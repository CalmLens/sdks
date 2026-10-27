//! The CalmLens Rust SDK: moderation, storage and CDN delivery.
//!
//! ```no_run
//! # async fn run() -> calmlens::Result<()> {
//! use calmlens::{models::*, ServerClient};
//!
//! let client = ServerClient::new("your-api-key", "proj_8fK2mQx7Lp4NvB3tRz9Y")?;
//! let asset = client.assets().classify(SubmitAsset::text("Hello world")).await?;
//! if asset.classification.moderation.status == AssetModerationStatus::Allowed {
//!     println!("{}", asset.id);
//! }
//! # Ok(()) }
//! ```
//!
//! # Features
//!
//! - `async` (default): the async [`ServerClient`], built on Tokio and reqwest.
//! - `rustls` (default): TLS through rustls with the bundled Mozilla root certificates.
//!   `rustls-native-roots` uses the operating system's roots, and `native-tls` the platform TLS
//!   library, instead.
//! - `blocking`: [`blocking::ServerClient`], the same API without `async`.
//! - `testing`: [`testing::MockServerClient`], an offline client for tests. Enable it in
//!   `[dev-dependencies]` only.
//!
//! With `default-features = false` the crate offers the models and the webhook helpers
//! ([`construct_webhook_event`]) without an HTTP stack.
//!
//! Every SDK call returns [`Error`], whose [`code`](Error::code) is an [`ErrorCode`].
#![deny(missing_docs)]
#![cfg_attr(docsrs, feature(doc_cfg))]

mod error;
pub mod models;
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

pub use error::{Error, ErrorCode, Result};
pub use webhooks::*;

#[cfg(feature = "async")]
#[cfg_attr(docsrs, doc(cfg(feature = "async")))]
pub use client::{
    AssetsClient, CdnClient, CdnResponse, EventsClient, FoldersClient, HashListsClient,
    ServerClient, ServerClientBuilder, TextClient, UploadTokensClient, ASSET_BATCH_MAX_ASSETS,
    DECISION_POLL_FIRST_INTERVAL, DECISION_POLL_INTERVAL_FACTOR, DECISION_POLL_MAX_INTERVAL,
    DEFAULT_BASE_URL, DEFAULT_CDN_BASE_URL, DEFAULT_DECISION_TIMEOUT, DEFAULT_MAX_RETRIES,
    DEFAULT_SIGNED_URL_SECONDS, DEFAULT_TIMEOUT, DEFAULT_UPLOAD_TIMEOUT,
    DEFAULT_UPLOAD_TOKEN_SECONDS, ENSURE_LENSES_MAX_PER_REQUEST, MAX_SIGNED_URL_SECONDS,
};
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
