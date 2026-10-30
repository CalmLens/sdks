//! The blocking client (the `blocking` feature): the async client's API without `async`.
//!
//! It runs the async client on a private Tokio runtime with one worker thread, so it can be
//! created, cloned and dropped anywhere, including inside an async runtime. Its methods block
//! the calling thread, so do not call them from async code: use [`crate::ServerClient`] there, or
//! call them inside `tokio::task::spawn_blocking`.
//!
//! ```no_run
//! use calmlens::{blocking::ServerClient, models::*};
//!
//! fn main() -> calmlens::Result<()> {
//!     let client = ServerClient::new("your-api-key", "proj_8fK2mQx7Lp4NvB3tRz9Y")?;
//!     let asset = client.assets().classify(SubmitAsset::text("Hello world"))?;
//!     for asset in client.assets().iterate(ListAssets::default()) {
//!         println!("{}", asset?.id);
//!     }
//!     Ok(())
//! }
//! ```
use crate::error::{invalid_config, ErrorCode};
use crate::models::*;
use crate::{Error, Result};
use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use http::{HeaderMap, StatusCode};
use std::{fmt, future::Future, pin::Pin, sync::Arc, time::Duration};

struct Runtime(Option<tokio::runtime::Runtime>);
impl Runtime {
    fn block_on<F: Future>(&self, future: F) -> F::Output {
        self.0
            .as_ref()
            .expect("runtime is present until drop")
            .block_on(future)
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        // Never blocks, so dropping the client inside an async runtime cannot panic.
        if let Some(runtime) = self.0.take() {
            runtime.shutdown_background();
        }
    }
}

/// Configures a [`ServerClient`]; the options match [`crate::ServerClientBuilder`].
#[derive(Clone, Debug)]
pub struct ServerClientBuilder(crate::ServerClientBuilder);
impl ServerClientBuilder {
    /// The API base URL.
    pub fn base_url(self, value: impl Into<String>) -> Self {
        Self(self.0.base_url(value))
    }
    /// The CDN base URL.
    pub fn cdn_base_url(self, value: impl Into<String>) -> Self {
        Self(self.0.cdn_base_url(value))
    }
    /// The timeout of each API call attempt. See [`crate::ServerClientBuilder::timeout`].
    pub fn timeout(self, value: Duration) -> Self {
        Self(self.0.timeout(value))
    }
    /// The timeout of each binary upload attempt. See
    /// [`crate::ServerClientBuilder::upload_timeout`].
    pub fn upload_timeout(self, value: Duration) -> Self {
        Self(self.0.upload_timeout(value))
    }
    /// The largest API response body the client reads. See
    /// [`crate::ServerClientBuilder::max_response_bytes`].
    pub fn max_response_bytes(self, value: usize) -> Self {
        Self(self.0.max_response_bytes(value))
    }
    /// The connect timeout.
    pub fn connect_timeout(self, value: Duration) -> Self {
        Self(self.0.connect_timeout(value))
    }
    /// The longest wait for the next response bytes.
    pub fn read_timeout(self, value: Duration) -> Self {
        Self(self.0.read_timeout(value))
    }
    /// How many times to retry a repeatable request.
    pub fn max_retries(self, value: u32) -> Self {
        Self(self.0.max_retries(value))
    }
    /// Sends requests through your own async reqwest client.
    pub fn http_client(self, client: reqwest::Client) -> Self {
        Self(self.0.http_client(client))
    }
    /// Validates the options and creates the client.
    pub fn build(self) -> Result<ServerClient> {
        ServerClient::from_async(self.0.build()?)
    }
}

/// The blocking CalmLens client. Clones are cheap and share connections and the runtime.
#[derive(Clone)]
pub struct ServerClient {
    client: crate::ServerClient,
    runtime: Arc<Runtime>,
}
impl fmt::Debug for ServerClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("blocking::ServerClient")
            .field(&self.client)
            .finish()
    }
}

impl ServerClient {
    /// A client for the production API with default options.
    pub fn new(api_key: impl Into<String>, project_id: impl Into<String>) -> Result<Self> {
        Self::builder(api_key, project_id).build()
    }
    /// A builder for a client with custom URLs, timeouts, retries or HTTP client.
    pub fn builder(
        api_key: impl Into<String>,
        project_id: impl Into<String>,
    ) -> ServerClientBuilder {
        ServerClientBuilder(crate::ServerClient::builder(api_key, project_id))
    }
    /// Wraps an async client, sharing its connections and lens cache.
    pub fn from_async(client: crate::ServerClient) -> Result<Self> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .thread_name("calmlens-blocking")
            .enable_all()
            .build()
            .map_err(|cause| {
                invalid_config(format!("Could not start the client runtime: {cause}"))
                    .with_source(cause)
            })?;
        Ok(Self {
            client,
            runtime: Arc::new(Runtime(Some(runtime))),
        })
    }
    /// The async client this wraps.
    pub fn as_async(&self) -> &crate::ServerClient {
        &self.client
    }
    /// A handle whose calls, including uploads and CDN downloads, time out after `timeout`.
    pub fn with_timeout(&self, timeout: Duration) -> Self {
        Self {
            client: self.client.with_timeout(timeout),
            runtime: self.runtime.clone(),
        }
    }
    /// A handle that retries repeatable requests up to `max_retries` times.
    pub fn with_max_retries(&self, max_retries: u32) -> Self {
        Self {
            client: self.client.with_max_retries(max_retries),
            runtime: self.runtime.clone(),
        }
    }
    fn wait<T>(&self, future: impl Future<Output = T>) -> T {
        self.runtime.block_on(future)
    }
    fn iter<T>(&self, stream: impl Stream<Item = T> + Send + 'static) -> Iter<T> {
        Iter {
            stream: Box::pin(stream),
            runtime: self.runtime.clone(),
        }
    }
    /// Asset operations.
    pub fn assets(&self) -> AssetsClient<'_> {
        AssetsClient(self)
    }
    /// Folder operations.
    pub fn folders(&self) -> FoldersClient<'_> {
        FoldersClient(self)
    }
    /// Hash list operations.
    pub fn hash_lists(&self) -> HashListsClient<'_> {
        HashListsClient(self)
    }
    /// The project's events feed.
    pub fn events(&self) -> EventsClient<'_> {
        EventsClient(self)
    }
    /// CDN URLs and downloads.
    pub fn cdn(&self) -> CdnClient<'_> {
        CdnClient(self)
    }
    /// Text moderation.
    pub fn text(&self) -> TextClient<'_> {
        TextClient(self)
    }
    /// Upload tokens for upload presets, signed locally.
    pub fn upload_tokens(&self) -> UploadTokensClient<'_> {
        UploadTokensClient(self)
    }
    /// See [`crate::ServerClient::ensure_lens`].
    pub fn ensure_lens(&self, lens: LensDefinition) -> Result<Lens> {
        self.wait(self.client.ensure_lens(lens))
    }
    /// See [`crate::ServerClient::ensure_lenses`].
    pub fn ensure_lenses(&self, options: EnsureLenses) -> Result<Vec<Lens>> {
        self.wait(self.client.ensure_lenses(options))
    }
}

/// An iterator that fetches pages as it is read.
pub struct Iter<T> {
    stream: Pin<Box<dyn Stream<Item = T> + Send>>,
    runtime: Arc<Runtime>,
}
impl<T> fmt::Debug for Iter<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Iter").finish_non_exhaustive()
    }
}
impl<T> Iterator for Iter<T> {
    type Item = T;
    fn next(&mut self) -> Option<T> {
        self.runtime.block_on(self.stream.next())
    }
}

macro_rules! blocking_methods {
    ($handle:ident => $async_handle:ident { $( $(#[$doc:meta])* fn $name:ident($($arg:ident: $ty:ty),*) -> $ret:ty; )* }) => {
        impl $handle<'_> {
            $(
                $(#[$doc])*
                pub fn $name(&self, $($arg: $ty),*) -> $ret {
                    self.0.wait(self.0.client.$async_handle().$name($($arg),*))
                }
            )*
        }
    };
}

/// Asset operations. See [`crate::AssetsClient`].
#[derive(Debug, Clone, Copy)]
pub struct AssetsClient<'a>(&'a ServerClient);
blocking_methods!(AssetsClient => assets {
    /// See [`crate::AssetsClient::create`].
    fn create(options: SubmitAsset) -> Result<Asset>;
    /// See [`crate::AssetsClient::classify`].
    fn classify(options: SubmitAsset) -> Result<Asset>;
    /// See [`crate::AssetsClient::upload_part`].
    fn upload_part(options: UploadPart) -> Result<Asset>;
    /// See [`crate::AssetsClient::search`].
    fn search(options: SearchAssets) -> Result<AssetSearchResponse>;
    /// See [`crate::AssetsClient::list`].
    fn list(options: ListAssets) -> Result<AssetPage>;
    /// See [`crate::AssetsClient::list_children`].
    fn list_children(options: ListChildren) -> Result<AssetPage>;
    /// See [`crate::AssetsClient::retrieve`].
    fn retrieve(options: AssetId) -> Result<Asset>;
    /// See [`crate::AssetsClient::wait_for_decision`]. Blocks until the asset is decided or
    /// the timeout passes.
    fn wait_for_decision(options: WaitForDecision) -> Result<Asset>;
    /// See [`crate::AssetsClient::update`].
    fn update(options: UpdateAsset) -> Result<Asset>;
    /// See [`crate::AssetsClient::retry`].
    fn retry(options: AssetId) -> Result<Asset>;
    /// See [`crate::AssetsClient::decide`].
    fn decide(options: DecideAsset) -> Result<Asset>;
    /// See [`crate::AssetsClient::explain`].
    fn explain(options: ExplainAsset) -> Result<Asset>;
    /// See [`crate::AssetsClient::delete_content`].
    fn delete_content(options: AssetId) -> Result<Asset>;
    /// See [`crate::AssetsClient::delete`].
    fn delete(options: AssetId) -> Result<()>;
    /// See [`crate::AssetsClient::batch`].
    fn batch(options: BatchAssets) -> Result<BatchAssetsResponse>;
    /// See [`crate::AssetsClient::move_asset`].
    fn move_asset(options: MoveAsset) -> Result<Asset>;
    /// See [`crate::AssetsClient::create_signed_url`].
    fn create_signed_url(options: SignedUrlOptions) -> Result<SignedUrl>;
});
impl AssetsClient<'_> {
    /// Every asset from `options.cursor` on, fetching pages as the iterator is read.
    pub fn iterate(&self, options: ListAssets) -> Iter<Result<Asset>> {
        self.0.iter(self.0.client.assets().iterate(options))
    }
    /// Every child of an asset from `options.cursor` on.
    pub fn iterate_children(&self, options: ListChildren) -> Iter<Result<Asset>> {
        self.0
            .iter(self.0.client.assets().iterate_children(options))
    }
}

/// Folder operations. See [`crate::FoldersClient`].
#[derive(Debug, Clone, Copy)]
pub struct FoldersClient<'a>(&'a ServerClient);
blocking_methods!(FoldersClient => folders {
    /// See [`crate::FoldersClient::list`].
    fn list(options: ListFolders) -> Result<FolderPage>;
    /// See [`crate::FoldersClient::create`].
    fn create(options: CreateFolder) -> Result<Folder>;
    /// See [`crate::FoldersClient::retrieve`].
    fn retrieve(options: FolderId) -> Result<Folder>;
    /// See [`crate::FoldersClient::update`].
    fn update(options: UpdateFolder) -> Result<Folder>;
    /// See [`crate::FoldersClient::move_folder`].
    fn move_folder(options: MoveFolder) -> Result<Folder>;
    /// See [`crate::FoldersClient::delete`].
    fn delete(options: FolderId) -> Result<()>;
});

/// Hash list operations. See [`crate::HashListsClient`].
#[derive(Debug, Clone, Copy)]
pub struct HashListsClient<'a>(&'a ServerClient);
blocking_methods!(HashListsClient => hash_lists {
    /// See [`crate::HashListsClient::list`].
    fn list(options: ListHashLists) -> Result<HashListPage>;
    /// See [`crate::HashListsClient::retrieve`].
    fn retrieve(options: HashListId) -> Result<HashList>;
    /// See [`crate::HashListsClient::create`].
    fn create(options: CreateHashList) -> Result<HashList>;
    /// See [`crate::HashListsClient::update`].
    fn update(options: UpdateHashList) -> Result<HashList>;
    /// See [`crate::HashListsClient::delete`].
    fn delete(options: HashListId) -> Result<()>;
    /// See [`crate::HashListsClient::list_entries`].
    fn list_entries(options: ListHashListEntries) -> Result<HashListEntryPage>;
    /// See [`crate::HashListsClient::add_entry`].
    fn add_entry(options: AddHashListEntry) -> Result<HashListEntry>;
    /// See [`crate::HashListsClient::remove_entry`].
    fn remove_entry(options: HashListEntryId) -> Result<()>;
});

/// The events feed. See [`crate::EventsClient`].
#[derive(Debug, Clone, Copy)]
pub struct EventsClient<'a>(&'a ServerClient);
blocking_methods!(EventsClient => events {
    /// See [`crate::EventsClient::list`].
    fn list(options: ListEvents) -> Result<EventsPage>;
});
impl EventsClient<'_> {
    /// See [`crate::EventsClient::pages`].
    pub fn pages(&self, options: ListEvents) -> Iter<Result<EventsPage>> {
        self.0.iter(self.0.client.events().pages(options))
    }
}

/// Text moderation. See [`crate::TextClient`].
#[derive(Debug, Clone, Copy)]
pub struct TextClient<'a>(&'a ServerClient);
blocking_methods!(TextClient => text {
    /// See [`crate::TextClient::classify`].
    fn classify(options: ClassifyText) -> Result<Asset>;
});

/// Signs upload tokens. See [`crate::UploadTokensClient`].
#[derive(Debug, Clone, Copy)]
pub struct UploadTokensClient<'a>(&'a ServerClient);
impl UploadTokensClient<'_> {
    /// See [`crate::UploadTokensClient::sign`].
    pub fn sign(&self, options: SignUploadToken) -> Result<SignedUploadToken> {
        self.0.client.upload_tokens().sign(options)
    }
}

/// CDN URLs and downloads. See [`crate::CdnClient`].
#[derive(Debug, Clone, Copy)]
pub struct CdnClient<'a>(&'a ServerClient);
impl CdnClient<'_> {
    /// See [`crate::CdnClient::get_asset_url`].
    pub fn get_asset_url(&self, options: &CdnRequest) -> Result<String> {
        self.0.client.cdn().get_asset_url(options)
    }
    /// Fetches an asset through the CDN; the response implements [`std::io::Read`].
    pub fn serve(&self, options: CdnRequest) -> Result<CdnResponse> {
        let response = self.0.wait(self.0.client.cdn().serve(options))?;
        Ok(CdnResponse {
            response,
            runtime: self.0.runtime.clone(),
            pending: Bytes::new(),
        })
    }
}

/// A streaming CDN response that implements [`std::io::Read`]. Drop it to close an
/// unfinished download.
pub struct CdnResponse {
    response: crate::CdnResponse,
    runtime: Arc<Runtime>,
    pending: Bytes,
}
impl fmt::Debug for CdnResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.response.fmt(f)
    }
}
impl CdnResponse {
    /// The HTTP status.
    pub fn status(&self) -> StatusCode {
        self.response.status()
    }
    /// The response headers.
    pub fn headers(&self) -> &HeaderMap {
        self.response.headers()
    }
    /// The next chunk of the body, or `None` at the end.
    pub fn chunk(&mut self) -> Result<Option<Bytes>> {
        if !self.pending.is_empty() {
            return Ok(Some(std::mem::take(&mut self.pending)));
        }
        self.runtime.block_on(self.response.chunk())
    }
    /// The whole body in memory.
    pub fn bytes(mut self) -> Result<Bytes> {
        let mut body = Vec::new();
        while let Some(chunk) = self.chunk()? {
            body.extend_from_slice(&chunk);
        }
        Ok(body.into())
    }
    /// The whole body as UTF-8 text.
    pub fn text(self) -> Result<String> {
        String::from_utf8(self.bytes()?.to_vec()).map_err(|cause| {
            Error::new(ErrorCode::InvalidResponse, "Invalid UTF-8 response").with_source(cause)
        })
    }
}
impl std::io::Read for CdnResponse {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if self.pending.is_empty() {
            match self.runtime.block_on(self.response.chunk()) {
                Ok(Some(chunk)) => self.pending = chunk,
                Ok(None) => return Ok(0),
                Err(error) => {
                    let kind = if error.is_timeout() {
                        std::io::ErrorKind::TimedOut
                    } else {
                        std::io::ErrorKind::Other
                    };
                    return Err(std::io::Error::new(kind, error));
                }
            }
        }
        let count = buffer.len().min(self.pending.len());
        buffer[..count].copy_from_slice(&self.pending.split_to(count));
        Ok(count)
    }
}
