//! Per-attempt observation: the `on_attempt` hook, `CALMLENS_LOG` and `tracing` events.
use http::Method;
use std::{fmt, sync::Arc, time::Duration};

/// One HTTP attempt the client made, as passed to
/// [`ServerClientBuilder::on_attempt`](crate::ServerClientBuilder::on_attempt). It never holds the
/// API key, upload tokens, signed URL grants or bodies.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct AttemptEvent {
    /// The operation, such as `assets.retrieve`, or `None` for [`ServerClient::request`](crate::ServerClient::request).
    pub operation: Option<&'static str>,
    /// The HTTP method.
    pub method: Method,
    /// The URL path, without the query, with signed URL grants replaced by `[redacted]`.
    pub path: String,
    /// The attempt number, from 1.
    pub attempt: u32,
    /// How long the client waits before retrying, or `None` when no retry follows.
    pub retry_delay: Option<Duration>,
    /// The response status, or `None` when no response arrived.
    pub status: Option<http::StatusCode>,
    /// The response's `X-Request-Id`.
    pub request_id: Option<String>,
    /// The code of the attempt's failure, or `None` when it succeeded.
    pub error_code: Option<crate::ErrorCode>,
    /// How long the attempt took, until the response headers or the failure.
    pub duration: Duration,
}

/// What `CALMLENS_LOG` asks the client to write to standard error.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum LogLevel {
    /// Failed attempts and retries.
    Info,
    /// Every attempt.
    Debug,
}
impl LogLevel {
    pub(crate) fn from_env() -> Option<Self> {
        match std::env::var("CALMLENS_LOG")
            .ok()?
            .to_ascii_lowercase()
            .as_str()
        {
            "info" => Some(Self::Info),
            "debug" => Some(Self::Debug),
            _ => None,
        }
    }
}

/// The hook type of [`ServerClientBuilder::on_attempt`](crate::ServerClientBuilder::on_attempt).
pub(crate) type AttemptHook = Arc<dyn Fn(&AttemptEvent) + Send + Sync>;

#[derive(Clone, Default)]
pub(crate) struct Observer {
    pub hook: Option<AttemptHook>,
    pub log: Option<LogLevel>,
}
impl fmt::Debug for Observer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Observer")
            .field("hook", &self.hook.is_some())
            .field("log", &self.log)
            .finish()
    }
}

impl Observer {
    pub(crate) fn attempt(&self, event: AttemptEvent) {
        let failed = event.error_code.is_some();
        if let Some(level) = self.log {
            if level == LogLevel::Debug || failed {
                eprintln!("{}", line(&event));
            }
        }
        #[cfg(feature = "tracing")]
        {
            let status = event.status.map(|status| status.as_u16());
            if failed {
                tracing::info!(
                    target: "calmlens",
                    operation = event.operation.unwrap_or("request"),
                    method = %event.method,
                    path = %event.path,
                    attempt = event.attempt,
                    retry_delay_ms = event.retry_delay.map(|delay| delay.as_millis() as u64),
                    status,
                    request_id = event.request_id.as_deref(),
                    error_code = event.error_code.as_ref().map(crate::ErrorCode::as_str),
                    duration_ms = event.duration.as_millis() as u64,
                    "CalmLens request attempt failed"
                );
            } else {
                tracing::debug!(
                    target: "calmlens",
                    operation = event.operation.unwrap_or("request"),
                    method = %event.method,
                    path = %event.path,
                    attempt = event.attempt,
                    retry_delay_ms = event.retry_delay.map(|delay| delay.as_millis() as u64),
                    status,
                    request_id = event.request_id.as_deref(),
                    error_code = event.error_code.as_ref().map(crate::ErrorCode::as_str),
                    duration_ms = event.duration.as_millis() as u64,
                    "CalmLens request attempt"
                );
            }
        }
        if let Some(hook) = &self.hook {
            hook(&event);
        }
    }
}

fn line(event: &AttemptEvent) -> String {
    let status = event.status.map_or_else(
        || "no response".to_owned(),
        |status| status.as_u16().to_string(),
    );
    let mut line = format!(
        "calmlens: {} {} {} attempt {} -> {} in {}ms",
        event.operation.unwrap_or("request"),
        event.method,
        event.path,
        event.attempt,
        status,
        event.duration.as_millis()
    );
    if let Some(code) = &event.error_code {
        line.push_str(&format!(" {code}"));
    }
    if let Some(delay) = event.retry_delay {
        line.push_str(&format!(", retrying in {}ms", delay.as_millis()));
    }
    if let Some(id) = &event.request_id {
        line.push_str(&format!(" (request {id})"));
    }
    line
}

/// `path` with every segment that holds a signed URL grant (`sig_…`) or upload token replaced.
pub(crate) fn redacted_path(path: &str) -> String {
    path.split('/')
        .map(|segment| {
            if segment.starts_with("sig_") || segment.starts_with("clut_") {
                "[redacted]"
            } else {
                segment
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}
