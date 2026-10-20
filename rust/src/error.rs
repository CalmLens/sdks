//! The SDK's error type and error codes.
use serde_json::{Map, Value};
use std::{error::Error as StdError, fmt, time::Duration};

macro_rules! error_codes {
    ($( $(#[$doc:meta])* $variant:ident = $id:literal, $status:literal; )*) => {
        /// A CalmLens error code, such as `asset/not-found` or `sdk/timeout`.
        ///
        /// API codes are generated from the CalmLens API's public error list. Codes this SDK
        /// version does not know arrive as [`ErrorCode::Other`], so new API codes never fail
        /// decoding. Compare with a string through `PartialEq<&str>`, or match variants.
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
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
            Other(String),
        }

        impl ErrorCode {
            /// Every API error code with its HTTP status, as generated from the API.
            pub const API_CODES: &'static [(&'static str, u16)] = &[$(($id, $status),)*];

            /// The code's string form, e.g. `asset/not-found`.
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
                    Self::Other(code) => code,
                }
            }

            /// The HTTP status the API returns with this code, or `None` for SDK and unknown codes.
            pub fn http_status(&self) -> Option<u16> {
                match self {
                    $(Self::$variant => Some($status),)*
                    _ => None,
                }
            }

            /// Parses a code string; unknown codes become [`ErrorCode::Other`].
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
                    other => Self::Other(other.to_owned()),
                }
            }
        }
    };
}

include!("codes.rs");

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
    status: Option<u16>,
    request_id: Option<String>,
    retry_after: Option<Duration>,
    headers: Option<http::HeaderMap>,
    source: Option<Box<dyn StdError + Send + Sync>>,
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
                source: None,
            }),
        }
    }
    /// Sets the HTTP status.
    pub fn with_status(mut self, status: u16) -> Self {
        self.inner.status = Some(status);
        self
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
    /// The API's `details` object (empty for SDK errors). API errors also carry `traceId`
    /// when the API sent one, and `network: true`.
    pub fn details(&self) -> &Map<String, Value> {
        &self.inner.details
    }
    /// The HTTP status of an API error response.
    pub fn status(&self) -> Option<u16> {
        self.inner.status
    }
    /// The `X-Request-Id` of the response that failed.
    pub fn request_id(&self) -> Option<&str> {
        self.inner.request_id.as_deref()
    }
    /// The `Retry-After` delay sent with a `429` or `idempotency/request-in-progress` response.
    pub fn retry_after(&self) -> Option<Duration> {
        self.inner.retry_after
    }
    /// The headers of the response that failed.
    pub fn headers(&self) -> Option<&http::HeaderMap> {
        self.inner.headers.as_ref()
    }
    /// Whether the resource was not found: a `404` status or a `*/not-found` code.
    pub fn is_not_found(&self) -> bool {
        self.inner.status == Some(404) || self.inner.code.as_str().ends_with("/not-found")
    }
    /// Whether a timeout elapsed.
    pub fn is_timeout(&self) -> bool {
        self.inner.code == ErrorCode::Timeout
    }
    /// Whether repeating the same request may succeed: transport failures, timeouts, `429`,
    /// `502`, `503`, `504` and `idempotency/request-in-progress`. A retried write is only safe
    /// with the same `Idempotency-Key`, which the SDK reuses across its own retries.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self.inner.code,
            ErrorCode::TransportError | ErrorCode::Timeout | ErrorCode::IdempotentRequestInProgress
        ) || matches!(self.inner.status, Some(429 | 502 | 503 | 504))
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
