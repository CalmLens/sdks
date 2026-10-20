//! The CalmLens Rust SDK: moderation, storage and CDN delivery.
//!
//! ```no_run
//! # async fn run() -> calmlens::Result<()> {
//! use calmlens::{models::*, ServerClient};
//!
//! let client = ServerClient::new("your-api-key", "your-project-id")?;
//! let asset = client.assets().moderate(SubmitAsset::text("Hello world")).await?;
//! if asset.moderation.status == AssetModerationStatus::Approved {
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
    AssetsClient, CdnClient, CdnResponse, EventsClient, FoldersClient, ServerClient,
    ServerClientBuilder, TextClient, UploadTokensClient, DEFAULT_BASE_URL, DEFAULT_CDN_BASE_URL,
    ENSURE_LENSES_MAX_PER_REQUEST,
};
#[cfg(feature = "async")]
pub use transport::MAX_RESPONSE_BYTES;

/// This SDK's version, from its Cargo manifest.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The `User-Agent` the SDK sends: `calmlens-rust/<version> (rustc <compiler version>)`.
pub fn user_agent() -> String {
    format!(
        "calmlens-rust/{VERSION} (rustc {})",
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
