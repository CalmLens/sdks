//! Request execution: transports, retries, timeouts, size limits and error mapping.
use crate::error::{invalid_argument, ErrorCode};
use crate::models::Payload;
use crate::{Error, Result};
use bytes::Bytes;
use futures_util::TryStreamExt;
use http::{HeaderMap, HeaderName, HeaderValue, Method};
use serde_json::{Map, Value};
use std::time::Duration;

/// The default size limit for API responses: larger ones fail with `sdk/response-too-large`.
/// Change it with [`ServerClientBuilder::max_response_bytes`](crate::ServerClientBuilder::max_response_bytes).
pub const DEFAULT_MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
/// The longest `Retry-After` delay the SDK waits for; a longer one returns the error (or, for
/// `cdn().serve`, the response) to the caller instead.
pub const RETRY_AFTER_MAX: Duration = Duration::from_secs(60);
/// The backoff before retry `n` (from 0) is `min(RETRY_MAX_DELAY, RETRY_BASE_DELAY * 2^n)`, of
/// which the client waits half plus a random share of the other half.
pub const RETRY_BASE_DELAY: Duration = Duration::from_millis(500);
/// The longest backoff between attempts.
pub const RETRY_MAX_DELAY: Duration = Duration::from_secs(8);

pub(crate) enum RequestBody {
    Empty,
    Bytes(Bytes),
    /// Read once; requests with a stream body are never retried. The size is sent as
    /// `Content-Length` when known.
    Stream(Option<crate::ByteStream>, Option<u64>),
}

/// Which deadline a request has.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Deadline {
    /// API calls: the client timeout covers the whole exchange, body included.
    Api,
    /// Binary uploads: the upload timeout (none by default) covers the whole exchange.
    Upload,
    /// CDN downloads: the client timeout ends when the response headers arrive, so the body
    /// can stream for as long as it takes.
    Headers,
}

pub(crate) struct Prepared {
    pub method: Method,
    pub url: reqwest::Url,
    pub headers: HeaderMap,
    pub body: RequestBody,
    pub deadline: Deadline,
}

impl Prepared {
    pub fn new(method: Method, url: reqwest::Url) -> Self {
        Self {
            method,
            url,
            headers: HeaderMap::new(),
            body: RequestBody::Empty,
            deadline: Deadline::Api,
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
    Stream(crate::ByteStream, Option<u64>),
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
    /// Reads the whole body, failing with `sdk/response-too-large` as soon as it (or the
    /// declared `Content-Length`) exceeds `limit` bytes.
    pub async fn read(self, limit: usize) -> Result<Bytes> {
        let declared = self
            .headers
            .get(http::header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<u64>().ok());
        if declared.is_some_and(|length| length > limit as u64) {
            return Err(too_large(limit, self.status, &self.headers));
        }
        match self.body {
            #[cfg(feature = "testing")]
            ResponseBody::Mock(bytes) if bytes.len() > limit => {
                Err(too_large(limit, self.status, &self.headers))
            }
            #[cfg(feature = "testing")]
            ResponseBody::Mock(bytes) => Ok(bytes),
            ResponseBody::Http(mut response) => {
                let mut body = Vec::new();
                while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
                    if body.len() + chunk.len() > limit {
                        return Err(too_large(limit, self.status, &self.headers));
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
fn too_large(limit: usize, status: u16, headers: &HeaderMap) -> Error {
    with_response(
        Error::new(
            ErrorCode::ResponseTooLarge,
            format!("Response body exceeds {limit} bytes"),
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
    /// Whether the client leaves multipart size checks to the API: only the in-memory mock's
    /// does, so its API answers them in the API's order.
    pub(crate) fn defers_upload_checks(&self) -> bool {
        match self {
            #[cfg(feature = "testing")]
            Transport::Mock(mock) => mock.defers_upload_checks(),
            Transport::Http(_) => false,
        }
    }
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
    async fn exchange(
        &self,
        attempt: Attempt,
        timeout: Option<Duration>,
        deadline: Deadline,
    ) -> Result<Exchange> {
        match self {
            #[cfg(feature = "testing")]
            Transport::Mock(mock) => mock.exchange(attempt, timeout).await,
            Transport::Http(client) => {
                let mut request = client
                    .request(attempt.method, attempt.url)
                    .headers(attempt.headers);
                request = match attempt.body {
                    AttemptBody::Empty => request,
                    AttemptBody::Bytes(bytes) => request.body(bytes),
                    AttemptBody::Stream(stream, Some(size)) => request
                        .header(http::header::CONTENT_LENGTH, size)
                        .body(reqwest::Body::wrap_stream(stream)),
                    AttemptBody::Stream(stream, None) => {
                        request.body(reqwest::Body::wrap_stream(stream))
                    }
                };
                let response = match (timeout, deadline) {
                    (Some(timeout), Deadline::Headers) => {
                        tokio::time::timeout(timeout, request.send())
                            .await
                            .map_err(|_| {
                                Error::new(
                                    ErrorCode::Timeout,
                                    format!("No response headers within {timeout:?}"),
                                )
                            })?
                    }
                    (Some(timeout), _) => request.timeout(timeout).send().await,
                    (None, _) => request.send().await,
                }
                .map_err(transport_error)?;
                Ok(Exchange {
                    status: response.status().as_u16(),
                    headers: response.headers().clone(),
                    body: ResponseBody::Http(response),
                })
            }
        }
    }
}

/// Retry, timeout and size settings for one call.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CallOptions {
    pub timeout: Duration,
    pub upload_timeout: Option<Duration>,
    pub timeout_override: Option<Duration>,
    pub max_retries: u32,
    pub max_response_bytes: usize,
}

const RETRYABLE_STATUSES: [u16; 4] = [429, 502, 503, 504];

/// Sends `request`, retrying transport failures, timeouts, `429`, `502`, `503`, `504` and
/// `idempotency/request-in-progress` with jittered backoff (or the `Retry-After` the server
/// sent) when the request is repeatable. A redirect is never followed: it fails with
/// `sdk/http-error`. With `api_errors`, an unsuccessful status is returned as an [`Error`];
/// without it (CDN requests) the final response is returned whatever its status.
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
    let timeout = options.timeout_override.or(match request.deadline {
        Deadline::Api | Deadline::Headers => Some(options.timeout),
        Deadline::Upload => options.upload_timeout,
    });
    let mut retry = 0;
    loop {
        let can_retry = retry < max_retries;
        let result = transport
            .exchange(request.attempt(), timeout, request.deadline)
            .await;
        let failure = match result {
            Err(error) => error,
            Ok(exchange) if (300..400).contains(&exchange.status) => with_response(
                Error::new(
                    ErrorCode::HttpError,
                    format!("Unexpected redirect (HTTP {})", exchange.status),
                ),
                exchange.status,
                &exchange.headers,
            ),
            Ok(exchange) if (200..300).contains(&exchange.status) => return Ok(exchange),
            Ok(exchange) if !api_errors => {
                let delay = retry_after(&exchange.headers).unwrap_or_else(|| backoff(retry));
                if !can_retry
                    || !RETRYABLE_STATUSES.contains(&exchange.status)
                    || delay > RETRY_AFTER_MAX
                {
                    return Ok(exchange);
                }
                transport.sleep(delay).await;
                retry += 1;
                continue;
            }
            Ok(exchange) => {
                let status = exchange.status;
                let headers = exchange.headers.clone();
                match exchange.read(options.max_response_bytes).await {
                    Ok(body) => api_error(status, &headers, &body),
                    Err(error) => error,
                }
            }
        };
        let delay = failure.retry_after().unwrap_or_else(|| backoff(retry));
        if !can_retry || delay > RETRY_AFTER_MAX || !failure.is_retryable() {
            return Err(failure);
        }
        transport.sleep(delay).await;
        retry += 1;
    }
}

/// Exponential backoff with jitter: 0.5s, 1s, 2s, ... capped at 8s, of which half is fixed and
/// half random.
fn backoff(retry: u32) -> Duration {
    let delay = RETRY_BASE_DELAY
        .saturating_mul(1 << retry.min(16))
        .min(RETRY_MAX_DELAY)
        .as_millis() as u64;
    let half = delay / 2;
    Duration::from_millis(half + random_u64() % (delay - half + 1))
}

pub(crate) fn random_u64() -> u64 {
    let mut bytes = [0; 8];
    let _ = getrandom::getrandom(&mut bytes);
    u64::from_le_bytes(bytes)
}

/// A new ID like the API's: `prefix`, `_` and 20 base62 characters, drawn without modulo bias
/// (bytes 248 to 255 are redrawn).
#[cfg(feature = "testing")]
pub(crate) fn new_id(prefix: &str) -> String {
    const ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let mut id = String::with_capacity(prefix.len() + 21);
    id.push_str(prefix);
    id.push('_');
    let mut count = 0;
    while count < 20 {
        let mut bytes = [0u8; 40];
        if getrandom::getrandom(&mut bytes).is_err() {
            bytes.copy_from_slice(
                &[
                    random_u64(),
                    random_u64(),
                    random_u64(),
                    random_u64(),
                    random_u64(),
                ]
                .map(u64::to_le_bytes)
                .concat(),
            );
        }
        for byte in bytes.into_iter().filter(|byte| *byte < 248) {
            if count == 20 {
                break;
            }
            id.push(ALPHABET[usize::from(byte % 62)] as char);
            count += 1;
        }
    }
    id
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

/// The `Retry-After` delay: whole seconds, or an HTTP date (rounded up to whole seconds from
/// now, and zero once it has passed).
fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    let value = headers
        .get(http::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim();
    if !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Some(Duration::from_secs(value.parse().unwrap_or(u64::MAX)));
    }
    let date = parse_http_date(value)?;
    let now = std::time::SystemTime::now();
    Some(match date.duration_since(now) {
        Ok(ahead) => Duration::from_secs(ahead.as_secs() + u64::from(ahead.subsec_nanos() > 0)),
        Err(_) => Duration::ZERO,
    })
}

/// Parses an IMF-fixdate such as `Wed, 21 Oct 2015 07:28:00 GMT`, the HTTP date format.
fn parse_http_date(value: &str) -> Option<std::time::SystemTime> {
    let (_, rest) = value.split_once(", ")?;
    let parts: Vec<&str> = rest.split(' ').collect();
    let [day, month, year, time, "GMT"] = parts.as_slice() else {
        return None;
    };
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let month = MONTHS.iter().position(|name| name == month)? as i64 + 1;
    let day: i64 = day.parse().ok()?;
    let year: i64 = year.parse().ok()?;
    let clock: Vec<i64> = time
        .split(':')
        .map(|part| part.parse().ok())
        .collect::<Option<_>>()?;
    let [hours, minutes, seconds] = clock.as_slice() else {
        return None;
    };
    if !(1..=31).contains(&day) || *hours > 23 || *minutes > 59 || *seconds > 60 {
        return None;
    }
    // Days from the civil date (Howard Hinnant's algorithm).
    let (y, m) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = y.div_euclid(400);
    let year_of_era = y - era * 400;
    let day_of_year = (153 * m + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    let seconds = days * 86_400 + hours * 3600 + minutes * 60 + seconds;
    let seconds = u64::try_from(seconds).ok()?;
    std::time::UNIX_EPOCH.checked_add(Duration::from_secs(seconds))
}

/// Adds the response's status, request ID, `Retry-After` and headers to `error`.
pub(crate) fn with_response(mut error: Error, status: u16, headers: &HeaderMap) -> Error {
    error = error.with_status(status).with_headers(headers.clone());
    if let Some(id) = headers.get("x-request-id").and_then(|v| v.to_str().ok()) {
        error = error.with_request_id(id);
    }
    if let Some(delay) = retry_after(headers) {
        error = error.with_retry_after(delay);
    }
    error
}

/// The [`Error`] for an unsuccessful API response: its `code`, `message` and `details` (with
/// the `traceId`), or `sdk/http-error` when the body is not a CalmLens error.
pub(crate) fn api_error(status: u16, headers: &HeaderMap, body: &[u8]) -> Error {
    let parsed = serde_json::from_slice::<Value>(body);
    let api_code = match &parsed {
        Ok(Value::Object(object)) => object.get("code").and_then(Value::as_str),
        _ => None,
    };
    let error = match (api_code, &parsed) {
        (Some(code), Ok(Value::Object(object))) => {
            let mut details: Map<String, Value> = object
                .get("details")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            if let Some(trace) = object.get("traceId").filter(|trace| !trace.is_null()) {
                details.insert("traceId".into(), trace.clone());
            }
            Error::new(
                code,
                object
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or(code)
                    .to_owned(),
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

/// The request body for an upload payload, and its size when it is known before sending.
pub(crate) fn upload_body(
    payload: Payload,
    multipart: bool,
    declared_size: Option<u64>,
) -> Result<(RequestBody, Option<u64>)> {
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
        Payload::Reader { reader, size } => (
            RequestBody::Stream(Some(reader_stream(reader)), Some(size)),
            size,
        ),
        Payload::Stream { stream, size } => (RequestBody::Stream(Some(stream), Some(size)), size),
        Payload::UnsizedStream(stream) => {
            return Ok((
                RequestBody::Stream(Some(stream), declared_size),
                declared_size,
            ))
        }
    };
    if declared_size.is_some_and(|declared| declared != size) {
        return Err(crate::error::invalid_payload(
            "sizeInBytes must match the payload byte length",
        ));
    }
    Ok((body, Some(size)))
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
