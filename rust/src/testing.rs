//! An offline, programmable client for tests (the `testing` feature).
//!
//! [`MockServerClient`] answers requests from a FIFO queue and records them. It uses the real
//! client's validation, request encoding, retries and error mapping; only the network is
//! replaced, and no HTTP client is created. Enable the feature in `[dev-dependencies]`:
//!
//! ```toml
//! [dev-dependencies]
//! calmlens = { version = "0.1", features = ["testing"] }
//! ```
use crate::error::ErrorCode;
use crate::transport::{Attempt, AttemptBody, Exchange, ResponseBody};
use crate::{Error, Result, ServerClient, ServerClientBuilder};
use bytes::Bytes;
use http::{HeaderMap, HeaderName, HeaderValue};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    io,
    ops::Deref,
    sync::{Arc, Mutex},
};

/// A request captured by [`MockServerClient`], decoded so tests need not parse URLs by hand.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct Request {
    /// The HTTP method, e.g. `POST`.
    pub method: String,
    /// Full request URL, including the configured base URL and query string.
    pub url: String,
    /// URL path, e.g. `/v1/projects/project-1/assets`.
    pub path: String,
    /// Decoded query parameters in request order.
    pub query: Vec<(String, String)>,
    /// Header names are lowercase. The API key is replaced with `[redacted]`.
    pub headers: HashMap<String, String>,
    /// The request body, including streamed uploads.
    pub body: Vec<u8>,
}
impl Request {
    /// The first value of query parameter `name`.
    pub fn query_param(&self, name: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
    /// The value of header `name` (case-insensitive).
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .get(&name.to_ascii_lowercase())
            .map(String::as_str)
    }
    /// The body parsed as JSON, or `None` when it is empty or not JSON.
    pub fn json(&self) -> Option<Value> {
        serde_json::from_slice(&self.body).ok()
    }
}

/// A queued response with a status, headers and body.
#[derive(Clone, Debug)]
pub struct MockResponse {
    status: u16,
    headers: HeaderMap,
    body: Bytes,
}
impl MockResponse {
    /// An empty response with `status`.
    pub fn new(status: u16) -> Self {
        Self {
            status,
            headers: HeaderMap::new(),
            body: Bytes::new(),
        }
    }
    /// A JSON response serialized from a model or `serde_json::Value`.
    pub fn json(status: u16, body: impl serde::Serialize) -> Self {
        Self::new(status)
            .header("content-type", "application/json")
            .body(serde_json::to_vec(&body).expect("serializable mock response"))
    }
    /// The API's error response for `code`, with the status the API uses for it (400 for
    /// codes without one) and the same body shape: `{code, message, details}`.
    pub fn api_error(code: impl Into<ErrorCode>, message: impl Into<String>) -> Self {
        let code = code.into();
        let status = code.http_status().unwrap_or(400);
        Self::json(
            status,
            serde_json::json!({"code": code.as_str(), "message": message.into(), "details": {}}),
        )
    }
    /// Adds a header, e.g. `content-type`, `content-range` or `retry-after`.
    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.append(
            HeaderName::from_bytes(name.as_bytes()).expect("valid header name"),
            HeaderValue::from_str(value).expect("valid header value"),
        );
        self
    }
    /// Sets the body.
    pub fn body(mut self, body: impl Into<Bytes>) -> Self {
        self.body = body.into();
        self
    }
}

enum Reply {
    Response(MockResponse),
    Error(Error),
}
#[derive(Default)]
struct State {
    replies: VecDeque<Reply>,
    requests: Vec<Request>,
}
#[derive(Default)]
pub(crate) struct MockTransport(Mutex<State>);
impl MockTransport {
    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
    pub(crate) async fn exchange(&self, attempt: Attempt) -> Result<Exchange> {
        let body = match attempt.body {
            AttemptBody::Empty => Vec::new(),
            AttemptBody::Bytes(bytes) => bytes.to_vec(),
            AttemptBody::Stream(stream, size) => {
                let body = crate::transport::collect(stream).await?;
                if body.len() as u64 != size {
                    return Err(Error::new(
                        ErrorCode::TransportError,
                        format!("Upload stream yielded {} bytes, not {size}", body.len()),
                    ));
                }
                body
            }
        };
        let url = &attempt.url;
        let mut state = self.state();
        let number = state.requests.len() + 1;
        state.requests.push(Request {
            method: attempt.method.to_string(),
            url: url.to_string(),
            path: url.path().to_string(),
            query: url.query_pairs().into_owned().collect(),
            headers: attempt
                .headers
                .iter()
                .map(|(name, value)| {
                    let value = if name == "x-api-key" {
                        "[redacted]".into()
                    } else {
                        value.to_str().unwrap_or("").to_string()
                    };
                    (name.to_string(), value)
                })
                .collect(),
            body,
        });
        match state.replies.pop_front() {
            Some(Reply::Response(mut response)) => {
                if !response.headers.contains_key("x-request-id") {
                    response.headers.insert(
                        "x-request-id",
                        HeaderValue::from_str(&format!("mock-request-{number}"))
                            .expect("valid header value"),
                    );
                }
                Ok(Exchange {
                    status: response.status,
                    headers: response.headers,
                    body: ResponseBody::Mock(response.body),
                })
            }
            Some(Reply::Error(error)) => Err(error),
            None => Err(Error::new(
                ErrorCode::TransportError,
                "No queued mock response",
            )),
        }
    }
}

/// An offline client that answers requests from a FIFO queue. Dereferences to [`ServerClient`].
///
/// ```
/// # async fn run() -> calmlens::Result<()> {
/// use calmlens::{models::*, testing::MockServerClient};
/// let mock = MockServerClient::new()?;
/// mock.enqueue(
///     200,
///     Asset::new("asset-1", AssetClassificationStatus::Completed, AssetModerationStatus::Approved),
/// );
/// let asset = mock.assets().classify(SubmitAsset::text("hello")).await?;
/// assert_eq!(asset.id, "asset-1");
/// assert_eq!(mock.last_request().unwrap().body, b"hello");
/// # Ok(()) }
/// ```
pub struct MockServerClient {
    client: ServerClient,
    #[cfg_attr(not(feature = "blocking"), allow(dead_code))]
    builder: ServerClientBuilder,
    transport: Arc<MockTransport>,
}
impl std::fmt::Debug for MockServerClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MockServerClient")
            .field("client", &self.client)
            .field("remaining_responses", &self.remaining_responses())
            .finish()
    }
}
impl MockServerClient {
    /// A mock for project `project-1` with placeholder base URLs. Retries are off, so each
    /// call consumes exactly one queued reply; use [`MockServerClient::from_builder`] to test them.
    pub fn new() -> Result<Self> {
        Self::from_builder(
            ServerClient::builder("mock-key", "project-1")
                .base_url("https://api.calmlens.invalid/v1")
                .cdn_base_url("https://cdn.calmlens.invalid/v1")
                .max_retries(0),
        )
    }
    /// A mock configured exactly like a real client, e.g.
    /// `MockServerClient::from_builder(ServerClient::builder(key, project).base_url(url).max_retries(2))`.
    /// The configuration is validated the same way; no network requests are made.
    pub fn from_builder(builder: ServerClientBuilder) -> Result<Self> {
        let transport = Arc::new(MockTransport::default());
        let client = builder.clone().build_mock(transport.clone())?;
        Ok(Self {
            client,
            builder,
            transport,
        })
    }
    /// A [`ServerClient`] answered by this mock's queue and recorded in its
    /// [`requests`](Self::requests), for code under test that owns its client.
    pub fn client(&self) -> ServerClient {
        self.client.clone()
    }
    /// A [`blocking::ServerClient`](crate::blocking::ServerClient) answered by this mock's queue.
    #[cfg(feature = "blocking")]
    pub fn blocking(&self) -> Result<crate::blocking::ServerClient> {
        crate::blocking::ServerClient::from_async(
            self.builder.clone().build_mock(self.transport.clone())?,
        )
    }
    /// Queues a JSON response serialized from a native model or `serde_json::Value`.
    pub fn enqueue<T: serde::Serialize>(&self, status: u16, body: T) {
        self.enqueue_response(MockResponse::json(status, body));
    }
    /// Queues a response with a raw body and no headers.
    pub fn enqueue_raw(&self, status: u16, body: impl Into<Bytes>) {
        self.enqueue_response(MockResponse::new(status).body(body));
    }
    /// Queues a response with headers, e.g. a CDN response with `content-type`.
    pub fn enqueue_response(&self, response: MockResponse) {
        self.transport
            .state()
            .replies
            .push_back(Reply::Response(response));
    }
    /// Queues the API's error response for `code` with its real HTTP status, so the client
    /// returns the same [`Error`] as against the API.
    pub fn enqueue_api_error(&self, code: impl Into<ErrorCode>, message: impl Into<String>) {
        self.enqueue_response(MockResponse::api_error(code, message));
    }
    /// Queues a failure the next request returns as-is, after the request is captured.
    pub fn enqueue_error(&self, error: Error) {
        self.transport
            .state()
            .replies
            .push_back(Reply::Error(error));
    }
    /// Queues an `sdk/transport-error` (connection reset) whose `source()` is an `io::Error`.
    pub fn enqueue_transport_error(&self, message: &str) {
        self.enqueue_error(io_failure(
            ErrorCode::TransportError,
            io::ErrorKind::ConnectionReset,
            message,
        ));
    }
    /// Queues an `sdk/timeout` whose `source()` is an `io::Error` of kind `TimedOut`.
    pub fn enqueue_timeout(&self) {
        self.enqueue_error(io_failure(
            ErrorCode::Timeout,
            io::ErrorKind::TimedOut,
            "operation timed out",
        ));
    }
    /// Captured requests, oldest first.
    pub fn requests(&self) -> Vec<Request> {
        self.transport.state().requests.clone()
    }
    /// The most recent captured request.
    pub fn last_request(&self) -> Option<Request> {
        self.transport.state().requests.last().cloned()
    }
    /// The number of queued replies not yet used.
    pub fn remaining_responses(&self) -> usize {
        self.transport.state().replies.len()
    }
}
fn io_failure(code: ErrorCode, kind: io::ErrorKind, message: &str) -> Error {
    Error::new(code, message).with_source(io::Error::new(kind, message.to_string()))
}
impl Deref for MockServerClient {
    type Target = ServerClient;
    fn deref(&self) -> &ServerClient {
        &self.client
    }
}
