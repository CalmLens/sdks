//! Request execution: transports, retries, timeouts, size limits and error mapping.
use crate::error::{invalid_argument, ErrorCode};
use crate::models::Payload;
use crate::{Error, Result};
use bytes::Bytes;
use futures_util::TryStreamExt;
use http::{HeaderMap, HeaderName, HeaderValue, Method};
use serde_json::{Map, Value};
use std::time::Duration;

/// API JSON responses larger than this fail with `sdk/response-too-large`.
pub const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
/// The longest `Retry-After` delay the SDK waits for before giving up and returning the error.
pub(crate) const MAX_RETRY_AFTER: Duration = Duration::from_secs(60);

pub(crate) enum RequestBody {
    Empty,
    Bytes(Bytes),
    /// Read once; requests with a stream body are never retried.
    Stream(Option<crate::ByteStream>, u64),
}

pub(crate) struct Prepared {
    pub method: Method,
    pub url: reqwest::Url,
    pub headers: HeaderMap,
    pub body: RequestBody,
    /// Uploads and CDN downloads have no default whole-request timeout.
    pub transfer: bool,
}

impl Prepared {
    pub fn new(method: Method, url: reqwest::Url) -> Self {
        Self {
            method,
            url,
            headers: HeaderMap::new(),
            body: RequestBody::Empty,
            transfer: false,
        }
    }
    pub fn header(mut self, name: &'static str, value: &str) -> Result<Self> {
        let value = HeaderValue::from_str(value)
            .map_err(|_| invalid_argument(format!("Invalid {name} header value")))?;
        self.headers.insert(HeaderName::from_static(name), value);
        Ok(self)
    }
    pub fn json(mut self, body: &impl serde::Serialize) -> Result<Self> {
        let bytes = serde_json::to_vec(body)
            .map_err(|cause| invalid_argument(cause.to_string()).with_source(cause))?;
        self.headers.insert(
            http::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        self.body = RequestBody::Bytes(bytes.into());
        Ok(self)
    }
    /// GET and HEAD, and POSTs carrying an `Idempotency-Key`, can be repeated safely.
    fn retryable(&self) -> bool {
        !matches!(self.body, RequestBody::Stream(..))
            && (matches!(self.method, Method::GET | Method::HEAD)
                || self.headers.contains_key("idempotency-key"))
    }
    fn attempt(&mut self) -> Attempt {
        Attempt {
            method: self.method.clone(),
            url: self.url.clone(),
            headers: self.headers.clone(),
            body: match &mut self.body {
                RequestBody::Empty => AttemptBody::Empty,
                RequestBody::Bytes(bytes) => AttemptBody::Bytes(bytes.clone()),
                RequestBody::Stream(stream, size) => match stream.take() {
                    Some(stream) => AttemptBody::Stream(stream, *size),
                    None => AttemptBody::Empty,
                },
            },
        }
    }
}

/// One attempt at a request, as handed to a transport.
pub(crate) struct Attempt {
    pub method: Method,
    pub url: reqwest::Url,
    pub headers: HeaderMap,
    pub body: AttemptBody,
}
pub(crate) enum AttemptBody {
    Empty,
    Bytes(Bytes),
    Stream(crate::ByteStream, u64),
}

pub(crate) enum ResponseBody {
    Http(reqwest::Response),
    #[cfg(feature = "testing")]
    Mock(Bytes),
}
pub(crate) struct Exchange {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: ResponseBody,
}
impl Exchange {
    pub async fn read(self) -> Result<Bytes> {
        match self.body {
            #[cfg(feature = "testing")]
            ResponseBody::Mock(bytes) => Ok(bytes),
            ResponseBody::Http(mut response) => {
                if response
                    .content_length()
                    .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
                {
                    return Err(too_large(self.status, &self.headers));
                }
                let mut body = Vec::new();
                while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
                    if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                        return Err(too_large(self.status, &self.headers));
                    }
                    body.extend_from_slice(&chunk);
                }
                Ok(body.into())
            }
        }
    }
    /// The body as a stream, for CDN responses.
    pub fn stream(self) -> crate::ByteStream {
        match self.body {
            #[cfg(feature = "testing")]
            ResponseBody::Mock(bytes) => Box::pin(futures_util::stream::once(async move {
                Ok::<_, Box<dyn std::error::Error + Send + Sync>>(bytes)
            })),
            ResponseBody::Http(response) => Box::pin(
                response
                    .bytes_stream()
                    .map_err(|error| Box::new(error) as _),
            ),
        }
    }
}
fn too_large(status: u16, headers: &HeaderMap) -> Error {
    with_response(
        Error::new(
            ErrorCode::ResponseTooLarge,
            format!("Response exceeds {MAX_RESPONSE_BYTES} bytes"),
        ),
        status,
        headers,
    )
}

pub(crate) enum Transport {
    Http(reqwest::Client),
    #[cfg(feature = "testing")]
    Mock(std::sync::Arc<crate::testing::MockTransport>),
}

impl Transport {
    /// The clock waits are measured with: the mock's virtual clock, or Tokio's.
    pub(crate) fn now(&self) -> tokio::time::Instant {
        match self {
            #[cfg(feature = "testing")]
            Transport::Mock(mock) => mock.now(),
            Transport::Http(_) => tokio::time::Instant::now(),
        }
    }
    /// Waits for `duration`; the mock only advances its virtual clock.
    pub(crate) async fn sleep(&self, duration: Duration) {
        match self {
            #[cfg(feature = "testing")]
            Transport::Mock(mock) => mock.sleep(duration).await,
            Transport::Http(_) => tokio::time::sleep(duration).await,
        }
    }
    async fn exchange(&self, attempt: Attempt, timeout: Option<Duration>) -> Result<Exchange> {
        match self {
            #[cfg(feature = "testing")]
            Transport::Mock(mock) => mock.exchange(attempt).await,
            Transport::Http(client) => {
                let mut request = client
                    .request(attempt.method, attempt.url)
                    .headers(attempt.headers);
                request = match attempt.body {
                    AttemptBody::Empty => request,
                    AttemptBody::Bytes(bytes) => request.body(bytes),
                    AttemptBody::Stream(stream, size) => request
                        .header(http::header::CONTENT_LENGTH, size)
                        .body(reqwest::Body::wrap_stream(stream)),
                };
                if let Some(timeout) = timeout {
                    request = request.timeout(timeout);
                }
                let response = request.send().await.map_err(transport_error)?;
                Ok(Exchange {
                    status: response.status().as_u16(),
                    headers: response.headers().clone(),
                    body: ResponseBody::Http(response),
                })
            }
        }
    }
}

/// Retry and timeout settings for one call.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CallOptions {
    pub timeout: Duration,
    pub timeout_override: Option<Duration>,
    pub max_retries: u32,
}

/// Sends `request`, retrying transport failures, `429`, `502`, `503`, `504` and
/// `idempotency/request-in-progress` with jittered backoff when the request is repeatable.
/// With `api_errors`, an unsuccessful status is returned as an [`Error`]; without it (CDN
/// requests) the final response is returned whatever its status.
pub(crate) async fn execute(
    transport: &Transport,
    mut request: Prepared,
    options: CallOptions,
    api_errors: bool,
) -> Result<Exchange> {
    let max_retries = if request.retryable() {
        options.max_retries
    } else {
        0
    };
    let timeout = options
        .timeout_override
        .or((!request.transfer).then_some(options.timeout));
    let mut retry = 0;
    loop {
        let result = transport.exchange(request.attempt(), timeout).await;
        let failure = match result {
            Ok(exchange) if (200..300).contains(&exchange.status) => return Ok(exchange),
            Ok(exchange) if !api_errors && !matches!(exchange.status, 429 | 502 | 503 | 504) => {
                return Ok(exchange)
            }
            Ok(exchange) if !api_errors && retry >= max_retries => return Ok(exchange),
            Ok(exchange) => {
                let status = exchange.status;
                let headers = exchange.headers.clone();
                let body = exchange.read().await?;
                api_error(status, &headers, &body)
            }
            Err(error) => error,
        };
        if retry >= max_retries || !failure.is_retryable() {
            return Err(failure);
        }
        let delay = match failure.retry_after() {
            Some(delay) if delay > MAX_RETRY_AFTER => return Err(failure),
            Some(delay) => delay,
            None => backoff(retry),
        };
        transport.sleep(delay).await;
        retry += 1;
    }
}

/// Full jitter: a random delay up to 0.5s, 1s, 2s, ... capped at 8s.
fn backoff(retry: u32) -> Duration {
    let ceiling = 500u64.saturating_mul(1 << retry.min(4));
    Duration::from_millis(random_u64() % (ceiling + 1))
}

pub(crate) fn random_u64() -> u64 {
    let mut bytes = [0; 8];
    let _ = getrandom::getrandom(&mut bytes);
    u64::from_le_bytes(bytes)
}

/// A random (version 4) UUID, used as an `Idempotency-Key`.
pub(crate) fn uuid() -> String {
    let mut bytes = [0u8; 16];
    let _ = getrandom::getrandom(&mut bytes);
    if bytes == [0; 16] {
        bytes[..8].copy_from_slice(&random_u64().to_le_bytes());
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

/// Adds the response's status, request ID, `Retry-After` and headers to `error`.
pub(crate) fn with_response(mut error: Error, status: u16, headers: &HeaderMap) -> Error {
    error = error.with_status(status).with_headers(headers.clone());
    if let Some(id) = headers.get("x-request-id").and_then(|v| v.to_str().ok()) {
        error = error.with_request_id(id);
    }
    if let Some(seconds) = headers
        .get(http::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
    {
        error = error.with_retry_after(Duration::from_secs(seconds));
    }
    error
}

/// The [`Error`] for an unsuccessful API response.
pub(crate) fn api_error(status: u16, headers: &HeaderMap, body: &[u8]) -> Error {
    let parsed = serde_json::from_slice::<Value>(body);
    let error = match &parsed {
        Ok(Value::Object(object)) => {
            let text = |key: &str| object.get(key).and_then(Value::as_str);
            let mut details: Map<String, Value> = object
                .get("details")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            details.insert("network".into(), Value::Bool(true));
            if let Some(trace) = object.get("traceId") {
                details.insert("traceId".into(), trace.clone());
            }
            Error::new(
                text("code").unwrap_or("sdk/http-error"),
                text("message")
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("HTTP {status}")),
            )
            .with_details(details)
        }
        _ => {
            let error = Error::new(ErrorCode::HttpError, format!("HTTP {status}"));
            match parsed {
                Err(cause) if !body.is_empty() => error.with_source(cause),
                _ => error,
            }
        }
    };
    with_response(error, status, headers)
}

/// Decodes a successful JSON response.
pub(crate) fn decode<T: serde::de::DeserializeOwned>(
    status: u16,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<T> {
    let body: &[u8] = if body.is_empty() { b"null" } else { body };
    serde_json::from_slice(body).map_err(|cause| {
        with_response(
            Error::new(
                ErrorCode::InvalidResponse,
                format!("Invalid JSON response (HTTP {status}): {cause}"),
            )
            .with_source(cause),
            status,
            headers,
        )
    })
}

pub(crate) fn transport_error(error: reqwest::Error) -> Error {
    let code = if is_timeout(&error) {
        ErrorCode::Timeout
    } else {
        ErrorCode::TransportError
    };
    Error::new(code, error.to_string()).with_source(error)
}

fn is_timeout(error: &reqwest::Error) -> bool {
    if error.is_timeout() {
        return true;
    }
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        if cause
            .downcast_ref::<std::io::Error>()
            .is_some_and(|io| io.kind() == std::io::ErrorKind::TimedOut)
        {
            return true;
        }
        source = cause.source();
    }
    false
}

/// Maps a failed streaming read to `sdk/timeout` or `sdk/transport-error`.
pub(crate) fn stream_error(error: Box<dyn std::error::Error + Send + Sync>) -> Error {
    match error.downcast::<reqwest::Error>() {
        Ok(error) => transport_error(*error),
        Err(error) => {
            let timed_out = error
                .downcast_ref::<std::io::Error>()
                .is_some_and(|io| io.kind() == std::io::ErrorKind::TimedOut);
            Error::new(
                if timed_out {
                    ErrorCode::Timeout
                } else {
                    ErrorCode::TransportError
                },
                error.to_string(),
            )
            .with_source(error)
        }
    }
}

/// The request body for an upload payload, and its size.
pub(crate) fn upload_body(
    payload: Payload,
    multipart: bool,
    declared_size: Option<u64>,
) -> Result<(RequestBody, u64)> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let (body, size) = match payload {
        Payload::Text(text) => {
            let size = text.len() as u64;
            (RequestBody::Bytes(Bytes::from(text)), size)
        }
        Payload::Bytes(bytes) => {
            let size = bytes.len() as u64;
            (RequestBody::Bytes(bytes), size)
        }
        Payload::Base64(encoded) => {
            let mut encoded: String = encoded
                .rsplit(";base64,")
                .next()
                .unwrap_or("")
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect();
            if multipart && !encoded.len().is_multiple_of(4) {
                return Err(crate::error::invalid_payload(
                    "Split bytes before base64-encoding each part",
                ));
            }
            encoded.push_str(&"=".repeat((4 - encoded.len() % 4) % 4));
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| crate::error::invalid_payload("Invalid base64"))?;
            let size = bytes.len() as u64;
            (RequestBody::Bytes(bytes.into()), size)
        }
        Payload::Reader { reader, size } => {
            (RequestBody::Stream(Some(reader_stream(reader)), size), size)
        }
        Payload::Stream { stream, size } => (RequestBody::Stream(Some(stream), size), size),
    };
    if declared_size.is_some_and(|declared| declared != size) {
        return Err(crate::error::invalid_payload(
            "sizeInBytes must match the payload byte length",
        ));
    }
    Ok((body, size))
}

/// Reads a blocking reader in 64 KiB chunks on Tokio's blocking thread pool.
fn reader_stream(reader: Box<dyn std::io::Read + Send>) -> crate::ByteStream {
    let stream = futures_util::stream::try_unfold(Some(reader), |state| async move {
        let Some(mut reader) = state else {
            return Ok(None);
        };
        let (reader, chunk) = tokio::task::spawn_blocking(move || {
            let mut buffer = vec![0; 64 * 1024];
            let read = reader.read(&mut buffer)?;
            buffer.truncate(read);
            Ok::<_, std::io::Error>((reader, buffer))
        })
        .await
        .map_err(std::io::Error::other)??;
        if chunk.is_empty() {
            Ok::<_, std::io::Error>(None)
        } else {
            Ok(Some((Bytes::from(chunk), Some(reader))))
        }
    });
    Box::pin(stream.map_err(|error| Box::new(error) as _))
}

/// Collects a request stream, for mocks.
#[cfg(feature = "testing")]
pub(crate) async fn collect(stream: crate::ByteStream) -> Result<Vec<u8>> {
    use futures_util::StreamExt;
    let mut body = Vec::new();
    let mut stream = stream;
    while let Some(chunk) = stream.next().await {
        body.extend_from_slice(&chunk.map_err(stream_error)?);
    }
    Ok(body)
}
