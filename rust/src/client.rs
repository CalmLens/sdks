//! The async [`ServerClient`].
use crate::error::{invalid_argument, invalid_config, invalid_payload, ErrorCode};
use crate::models::*;
use crate::transport::{
    decode, execute, stream_error, upload_body, uuid, CallOptions, Deadline, Exchange, Prepared,
    Transport, DEFAULT_MAX_RESPONSE_BYTES,
};
use crate::{Error, Result};
use bytes::Bytes;
use futures_util::{stream::BoxStream, StreamExt, TryStreamExt};
use http::{HeaderMap, HeaderValue, Method, StatusCode};
use serde::Serialize;
use std::{
    collections::HashMap,
    fmt,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// The production API base URL.
pub const DEFAULT_BASE_URL: &str = "https://api.calmlens.com/v1";
/// The production CDN base URL.
pub const DEFAULT_CDN_BASE_URL: &str = "https://cdn.calmlens.com/v1";
/// The most lens definitions [`ServerClient::ensure_lenses`] sends in one request.
pub const ENSURE_LENSES_MAX_PER_REQUEST: usize = 100;
/// The longest signed URL lifetime the API accepts, in seconds: 24 hours.
pub const MAX_SIGNED_URL_SECONDS: u64 = 24 * 60 * 60;
/// The default timeout of each API call attempt.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);
/// The default timeout of each binary upload attempt: none.
pub const DEFAULT_UPLOAD_TIMEOUT: Option<Duration> = None;
/// How many times a repeatable request is retried by default.
pub const DEFAULT_MAX_RETRIES: u32 = 2;
/// A signed URL's lifetime in seconds when the options give none: 15 minutes.
pub const DEFAULT_SIGNED_URL_SECONDS: u64 = 15 * 60;
/// An upload token's lifetime in seconds when the options give none: 10 minutes.
pub const DEFAULT_UPLOAD_TOKEN_SECONDS: u32 = 10 * 60;
/// How long [`AssetsClient::wait_for_decision`] waits by default.
pub const DEFAULT_DECISION_TIMEOUT: Duration = Duration::from_secs(60);
/// The wait before [`AssetsClient::wait_for_decision`]'s second check.
pub const DECISION_POLL_FIRST_INTERVAL: Duration = Duration::from_millis(500);
/// How much longer each wait between decision checks is than the one before.
pub const DECISION_POLL_INTERVAL_FACTOR: f64 = 1.5;
/// The longest wait between decision checks.
pub const DECISION_POLL_MAX_INTERVAL: Duration = Duration::from_secs(5);

/// Configures a [`ServerClient`]. Create it with [`ServerClient::builder`].
///
/// Defaults: a 120-second `timeout` for API calls (and for the response headers of CDN
/// downloads), no `upload_timeout` for binary uploads, a 10-second `connect_timeout`, a
/// 120-second `read_timeout` between response bytes, 2 retries of repeatable requests and a
/// 32 MiB `max_response_bytes`.
#[derive(Clone)]
pub struct ServerClientBuilder {
    api_key: String,
    project_id: String,
    base_url: String,
    cdn_base_url: String,
    timeout: Duration,
    upload_timeout: Option<Duration>,
    connect_timeout: Duration,
    read_timeout: Duration,
    max_retries: u32,
    max_response_bytes: usize,
    http_client: Option<reqwest::Client>,
}

impl fmt::Debug for ServerClientBuilder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ServerClientBuilder")
            .field("api_key", &"[redacted]")
            .field("project_id", &self.project_id)
            .field("base_url", &self.base_url)
            .field("cdn_base_url", &self.cdn_base_url)
            .field("timeout", &self.timeout)
            .field("upload_timeout", &self.upload_timeout)
            .field("connect_timeout", &self.connect_timeout)
            .field("read_timeout", &self.read_timeout)
            .field("max_retries", &self.max_retries)
            .field("max_response_bytes", &self.max_response_bytes)
            .field("http_client", &self.http_client.is_some())
            .finish()
    }
}

impl ServerClientBuilder {
    pub(crate) fn new(api_key: String, project_id: String) -> Self {
        Self {
            api_key,
            project_id,
            base_url: DEFAULT_BASE_URL.into(),
            cdn_base_url: DEFAULT_CDN_BASE_URL.into(),
            timeout: DEFAULT_TIMEOUT,
            upload_timeout: DEFAULT_UPLOAD_TIMEOUT,
            connect_timeout: Duration::from_secs(10),
            read_timeout: Duration::from_secs(120),
            max_retries: DEFAULT_MAX_RETRIES,
            max_response_bytes: DEFAULT_MAX_RESPONSE_BYTES,
            http_client: None,
        }
    }
    /// The API base URL, e.g. `http://localhost:6110/v1` for a local CalmLens.
    pub fn base_url(mut self, value: impl Into<String>) -> Self {
        self.base_url = value.into();
        self
    }
    /// The CDN base URL.
    pub fn cdn_base_url(mut self, value: impl Into<String>) -> Self {
        self.cdn_base_url = value.into();
        self
    }
    /// The timeout of each API call attempt, response body included (120 seconds by default).
    /// It also covers text uploads and the wait for a CDN download's response headers; binary
    /// uploads use [`upload_timeout`](Self::upload_timeout) instead, and a CDN body streams for
    /// as long as it takes.
    pub fn timeout(mut self, value: Duration) -> Self {
        self.timeout = value;
        self
    }
    /// The timeout of each binary upload attempt (none by default, so large files are not cut
    /// off; `read_timeout` still bounds a stalled connection).
    pub fn upload_timeout(mut self, value: Duration) -> Self {
        self.upload_timeout = Some(value);
        self
    }
    /// The largest API response body the client reads, in bytes (32 MiB by default). A larger
    /// one, or a larger declared `Content-Length`, fails with `sdk/response-too-large` before
    /// it is read. CDN downloads stream and have no limit.
    pub fn max_response_bytes(mut self, value: usize) -> Self {
        self.max_response_bytes = value;
        self
    }
    /// The timeout for establishing a connection (10 seconds by default).
    pub fn connect_timeout(mut self, value: Duration) -> Self {
        self.connect_timeout = value;
        self
    }
    /// The longest wait for the next response bytes, for every request including CDN streams
    /// (120 seconds by default).
    pub fn read_timeout(mut self, value: Duration) -> Self {
        self.read_timeout = value;
        self
    }
    /// How many times to retry a repeatable request (2 by default; 0 disables retries).
    ///
    /// GET and HEAD requests and POSTs carrying an `Idempotency-Key` (uploads and parts) are
    /// retried after transport failures and timeouts, `429`, `502`, `503`, `504` and
    /// `idempotency/request-in-progress`, waiting for `Retry-After` when the server sends one
    /// and otherwise for a jittered exponential backoff. Uploads from readers and streams are
    /// sent once.
    pub fn max_retries(mut self, value: u32) -> Self {
        self.max_retries = value;
        self
    }
    /// Sends requests through your own reqwest client, e.g. for a proxy, custom root
    /// certificates or a shared connection pool. Its own timeouts and redirect policy apply
    /// instead of `connect_timeout` and `read_timeout`; disable redirects on it.
    pub fn http_client(mut self, client: reqwest::Client) -> Self {
        self.http_client = Some(client);
        self
    }
    /// Validates the options and creates the client. Fails with `sdk/invalid-config`.
    pub fn build(self) -> Result<ServerClient> {
        let config = self.validate()?;
        let http = match self.http_client {
            Some(client) => client,
            None => reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(self.connect_timeout)
                .read_timeout(self.read_timeout)
                .build()
                .map_err(|cause| {
                    invalid_config(format!("Could not create the HTTP client: {cause}"))
                        .with_source(cause)
                })?,
        };
        Ok(ServerClient::from_parts(config, Transport::Http(http)))
    }
    #[cfg(feature = "testing")]
    pub(crate) fn build_mock(
        self,
        mock: Arc<crate::testing::MockTransport>,
    ) -> Result<ServerClient> {
        Ok(ServerClient::from_parts(
            self.validate()?,
            Transport::Mock(mock),
        ))
    }
    fn validate(&self) -> Result<Config> {
        for (name, value) in [
            ("timeout", Some(self.timeout)),
            ("upload_timeout", self.upload_timeout),
            ("connect_timeout", Some(self.connect_timeout)),
            ("read_timeout", Some(self.read_timeout)),
        ] {
            if value.is_some_and(|value| value.is_zero()) {
                return Err(invalid_config(format!("{name} must be positive")));
            }
        }
        if self.max_response_bytes == 0 {
            return Err(invalid_config("max_response_bytes must be positive"));
        }
        if self.api_key.is_empty() || self.project_id.is_empty() {
            return Err(invalid_config("API key and project ID are required"));
        }
        id(&self.project_id).map_err(|_| invalid_config("Invalid project ID"))?;
        let api_key = HeaderValue::from_str(&self.api_key)
            .map_err(|_| invalid_config("The API key contains characters a header cannot"))?;
        let mut api_key = api_key;
        api_key.set_sensitive(true);
        let mut urls = Vec::new();
        for url in [&self.base_url, &self.cdn_base_url] {
            let parsed = reqwest::Url::parse(url).ok().filter(|url| {
                ["http", "https"].contains(&url.scheme())
                    && url.query().is_none()
                    && url.fragment().is_none()
            });
            if parsed.is_none() {
                return Err(invalid_config(format!(
                    "Base URLs must be absolute HTTP(S) URLs without a query: {url:?}"
                )));
            }
            urls.push(url.trim_end_matches('/').to_owned());
        }
        Ok(Config {
            api_key,
            project_id: self.project_id.clone(),
            cdn_base_url: urls.pop().unwrap_or_default(),
            base_url: urls.pop().unwrap_or_default(),
            timeout: self.timeout,
            upload_timeout: self.upload_timeout,
            max_retries: self.max_retries,
            max_response_bytes: self.max_response_bytes,
        })
    }
}

struct Config {
    api_key: HeaderValue,
    project_id: String,
    base_url: String,
    cdn_base_url: String,
    timeout: Duration,
    upload_timeout: Option<Duration>,
    max_retries: u32,
    max_response_bytes: usize,
}

struct Inner {
    config: Config,
    transport: Transport,
    user_agent: HeaderValue,
    lenses: Mutex<HashMap<String, Lens>>,
    /// Held while lenses are ensured, so concurrent calls for the same definitions send one
    /// request and the others answer from the cache it fills.
    ensuring: tokio::sync::Mutex<()>,
}

/// The async CalmLens client.
///
/// Create one client and reuse it: clones are cheap and share the connection pool and lens
/// cache, so hold it in your application state (or an `Arc`) rather than creating one per
/// request. All methods are `Send`, so they work in Tokio tasks, axum and actix-web handlers.
#[derive(Clone)]
pub struct ServerClient {
    inner: Arc<Inner>,
    timeout: Option<Duration>,
    max_retries: Option<u32>,
}

impl fmt::Debug for ServerClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let config = &self.inner.config;
        f.debug_struct("ServerClient")
            .field("api_key", &"[redacted]")
            .field("project_id", &config.project_id)
            .field("base_url", &config.base_url)
            .field("cdn_base_url", &config.cdn_base_url)
            .field("timeout", &self.timeout.unwrap_or(config.timeout))
            .field(
                "max_retries",
                &self.max_retries.unwrap_or(config.max_retries),
            )
            .finish_non_exhaustive()
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
        ServerClientBuilder::new(api_key.into(), project_id.into())
    }
    fn from_parts(config: Config, transport: Transport) -> Self {
        let user_agent = HeaderValue::from_str(&crate::user_agent())
            .unwrap_or_else(|_| HeaderValue::from_static("calmlens-rust"));
        Self {
            inner: Arc::new(Inner {
                config,
                transport,
                user_agent,
                lenses: Mutex::new(HashMap::new()),
                ensuring: tokio::sync::Mutex::new(()),
            }),
            timeout: None,
            max_retries: None,
        }
    }
    /// A handle whose calls, including uploads and CDN downloads, time out after `timeout`.
    /// It shares this client's connections.
    pub fn with_timeout(&self, timeout: Duration) -> Self {
        Self {
            timeout: Some(timeout),
            ..self.clone()
        }
    }
    /// A handle that retries repeatable requests up to `max_retries` times.
    pub fn with_max_retries(&self, max_retries: u32) -> Self {
        Self {
            max_retries: Some(max_retries),
            ..self.clone()
        }
    }
    /// The project this client works in.
    pub fn project_id(&self) -> &str {
        &self.inner.config.project_id
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

    /// Creates or updates a named lens and returns it. See [`ServerClient::ensure_lenses`].
    pub async fn ensure_lens(&self, lens: LensDefinition) -> Result<Lens> {
        let mut lenses = self
            .ensure_lenses(EnsureLenses { lenses: vec![lens] })
            .await?;
        lenses
            .pop()
            .ok_or_else(|| Error::new(ErrorCode::InvalidResponse, "Unexpected lens response"))
    }
    /// Creates or updates named lenses and returns them in request order. Definitions this
    /// client has already ensured are answered from its cache without a request, and
    /// concurrent calls wait for each other, so one definition is sent once. More than
    /// [`ENSURE_LENSES_MAX_PER_REQUEST`] new definitions are sent in consecutive requests, in order.
    /// A response that does not return each definition's lens at its position fails with
    /// `sdk/invalid-response`.
    pub async fn ensure_lenses(&self, options: EnsureLenses) -> Result<Vec<Lens>> {
        if options.lenses.is_empty() {
            return Err(invalid_argument("At least one lens is required"));
        }
        let _ensuring = self.inner.ensuring.lock().await;
        let mut keys = Vec::with_capacity(options.lenses.len());
        let mut missing: Vec<(String, &LensDefinition)> = Vec::new();
        let mut resolved = HashMap::new();
        {
            let cache = self.inner.lenses.lock().unwrap_or_else(|e| e.into_inner());
            for lens in &options.lenses {
                id(&lens.identifier)?;
                let key = serde_json::to_string(lens)
                    .map_err(|cause| invalid_argument(cause.to_string()).with_source(cause))?;
                match cache.get(&key) {
                    Some(cached) => {
                        resolved.insert(key.clone(), cached.clone());
                    }
                    None if !missing.iter().any(|(k, _)| *k == key) => {
                        missing.push((key.clone(), lens))
                    }
                    None => {}
                }
                keys.push(key);
            }
        }
        #[derive(Serialize)]
        struct Body<'a> {
            lenses: Vec<&'a LensDefinition>,
        }
        #[derive(serde::Deserialize)]
        struct Response {
            lenses: Vec<Lens>,
        }
        for chunk in missing.chunks(ENSURE_LENSES_MAX_PER_REQUEST) {
            let request = self.prepare(Method::PUT, &self.project_path("lenses")?, &[])?;
            let request = request.json(&Body {
                lenses: chunk.iter().map(|(_, lens)| *lens).collect(),
            })?;
            let response: Response = self.call(request).await?;
            if response.lenses.len() != chunk.len() {
                return Err(Error::new(
                    ErrorCode::InvalidResponse,
                    format!(
                        "Expected {} lenses but CalmLens returned {}",
                        chunk.len(),
                        response.lenses.len()
                    ),
                ));
            }
            let mut cache = self.inner.lenses.lock().unwrap_or_else(|e| e.into_inner());
            for ((key, definition), lens) in chunk.iter().zip(response.lenses) {
                if lens.identifier != definition.identifier {
                    return Err(Error::new(
                        ErrorCode::InvalidResponse,
                        format!("Expected lens {:?} at its position", definition.identifier),
                    ));
                }
                cache.retain(|_, cached| cached.identifier != lens.identifier);
                cache.insert(key.clone(), lens.clone());
                resolved.insert(key.clone(), lens);
            }
        }
        Ok(keys
            .iter()
            .filter_map(|key| resolved.get(key).cloned())
            .collect())
    }

    fn options(&self) -> CallOptions {
        let config = &self.inner.config;
        CallOptions {
            timeout: config.timeout,
            upload_timeout: config.upload_timeout,
            timeout_override: self.timeout,
            max_retries: self.max_retries.unwrap_or(config.max_retries),
            max_response_bytes: config.max_response_bytes,
        }
    }
    fn project_path(&self, path: &str) -> Result<String> {
        Ok(format!(
            "/projects/{}/{path}",
            id(&self.inner.config.project_id)?
        ))
    }
    /// An API request, which accepts JSON.
    fn prepare(&self, method: Method, path: &str, query: &[(String, String)]) -> Result<Prepared> {
        let url = format!("{}{path}", self.inner.config.base_url);
        let mut request = self.prepare_url(method, &url, query)?;
        request.headers.insert(
            http::header::ACCEPT,
            HeaderValue::from_static("application/json"),
        );
        Ok(request)
    }
    fn prepare_url(
        &self,
        method: Method,
        url: &str,
        query: &[(String, String)],
    ) -> Result<Prepared> {
        let mut url = reqwest::Url::parse(url).map_err(|cause| {
            invalid_argument(format!("Invalid URL: {cause}")).with_source(cause)
        })?;
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query);
        }
        let mut request = Prepared::new(method, url);
        request
            .headers
            .insert("x-api-key", self.inner.config.api_key.clone());
        request
            .headers
            .insert(http::header::USER_AGENT, self.inner.user_agent.clone());
        Ok(request)
    }
    async fn send(&self, request: Prepared) -> Result<(u16, HeaderMap, Bytes)> {
        let options = self.options();
        let exchange = execute(&self.inner.transport, request, options, true).await?;
        let (status, headers) = (exchange.status, exchange.headers.clone());
        let body = exchange.read(options.max_response_bytes).await?;
        Ok((status, headers, body))
    }
    async fn call<T: serde::de::DeserializeOwned>(&self, request: Prepared) -> Result<T> {
        let (status, headers, body) = self.send(request).await?;
        decode(status, &headers, &body)
    }
    async fn call_empty(&self, request: Prepared) -> Result<()> {
        self.send(request).await.map(|_| ())
    }
    /// An upload's response, which must be an asset with an ID.
    async fn call_upload(&self, request: Prepared) -> Result<Asset> {
        let (status, headers, body) = self.send(request).await?;
        let value: serde_json::Value = decode(status, &headers, &body)?;
        if value["id"].as_str().is_none_or(|id| id.is_empty()) {
            return Err(Error::new(
                ErrorCode::InvalidResponse,
                "Expected an uploaded asset response",
            )
            .with_status(status));
        }
        serde_json::from_value(value).map_err(|cause| {
            Error::new(
                ErrorCode::InvalidResponse,
                format!("Invalid asset response: {cause}"),
            )
            .with_status(status)
            .with_source(cause)
        })
    }

    async fn submit(&self, options: SubmitAsset, queue: bool) -> Result<Asset> {
        if options.name.is_empty() {
            return Err(invalid_payload("Asset name is required"));
        }
        let sources = [
            options.content.is_some(),
            options.part.is_some(),
            options.url.is_some(),
        ];
        if sources.iter().filter(|present| **present).count() != 1 {
            return Err(invalid_payload(
                "Supply exactly one of content, part, or url; isFinal belongs in part",
            ));
        }
        let idempotency_key = options.idempotency_key.clone().unwrap_or_else(uuid);
        // Only the posts CalmLens uses are sent, which keeps a raw upload's query short.
        let context = options
            .context
            .as_ref()
            .map(|context| ModerationContext::new(select_moderation_context_items(&context.items)));
        let mut query = Query::default();
        query.push("name", &options.name);
        query.push("queue", queue);
        query.opt("description", options.description.as_ref());
        query.json("processingOptions", options.processing_options.as_ref())?;
        query.opt("visibility", options.visibility.as_ref());
        query.json("metadata", options.metadata.as_ref())?;
        query.opt("authorId", options.author_id.as_ref());
        query.json("context", context.as_ref())?;
        query.opt("externalId", options.external_id.as_ref());
        query.opt("externalUrl", options.external_url.as_ref());
        if let Patch::Value(folder) = &options.folder_id {
            query.push("folderId", folder);
        }
        query.opt("uploadPresetId", options.upload_preset_id.as_ref());
        if let Some(url) = &options.url {
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            struct UrlBody<'a> {
                name: &'a str,
                url: &'a str,
                #[serde(skip_serializing_if = "Option::is_none")]
                description: Option<&'a String>,
                #[serde(skip_serializing_if = "Option::is_none")]
                processing_options: Option<&'a ProcessingOptions>,
                #[serde(skip_serializing_if = "Option::is_none")]
                visibility: Option<&'a Visibility>,
                #[serde(skip_serializing_if = "Option::is_none")]
                metadata: Option<&'a Vec<MetadataItem>>,
                #[serde(skip_serializing_if = "Option::is_none")]
                author_id: Option<&'a String>,
                #[serde(skip_serializing_if = "Option::is_none")]
                context: Option<&'a ModerationContext>,
                #[serde(skip_serializing_if = "Option::is_none")]
                external_id: Option<&'a String>,
                #[serde(skip_serializing_if = "Option::is_none")]
                external_url: Option<&'a String>,
                #[serde(skip_serializing_if = "Patch::is_missing")]
                folder_id: &'a Patch<String>,
                #[serde(skip_serializing_if = "Option::is_none")]
                upload_preset_id: Option<&'a String>,
            }
            let request = self
                .prepare(
                    Method::POST,
                    &self.project_path("assets")?,
                    &[("queue".into(), queue.to_string())],
                )?
                .header("idempotency-key", &idempotency_key)?
                .json(&UrlBody {
                    name: &options.name,
                    url,
                    description: options.description.as_ref(),
                    processing_options: options.processing_options.as_ref(),
                    visibility: options.visibility.as_ref(),
                    metadata: options.metadata.as_ref(),
                    author_id: options.author_id.as_ref(),
                    context: context.as_ref(),
                    external_id: options.external_id.as_ref(),
                    external_url: options.external_url.as_ref(),
                    folder_id: &options.folder_id,
                    upload_preset_id: options.upload_preset_id.as_ref(),
                })?;
            return self.call_upload(request).await;
        }
        let multipart = options.part.is_some();
        let content = match (options.content, options.part) {
            (Some(content), _) | (None, Some(content)) => content,
            (None, None) => return Err(invalid_payload("Content is required")),
        };
        let mime = content
            .mime_type
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_lowercase();
        if REJECTED_UPLOAD_MIME_TYPES.contains(&mime.as_str()) {
            return Err(Error::new(
                ErrorCode::InvalidUploadMimeType,
                format!("{mime} is not a valid upload file type. Uploads must use a concrete file MIME type that CalmLens can store and process, such as image/png, image/jpeg, application/pdf, or text/plain."),
            ));
        }
        if multipart && content.part_number.is_some_and(|number| number != 1) {
            return Err(Error::new(
                ErrorCode::UseUploadPart,
                "Use uploadPart for multipart upload parts after the first part",
            ));
        }
        let is_final = content.is_final.unwrap_or(false);
        let deadline = upload_deadline(&content.payload);
        let (body, size) = upload_body(content.payload, multipart, content.size_in_bytes)?;
        if multipart && !self.inner.transport.defers_upload_checks() {
            if mime.starts_with("image/") {
                check_image_size(size, is_final)?;
            }
            check_part_size(size, is_final)?;
        }
        query.push("contentType", &content.mime_type);
        query.opt("sizeInBytes", size);
        if multipart {
            query.push("partNumber", 1);
            query.push("isFinal", is_final);
            query.opt("totalSizeInBytes", options.total_size_in_bytes);
        }
        let mut request = self
            .prepare(Method::POST, &self.project_path("assets")?, &query.0)?
            .header("content-type", &content.mime_type)?
            .header(
                "x-calmlens-upload",
                if multipart { "part" } else { "content" },
            )?
            .header("idempotency-key", &idempotency_key)?;
        request.body = body;
        request.deadline = deadline;
        self.call_upload(request).await
    }

    async fn upload_part(&self, options: UploadPart) -> Result<Asset> {
        let path = format!("/assets/{}/part", id(&options.asset_id)?);
        let part_number = options.part.part_number.unwrap_or(0);
        if part_number < 1 {
            return Err(Error::new(
                ErrorCode::InvalidUploadPartNumber,
                "Multipart upload part number is invalid.",
            ));
        }
        let is_final = options.part.is_final.unwrap_or(false);
        let deadline = upload_deadline(&options.part.payload);
        let (body, size) = upload_body(options.part.payload, true, options.part.size_in_bytes)?;
        if !self.inner.transport.defers_upload_checks() {
            check_part_size(size, is_final)?;
        }
        let mut query = Query::default();
        query.push("partNumber", part_number);
        query.push("isFinal", is_final);
        query.opt("queue", options.queue);
        query.opt("sizeInBytes", size);
        let idempotency_key = options.idempotency_key.unwrap_or_else(uuid);
        // Later parts carry no Content-Type: the API reads the upload's saved type.
        let mut request = self
            .prepare(Method::POST, &path, &query.0)?
            .header("x-calmlens-upload", "part")?
            .header("idempotency-key", &idempotency_key)?;
        request.body = body;
        request.deadline = deadline;
        self.call_upload(request).await
    }

    async fn list_page(&self, options: &ListAssets) -> Result<AssetPage> {
        let mut query = Query::default();
        query.opt("cursor", options.cursor.as_deref());
        query.opt("pageSize", options.page_size);
        query.opt("filter", options.filter.as_ref());
        query.ordering(options.ordering.as_deref());
        query.opt("folderId", options.folder_id.as_ref());
        self.call(self.prepare(Method::GET, &self.project_path("assets/page")?, &query.0)?)
            .await
    }
    async fn children_page(&self, options: &ListChildren) -> Result<AssetPage> {
        let path = format!("/assets/{}/children", id(&options.asset_id)?);
        let mut query = Query::default();
        query.opt("cursor", options.cursor.as_deref());
        query.opt("pageSize", options.page_size);
        query.opt("filter", options.filter.as_ref());
        query.ordering(options.ordering.as_deref());
        self.call(self.prepare(Method::GET, &path, &query.0)?).await
    }
    async fn events_page(&self, options: &ListEvents) -> Result<EventsPage> {
        let mut query = Query::default();
        query.opt("after", options.after.as_ref());
        query.opt("limit", options.limit);
        self.call(self.prepare(Method::GET, &self.project_path("events")?, &query.0)?)
            .await
    }
}

/// Refuses a multipart part under 5 MiB that is not the last, before it is sent.
fn check_part_size(size: Option<u64>, is_final: bool) -> Result<()> {
    if !is_final && size.is_some_and(|size| size < 5 * 1024 * 1024) {
        return Err(invalid_payload(
            "Multipart upload parts must be at least 5MiB except the final part.",
        ));
    }
    Ok(())
}

/// Refuses a first multipart image part over 20 MiB, or a final one (the whole image) under
/// 10 MiB, before it is sent.
fn check_image_size(size: Option<u64>, is_final: bool) -> Result<()> {
    let Some(size) = size else { return Ok(()) };
    if size > 20 * 1024 * 1024 {
        return Err(Error::new(
            ErrorCode::MultipartImageTooLarge,
            "Multipart image uploads cannot exceed 20MB.",
        ));
    }
    if is_final && size < 10 * 1024 * 1024 {
        return Err(Error::new(
            ErrorCode::MultipartImageTooSmall,
            "Multipart image uploads must total at least 10MB.",
        ));
    }
    Ok(())
}

/// MIME types an upload cannot use: they name no concrete file type.
const REJECTED_UPLOAD_MIME_TYPES: [&str; 7] = [
    "application/octet-stream",
    "multipart/form-data",
    "multipart/mixed",
    "multipart/alternative",
    "multipart/related",
    "multipart/signed",
    "multipart/encrypted",
];

/// Text is small, so it keeps the API timeout; binary files may be arbitrarily large.
fn upload_deadline(payload: &Payload) -> Deadline {
    match payload {
        Payload::Text(_) => Deadline::Api,
        _ => Deadline::Upload,
    }
}

#[derive(Default)]
struct Query(Vec<(String, String)>);
impl Query {
    fn push(&mut self, key: &str, value: impl fmt::Display) {
        self.0.push((key.into(), value.to_string()));
    }
    fn opt(&mut self, key: &str, value: Option<impl fmt::Display>) {
        if let Some(value) = value {
            self.push(key, value);
        }
    }
    fn json(&mut self, key: &str, value: Option<&impl Serialize>) -> Result<()> {
        if let Some(value) = value {
            let text = serde_json::to_string(value)
                .map_err(|cause| invalid_argument(cause.to_string()).with_source(cause))?;
            self.push(key, text);
        }
        Ok(())
    }
    fn ordering(&mut self, ordering: Option<&[Order]>) {
        for (index, order) in ordering.unwrap_or_default().iter().enumerate() {
            self.push(&format!("ordering[{index}][field]"), &order.field);
            self.push(&format!("ordering[{index}][direction]"), &order.direction);
        }
    }
}

fn percent_encode(value: &str, keep: &[u8]) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || keep.contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}
/// Encodes an identifier as one path segment. "." and ".." are rejected because URL
/// resolution treats them as relative segments, which would reach another route.
/// The most assets one [`AssetsClient::batch`] request takes.
pub const ASSET_BATCH_MAX_ASSETS: usize = 500;

/// Refuses a batch the API would reject for its size or an empty ID.
pub(crate) fn validate_batch(options: &BatchAssets) -> Result<()> {
    if options.asset_ids.is_empty() || options.asset_ids.len() > ASSET_BATCH_MAX_ASSETS {
        return Err(invalid_argument(format!(
            "asset_ids must list 1 to {ASSET_BATCH_MAX_ASSETS} asset IDs"
        )));
    }
    if options.asset_ids.iter().any(String::is_empty) {
        return Err(invalid_argument(
            "Every asset ID must be a non-empty string",
        ));
    }
    Ok(())
}

pub(crate) fn id(value: &str) -> Result<String> {
    if value.is_empty() {
        return Err(invalid_argument("Identifier is required"));
    }
    if value == "." || value == ".." {
        return Err(invalid_argument("Identifier cannot be \".\" or \"..\""));
    }
    Ok(percent_encode(value, b"-_.!~*'()"))
}
/// Encodes a CDN transform selector like JavaScript's encodeURI, keeping its separators and
/// the literal `[` and `]` the CDN matches.
fn transform(value: &str) -> Result<String> {
    let value = value.trim_start_matches('/');
    if value.contains("..") || value.contains('?') || value.contains('#') {
        return Err(invalid_argument(
            "Transform cannot contain \"..\", \"?\" or \"#\"",
        ));
    }
    // Like JavaScript's encodeURI.
    Ok(percent_encode(value, b"-_.!~*'();/:@&=+$,"))
}

/// Asset operations. Get it from [`ServerClient::assets`].
#[derive(Debug, Clone, Copy)]
pub struct AssetsClient<'a>(&'a ServerClient);
impl AssetsClient<'_> {
    /// Uploads an asset and queues it for classification, returning straight away
    /// (`POST /projects/:projectId/assets?queue=true`). Retries reuse one
    /// `Idempotency-Key`, so a retried upload never creates a second asset.
    pub async fn create(&self, options: SubmitAsset) -> Result<Asset> {
        self.0.submit(options, true).await
    }
    /// Uploads an asset and waits for its moderation decision.
    pub async fn classify(&self, options: SubmitAsset) -> Result<Asset> {
        if let Some(Content {
            payload: Payload::Text(text),
            ..
        }) = &options.content
        {
            if text.trim().is_empty() {
                return Err(invalid_payload(
                    "Text to classify must be a non-empty string",
                ));
            }
        }
        self.0.submit(options, false).await
    }
    /// Sends a later multipart part. The final part is classified with the `queue` choice
    /// saved when the upload started unless `options.queue` overrides it.
    pub async fn upload_part(&self, options: UploadPart) -> Result<Asset> {
        self.0.upload_part(options).await
    }
    /// Searches accessible assets in natural language.
    pub async fn search(&self, options: SearchAssets) -> Result<AssetSearchResponse> {
        let mut query = Query::default();
        query.push("query", &options.query);
        query.opt("mode", options.mode.as_ref());
        query.opt("limit", options.limit);
        self.0
            .call(self.0.prepare(
                Method::GET,
                &self.0.project_path("assets/search")?,
                &query.0,
            )?)
            .await
    }
    /// One page of assets.
    pub async fn list(&self, options: ListAssets) -> Result<AssetPage> {
        self.0.list_page(&options).await
    }
    /// Every asset from `options.cursor` on, fetching pages as the stream is read. It ends
    /// at a page without a next cursor, with `has_more: false` or without items, and fails with
    /// `sdk/invalid-response` (`details.cursor`) instead of yielding a page that hands back a
    /// cursor it already sent.
    pub fn iterate(&self, options: ListAssets) -> BoxStream<'static, Result<Asset>> {
        let client = self.0.clone();
        paginate(
            options,
            |options| options.cursor.clone(),
            move |options| {
                let client = client.clone();
                async move {
                    let page = client.list_page(&options).await?;
                    let next = next_asset_cursor(&page).map(|cursor| ListAssets {
                        cursor: Some(cursor),
                        ..options
                    });
                    Ok((page.items, next))
                }
            },
        )
    }
    /// One page of an asset's children.
    pub async fn list_children(&self, options: ListChildren) -> Result<AssetPage> {
        self.0.children_page(&options).await
    }
    /// Every child of an asset from `options.cursor` on, ending and failing like
    /// [`iterate`](Self::iterate).
    pub fn iterate_children(&self, options: ListChildren) -> BoxStream<'static, Result<Asset>> {
        let client = self.0.clone();
        paginate(
            options,
            |options| options.cursor.clone(),
            move |options| {
                let client = client.clone();
                async move {
                    let page = client.children_page(&options).await?;
                    let next = next_asset_cursor(&page).map(|cursor| ListChildren {
                        cursor: Some(cursor),
                        ..options
                    });
                    Ok((page.items, next))
                }
            },
        )
    }
    /// Retrieves an asset's current state.
    pub async fn retrieve(&self, options: AssetId) -> Result<Asset> {
        let path = format!("/assets/{}", id(&options.asset_id)?);
        let mut query = Query::default();
        query.opt("region", options.region.as_ref());
        self.0
            .call(self.0.prepare(Method::GET, &path, &query.0)?)
            .await
    }
    /// Retrieves the asset until it is decided ([`Asset::is_decided`]: moderation status no
    /// longer `pending`, or classification status `failed`) and returns it. It checks again
    /// after 0.5 seconds, waiting 1.5 times longer each time up to 5 seconds, and fails with
    /// `sdk/timeout` and details `{assetId, classificationStatus, moderationStatus}` when
    /// `options.timeout` (60 seconds by default) passes without a decision. Drop the future to
    /// stop waiting. Webhooks report decisions without polling.
    pub async fn wait_for_decision(&self, options: WaitForDecision) -> Result<Asset> {
        let timeout = options.timeout.unwrap_or(DEFAULT_DECISION_TIMEOUT);
        let asset_id = AssetId::new(options.asset_id);
        // A timeout too large to add to the clock never runs out.
        let transport = &self.0.inner.transport;
        let deadline = transport.now().checked_add(timeout);
        let mut delay = DECISION_POLL_FIRST_INTERVAL;
        loop {
            let asset = self.retrieve(asset_id.clone()).await?;
            if asset.is_decided() {
                return Ok(asset);
            }
            let remaining =
                deadline.map(|deadline| deadline.saturating_duration_since(transport.now()));
            if remaining == Some(Duration::ZERO) {
                let processing = asset.classification.status.as_str();
                let moderation = asset.classification.moderation.status.as_str();
                let mut details = serde_json::Map::new();
                details.insert("assetId".into(), asset.id.clone().into());
                details.insert("classificationStatus".into(), processing.into());
                details.insert("moderationStatus".into(), moderation.into());
                return Err(Error::new(
                    ErrorCode::Timeout,
                    format!(
                        "Asset {} had no moderation decision after {timeout:?} (processing {processing}, moderation {moderation})",
                        asset.id
                    ),
                )
                .with_details(details));
            }
            transport
                .sleep(remaining.map_or(delay, |remaining| remaining.min(delay)))
                .await;
            delay = delay
                .mul_f64(DECISION_POLL_INTERVAL_FACTOR)
                .min(DECISION_POLL_MAX_INTERVAL);
        }
    }
    /// Updates an asset; [`Patch::Missing`] fields are left unchanged.
    pub async fn update(&self, options: UpdateAsset) -> Result<Asset> {
        let path = format!("/assets/{}", id(&options.asset_id)?);
        let request = self.0.prepare(Method::PATCH, &path, &[])?.json(&options)?;
        self.0.call(request).await
    }
    /// Classifies an asset whose processing failed (status `error`) again.
    pub async fn retry(&self, options: AssetId) -> Result<Asset> {
        let path = format!("/assets/{}/retry", id(&options.asset_id)?);
        self.0.call(self.0.prepare(Method::POST, &path, &[])?).await
    }
    /// Completes the policy evidence behind a decided asset's moderation decision: the report's
    /// `policy.evidence` becomes `full` and every action stays as decided. With `rerun` the asset
    /// is moderated again with the project's current policy and returns in `processing`; use it
    /// when the policy changed since the decision (`asset/policy-changed`).
    pub async fn explain(&self, options: ExplainAsset) -> Result<Asset> {
        let path = format!("/assets/{}/explain", id(&options.asset_id)?);
        let request = self.0.prepare(Method::POST, &path, &[])?.json(&options)?;
        self.0.call(request).await
    }
    /// Removes the stored content (`DELETE /assets/:assetId/content`). The asset record,
    /// metadata and report remain; the returned asset has `storage_deleted_at` set.
    pub async fn delete_content(&self, options: AssetId) -> Result<Asset> {
        let path = format!("/assets/{}/content", id(&options.asset_id)?);
        self.0
            .call(self.0.prepare(Method::DELETE, &path, &[])?)
            .await
    }
    /// Deletes the asset record and its stored content (`DELETE /assets/:assetId`).
    pub async fn delete(&self, options: AssetId) -> Result<()> {
        let path = format!("/assets/{}", id(&options.asset_id)?);
        self.0
            .call_empty(self.0.prepare(Method::DELETE, &path, &[])?)
            .await
    }
    /// Deletes up to 500 assets ([`AssetBatchOperation::Delete`]) or removes their stored content
    /// ([`AssetBatchOperation::RemoveContent`]) in one request
    /// (`POST /projects/:projectId/assets/batch`). Every asset must exist in the project and the
    /// key needs `assets:delete` for its folder, or nothing is queued. Returns once queued; the
    /// work runs in the background and records `asset.deleted` or `asset.content-removed` for
    /// each asset. Assets under a safety hold are skipped. Not retried: it carries no
    /// `Idempotency-Key`.
    pub async fn batch(&self, options: BatchAssets) -> Result<BatchAssetsResponse> {
        validate_batch(&options)?;
        let path = self.0.project_path("assets/batch")?;
        let request = self.0.prepare(Method::POST, &path, &[])?.json(&options)?;
        self.0.call(request).await
    }
    /// Moves an asset to a folder, or to the project root.
    pub async fn move_asset(&self, options: MoveAsset) -> Result<Asset> {
        let path = format!("/assets/{}/move", id(&options.asset_id)?);
        let request = self.0.prepare(Method::POST, &path, &[])?.json(&options)?;
        self.0.call(request).await
    }
    /// Creates a signed URL for an asset's rendered (the API's default) or original resource
    /// (15 minutes by default).
    pub async fn create_signed_url(&self, options: SignedUrlOptions) -> Result<SignedUrl> {
        let path = format!("/assets/{}/signed-url", id(&options.asset_id)?);
        match &options.resource {
            None | Some(SignedUrlResource::Rendered) => {}
            Some(SignedUrlResource::Original) => {
                if options.lens.is_some() || options.transform.is_some() {
                    return Err(invalid_argument(
                        "Lenses and transforms apply only to the rendered resource",
                    ));
                }
            }
            Some(_) => {
                return Err(invalid_argument(
                    "A signed URL's resource must be original or rendered",
                ))
            }
        }
        if options
            .expires_in_seconds
            .is_some_and(|seconds| !(1..=MAX_SIGNED_URL_SECONDS).contains(&seconds))
        {
            return Err(invalid_argument(
                "expires_in_seconds must be from 1 to 86400",
            ));
        }
        let transform = match options.transform {
            Some(transform) => Some(CdnTransform::Selector(transform.selector()?)),
            None => None,
        };
        let options = SignedUrlOptions {
            transform,
            expires_in_seconds: Some(
                options
                    .expires_in_seconds
                    .unwrap_or(DEFAULT_SIGNED_URL_SECONDS),
            ),
            ..options
        };
        let request = self.0.prepare(Method::POST, &path, &[])?.json(&options)?;
        self.0.call(request).await
    }
}

/// The cursor of the page after `page`, or `None` when the iteration ends there.
fn next_asset_cursor(page: &AssetPage) -> Option<String> {
    let more = page.has_more.unwrap_or(false) && !page.items.is_empty();
    page.next_cursor.clone().filter(|_| more)
}

/// The error for a page that hands back a cursor the iteration already sent, which would
/// otherwise repeat pages forever.
fn repeated_cursor(cursor: &str) -> Error {
    let mut details = serde_json::Map::new();
    details.insert("cursor".into(), cursor.into());
    Error::new(
        ErrorCode::InvalidResponse,
        "The API returned a cursor it had already returned, with more pages to follow",
    )
    .with_details(details)
}

/// Yields the pages `fetch` returns, each with the next page's options; `cursor` reads the
/// cursor options send. A page whose next cursor was already sent fails, and is not yielded.
fn pages<O, P, C, F, Fut>(first: O, cursor: C, fetch: F) -> BoxStream<'static, Result<P>>
where
    O: Send + 'static,
    P: Send + 'static,
    C: Fn(&O) -> Option<String> + Send + Sync + 'static,
    F: Fn(O) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<(P, Option<O>)>> + Send + 'static,
{
    let mut sent = std::collections::HashSet::new();
    if let Some(first) = cursor(&first) {
        sent.insert(first);
    }
    let cursor = Arc::new(cursor);
    futures_util::stream::try_unfold((Some(first), sent), move |(next, mut sent)| {
        let page = next.map(&fetch);
        let cursor = cursor.clone();
        let checked = page.map(|page| async move {
            let (page, next) = page.await?;
            if let Some(next_cursor) = next.as_ref().and_then(|next| cursor(next)) {
                if !sent.insert(next_cursor.clone()) {
                    return Err(repeated_cursor(&next_cursor));
                }
            }
            Ok((page, (next, sent)))
        });
        async move {
            match checked {
                None => Ok(None),
                Some(checked) => checked.await.map(Some),
            }
        }
    })
    .boxed()
}

/// Yields the items of successive pages, as [`pages`] fetches them.
fn paginate<O, C, F, Fut, T>(first: O, cursor: C, fetch: F) -> BoxStream<'static, Result<T>>
where
    O: Send + 'static,
    T: Send + 'static,
    C: Fn(&O) -> Option<String> + Send + Sync + 'static,
    F: Fn(O) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<(Vec<T>, Option<O>)>> + Send + 'static,
{
    pages(first, cursor, fetch)
        .map_ok(|items| futures_util::stream::iter(items.into_iter().map(Ok)))
        .try_flatten()
        .boxed()
}

/// Folder operations. Get it from [`ServerClient::folders`].
#[derive(Debug, Clone, Copy)]
pub struct FoldersClient<'a>(&'a ServerClient);
impl FoldersClient<'_> {
    /// One page of child folders.
    pub async fn list(&self, options: ListFolders) -> Result<FolderPage> {
        let mut query = Query::default();
        query.opt("parentId", options.parent_id.as_ref());
        query.opt("pageIndex", options.page_index);
        query.opt("pageSize", options.page_size);
        query.opt("search", options.search.as_ref());
        query.opt("searchAll", options.search_all);
        query.opt("resolveOnly", options.resolve_only);
        query.opt("sort", options.sort.as_ref());
        query.opt("direction", options.direction.as_ref());
        for (index, folder_id) in options.ids.unwrap_or_default().iter().enumerate() {
            query.push(&format!("ids[{index}]"), folder_id);
        }
        let request = self
            .0
            .prepare(Method::GET, &self.0.project_path("folders")?, &query.0)?;
        self.0.call(request).await
    }
    /// Creates a folder.
    pub async fn create(&self, options: CreateFolder) -> Result<Folder> {
        let request = self
            .0
            .prepare(Method::POST, &self.0.project_path("folders")?, &[])?
            .json(&options)?;
        self.0.call(request).await
    }
    /// Retrieves a folder.
    pub async fn retrieve(&self, options: FolderId) -> Result<Folder> {
        let path = format!("/folders/{}", id(&options.folder_id)?);
        self.0.call(self.0.prepare(Method::GET, &path, &[])?).await
    }
    /// Renames a folder.
    pub async fn update(&self, options: UpdateFolder) -> Result<Folder> {
        let path = format!("/folders/{}", id(&options.folder_id)?);
        let request = self.0.prepare(Method::PATCH, &path, &[])?.json(&options)?;
        self.0.call(request).await
    }
    /// Moves a folder under another folder, or to the project root.
    pub async fn move_folder(&self, options: MoveFolder) -> Result<Folder> {
        let path = format!("/folders/{}/move", id(&options.folder_id)?);
        let request = self.0.prepare(Method::POST, &path, &[])?.json(&options)?;
        self.0.call(request).await
    }
    /// Deletes an empty folder.
    pub async fn delete(&self, options: FolderId) -> Result<()> {
        let path = format!("/folders/{}", id(&options.folder_id)?);
        self.0
            .call_empty(self.0.prepare(Method::DELETE, &path, &[])?)
            .await
    }
}

/// Hash list operations. Get it from [`ServerClient::hash_lists`].
///
/// Hash lists hold PDQ hashes of images the project never wants again. Image uploads are
/// compared with every list: `flag` lists record matches, `block` lists also block close ones.
#[derive(Debug, Clone, Copy)]
pub struct HashListsClient<'a>(&'a ServerClient);
impl HashListsClient<'_> {
    /// Every hash list in the project.
    pub async fn list(&self) -> Result<HashListList> {
        let request = self
            .0
            .prepare(Method::GET, &self.0.project_path("hash-lists")?, &[])?;
        self.0.call(request).await
    }
    /// Retrieves a hash list.
    pub async fn retrieve(&self, options: HashListId) -> Result<HashList> {
        let path = format!("/hash-lists/{}", id(&options.hash_list_id)?);
        self.0.call(self.0.prepare(Method::GET, &path, &[])?).await
    }
    /// Creates a hash list.
    pub async fn create(&self, options: CreateHashList) -> Result<HashList> {
        let request = self
            .0
            .prepare(Method::POST, &self.0.project_path("hash-lists")?, &[])?
            .json(&options)?;
        self.0.call(request).await
    }
    /// Renames a hash list or changes what its matches do; the new action applies to later
    /// uploads.
    pub async fn update(&self, options: UpdateHashList) -> Result<HashList> {
        let path = format!("/hash-lists/{}", id(&options.hash_list_id)?);
        let request = self.0.prepare(Method::PATCH, &path, &[])?.json(&options)?;
        self.0.call(request).await
    }
    /// Deletes a hash list and every entry in it.
    pub async fn delete(&self, options: HashListId) -> Result<()> {
        let path = format!("/hash-lists/{}", id(&options.hash_list_id)?);
        self.0
            .call_empty(self.0.prepare(Method::DELETE, &path, &[])?)
            .await
    }
    /// One page of a hash list's entries, newest first.
    pub async fn list_entries(&self, options: ListHashListEntries) -> Result<HashListEntryPage> {
        let path = format!("/hash-lists/{}/entries", id(&options.hash_list_id)?);
        let mut query = Query::default();
        query.opt("cursor", options.cursor.as_ref());
        query.opt("pageSize", options.page_size);
        self.0
            .call(self.0.prepare(Method::GET, &path, &query.0)?)
            .await
    }
    /// Adds a hash, or an image asset's perceptual hash, to a hash list. A hash the list
    /// already holds returns its existing entry.
    pub async fn add_entry(&self, options: AddHashListEntry) -> Result<HashListEntry> {
        let path = format!("/hash-lists/{}/entries", id(&options.hash_list_id)?);
        let request = self.0.prepare(Method::POST, &path, &[])?.json(&options)?;
        self.0.call(request).await
    }
    /// Removes a hash from its hash list.
    pub async fn remove_entry(&self, options: HashListEntryId) -> Result<()> {
        let path = format!("/hash-list-entries/{}", id(&options.entry_id)?);
        self.0
            .call_empty(self.0.prepare(Method::DELETE, &path, &[])?)
            .await
    }
}

/// The events feed. Get it from [`ServerClient::events`].
#[derive(Debug, Clone, Copy)]
pub struct EventsClient<'a>(&'a ServerClient);
impl EventsClient<'_> {
    /// One page of events after `options.after`. Without `after` the page is empty and its
    /// cursor marks now.
    pub async fn list(&self, options: ListEvents) -> Result<EventsPage> {
        self.0.events_page(&options).await
    }
    /// Pages of events from `options.after`, following each page's cursor until a page has
    /// `has_more: false`. Store the last page's `cursor` and continue from it later. A page
    /// with more to follow that hands back a cursor already sent fails with
    /// `sdk/invalid-response` (`details.cursor`) and is not yielded.
    pub fn pages(&self, options: ListEvents) -> BoxStream<'static, Result<EventsPage>> {
        let client = self.0.clone();
        pages(
            options,
            |options| options.after.clone(),
            move |options| {
                let client = client.clone();
                async move {
                    let page = client.events_page(&options).await?;
                    let next = page.has_more.then(|| ListEvents {
                        after: Some(page.cursor.clone()),
                        ..options
                    });
                    Ok((page, next))
                }
            },
        )
    }
}

/// Signs upload tokens, which let a browser upload through an upload preset. Get it from
/// [`ServerClient::upload_tokens`]. Signing happens locally with the API key; no request is made.
#[derive(Debug, Clone, Copy)]
pub struct UploadTokensClient<'a>(&'a ServerClient);
impl UploadTokensClient<'_> {
    /// Signs a single-use token. Hand it to the browser as its bearer token and give each
    /// upload its own.
    pub fn sign(&self, options: SignUploadToken) -> Result<SignedUploadToken> {
        let api_key = String::from_utf8_lossy(self.0.inner.config.api_key.as_bytes()).into_owned();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64);
        sign_upload_token(&api_key, options, now, &uuid())
    }
}

/// Signs an upload token for `api_key` at `now` (epoch milliseconds) with `nonce`.
pub(crate) fn sign_upload_token(
    api_key: &str,
    options: SignUploadToken,
    now: u64,
    nonce: &str,
) -> Result<SignedUploadToken> {
    use base64::Engine;
    use hmac::{Hmac, Mac};
    use sha2::{Digest, Sha256};

    id(&options.upload_preset_id).map_err(|_| invalid_argument("Upload preset ID is required"))?;
    let ttl = options
        .expires_in_seconds
        .unwrap_or(DEFAULT_UPLOAD_TOKEN_SECONDS);
    if !(1..=3600).contains(&ttl) {
        return Err(invalid_argument(
            "expiresInSeconds must be a whole number from 1 to 3600",
        ));
    }
    if options.external_id.as_deref() == Some("") {
        return Err(invalid_argument("externalId must be a non-empty string"));
    }
    let prefix_length = if api_key.starts_with("clsk_") { 13 } else { 8 };
    let prefix: String = api_key.chars().take(prefix_length).collect();
    let expires_at = now + u64::from(ttl) * 1000;
    // Field order and escaping as JavaScript's JSON.stringify writes them, which serde_json
    // matches: no whitespace, raw UTF-8, and only quotes, backslashes and control characters
    // escaped.
    #[derive(Serialize)]
    struct Claims<'a> {
        v: u8,
        u: &'a str,
        k: &'a str,
        e: u64,
        n: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        x: Option<&'a str>,
    }
    let claims = Claims {
        v: 1,
        u: &options.upload_preset_id,
        k: &prefix,
        e: expires_at,
        n: nonce,
        x: options.external_id.as_deref(),
    };
    let body = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&claims).map_err(|e| invalid_argument(e.to_string()))?);
    let secret: String = Sha256::digest(api_key.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|e| invalid_argument(e.to_string()))?;
    mac.update(format!("calmlens-upload-token:v1:{body}").as_bytes());
    let signature: String = mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(SignedUploadToken {
        token: format!("clut_{body}.{signature}"),
        expires_at,
    })
}

/// Text moderation. Get it from [`ServerClient::text`].
#[derive(Debug, Clone, Copy)]
pub struct TextClient<'a>(&'a ServerClient);
impl TextClient<'_> {
    /// Moderates text as a `text/plain` asset named `text` unless `name` is set.
    pub async fn classify(&self, options: ClassifyText) -> Result<Asset> {
        self.0
            .assets()
            .classify(SubmitAsset {
                name: options.name.unwrap_or_else(|| "text".into()),
                content: Some(Content::text(options.text)),
                description: options.description,
                processing_options: options.processing_options,
                metadata: options.metadata,
                author_id: options.author_id,
                context: options.context,
                external_id: options.external_id,
                external_url: options.external_url,
                folder_id: options.folder_id,
                upload_preset_id: options.upload_preset_id,
                idempotency_key: options.idempotency_key,
                ..Default::default()
            })
            .await
    }
}

/// CDN URLs and downloads. Get it from [`ServerClient::cdn`].
#[derive(Debug, Clone, Copy)]
pub struct CdnClient<'a>(&'a ServerClient);
impl CdnClient<'_> {
    /// The CDN URL of an asset's rendered (default), original or placeholder resource, with
    /// `?ageConfirmed=true` when [`CdnRequest::age_confirmed`] is `Some(true)`. Only the
    /// rendered resource takes a lens or transform; a placeholder also takes no `age_confirmed`.
    pub fn get_asset_url(&self, options: &CdnRequest) -> Result<String> {
        let resource = options
            .resource
            .as_ref()
            .map_or("rendered", |value| value.as_str());
        if !["original", "rendered", "placeholder"].contains(&resource) {
            return Err(invalid_argument(
                "Resource must be original, rendered or placeholder",
            ));
        }
        let transformed = options.lens.is_some() || options.transform.is_some();
        if resource == "original" && transformed {
            return Err(invalid_argument(
                "Lenses and transforms apply only to the rendered resource",
            ));
        }
        if resource == "placeholder" && (transformed || options.age_confirmed == Some(true))
        {
            return Err(invalid_argument(
                "A placeholder takes no lens, transform or ageConfirmed",
            ));
        }
        let config = &self.0.inner.config;
        let mut url = format!(
            "{}/assets/{}/{}/{resource}",
            config.cdn_base_url,
            id(&config.project_id)?,
            id(&options.asset_identifier)?
        );
        if let Some(lens) = options.lens.as_deref().filter(|v| !v.is_empty()) {
            url.push_str(&format!("/@{}", id(lens)?));
        }
        if let Some(value) = options.transform.as_ref().filter(|v| !v.is_empty()) {
            url.push('/');
            match value {
                CdnTransform::Selector(value) => url.push_str(&transform(value)?),
                // Already path-safe: unreserved characters, percent escapes, `=`, `,` and `/`.
                CdnTransform::Steps(_) => url.push_str(&value.selector()?),
            }
        }
        let mut query = Query::default();
        if options.age_confirmed == Some(true) {
            query.push("ageConfirmed", "true");
        }
        query.opt("region", options.region.as_ref());
        if !query.0.is_empty() {
            url.push('?');
            url.push_str(
                &query
                    .0
                    .iter()
                    .map(|(key, value)| {
                        format!(
                            "{}={}",
                            percent_encode(key, b"-._~"),
                            percent_encode(value, b"-._~")
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("&"),
            );
        }
        Ok(url)
    }
    /// Fetches an asset through the CDN with the API key, returning the response whatever
    /// its status. The body streams; it is not subject to the API call timeout.
    pub async fn serve(&self, options: CdnRequest) -> Result<CdnResponse> {
        let url = self.get_asset_url(&options)?;
        let init = options.init.unwrap_or_default();
        let method = Method::from_bytes(init.method.as_deref().unwrap_or("GET").as_bytes())
            .map_err(|_| invalid_argument("Invalid HTTP method"))?;
        let mut request = self.0.prepare_url(method, &url, &[])?;
        for (name, value) in &init.headers {
            if name.eq_ignore_ascii_case("x-api-key") {
                continue;
            }
            let name = http::HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| invalid_argument(format!("Invalid header name {name:?}")))?;
            let value = HeaderValue::from_str(value)
                .map_err(|_| invalid_argument(format!("Invalid {name} header value")))?;
            request.headers.insert(name, value);
        }
        request.deadline = Deadline::Headers;
        let exchange: Exchange =
            execute(&self.0.inner.transport, request, self.0.options(), false).await?;
        Ok(CdnResponse {
            status: StatusCode::from_u16(exchange.status)
                .map_err(|_| Error::new(ErrorCode::InvalidResponse, "Invalid status"))?,
            headers: exchange.headers.clone(),
            body: exchange.stream(),
        })
    }
}

/// A streaming CDN response. Drop it to close an unfinished download.
pub struct CdnResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: crate::ByteStream,
}
impl fmt::Debug for CdnResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CdnResponse")
            .field("status", &self.status)
            .field("headers", &self.headers)
            .finish_non_exhaustive()
    }
}
impl CdnResponse {
    /// The HTTP status.
    pub fn status(&self) -> StatusCode {
        self.status
    }
    /// The response headers.
    pub fn headers(&self) -> &HeaderMap {
        &self.headers
    }
    /// The next chunk of the body, or `None` at the end.
    pub async fn chunk(&mut self) -> Result<Option<Bytes>> {
        match self.body.next().await {
            None => Ok(None),
            Some(chunk) => chunk.map(Some).map_err(stream_error),
        }
    }
    /// The whole body in memory. Prefer [`CdnResponse::chunk`] or
    /// [`CdnResponse::into_stream`] for large files.
    pub async fn bytes(mut self) -> Result<Bytes> {
        let mut body = Vec::new();
        while let Some(chunk) = self.chunk().await? {
            body.extend_from_slice(&chunk);
        }
        Ok(body.into())
    }
    /// The whole body as UTF-8 text.
    pub async fn text(self) -> Result<String> {
        String::from_utf8(self.bytes().await?.to_vec()).map_err(|cause| {
            Error::new(ErrorCode::InvalidResponse, "Invalid UTF-8 response").with_source(cause)
        })
    }
    /// The body as a stream of chunks.
    pub fn into_stream(self) -> BoxStream<'static, Result<Bytes>> {
        self.body.map_err(stream_error).boxed()
    }
}
