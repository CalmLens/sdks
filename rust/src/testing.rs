//! An offline, programmable client for tests (the `testing` feature).
//!
//! [`MockServerClient`] records every request and answers it from a FIFO queue of scripted
//! replies. It uses the real client's validation, request encoding, retries and error mapping;
//! only the network is replaced, and no HTTP client is created. [`MockServerClient::in_memory`]
//! adds an in-memory API behind the queue: uploads create assets that a `moderate` callback
//! ([`MockOptions::moderate`]) decides with a [`MockDecision`], and assets, folders, hash lists,
//! events and CDN downloads behave like the API's. Against a real project, signed test inputs
//! ([`generate_test_text_code`], [`paint_test_image`], [`generate_media_test_code`]) make
//! CalmLens decide an input as a chosen [`TestInput`] scenario. Enable the feature in
//! `[dev-dependencies]`:
//!
//! ```toml
//! [dev-dependencies]
//! calmlens = { version = "0.1", features = ["testing"] }
//! ```
// Generated (packages/sdk-contract/mockAssetFilters.ts).
mod asset_filters;
// Generated, one line per list (packages/sdk-contract/mockClassification.ts).
#[rustfmt::skip]
mod classification;
mod decision;
mod image_grid;
mod inputs;
mod memory;
mod placeholder;

pub use decision::{
    IntoMockDecision, MockDecision, MockModerationContent, MockModerationInput,
    MockModerationTrigger, MockOutcome,
};
pub use inputs::{
    generate_media_test_code, generate_test_text_code, paint_test_image, test_input_for_signal,
    TestAgeRange, TestDetectionList, TestDetections, TestFace, TestFaceAge, TestImage, TestInput,
    TestInputInstance, TestInputKind, TestInputPreset, TestPerson, TestRegionalAction,
    TestScenario, MEDIA_TEST_SIGNALS, TEST_INPUT_SIGNALS,
};
pub use memory::{
    create_mock_api_key, MockApiKeyGrant, MockFailure, MockFailureOptions, MockOptions,
    MockStorage, StoredContent,
};

use crate::error::ErrorCode;
use crate::models::{Actor, ActorType, Asset, AssetModerationDecision, Event};
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
    time::Duration,
};

/// A request captured by [`MockServerClient`], decoded so tests need not parse URLs by hand.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct Request {
    /// The HTTP method, e.g. `POST`.
    pub method: String,
    /// Full request URL, including the configured base URL and query string.
    pub url: String,
    /// The path relative to the API (or CDN) base URL, each segment decoded, e.g.
    /// `/projects/project-1/assets` or `/assets/asset_5Gm2Rk8XqT3wLp9VbN4c`. A request to
    /// neither base URL keeps its whole decoded URL path.
    pub path: String,
    /// Decoded query parameters in request order.
    pub query: Vec<(String, String)>,
    /// Header names are lowercase; repeated headers keep their last value.
    pub headers: HashMap<String, String>,
    /// The request body, including streamed uploads.
    pub body: Vec<u8>,
    /// The HTTP status the mock answered with, or `None` when the request failed without a
    /// response (a transport error or timeout).
    pub response_status: Option<u16>,
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
    /// An API error body, which gets the response's request ID as `requestId`.
    api_error: bool,
}
impl MockResponse {
    /// An empty response with `status`.
    pub fn new(status: u16) -> Self {
        Self {
            status,
            headers: HeaderMap::new(),
            body: Bytes::new(),
            api_error: false,
        }
    }
    /// A JSON response serialized from a model or `serde_json::Value`.
    pub fn json(status: u16, body: impl serde::Serialize) -> Self {
        Self::new(status)
            .header("content-type", "application/json")
            .body(serde_json::to_vec(&body).expect("serializable mock response"))
    }
    /// The API's error response for `code`, with the status the API uses for it (400 for
    /// codes without one) and the same body shape: `{code, message, requestId, details}`, where
    /// `requestId` is the `x-request-id` header the mock adds.
    pub fn api_error(code: impl Into<ErrorCode>, message: impl Into<String>) -> Self {
        let code = code.into();
        let status = code.http_status().unwrap_or(400);
        Self::api_error_body(status, code.as_str(), message.into(), serde_json::json!({}))
    }
    /// An API error response with `status` and the body `{code, message, requestId, details}`.
    pub(crate) fn api_error_body(status: u16, code: &str, message: String, details: Value) -> Self {
        let mut response = Self::json(
            status,
            serde_json::json!({"code": code, "message": message, "details": details}),
        );
        response.api_error = true;
        response
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
    /// No response until the attempt's timeout.
    Hang,
}
#[derive(Default)]
struct State {
    replies: VecDeque<Reply>,
    requests: Vec<Request>,
    backend: Option<memory::Backend>,
    /// Virtual time the client's waits and timeouts have advanced.
    elapsed: Duration,
    /// Each wait between attempts and polls, in order.
    sleeps: Vec<Duration>,
    /// The API and CDN base URLs, which recorded paths are relative to.
    base_urls: [String; 2],
}
pub(crate) struct MockTransport {
    state: Mutex<State>,
    started: tokio::time::Instant,
}
impl MockTransport {
    fn new(state: State) -> Self {
        Self {
            state: Mutex::new(state),
            started: tokio::time::Instant::now(),
        }
    }
    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
    /// Whether an in-memory API answers requests, which then makes the multipart size checks.
    pub(crate) fn defers_upload_checks(&self) -> bool {
        self.state().backend.is_some()
    }
    /// The virtual clock: the time the mock was created plus the waits since.
    pub(crate) fn now(&self) -> tokio::time::Instant {
        self.started + self.state().elapsed
    }
    /// Advances the virtual clock instead of waiting, then yields once to the runtime.
    pub(crate) async fn sleep(&self, duration: Duration) {
        {
            let mut state = self.state();
            state.elapsed = state.elapsed.saturating_add(duration);
            state.sleeps.push(duration);
        }
        tokio::task::yield_now().await;
    }
    pub(crate) async fn exchange(
        &self,
        attempt: Attempt,
        timeout: Option<Duration>,
    ) -> Result<Exchange> {
        let body = match attempt.body {
            AttemptBody::Empty => Vec::new(),
            AttemptBody::Bytes(bytes) => bytes.to_vec(),
            AttemptBody::Stream(stream, size) => {
                let body = crate::transport::collect(stream).await?;
                if let Some(size) = size.filter(|size| body.len() as u64 != *size) {
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
        let reply = match state.replies.pop_front() {
            Some(reply) => Some(reply),
            None => state.backend.as_mut().map(|backend| {
                let Some(queued) = backend.take_failure(&attempt.method, url) else {
                    return match backend.handle(&attempt.method, url, &attempt.headers, &body) {
                        Ok(response) => Reply::Response(response),
                        Err(error) => Reply::Error(error),
                    };
                };
                match queued.failure {
                    MockFailure::TransportError => Reply::Error(io_failure(
                        ErrorCode::TransportError,
                        io::ErrorKind::ConnectionReset,
                        "connection reset",
                    )),
                    MockFailure::Timeout => Reply::Error(io_failure(
                        ErrorCode::Timeout,
                        io::ErrorKind::TimedOut,
                        "operation timed out",
                    )),
                    MockFailure::Api(code) => {
                        let message = format!("Injected {code} failure");
                        let status = code.http_status().unwrap_or(400);
                        let details = Value::Object(queued.options.details.unwrap_or_default());
                        let mut response =
                            MockResponse::api_error_body(status, code.as_str(), message, details);
                        if let Some(seconds) = queued.options.retry_after {
                            response = response.header("retry-after", &seconds.to_string());
                        }
                        Reply::Response(response)
                    }
                }
            }),
        };
        let path = relative_path(url, &state.base_urls);
        state.requests.push(Request {
            method: attempt.method.to_string(),
            url: url.to_string(),
            path,
            query: url.query_pairs().into_owned().collect(),
            headers: attempt
                .headers
                .iter()
                .map(|(name, value)| (name.to_string(), value.to_str().unwrap_or("").to_string()))
                .collect(),
            body,
            response_status: match &reply {
                Some(Reply::Response(response)) => Some(response.status),
                _ => None,
            },
        });
        match reply {
            Some(Reply::Response(mut response)) => {
                // API errors the mock builds carry a request ID, in the header and the body;
                // responses a test scripts are sent exactly as scripted.
                if response.api_error && !response.headers.contains_key("x-request-id") {
                    let request_id = format!("mock-request-{number}");
                    if let Ok(Value::Object(mut error)) =
                        serde_json::from_slice::<Value>(&response.body)
                    {
                        error.insert("requestId".into(), request_id.clone().into());
                        response.body = serde_json::to_vec(&error)
                            .expect("serializable mock response")
                            .into();
                    }
                    response.headers.insert(
                        "x-request-id",
                        HeaderValue::from_str(&request_id).expect("valid header value"),
                    );
                }
                Ok(Exchange {
                    status: response.status,
                    headers: response.headers,
                    body: ResponseBody::Mock(response.body),
                })
            }
            Some(Reply::Error(error)) => Err(error),
            Some(Reply::Hang) => {
                // The attempt's deadline passes on the virtual clock; without one it would
                // wait forever, so it fails at once.
                if let Some(timeout) = timeout {
                    state.elapsed = state.elapsed.saturating_add(timeout);
                }
                Err(io_failure(
                    ErrorCode::Timeout,
                    io::ErrorKind::TimedOut,
                    "operation timed out",
                ))
            }
            None => Err(Error::new(
                ErrorCode::TransportError,
                "No queued mock response",
            )),
        }
    }
}

/// An offline client that records requests and answers them from a FIFO queue of scripted
/// replies, then, when created with [`in_memory`](Self::in_memory), from an in-memory API.
/// Dereferences to [`ServerClient`].
///
/// Waits take no real time: retry backoff and `wait_for_decision` advance a virtual clock
/// ([`elapsed`](Self::elapsed)), so a decision that never comes times out at once.
///
/// ```
/// # async fn run() -> calmlens::Result<()> {
/// use calmlens::{models::*, testing::MockServerClient};
/// let mock = MockServerClient::new()?;
/// mock.enqueue(
///     200,
///     Asset::new("asset-1", AssetClassificationStatus::Completed, AssetModerationStatus::Allowed),
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
                .base_url(memory::API_BASE_URL)
                .cdn_base_url(memory::CDN_BASE_URL)
                .max_retries(0),
        )
    }
    /// A mock backed by an in-memory API, configured by `options`. Queued replies are still
    /// used first, in order; once the queue is empty, requests reach the in-memory API.
    ///
    /// Uploads create assets, which [`MockOptions::moderate`] decides (by default queued
    /// uploads, from `assets().create` or a queued multipart upload, stay `pending` until
    /// [`complete_processing`](Self::complete_processing), and the rest are `allowed`). A decided
    /// asset gets a full report, and the events feed records `asset.uploaded`, then
    /// `asset.classified` and the automated `asset.<status>`, or `asset.failed`. Finished
    /// processing removes the content unless the upload set `keep_content_after_processing`;
    /// `purged` removes it with reason `policy`.
    /// Retrieve, list (RSQL filter, ordering, folder, cursor), children, update, move, delete,
    /// delete content, retry, keyword search, signed URLs, folders, hash lists, lenses and the
    /// events feed read and change that storage, with the API's error codes, statuses and idempotent
    /// replays. `wait_for_decision` returns at once for a settled asset (processing `completed`
    /// or `failed`); a queued or processing one waits for [`decide`](Self::decide),
    /// [`complete_processing`](Self::complete_processing) or the timeout. The CDN serves stored bytes, refusing
    /// blocked and purged assets, age-restricted ones requested without
    /// `ViewerClaims::age_confirmed` set to `true` whatever the key, and private ones unless the
    /// API key has an `assets:download` grant ([`create_mock_api_key`]). Served content has its stored `content-type` and
    /// the CDN's `cache-control`: `public` only when anyone may see the asset, otherwise
    /// `private`, with `max-age=31536000, immutable` for images and `max-age=3600` otherwise.
    /// Content is never classified or transformed.
    ///
    /// ```
    /// # async fn run() -> calmlens::Result<()> {
    /// use calmlens::{models::*, testing::*};
    /// let mock = MockServerClient::in_memory(MockOptions::new())?;
    /// let asset = mock.assets().create(SubmitAsset::text("hello")).await?;
    /// assert_eq!(asset.classification.moderation.status, AssetModerationStatus::Pending);
    /// mock.complete_processing(&asset.id, Some(MockOutcome::Blocked.into()))?;
    /// let asset = mock.assets().retrieve(AssetId::new(&asset.id)).await?;
    /// assert_eq!(asset.classification.moderation.status, AssetModerationStatus::Blocked);
    /// # Ok(()) }
    /// ```
    pub fn in_memory(options: MockOptions) -> Result<Self> {
        let mut builder =
            ServerClient::builder(options.api_key.clone(), options.project_id.clone())
                .base_url(&options.api_base_url)
                .cdn_base_url(&options.cdn_base_url)
                .max_retries(options.max_retries);
        if let Some(value) = options.upload_timeout {
            builder = builder.upload_timeout(value);
        }
        if let Some(value) = options.max_response_bytes {
            builder = builder.max_response_bytes(value);
        }
        if let Some(value) = options.part_size_bytes {
            builder = builder.part_size_bytes(value);
        }
        let transport = Arc::new(MockTransport::new(State {
            backend: Some(memory::Backend::new(options)),
            base_urls: builder.base_urls(),
            ..State::default()
        }));
        let client = builder.clone().build_mock(transport.clone())?;
        Ok(Self {
            client,
            builder,
            transport,
        })
    }
    fn backend<R>(&self, f: impl FnOnce(&mut memory::Backend) -> R) -> R {
        let mut state = self.transport.state();
        let backend = state
            .backend
            .as_mut()
            .expect("this MockServerClient was not created with MockServerClient::in_memory");
        f(backend)
    }
    /// Runs `f` on the in-memory storage, e.g. to seed assets or inspect stored content.
    ///
    /// # Panics
    ///
    /// When the mock was not created with [`MockServerClient::in_memory`].
    pub fn with_storage<R>(&self, f: impl FnOnce(&mut MockStorage) -> R) -> R {
        self.backend(|backend| f(&mut backend.storage))
    }
    /// Applies a reviewer decision to a stored asset, as the portal would: the moderation
    /// status changes (`purged` removes the content), the review is added to `manual_reviews`,
    /// and an `asset.<status>` event whose `actor` is a `user` joins the events feed (after an
    /// `asset.content-removed` event for a purge).
    /// The report stays as moderation left it. Fails with `sdk/invalid-argument` for a decision
    /// that is not `allowed`, `limited`, `age-restricted`, `blocked` or `purged`, and with
    /// `asset/not-found` (status 404) for an unknown asset.
    ///
    /// # Panics
    ///
    /// When the mock was not created with [`MockServerClient::in_memory`].
    pub fn decide(&self, asset_id: &str, decision: AssetModerationDecision) -> Result<Asset> {
        if matches!(decision, AssetModerationDecision::Unknown(_)) {
            return Err(Error::new(
                ErrorCode::InvalidArgument,
                "decision must be one of allowed, limited, age-restricted, blocked, purged",
            ));
        }
        let asset = self
            .backend(|backend| backend.decide(asset_id, decision.as_str()))
            .ok_or_else(|| {
                Error::new(ErrorCode::AssetNotFound, "Asset not found").with_status(404)
            })?;
        decode_asset(asset)
    }
    /// Finishes processing a stored asset as the pipeline would and returns it: with
    /// `decision`, or else what [`MockOptions::moderate`] returns for the
    /// [`Complete`](MockModerationTrigger::Complete) trigger (by default `allowed`). It records
    /// the processing events and no manual review; a `pending` decision leaves the asset
    /// processing. Fails with `asset/not-found` (status 404) for an unknown asset and with
    /// `sdk/invalid-argument` for one that isn't processing.
    ///
    /// # Panics
    ///
    /// When the mock was not created with [`MockServerClient::in_memory`].
    pub fn complete_processing(
        &self,
        asset_id: &str,
        decision: Option<MockDecision>,
    ) -> Result<Asset> {
        let asset = self.backend(|backend| backend.complete_processing(asset_id, decision))?;
        decode_asset(asset)
    }
    /// Replaces the grants of the mock's API key, as editing the key in the portal would: later
    /// requests, such as CDN downloads, use them. The key itself stays the same, so its
    /// idempotency keys still replay.
    ///
    /// # Panics
    ///
    /// When the mock was not created with [`MockServerClient::in_memory`].
    pub fn set_api_key_grants(&self, grants: &[MockApiKeyGrant]) {
        self.backend(|backend| backend.set_grants(grants));
    }
    /// Makes the next request (or, with [`MockFailureOptions::operation`], the next request of
    /// that operation) fail with `failure` instead of reaching the in-memory API, which it
    /// leaves unchanged. An API error carries the options' `details` and, with `retry_after`,
    /// a `Retry-After` header. Each queued failure fails exactly one request, so a client retry
    /// takes the next queued failure or reaches the API; queue several to fail several requests.
    /// The operation is the JavaScript SDK's method path, such as `assets.create`,
    /// `assets.uploadPart` or `cdn.serve`; a convenience fails with the request it sends
    /// (`assets.waitForDecision` with `assets.retrieve`, `text.classify` with
    /// `assets.classify`, `ensureLens` with `ensureLenses`, iterators with their list). Fails
    /// with `sdk/invalid-argument`, queueing nothing, for an unknown operation or for `details`
    /// or `retry_after` with a transport error or timeout.
    ///
    /// # Panics
    ///
    /// When the mock was not created with [`MockServerClient::in_memory`].
    pub fn fail_next_request(
        &self,
        failure: MockFailure,
        options: MockFailureOptions,
    ) -> Result<()> {
        if let Some(operation) = &options.operation {
            if !memory::OPERATIONS.contains(&operation.as_str()) {
                return Err(Error::new(
                    ErrorCode::InvalidArgument,
                    format!("{operation:?} is not a client method that sends requests"),
                ));
            }
        }
        if !matches!(failure, MockFailure::Api(_))
            && (options.details.is_some() || options.retry_after.is_some())
        {
            return Err(Error::new(
                ErrorCode::InvalidArgument,
                "details and retry_after apply only to an API error code",
            ));
        }
        self.backend(|backend| {
            backend.queue_failure(memory::QueuedFailure { failure, options });
        });
        Ok(())
    }
    /// Appends `event` to the in-memory events feed and returns it. An empty ID or project ID,
    /// or a zero creation time, is filled in, and an event without an actor is the mock API
    /// key's (`api-key` with no ID); an event about an asset takes that asset's next
    /// `asset_sequence` like the API's (any given one is ignored; events without an `asset_id`
    /// have none); when `asset_id` names a stored asset and `asset`
    /// is `None`, the event carries its snapshot, with the moderation status an
    /// `asset.<status>` event announces. `events().list` returns it to cursors taken
    /// before it was added.
    ///
    /// # Panics
    ///
    /// When the mock was not created with [`MockServerClient::in_memory`].
    pub fn enqueue_event(&self, mut event: Event) -> Event {
        self.backend(|backend| {
            if event.id.is_empty() {
                event.id = backend.create_id("evt");
            }
            if event.project_id.is_empty() {
                event.project_id = backend.project_id().to_owned();
            }
            if event.created_at == 0 {
                event.created_at = backend.now();
            }
            // The mock's API key, which has no ID, unless the event names someone else.
            if event.actor.actor_type == ActorType::Unknown(String::new()) {
                event.actor = Actor::new(ActorType::ApiKey, None);
            }
            event.asset_sequence = event
                .asset_id
                .as_deref()
                .map(|id| backend.next_asset_sequence(id));
            let mut stored = serde_json::to_value(&event).expect("serializable event");
            if event.asset.is_none() {
                if let Some(asset) = event
                    .asset_id
                    .as_ref()
                    .and_then(|id| backend.storage.assets.get(id))
                {
                    stored["asset"] = memory::snapshot(asset);
                    // An `asset.<status>` event carries the moderation status it announces.
                    if let Some(status) = memory::announced_status(&stored["type"]) {
                        stored["asset"]["classification"]["moderation"]["status"] = status.into();
                    }
                    event.asset = serde_json::from_value(stored["asset"].clone()).ok();
                }
            }
            backend.storage.events.push(stored);
            event
        })
    }
    /// A mock configured exactly like a real client, e.g.
    /// `MockServerClient::from_builder(ServerClient::builder(key, project).base_url(url).max_retries(2))`.
    /// The configuration is validated the same way; no network requests are made.
    pub fn from_builder(builder: ServerClientBuilder) -> Result<Self> {
        let transport = Arc::new(MockTransport::new(State {
            base_urls: builder.base_urls(),
            ..State::default()
        }));
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
    /// Queues a request that gets no response: it fails with `sdk/timeout` once the attempt's
    /// timeout passes on the virtual clock (at once for an attempt without one).
    pub fn enqueue_hang(&self) {
        self.transport.state().replies.push_back(Reply::Hang);
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
    /// Forgets the requests captured so far.
    pub fn clear_requests(&self) {
        self.transport.state().requests.clear();
    }
    /// The most recent captured request.
    pub fn last_request(&self) -> Option<Request> {
        self.transport.state().requests.last().cloned()
    }
    /// The number of queued replies not yet used.
    pub fn remaining_responses(&self) -> usize {
        self.transport.state().replies.len()
    }
    /// The virtual time this mock's clients have waited: retry backoff, `wait_for_decision`
    /// and the timeouts of [`enqueue_hang`](Self::enqueue_hang) advance it instead of sleeping.
    pub fn elapsed(&self) -> Duration {
        self.transport.state().elapsed
    }
    /// Each wait the clients made between attempts (retry backoff, `Retry-After`) and
    /// between `wait_for_decision` checks, in order.
    pub fn sleeps(&self) -> Vec<Duration> {
        self.transport.state().sleeps.clone()
    }
}
/// Signs an upload token exactly as
/// [`UploadTokensClient::sign`](crate::UploadTokensClient::sign) does, with the same
/// validation, but at `now` (milliseconds since the Unix epoch) and with `nonce`, so a test can
/// compare the whole token.
pub fn sign_upload_token(
    api_key: &str,
    options: crate::models::SignUploadToken,
    now: u64,
    nonce: &str,
) -> Result<crate::models::SignedUploadToken> {
    crate::client::sign_upload_token(api_key, options, now, nonce)
}

/// `url`'s path relative to the first base URL it is under, as `/` and its decoded segments.
fn relative_path(url: &reqwest::Url, base_urls: &[String; 2]) -> String {
    let rest = base_urls
        .iter()
        .find_map(|base| memory::under(url, base))
        .unwrap_or(url.path());
    let segments: Vec<String> = rest
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(memory::percent_decode)
        .collect();
    format!("/{}", segments.join("/"))
}

fn decode_asset(asset: Value) -> Result<Asset> {
    serde_json::from_value(asset)
        .map_err(|cause| Error::new(ErrorCode::InvalidResponse, cause.to_string()))
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

#[cfg(test)]
mod tests {
    use super::classification::{CATEGORIES, QUALIFIERS};
    use serde_json::{json, Value};

    /// The generated category and qualifier lists the decision builder checks match the
    /// contract's `classification` in `testdata/surface.json`.
    #[test]
    fn classification_lists_match_the_surface() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/surface.json");
        let surface: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let qualifiers: serde_json::Map<String, Value> = QUALIFIERS
            .iter()
            .map(|(category, qualifiers)| ((*category).to_owned(), json!(qualifiers)))
            .collect();
        assert_eq!(
            json!({"categories": CATEGORIES, "qualifiers": qualifiers}),
            surface["classification"]
        );
    }
}
