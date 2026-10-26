//! Startup configuration. The app fails closed: without credentials it refuses to start unless
//! demo mode is explicitly requested.
use crate::library::Library;
use calmlens::ServerClient;
use std::time::Duration;

pub const DEFAULT_PORT: u16 = 6405;
/// Live SDK requests time out after this long.
pub const SDK_TIMEOUT: Duration = Duration::from_secs(30);

/// Why the app refused to start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupError {
    /// Neither credential is set and demo mode was not requested.
    MissingCredentials,
    /// Only one of `CALMLENS_API_KEY` and `CALMLENS_PROJECT_ID` is set.
    PartialCredentials,
    /// Demo mode was requested while credentials are set.
    DemoWithCredentials,
    /// The SDK refused the client configuration, such as an invalid `CALMLENS_API_URL`.
    InvalidClient,
}

impl StartupError {
    pub fn message(self) -> &'static str {
        match self {
            StartupError::MissingCredentials => {
                "Set CALMLENS_API_KEY and CALMLENS_PROJECT_ID to use CalmLens, or start the offline demo with CALMLENS_DEMO=1 (or --demo)."
            }
            StartupError::PartialCredentials => {
                "Set both CALMLENS_API_KEY and CALMLENS_PROJECT_ID. Partial credentials never fall back to demo mode."
            }
            StartupError::DemoWithCredentials => {
                "Demo mode was requested while CalmLens credentials are set. Unset one or the other."
            }
            StartupError::InvalidClient => {
                "The CalmLens client configuration is invalid. Check CALMLENS_API_URL and CALMLENS_CDN_URL."
            }
        }
    }
}

pub struct Settings {
    pub library: Library,
    pub webhook_secret: String,
}

/// Reads the configuration. `demo_flag` is the `--demo` command-line flag; `CALMLENS_DEMO=1`
/// requests demo mode too.
pub fn settings_from_env(
    env: impl Fn(&str) -> Option<String>,
    demo_flag: bool,
) -> Result<Settings, StartupError> {
    let get = |name: &str| env(name).filter(|value| !value.trim().is_empty());
    let enabled = |name: &str| get(name).is_some_and(|value| matches!(value.trim(), "1" | "true"));
    let demo_requested = demo_flag || enabled("CALMLENS_DEMO");
    let webhook_secret = get("CALMLENS_WEBHOOK_SECRET").unwrap_or_default();
    let library = match (get("CALMLENS_API_KEY"), get("CALMLENS_PROJECT_ID")) {
        (Some(_), None) | (None, Some(_)) => return Err(StartupError::PartialCredentials),
        (Some(_), Some(_)) if demo_requested => return Err(StartupError::DemoWithCredentials),
        (Some(key), Some(project)) => {
            let mut builder = ServerClient::builder(key, project).timeout(SDK_TIMEOUT);
            if let Some(url) = get("CALMLENS_API_URL") {
                builder = builder.base_url(url);
            }
            if let Some(url) = get("CALMLENS_CDN_URL") {
                builder = builder.cdn_base_url(url);
            }
            Library::Live(builder.build().map_err(|_| StartupError::InvalidClient)?)
        }
        (None, None) if !demo_requested => return Err(StartupError::MissingCredentials),
        (None, None) => Library::demo_with_samples(),
    };
    Ok(Settings {
        library,
        webhook_secret,
    })
}
