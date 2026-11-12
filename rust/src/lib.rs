//! The CalmLens Rust SDK: moderation, storage and CDN delivery.
//!
//! ```no_run
//! # async fn run() -> calmlens::Result<()> {
//! use calmlens::{models::*, ServerClient};
//!
//! let client = ServerClient::new("your-api-key", "proj_8fK2mQx7Lp4NvB3tRz9Y")?;
//! let asset = client.assets().classify(SubmitAsset::text("Hello world")).await?;
//! if asset.classification.moderation.decision == Some(AssetModerationDecision::Allowed) {
//!     println!("{}", asset.id);
//! }
//! # Ok(()) }
//! ```
//!
//! # Features
//!
//! - `async` (default): the async [`ServerClient`], built on Tokio and reqwest.
//! - `rustls` (default): TLS through rustls, verifying certificates with the operating system's
//!   trust store. `native-tls` uses the platform TLS library instead.
//! - `blocking`: `blocking::ServerClient`, the same API without `async`.
//! - `tracing`: a `tracing` event, with the target `calmlens`, for every HTTP attempt.
//! - `testing`: `testing::MockServerClient`, an offline client for tests. Enable it in
//!   `[dev-dependencies]` only.
//!
//! With `default-features = false` the crate offers the models and the webhook helpers
//! ([`construct_webhook_event`]) without an HTTP stack.
//!
//! Every SDK call returns [`Error`], whose [`kind`](Error::kind) is an [`ErrorKind`] and whose
//! [`code`](Error::code) is an [`ErrorCode`].
//!
//! Options types are `#[non_exhaustive]`: build them with `new` (which takes the required
//! fields) and the chained setters, so a minor release can add an option.
//!
//! The minimum supported Rust version is 1.88. A minor release may raise it to a version
//! released at least six months earlier; a patch release never does.
#![deny(missing_docs)]
#![cfg_attr(docsrs, feature(doc_cfg))]

mod contract_checks;
mod error;
pub mod models;
#[cfg(feature = "async")]
mod observe;
mod transform_schema;
mod unknown;
#[cfg(feature = "async")]
mod upload_mime_types;
mod webhooks;

#[cfg(feature = "blocking")]
#[cfg_attr(docsrs, doc(cfg(feature = "blocking")))]
pub mod blocking;
#[cfg(feature = "async")]
mod client;
#[cfg(feature = "testing")]
#[cfg_attr(docsrs, doc(cfg(feature = "testing")))]
pub mod testing;
#[cfg(feature = "async")]
mod transport;

pub use error::{Error, ErrorCode, ErrorKind, Result, RAW_BODY_MAX_BYTES};
pub use unknown::UnknownValue;
pub use webhooks::*;

#[cfg(feature = "async")]
#[cfg_attr(docsrs, doc(cfg(feature = "async")))]
pub use client::{
    AssetsClient, CdnClient, CdnResponse, EventsClient, FoldersClient, HashListsClient,
    LensesClient, MetadataFieldsClient, PoliciesClient, ProjectSettingsClient, RequestOptions,
    ServerClient, ServerClientBuilder, TextClient, UploadPresetsClient, UploadTokensClient,
    ASSET_BATCH_MAX_ASSETS, DECISION_POLL_FIRST_INTERVAL, DECISION_POLL_INTERVAL_FACTOR,
    DECISION_POLL_MAX_INTERVAL, DEFAULT_BASE_URL, DEFAULT_CDN_BASE_URL, DEFAULT_DECISION_TIMEOUT,
    DEFAULT_MAX_RETRIES, DEFAULT_PART_SIZE_BYTES, DEFAULT_SIGNED_URL_EXPIRES_IN, DEFAULT_TIMEOUT,
    DEFAULT_UPLOAD_TIMEOUT, DEFAULT_UPLOAD_TOKEN_SECONDS, ENSURE_LENSES_MAX_PER_REQUEST,
    MAX_PART_SIZE_BYTES, MAX_SIGNED_URL_EXPIRES_IN, MIN_PART_SIZE_BYTES,
};
#[cfg(feature = "async")]
#[cfg_attr(docsrs, doc(cfg(feature = "async")))]
pub use observe::AttemptEvent;
#[cfg(feature = "async")]
pub use transport::{
    DEFAULT_MAX_RESPONSE_BYTES, RETRY_AFTER_MAX, RETRY_BASE_DELAY, RETRY_MAX_DELAY,
};

/// This SDK's version, from its Cargo manifest.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The `User-Agent` the SDK sends: `calmlens-rust/<version> (rustc/<compiler version>)`.
pub fn user_agent() -> String {
    format!(
        "calmlens-rust/{VERSION} (rustc/{})",
        env!("CALMLENS_RUSTC_VERSION")
    )
}

/// A stream of upload or download chunks.
#[cfg(feature = "async")]
pub type ByteStream = std::pin::Pin<
    Box<
        dyn futures_util::Stream<
                Item = std::result::Result<bytes::Bytes, Box<dyn std::error::Error + Send + Sync>>,
            > + Send,
    >,
>;

pub use bytes::Bytes;
