//! The SDK's error type and error codes.
use serde_json::{Map, Value};
use std::{error::Error as StdError, fmt, time::Duration};

macro_rules! error_codes {
    ($( $(#[$doc:meta])* $variant:ident = $id:literal, $status:literal; )*) => {
        /// A CalmLens error code, such as `asset/not-found` or `sdk/timeout`.
        ///
        /// API codes are generated from the CalmLens API's public error list. Codes this SDK
        /// version does not know arrive as `Unknown`, so new API codes never fail decoding.
        /// Match variants, or compare with a string through `PartialEq<&str>`; to act on a code
        /// this version doesn't list, compare [`as_str`](Self::as_str) in a `_` arm rather than
        /// matching `Unknown`. Codes compare and hash by their string form.
        #[derive(Debug, Clone)]
        #[non_exhaustive]
        pub enum ErrorCode {
            $( $(#[$doc])* $variant, )*
            /// `sdk/transport-error`: the request could not be sent or its response could not
            /// be read (refused or reset connection, TLS or protocol failure, truncated body).
            TransportError,
            /// `sdk/timeout`: a connect, read or request timeout elapsed, or an asset had no
            /// moderation decision within the `wait_for_decision` timeout.
            Timeout,
            /// `sdk/invalid-response`: a successful response was not the JSON the SDK expected.
            InvalidResponse,
            /// `sdk/http-error`: an unsuccessful response without a CalmLens error body.
            HttpError,
            /// `sdk/invalid-argument`: an option passed to an SDK method is invalid.
            InvalidArgument,
            /// `sdk/invalid-config`: a client option is invalid.
            InvalidConfig,
            /// `sdk/response-too-large`: an API response exceeded the SDK's size limit.
            ResponseTooLarge,
            /// `sdk/invalid-webhook-payload`: a webhook body is not a delivery payload.
            InvalidWebhookPayload,
            /// `sdk/invalid-webhook-signature`: a webhook signature is missing, wrong or stale.
            InvalidWebhookSignature,
            /// A code this SDK version does not know.
            #[deprecated(
                note = "match `as_str()` in a `_` arm: a code a later version lists stops arriving as `Unknown`"
            )]
            Unknown(crate::UnknownValue),
        }

        impl ErrorCode {
            /// Every API error code with its HTTP status, as generated from the API.
            pub const API_CODES: &'static [(&'static str, u16)] = &[$(($id, $status),)*];

            /// The code's string form, e.g. `asset/not-found`.
            #[allow(deprecated)]
            pub fn as_str(&self) -> &str {
                match self {
                    $(Self::$variant => $id,)*
                    Self::TransportError => "sdk/transport-error",
                    Self::Timeout => "sdk/timeout",
                    Self::InvalidResponse => "sdk/invalid-response",
                    Self::HttpError => "sdk/http-error",
                    Self::InvalidArgument => "sdk/invalid-argument",
                    Self::InvalidConfig => "sdk/invalid-config",
                    Self::ResponseTooLarge => "sdk/response-too-large",
                    Self::InvalidWebhookPayload => "sdk/invalid-webhook-payload",
                    Self::InvalidWebhookSignature => "sdk/invalid-webhook-signature",
                    Self::Unknown(code) => code.as_str(),
                }
            }

            /// The HTTP status the API returns with this code, or `None` for SDK and unknown codes.
            pub fn http_status(&self) -> Option<http::StatusCode> {
                match self {
                    $(Self::$variant => http::StatusCode::from_u16($status).ok(),)*
                    _ => None,
                }
            }

            /// Parses a code string; codes this version does not know become `Unknown`.
            #[allow(deprecated)]
            pub fn parse(code: &str) -> Self {
                match code {
                    $($id => Self::$variant,)*
                    "sdk/transport-error" => Self::TransportError,
                    "sdk/timeout" => Self::Timeout,
                    "sdk/invalid-response" => Self::InvalidResponse,
                    "sdk/http-error" => Self::HttpError,
                    "sdk/invalid-argument" => Self::InvalidArgument,
                    "sdk/invalid-config" => Self::InvalidConfig,
                    "sdk/response-too-large" => Self::ResponseTooLarge,
                    "sdk/invalid-webhook-payload" => Self::InvalidWebhookPayload,
                    "sdk/invalid-webhook-signature" => Self::InvalidWebhookSignature,
                    other => Self::Unknown(crate::UnknownValue::new(other)),
                }
            }
        }
    };
}

include!("codes.rs");

impl PartialEq for ErrorCode {
    fn eq(&self, other: &Self) -> bool {
        self.as_str() == other.as_str()
    }
}
impl Eq for ErrorCode {}
impl std::hash::Hash for ErrorCode {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.as_str().hash(state);
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
impl From<&str> for ErrorCode {
    fn from(code: &str) -> Self {
        Self::parse(code)
    }
}
impl From<String> for ErrorCode {
    fn from(code: String) -> Self {
        Self::parse(&code)
    }
}
impl PartialEq<str> for ErrorCode {
    fn eq(&self, other: &str) -> bool {
        self.as_str() == other
    }
}
impl PartialEq<&str> for ErrorCode {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<ErrorCode> for &str {
    fn eq(&self, other: &ErrorCode) -> bool {
        *self == other.as_str()
    }
}

/// Every failure the SDK returns: API errors, validation, transport failures and timeouts.
///
/// `Display` prefixes the message with `[calmlens] `; [`Error::message`] returns it without.
/// API errors carry the HTTP [`status`](Error::status), the response's
/// [`request_id`](Error::request_id) (log it, and quote it to support) and, for `429` and
/// `idempotency/request-in-progress`, [`retry_after`](Error::retry_after). [`Error::source`]
/// returns the underlying reqwest, IO or JSON error.
#[derive(Debug)]
#[non_exhaustive]
pub struct Error {
    inner: Box<Inner>,
}

#[derive(Debug)]
struct Inner {
    code: ErrorCode,
    message: String,
    details: Map<String, Value>,
    status: Option<http::StatusCode>,
    request_id: Option<String>,
    retry_after: Option<Duration>,
    headers: Option<http::HeaderMap>,
    raw_body: Option<String>,
    source: Option<Box<dyn StdError + Send + Sync>>,
}

/// The largest error response body [`Error::raw_body`] keeps, in bytes.
pub const RAW_BODY_MAX_BYTES: usize = 16 * 1024;

/// What kind of failure an [`Error`] is, for handling a class of failures rather than each
/// [`ErrorCode`]. Kinds form a tree: [`parent`](Self::parent) names the broader kind, and
/// [`Error::is`] answers whether an error is a kind or any kind beneath it, so
/// `error.is(ErrorKind::Api)` holds for every non-2xx response.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ErrorKind {
    /// The API, or a proxy in front of it, answered with a non-2xx status.
    Api,
    /// HTTP 400: the request was invalid.
    BadRequest,
    /// HTTP 401: the API key is missing or invalid.
    Authentication,
    /// HTTP 403: the API key lacks a grant.
    PermissionDenied,
    /// HTTP 404: the resource doesn't exist.
    NotFound,
    /// HTTP 409: the request conflicts with the resource's state.
    Conflict,
    /// HTTP 413: the content is over a size limit.
    PayloadTooLarge,
    /// HTTP 422: the content can't be processed.
    UnprocessableEntity,
    /// HTTP 429: too many requests.
    RateLimit,
    /// HTTP 500 or above: the API failed.
    Server,
    /// No complete response: the connection failed or was cut.
    Connection,
    /// A request took longer than its timeout, or a wait reached its deadline.
    Timeout,
    /// The caller cancelled the call. Dropping a future cancels it without an error, so the
    /// SDK returns this kind only where a cancellation has to be reported.
    Cancelled,
    /// The SDK refused the call before sending anything.
    InvalidArgument,
    /// The client's configuration is invalid.
    Configuration,
    /// A response wasn't what the operation returns.
    InvalidResponse,
    /// A webhook delivery couldn't be verified or parsed.
    WebhookVerification,
}

impl ErrorKind {
    /// The broader kind this one belongs to, or `None` for a top-level kind.
    pub fn parent(self) -> Option<Self> {
        match self {
            Self::BadRequest
            | Self::Authentication
            | Self::PermissionDenied
            | Self::NotFound
            | Self::Conflict
            | Self::PayloadTooLarge
            | Self::UnprocessableEntity
            | Self::RateLimit
            | Self::Server => Some(Self::Api),
            Self::Configuration => Some(Self::InvalidArgument),
            _ => None,
        }
    }
    /// Whether this kind is `kind` or beneath it.
    pub fn is(self, kind: Self) -> bool {
        let mut current = Some(self);
        while let Some(this) = current {
            if this == kind {
                return true;
            }
            current = this.parent();
        }
        false
    }
    /// The kind of an API response with `status`.
    fn of_status(status: u16) -> Self {
        match status {
            400 => Self::BadRequest,
            401 => Self::Authentication,
            403 => Self::PermissionDenied,
            404 => Self::NotFound,
            409 => Self::Conflict,
            413 => Self::PayloadTooLarge,
            422 => Self::UnprocessableEntity,
            429 => Self::RateLimit,
            500.. => Self::Server,
            _ => Self::Api,
        }
    }
}

impl Error {
    /// An error with `code` and `message` and nothing else; add fields with the `with_*`
    /// methods. Useful for tests and for queuing failures on a mock.
    pub fn new(code: impl Into<ErrorCode>, message: impl Into<String>) -> Self {
        Self {
            inner: Box::new(Inner {
                code: code.into(),
                message: message.into(),
                details: Map::new(),
                status: None,
                request_id: None,
                retry_after: None,
                headers: None,
                raw_body: None,
                source: None,
            }),
        }
    }
    /// Sets the HTTP status.
    pub fn with_status(mut self, status: http::StatusCode) -> Self {
        self.inner.status = Some(status);
        self
    }
    /// Sets the HTTP status from its number, ignoring one outside 100–999.
    #[cfg_attr(not(feature = "async"), allow(dead_code))]
    pub(crate) fn with_http_status(mut self, status: u16) -> Self {
        self.inner.status = http::StatusCode::from_u16(status).ok();
        self
    }
    /// Keeps the response body, at most [`RAW_BODY_MAX_BYTES`] of it, as text.
    #[cfg_attr(not(feature = "async"), allow(dead_code))]
    pub(crate) fn with_raw_body(mut self, body: &[u8]) -> Self {
        let mut end = body.len().min(RAW_BODY_MAX_BYTES);
        while end > 0 && std::str::from_utf8(&body[..end]).is_err() {
            end -= 1;
        }
        self.inner.raw_body = Some(String::from_utf8_lossy(&body[..end]).into_owned());
        self
    }
    /// The kind of failure. An error from a response follows its HTTP status, and an SDK
    /// error its code; an API code the SDK raised before sending anything, such as
    /// `upload/unsupported-type`, is [`ErrorKind::InvalidArgument`].
    pub fn kind(&self) -> ErrorKind {
        match self.inner.code.as_str() {
            "sdk/transport-error" => ErrorKind::Connection,
            "sdk/timeout" => ErrorKind::Timeout,
            "sdk/cancelled" => ErrorKind::Cancelled,
            "sdk/invalid-argument" => ErrorKind::InvalidArgument,
            "sdk/invalid-config" => ErrorKind::Configuration,
            "sdk/invalid-response" | "sdk/response-too-large" => ErrorKind::InvalidResponse,
            "sdk/invalid-webhook-payload" | "sdk/invalid-webhook-signature" => {
                ErrorKind::WebhookVerification
            }
            // A response without a CalmLens error body, such as a proxy's page or a redirect.
            "sdk/http-error" => self.inner.status.map_or(ErrorKind::Api, |status| {
                ErrorKind::of_status(status.as_u16())
            }),
            _ => self
                .inner
                .status
                .map_or(ErrorKind::InvalidArgument, |status| {
                    ErrorKind::of_status(status.as_u16())
                }),
        }
    }
    /// Whether the error is `kind` or a kind beneath it, e.g. `error.is(ErrorKind::Api)`.
    pub fn is(&self, kind: ErrorKind) -> bool {
        self.kind().is(kind)
    }
    /// An API error response's body as text, at most [`RAW_BODY_MAX_BYTES`] of it, e.g. a
    /// proxy's HTML page.
    pub fn raw_body(&self) -> Option<&str> {
        self.inner.raw_body.as_deref()
    }
    /// Sets the details object.
    pub fn with_details(mut self, details: Map<String, Value>) -> Self {
        self.inner.details = details;
        self
    }
    /// Sets the request ID.
    pub fn with_request_id(mut self, request_id: impl Into<String>) -> Self {
        self.inner.request_id = Some(request_id.into());
        self
    }
    /// Sets the delay the server asked for before a retry.
    pub fn with_retry_after(mut self, retry_after: Duration) -> Self {
        self.inner.retry_after = Some(retry_after);
        self
    }
    /// Sets the response headers.
    pub fn with_headers(mut self, headers: http::HeaderMap) -> Self {
        self.inner.headers = Some(headers);
        self
    }
    /// Sets the underlying cause returned by [`StdError::source`].
    pub fn with_source(mut self, source: impl Into<Box<dyn StdError + Send + Sync>>) -> Self {
        self.inner.source = Some(source.into());
        self
    }

    /// The error code.
    pub fn code(&self) -> &ErrorCode {
        &self.inner.code
    }
    /// The message without the `[calmlens] ` prefix that `Display` adds.
    pub fn message(&self) -> &str {
        &self.inner.message
    }
    /// The API's `details` object, such as validation issues. Empty for SDK errors such as transport failures, except where a code documents its details.
    pub fn details(&self) -> &Map<String, Value> {
        &self.inner.details
    }
    /// The HTTP status of an API error response.
    pub fn status(&self) -> Option<http::StatusCode> {
        self.inner.status
    }
    /// The request ID of the response that failed: its `X-Request-Id` header, or the error
    /// body's `requestId` when the header is missing.
    pub fn request_id(&self) -> Option<&str> {
        self.inner.request_id.as_deref()
    }
    /// The `Retry-After` delay the response sent, in seconds or as an HTTP date (rounded up to
    /// whole seconds from now, and zero once past).
    pub fn retry_after(&self) -> Option<Duration> {
        self.inner.retry_after
    }
    /// The headers of the response that failed.
    pub fn headers(&self) -> Option<&http::HeaderMap> {
        self.inner.headers.as_ref()
    }
    /// Whether the SDK raised this error itself, with no HTTP response: before sending (an
    /// invalid argument or option, or content it checks first, such as
    /// [`ErrorCode::UnsupportedUploadType`]), or because no response arrived (a timeout or a
    /// connection failure). The code is the one the API would use; [`status`](Self::status) and
    /// [`request_id`](Self::request_id) are `None`, so branch on [`code`](Self::code).
    pub fn is_local(&self) -> bool {
        self.inner.status.is_none()
    }
    /// Whether the resource was not found: a `404` status or a `*/not-found` code.
    pub fn is_not_found(&self) -> bool {
        self.inner.status == Some(http::StatusCode::NOT_FOUND)
            || self.inner.code.as_str().ends_with("/not-found")
    }
    /// Whether a timeout elapsed.
    pub fn is_timeout(&self) -> bool {
        self.inner.code == ErrorCode::Timeout
    }
    /// Whether repeating the same request may succeed: transport failures, timeouts, `429`,
    /// `500`, `502`, `503`, `504` and `idempotency/request-in-progress`. A retried write is only safe
    /// with the same `Idempotency-Key`, which the SDK reuses across its own retries.
    pub fn is_retryable(&self) -> bool {
        [
            ErrorCode::TransportError,
            ErrorCode::Timeout,
            ErrorCode::IdempotentRequestInProgress,
        ]
        .contains(&self.inner.code)
            || self
                .inner
                .status
                .is_some_and(|status| matches!(status.as_u16(), 429 | 500 | 502 | 503 | 504))
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[calmlens] {}", self.inner.message)
    }
}

impl StdError for Error {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        self.inner.source.as_ref().map(|e| &**e as _)
    }
}

/// `Result` with the SDK's [`Error`].
pub type Result<T, E = Error> = std::result::Result<T, E>;

#[cfg(feature = "async")]
pub(crate) fn invalid_payload(message: impl Into<String>) -> Error {
    Error::new(ErrorCode::InvalidUploadPayload, message)
}
#[cfg(feature = "async")]
pub(crate) fn invalid_argument(message: impl Into<String>) -> Error {
    Error::new(ErrorCode::InvalidArgument, message)
}
#[cfg(feature = "async")]
pub(crate) fn invalid_config(message: impl Into<String>) -> Error {
    Error::new(ErrorCode::InvalidConfig, message)
}
