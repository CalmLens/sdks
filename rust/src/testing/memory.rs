//! The in-memory API behind [`MockServerClient::in_memory`](super::MockServerClient::in_memory).
use super::asset_filters;
use super::decision::{
    IntoMockDecision, MockDecision, MockModerationContent, MockModerationInput,
    MockModerationTrigger, MockOutcome,
};
use super::MockResponse;
use crate::contract_checks::{
    check_transform_options, invalid_upload_mime_type, is_accepted_upload_mime_type,
    parse_transform_selector,
};
use crate::error::ErrorCode;
use crate::models::{select_moderation_context_items, ModerationContext};
use base64::Engine;
use http::{HeaderMap, Method};
use serde_json::{json, Map, Value};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashMap, HashSet},
    fmt,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

mod policies;

pub(super) const API_BASE_URL: &str = "https://api.calmlens.invalid/v1";
pub(super) const CDN_BASE_URL: &str = "https://cdn.calmlens.invalid/v1";

/// One permission grant of a key made by [`create_mock_api_key`].
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockApiKeyGrant {
    /// Actions, e.g. `assets:download` for CDN access to private and age-restricted assets.
    pub actions: Vec<String>,
    /// The folder the grant covers, or every folder when `None`.
    pub folder_id: Option<String>,
    /// Whether the grant also covers the folder's subfolders.
    pub include_subfolders: bool,
}
impl MockApiKeyGrant {
    /// `assets:download` for every asset.
    pub fn download() -> Self {
        Self {
            actions: vec!["assets:download".into()],
            ..Self::default()
        }
    }
}

/// A mock API key carrying `grants`, for [`MockOptions::api_key`]. A key without an
/// `assets:download` grant (the default) cannot fetch private or age-restricted assets from the CDN.
pub fn create_mock_api_key(grants: &[MockApiKeyGrant]) -> String {
    let json = serde_json::to_vec(grants).expect("serializable grants");
    format!(
        "sk_test_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json)
    )
}

type CreateId = Arc<dyn Fn(&str) -> String + Send + Sync>;
type Now = Arc<dyn Fn() -> u64 + Send + Sync>;
type Moderate = Arc<dyn Fn(&MockModerationInput) -> crate::Result<MockDecision> + Send + Sync>;

/// How [`MockServerClient::fail_next_request`](super::MockServerClient::fail_next_request)
/// fails a request.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum MockFailure {
    /// The connection fails before a response: `sdk/transport-error`.
    TransportError,
    /// No response arrives in time: `sdk/timeout`.
    Timeout,
    /// The API answers with this error code and its HTTP status.
    Api(ErrorCode),
}

/// Which request [`MockServerClient::fail_next_request`](super::MockServerClient::fail_next_request)
/// fails, and the details of an API error.
#[derive(Clone, Debug, Default, PartialEq)]
#[non_exhaustive]
pub struct MockFailureOptions {
    /// Fail the next request of this operation rather than the next request.
    pub operation: Option<String>,
    /// The API error's `details`.
    pub details: Option<Map<String, Value>>,
    /// The API error's `Retry-After` header, in seconds.
    pub retry_after: Option<u32>,
}
impl MockFailureOptions {
    /// Fails the next request, with no details or `Retry-After`.
    pub fn new() -> Self {
        Self::default()
    }
    /// Fails the next request of `operation`: the JavaScript SDK's method path, such as
    /// `assets.create`, `assets.uploadPart` or `cdn.serve`.
    pub fn operation(mut self, operation: impl Into<String>) -> Self {
        self.operation = Some(operation.into());
        self
    }
    /// The API error's `details`, such as `{"reason": "spend-limit"}`.
    pub fn details(mut self, details: Map<String, Value>) -> Self {
        self.details = Some(details);
        self
    }
    /// Sends the API error with a `Retry-After` header of `seconds`.
    pub fn retry_after(mut self, seconds: u32) -> Self {
        self.retry_after = Some(seconds);
        self
    }
}

/// A failure queued by `fail_next_request`.
pub(super) struct QueuedFailure {
    pub(super) failure: MockFailure,
    pub(super) options: MockFailureOptions,
}

/// The operation names [`MockServerClient::fail_next_request`](super::MockServerClient::fail_next_request)
/// takes: the JavaScript SDK's method paths.
pub(super) const OPERATIONS: [&str; 47] = [
    "assets.create",
    "assets.classify",
    "text.classify",
    "assets.uploadPart",
    "assets.list",
    "assets.iterate",
    "assets.search",
    "assets.retrieve",
    "assets.waitForDecision",
    "assets.update",
    "assets.delete",
    "assets.listChildren",
    "assets.iterateChildren",
    "assets.deleteContent",
    "assets.createSignedUrl",
    "assets.retry",
    "assets.explain",
    "assets.move",
    "assets.decide",
    "assets.batch",
    "folders.list",
    "folders.create",
    "folders.retrieve",
    "folders.update",
    "folders.delete",
    "folders.move",
    "hashLists.list",
    "hashLists.retrieve",
    "hashLists.create",
    "hashLists.update",
    "hashLists.delete",
    "hashLists.listEntries",
    "hashLists.addEntry",
    "hashLists.removeEntry",
    "policies.list",
    "policies.retrieve",
    "policies.create",
    "policies.update",
    "policies.applyPreset",
    "policies.setAutomaticUpdates",
    "policies.delete",
    "policies.assign",
    "events.list",
    "events.pages",
    "ensureLens",
    "ensureLenses",
    "cdn.serve",
];

/// Options for [`MockServerClient::in_memory`](super::MockServerClient::in_memory).
///
/// Defaults: project `project-1`, `create_mock_api_key(&[])`, no retries, random IDs, the
/// system clock, the default moderation ([`MockModerationInput::default_decision`]) and the base
/// URLs `https://api.calmlens.invalid/v1` and
/// `https://cdn.calmlens.invalid/v1`.
#[derive(Clone)]
pub struct MockOptions {
    pub(super) api_key: String,
    pub(super) project_id: String,
    pub(super) max_retries: u32,
    pub(super) api_base_url: String,
    pub(super) cdn_base_url: String,
    pub(super) upload_timeout: Option<Duration>,
    pub(super) max_response_bytes: Option<usize>,
    pub(super) part_size_bytes: Option<u64>,
    moderate: Option<Moderate>,
    create_id: CreateId,
    now: Now,
    signed_url_base_url: String,
}
impl Default for MockOptions {
    fn default() -> Self {
        Self {
            api_key: create_mock_api_key(&[]),
            project_id: "project-1".into(),
            max_retries: 0,
            api_base_url: API_BASE_URL.into(),
            cdn_base_url: CDN_BASE_URL.into(),
            upload_timeout: None,
            max_response_bytes: None,
            part_size_bytes: None,
            moderate: None,
            create_id: Arc::new(crate::transport::new_id),
            now: monotonic_clock(),
            signed_url_base_url: "https://mock.calmlens.invalid".into(),
        }
    }
}
/// The system clock, moved on by at least a millisecond per reading, so assets created in a
/// row get increasing `createdAt` values.
fn monotonic_clock() -> Now {
    let last = Mutex::new(0u64);
    Arc::new(move || {
        let system = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64);
        let mut last = last.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        *last = system.max(*last + 1);
        *last
    })
}
impl fmt::Debug for MockOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MockOptions")
            .field("project_id", &self.project_id)
            .field("max_retries", &self.max_retries)
            .field("api_base_url", &self.api_base_url)
            .field("cdn_base_url", &self.cdn_base_url)
            .field("upload_timeout", &self.upload_timeout)
            .field("max_response_bytes", &self.max_response_bytes)
            .field("part_size_bytes", &self.part_size_bytes)
            .field("signed_url_base_url", &self.signed_url_base_url)
            .finish_non_exhaustive()
    }
}
impl MockOptions {
    /// The default options.
    pub fn new() -> Self {
        Self::default()
    }
    /// The API key, e.g. `create_mock_api_key(&[MockApiKeyGrant::download()])`.
    pub fn api_key(mut self, value: impl Into<String>) -> Self {
        self.api_key = value.into();
        self
    }
    /// The project ID.
    pub fn project_id(mut self, value: impl Into<String>) -> Self {
        self.project_id = value.into();
        self
    }
    /// Retries of repeatable requests (0 by default, so a queued failure fails one call).
    pub fn max_retries(mut self, value: u32) -> Self {
        self.max_retries = value;
        self
    }
    /// The API base URL the mock client uses and the in-memory API answers.
    pub fn api_base_url(mut self, value: impl Into<String>) -> Self {
        self.api_base_url = value.into();
        self
    }
    /// The CDN base URL the mock client uses and the in-memory CDN answers. It must differ
    /// from the API base URL.
    pub fn cdn_base_url(mut self, value: impl Into<String>) -> Self {
        self.cdn_base_url = value.into();
        self
    }
    /// The mock client's binary upload timeout, as
    /// [`ServerClientBuilder::upload_timeout`](crate::ServerClientBuilder::upload_timeout).
    pub fn upload_timeout(mut self, value: Duration) -> Self {
        self.upload_timeout = Some(value);
        self
    }
    /// The largest response body the mock client reads, as
    /// [`ServerClientBuilder::max_response_bytes`](crate::ServerClientBuilder::max_response_bytes).
    pub fn max_response_bytes(mut self, value: usize) -> Self {
        self.max_response_bytes = Some(value);
        self
    }
    /// The mock client's part size, as
    /// [`ServerClientBuilder::part_size_bytes`](crate::ServerClientBuilder::part_size_bytes):
    /// content larger than it is uploaded in parts to the in-memory API.
    pub fn part_size_bytes(mut self, value: u64) -> Self {
        self.part_size_bytes = Some(value);
        self
    }
    /// Decides each asset the mock moderates: when an upload completes (`assets().create`,
    /// `assets().classify`, `text().classify` or a final part), when `assets().retry` or
    /// `assets().explain` with `rerun` queues an asset again, and when
    /// [`complete_processing`](super::MockServerClient::complete_processing) is called without a
    /// decision. It receives the stored asset, its content, the trigger and whether the API
    /// would queue the work, and returns a [`MockOutcome`] or a [`MockDecision`] (or a
    /// `calmlens::Result` of either; an error fails the request that triggered it). `pending`
    /// leaves the asset processing. Without it, queued work other than `complete` stays
    /// `pending` and everything else is `allowed`.
    ///
    /// The callback runs while the mock handles the request, so it must not call the mock.
    pub fn moderate<F, R>(mut self, moderate: F) -> Self
    where
        F: Fn(&MockModerationInput) -> R + Send + Sync + 'static,
        R: IntoMockDecision,
    {
        self.moderate = Some(Arc::new(move |input| moderate(input).into_mock_decision()));
        self
    }
    /// Creates the ID of a new object of the kind its prefix names (`asset`, `fldr`, `hl`, `hle`,
    /// `lens`, `evt` or `rev`). The default is like the API's: the prefix, `_` and 20 random
    /// base62 characters, such as `asset_5Gm2Rk8XqT3wLp9VbN4c`.
    pub fn create_id(mut self, value: impl Fn(&str) -> String + Send + Sync + 'static) -> Self {
        self.create_id = Arc::new(value);
        self
    }
    /// The clock, in milliseconds since the Unix epoch.
    pub fn now(mut self, value: impl Fn() -> u64 + Send + Sync + 'static) -> Self {
        self.now = Arc::new(value);
        self
    }
    /// The origin of signed URLs.
    pub fn signed_url_base_url(mut self, value: impl Into<String>) -> Self {
        self.signed_url_base_url = value.into();
        self
    }
}

/// An asset's uploaded content, by part number.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StoredContent {
    /// The upload's MIME type.
    pub content_type: String,
    /// The parts received, by part number.
    pub parts: BTreeMap<u32, Vec<u8>>,
}
impl StoredContent {
    /// The parts joined in order.
    pub fn bytes(&self) -> Vec<u8> {
        self.parts.values().flatten().copied().collect()
    }
}

/// The mock's storage, in the API's JSON shape, for
/// [`MockServerClient::with_storage`](super::MockServerClient::with_storage). Seed or change it
/// between calls, e.g. `storage.assets["id"]["visibility"] = "public".into()`.
#[derive(Clone, Debug, Default)]
#[non_exhaustive]
pub struct MockStorage {
    /// Assets by ID.
    pub assets: HashMap<String, Value>,
    /// Folders by ID.
    pub folders: HashMap<String, Value>,
    /// Hash lists, oldest first.
    pub hash_lists: Vec<Value>,
    /// Hash list entries, oldest first.
    pub hash_list_entries: Vec<Value>,
    /// Uploaded content by asset ID; removed content is absent.
    pub content: HashMap<String, StoredContent>,
    /// The events feed, oldest first.
    pub events: Vec<Value>,
}

struct Failure {
    code: String,
    status: u16,
    message: String,
    details: Value,
    /// An error the request fails with instead of an API response, such as one a `moderate`
    /// callback returned.
    raised: Option<crate::Error>,
}
fn fail(code: ErrorCode, message: &str) -> Failure {
    custom(code.as_str(), code.http_status().unwrap_or(400), message)
}
fn custom(code: &str, status: u16, message: &str) -> Failure {
    Failure {
        code: code.to_owned(),
        status,
        message: message.to_owned(),
        details: json!({}),
        raised: None,
    }
}
/// A failure that fails the request with `error` rather than an API response.
fn raised(error: crate::Error) -> Failure {
    let mut failure = custom(error.code().as_str(), 0, "");
    failure.raised = Some(error);
    failure
}
fn invalid(message: &str) -> Failure {
    fail(ErrorCode::InvalidUploadPayload, message)
}
/// Whether `value` is an asset ID as the API's schema accepts it: `asset_` and 20 base62
/// characters.
fn is_asset_id(value: &str) -> bool {
    value.strip_prefix("asset_").is_some_and(|body| {
        body.len() == 20 && body.bytes().all(|byte| byte.is_ascii_alphanumeric())
    })
}
/// A request the API's schema refuses: `validation/<issue>` with HTTP 400 and the field.
fn validation(issue: &str, path: &str) -> Failure {
    let mut failure = custom(
        &format!("validation/{issue}"),
        400,
        &format!("Invalid {path}"),
    );
    failure.details = json!({ "path": path });
    failure
}
/// Refuses `metadata` the API's schema refuses: it is `null` or a list of `{ id, value }`
/// objects with a string `id` and any JSON `value`.
fn check_metadata(metadata: Option<&Value>) -> Outcome<()> {
    let Some(metadata) = metadata.filter(|metadata| !metadata.is_null()) else {
        return Ok(());
    };
    let items = metadata
        .as_array()
        .ok_or_else(|| validation("invalid-type", "metadata"))?;
    for (index, item) in items.iter().enumerate() {
        let item = item
            .as_object()
            .ok_or_else(|| validation("invalid-type", &format!("metadata.{index}")))?;
        if !item.get("id").is_some_and(Value::is_string) {
            return Err(validation("invalid-type", &format!("metadata.{index}.id")));
        }
        if !item.contains_key("value") {
            return Err(validation(
                "invalid-value",
                &format!("metadata.{index}.value"),
            ));
        }
    }
    Ok(())
}
/// A whole number from `low` to `high` in query parameter `path`, or the schema's error.
fn bounded(
    value: Option<&String>,
    default: usize,
    low: usize,
    high: usize,
    path: &str,
) -> Outcome<usize> {
    let Some(value) = value else {
        return Ok(default);
    };
    let number: f64 = value
        .parse()
        .map_err(|_| validation("invalid-type", path))?;
    if number < low as f64 {
        return Err(validation("too-small", path));
    }
    if number > high as f64 {
        return Err(validation("too-big", path));
    }
    if number.fract() != 0.0 {
        return Err(validation("invalid-type", path));
    }
    Ok(number as usize)
}
/// Like the API: 1 to 255 printable ASCII characters, without a space at either end.
fn valid_idempotency_key(key: &str) -> bool {
    let printable = |byte: &u8| (0x20..=0x7e).contains(byte);
    let bytes = key.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 255
        && bytes.iter().all(printable)
        && bytes[0] != b' '
        && bytes[bytes.len() - 1] != b' '
}
fn unknown_route() -> Failure {
    custom(
        "mock/unknown-route",
        404,
        "The in-memory mock does not emulate this route; enqueue a response for it",
    )
}
impl Failure {
    /// The client error this failure gives, as the client would map the API's response.
    fn into_error(self) -> crate::Error {
        match self.raised {
            Some(error) => error,
            None => crate::Error::new(self.code.as_str(), self.message).with_status(self.status),
        }
    }
    fn response(&self) -> MockResponse {
        MockResponse::api_error_body(
            self.status,
            &self.code,
            self.message.clone(),
            self.details.clone(),
        )
    }
}
type Outcome<T> = std::result::Result<T, Failure>;

struct Upload {
    queue: bool,
    total_size: Option<u64>,
}

fn normalize_mime(mime: &str) -> String {
    mime.split(';').next().unwrap_or("").trim().to_lowercase()
}
/// The asset type the API infers from a content type.
fn asset_type(mime: &str) -> &'static str {
    if mime.starts_with("image/") {
        "image"
    } else if mime.starts_with("video/") {
        "video"
    } else if mime.starts_with("audio/") {
        "audio"
    } else if mime.starts_with("text/") {
        "plaintext-document"
    } else if mime.contains("pdf") || mime.contains("document") {
        "multimedia-document"
    } else {
        "file"
    }
}
const MIB: u64 = 1024 * 1024;
/// Like the API: image uploads in parts total at most 20 MiB, at any size below that.
fn image_size_error(kind: &str, size: u64, _is_final: bool) -> Option<ErrorCode> {
    (kind == "image" && size > 20 * MIB).then_some(ErrorCode::MultipartImageTooLarge)
}
/// Like the API: the parts may not overshoot a declared total, and must reach it at the end.
fn total_size_error(total: Option<u64>, received: u64, is_final: bool) -> Option<ErrorCode> {
    let total = total?;
    (received > total || (is_final && received != total)).then_some(ErrorCode::UploadSizeMismatch)
}
/// Like the API: an upload has at most this many parts.
const MAX_UPLOAD_PARTS: u64 = 10_000;
/// Like the API: every part but the last is at least 5 MiB.
fn check_part_size(size: u64, is_final: bool) -> Outcome<()> {
    if !is_final && size < 5 * MIB {
        return Err(invalid(
            "Multipart upload parts must be at least 5MiB except the final part.",
        ));
    }
    Ok(())
}

pub(super) struct Backend {
    pub(super) storage: MockStorage,
    options: MockOptions,
    /// The mock API key's grants; `set_api_key_grants` replaces them.
    grants: Vec<MockApiKeyGrant>,
    /// Failures queued by `fail_next_request`, each for any request or one operation.
    failures: Vec<QueuedFailure>,
    uploads: HashMap<String, Upload>,
    lenses: HashMap<String, Value>,
    replays: HashMap<String, (String, MockResponse)>,
    policies: policies::Policies,
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}
fn display(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}
/// The object at `key`, created when missing.
fn section<'a>(value: &'a mut Value, key: &str) -> &'a mut Map<String, Value> {
    if !value[key].is_object() {
        value[key] = json!({});
    }
    value[key].as_object_mut().expect("object")
}
fn lookup<'a>(value: &'a Value, path: &str) -> &'a Value {
    path.split('.').fold(value, |value, key| &value[key])
}
fn header<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
}
/// The path of `url` below `base` (still percent-encoded), when `url` is under `base`.
pub(super) fn under<'a>(url: &'a reqwest::Url, base: &str) -> Option<&'a str> {
    let base = reqwest::Url::parse(base).ok()?;
    if url.origin() != base.origin() {
        return None;
    }
    let rest = url.path().strip_prefix(base.path().trim_end_matches('/'))?;
    (rest.is_empty() || rest.starts_with('/')).then_some(rest)
}
pub(super) fn percent_decode(segment: &str) -> String {
    let bytes = segment.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let hex = segment
            .get(index + 1..index + 3)
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match (bytes[index], hex) {
            (b'%', Some(byte)) => {
                out.push(byte);
                index += 3;
            }
            (byte, _) => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The ThumbHash the mock gives every classified image, standing in for one computed from its
/// pixels. The `placeholder` resource serves it as a PNG, like the CDN.
const MOCK_THUMBHASH: &str = "1QcSHQRnh493V4dIh4eXh1h4kJUI";

/// `image` without its placeholder: removing content removes the ThumbHash and average colour.
fn without_placeholder(image: &Value) -> Value {
    match image {
        Value::Object(image) => {
            let mut image = image.clone();
            image.insert("thumbhash".into(), Value::Null);
            image.insert("averageColor".into(), Value::Null);
            Value::Object(image)
        }
        other => other.clone(),
    }
}

/// Moves `asset` to `outcome` like the pipeline: a decision completes processing, `purged`
/// removes the content (with `purge_reason`), and completed processing removes content held
/// only temporarily (reason `retention`). A classified image gets a ThumbHash for its
/// placeholder, which goes with its content.
fn apply_outcome(
    asset: &mut Value,
    content: &mut HashMap<String, StoredContent>,
    outcome: &str,
    purge_reason: &str,
    now: u64,
) {
    let decided = outcome != "pending" && outcome != "failed";
    let status = match outcome {
        "pending" => "processing",
        "failed" => "failed",
        _ => "completed",
    };
    let removed = asset["content"]["status"] == "removed";
    let purge = outcome == "purged" && !removed;
    let remove = purge || (status == "completed" && asset["content"]["status"] == "temporary");
    let classified_image = decided && asset["type"] == "image" && !removed && !purge;
    let image = asset["content"]["image"].clone();
    let image = if classified_image {
        let mut fields = json!({"width": null, "height": null, "perceptualHash": null});
        if let Value::Object(old) = &image {
            for (key, value) in old {
                fields[key] = value.clone();
            }
        }
        fields["thumbhash"] = MOCK_THUMBHASH.into();
        if fields["averageColor"].is_null() {
            fields["averageColor"] = "#7f7f7f".into();
        }
        fields
    } else if outcome == "purged" {
        without_placeholder(&image)
    } else {
        image
    };
    let stored = section(asset, "content");
    if remove {
        stored.insert("status".into(), "removed".into());
        stored.insert(
            "removalReason".into(),
            if purge { purge_reason } else { "retention" }.into(),
        );
        stored.insert("updatedAt".into(), now.into());
        stored.insert("extractedText".into(), Value::Null);
        stored.insert("fileMetadata".into(), Value::Null);
        stored.insert("image".into(), without_placeholder(&image));
    } else {
        stored.insert("image".into(), image);
    }
    if remove {
        content.remove(text(&asset["id"]));
        asset["context"] = Value::Null;
    }
    let classification = section(asset, "classification");
    classification.insert("status".into(), status.into());
    // The mock has no content checks, so a failure is always a `processing-error`.
    classification.insert(
        "failureReason".into(),
        if status == "failed" {
            "processing-error".into()
        } else {
            Value::Null
        },
    );
    classification.insert("updatedAt".into(), now.into());
    classification.insert(
        "completedAt".into(),
        if decided { now.into() } else { Value::Null },
    );
    let moderation = classification
        .entry("moderation")
        .or_insert_with(|| json!({"manualReviews": [], "flaggedCategories": [], "regions": []}));
    moderation["status"] = if decided { outcome } else { "pending" }.into();
    let upload = section(asset, "upload");
    upload.insert("status".into(), "completed".into());
    upload.insert("updatedAt".into(), now.into());
    asset["updatedAt"] = now.into();
}
/// The asset snapshot events carry.
/// The moderation status an `asset.<status>` event type announces.
pub(super) fn announced_status(event_type: &Value) -> Option<&'static str> {
    match event_type.as_str()? {
        "asset.allowed" => Some("allowed"),
        "asset.limited" => Some("limited"),
        "asset.age-restricted" => Some("age-restricted"),
        "asset.blocked" => Some("blocked"),
        "asset.purged" => Some("purged"),
        _ => None,
    }
}

pub(super) fn snapshot(asset: &Value) -> Value {
    json!({
        "id": asset["id"],
        "externalId": asset["externalId"],
        "uploadPresetId": asset["uploadPresetId"],
        "upload": {"status": asset["upload"]["status"]},
        "classification": {
            "status": asset["classification"]["status"],
            "moderation": {"status": asset["classification"]["moderation"]["status"]},
        },
        "content": {"status": asset["content"]["status"]},
    })
}

/// An asset's portal link, as event facts carry it.
fn asset_name_fact(asset: &Value) -> Value {
    json!({
        "key": "asset-name", "value": asset["name"],
        "url": format!("https://calmlens.com/go/asset/{}", text(&asset["id"])),
    })
}

impl Backend {
    pub(super) fn new(options: MockOptions) -> Self {
        Self {
            storage: MockStorage::default(),
            grants: grants_of(&options.api_key),
            failures: Vec::new(),
            options,
            uploads: HashMap::new(),
            lenses: HashMap::new(),
            replays: HashMap::new(),
            policies: policies::Policies::default(),
        }
    }
    pub(super) fn create_id(&self, prefix: &str) -> String {
        (self.options.create_id)(prefix)
    }
    pub(super) fn now(&self) -> u64 {
        (self.options.now)()
    }
    pub(super) fn project_id(&self) -> &str {
        &self.options.project_id
    }

    /// Records a reviewer decision on a stored asset and adds the matching `asset.<status>` event
    /// (after an `asset.content-removed` event for a purge).
    pub(super) fn decide(&mut self, asset_id: &str, decision: &str) -> Option<Value> {
        self.owned(&self.storage.assets, asset_id)?;
        Some(self.record_review(asset_id, decision, Value::Null))
    }

    /// Applies a reviewer's decision to stored asset `asset_id`, like the API: the moderation
    /// status changes (purged also removes the content with removal reason `requested`,
    /// recording an `asset.content-removed` event first), the review joins `manualReviews`, and
    /// an `asset.<decision>` event with a `decided-by: reviewer` fact joins the feed. `note` is
    /// the reviewer's note, or null for [`decide`](Self::decide).
    fn record_review(&mut self, asset_id: &str, decision: &str, note: Value) -> Value {
        let now = self.now();
        let review_id = self.create_id("rev");
        let storage = &mut self.storage;
        let asset = storage.assets.get_mut(asset_id).expect("stored asset");
        apply_outcome(asset, &mut storage.content, decision, "requested", now);
        let moderation = &mut asset["classification"]["moderation"];
        if !moderation["manualReviews"].is_array() {
            moderation["manualReviews"] = json!([]);
        }
        moderation["manualReviews"]
            .as_array_mut()
            .expect("array")
            .push(json!({
                "id": review_id, "decision": decision, "note": note,
                "reviewerName": null, "reviewerEmail": null, "reviewedAt": now,
                "appliedToAsset": true,
            }));
        let asset = asset.clone();
        if decision == "purged" {
            self.record_lifecycle_event("asset.content-removed", &asset);
        }
        let event_type = format!("asset.{decision}");
        // Like the event catalog: only allowing and limiting are low severity.
        let severity = if matches!(decision, "allowed" | "limited") {
            "low"
        } else {
            "high"
        };
        // A decision through the API (with its note) is the API key's; the test hook's is a reviewer's.
        let decided_by = if note.is_null() {
            "reviewer"
        } else {
            "api-key"
        };
        let facts = json!([
            {"key": "decided-by", "value": decided_by},
            {"key": "asset-type", "value": asset["type"]},
            {"key": "asset-name", "value": asset["name"], "url": format!("https://calmlens.com/go/asset/{asset_id}")},
            {"key": "note", "value": note},
        ]);
        self.push_event(&event_type, severity, &asset, facts);
        asset
    }

    /// Answers `POST /assets/:id/decision` like the API: the body is validated first (a known
    /// decision, a trimmed note of 1 to 1499 characters, `confirmPurge: true` to purge), then the
    /// asset must exist and have finished uploading and processing (`asset/processing`). An
    /// undecided asset (whose processing failed) can only be blocked or purged, the current
    /// status is refused as unchanged, and purged content can only be blocked. Mock assets
    /// carry no safety holds and the mock key may make every decision.
    fn decide_asset(&mut self, id: &str, body: Map<String, Value>) -> Outcome<Value> {
        let decision = body.get("decision").and_then(Value::as_str).unwrap_or("");
        if !matches!(
            decision,
            "allowed" | "limited" | "age-restricted" | "blocked" | "purged"
        ) {
            return Err(validation("invalid-value", "decision"));
        }
        let Some(note) = body.get("note").and_then(Value::as_str).map(str::trim) else {
            return Err(validation("invalid-type", "note"));
        };
        if note.is_empty() {
            return Err(validation("too-small", "note"));
        }
        // JavaScript counts string length in UTF-16 code units.
        if note.encode_utf16().count() > 1499 {
            return Err(validation("too-big", "note"));
        }
        if decision == "purged" && body.get("confirmPurge") != Some(&Value::Bool(true)) {
            return Err(validation("invalid-value", "confirmPurge"));
        }
        let asset = self
            .owned(&self.storage.assets, id)
            .ok_or_else(|| fail(ErrorCode::AssetNotFound, "Asset not found"))?;
        let status = text(&asset["classification"]["moderation"]["status"]);
        let undecided = !matches!(decision, "blocked" | "purged");
        if asset["upload"]["status"] == "uploading"
            || asset["classification"]["status"] == "processing"
        {
            return Err(fail(
                ErrorCode::AssetProcessing,
                "The asset is still processing",
            ));
        }
        if status == "pending" && undecided {
            return Err(fail(
                ErrorCode::AssetDecisionNotAllowed,
                "An asset pending moderation can only be blocked or purged",
            ));
        }
        if status == decision {
            return Err(fail(
                ErrorCode::AssetDecisionUnchanged,
                "The asset already has this status",
            ));
        }
        if undecided && content_purged(asset) {
            return Err(fail(
                ErrorCode::AssetContentPurged,
                "This asset's content was purged, so it can only be blocked",
            ));
        }
        Ok(self.record_review(id, decision, note.into()))
    }

    /// Adds an event to the feed, as the API records it.
    fn push_event(&mut self, event_type: &str, severity: &str, asset: &Value, facts: Value) {
        let now = self.now();
        let event = json!({
            "id": self.create_id("evt"), "projectId": self.options.project_id, "type": event_type,
            "severity": severity, "title": event_type, "description": null,
            "assetId": asset["id"], "asset": snapshot(asset), "facts": facts, "createdAt": now,
        });
        self.storage.events.push(event);
    }

    /// Removes an asset's content like the API: the record and report stay; stored content,
    /// extracted text and the placeholder go. Content already removed keeps its reason, and an
    /// `asset.content-removed` event is recorded either way.
    fn remove_content(&mut self, mut asset: Value, now: u64) -> Value {
        let id = text(&asset["id"]).to_owned();
        self.storage.content.remove(&id);
        let image = without_placeholder(&asset["content"]["image"]);
        if asset["content"]["status"] != "removed" {
            let content = section(&mut asset, "content");
            content.insert("status".into(), "removed".into());
            content.insert("removalReason".into(), "requested".into());
            content.insert("updatedAt".into(), now.into());
            content.insert("extractedText".into(), Value::Null);
            content.insert("fileMetadata".into(), Value::Null);
            asset["updatedAt"] = now.into();
        }
        asset["content"]["image"] = image;
        asset["context"] = Value::Null;
        self.storage.assets.insert(id, asset.clone());
        self.record_lifecycle_event("asset.content-removed", &asset);
        asset
    }

    /// Deletes an asset, its stored child assets and their content.
    fn delete_asset_tree(&mut self, id: &str) {
        let mut deleting = vec![id.to_owned()];
        let mut index = 0;
        while index < deleting.len() {
            let parent = deleting[index].clone();
            for (child, asset) in &self.storage.assets {
                if asset["parentId"] == parent.as_str() && !deleting.contains(child) {
                    deleting.push(child.clone());
                }
            }
            index += 1;
        }
        for id in deleting {
            self.storage.assets.remove(&id);
            self.storage.content.remove(&id);
            self.uploads.remove(&id);
        }
    }

    /// `POST /projects/:id/assets/batch`: the schema (1 to 500 UUIDs and a known operation) and
    /// every asset are checked before anything changes, then the operation is applied at once,
    /// in request order, instead of in the background. Mock assets carry no safety holds.
    fn batch(&mut self, body: Map<String, Value>, now: u64) -> Outcome<Value> {
        let ids = match body.get("assetIds") {
            Some(Value::Array(ids)) => ids,
            _ => return Err(validation("invalid-type", "assetIds")),
        };
        if ids.is_empty() {
            return Err(validation("too-small", "assetIds"));
        }
        if ids.len() > crate::ASSET_BATCH_MAX_ASSETS {
            return Err(validation("too-big", "assetIds"));
        }
        let mut unique: Vec<String> = Vec::new();
        for (index, id) in ids.iter().enumerate() {
            let Some(id) = id.as_str() else {
                return Err(validation("invalid-type", &format!("assetIds.{index}")));
            };
            if !is_asset_id(id) {
                return Err(validation("invalid-format", &format!("assetIds.{index}")));
            }
            if !unique.iter().any(|seen| seen == id) {
                unique.push(id.to_owned());
            }
        }
        let operation = body.get("operation").and_then(Value::as_str);
        if !matches!(operation, Some("delete" | "remove-content")) {
            return Err(validation("invalid-value", "operation"));
        }
        let mut assets = Vec::with_capacity(unique.len());
        for id in &unique {
            let asset = self
                .owned(&self.storage.assets, id)
                .ok_or_else(|| fail(ErrorCode::AssetNotFound, "Asset not found"))?;
            assets.push(asset.clone());
        }
        for asset in assets {
            if operation == Some("delete") {
                self.delete_asset_tree(text(&asset["id"]));
                // One event per requested asset, with the asset as it was before the deletion.
                self.record_lifecycle_event("asset.deleted", &asset);
            } else {
                self.remove_content(asset, now);
            }
        }
        Ok(json!({ "queued": true }))
    }

    /// Adds an `asset.deleted`, `asset.content-removed` or `asset.retried` event, like the API.
    fn record_lifecycle_event(&mut self, event_type: &str, asset: &Value) {
        let mut name = json!({"key": "asset-name", "value": asset["name"]});
        // A deleted asset has no portal page to link to.
        if event_type != "asset.deleted" {
            name["url"] = format!("https://calmlens.com/go/asset/{}", text(&asset["id"])).into();
        }
        let facts = json!([name, {"key": "asset-type", "value": asset["type"]}]);
        self.push_event(event_type, "low", asset, facts);
    }

    pub(super) fn handle(
        &mut self,
        method: &Method,
        url: &reqwest::Url,
        headers: &HeaderMap,
        raw: &[u8],
    ) -> crate::Result<MockResponse> {
        let cdn = under(url, &self.options.cdn_base_url);
        let Some(rest) = cdn.or_else(|| under(url, &self.options.api_base_url)) else {
            return Ok(unknown_route().response());
        };
        let parts: Vec<String> = rest
            .split('/')
            .filter(|part| !part.is_empty())
            .map(percent_decode)
            .collect();
        let mut query = HashMap::new();
        for (key, value) in url.query_pairs().into_owned() {
            query.entry(key).or_insert(value);
        }
        if cdn.is_some() {
            let raw_parts: Vec<&str> = rest.split('/').filter(|part| !part.is_empty()).collect();
            let response = self.serve(&parts, &raw_parts, &query, headers);
            return Ok(if method == Method::HEAD {
                response.body(Vec::new())
            } else {
                response
            });
        }
        if header(headers, "x-api-key") != self.options.api_key {
            return Ok(fail(ErrorCode::InvalidApiKey, "The API key is invalid").response());
        }
        let content_type = header(headers, "content-type");
        let is_json = content_type == "application/json";
        let raw_key = headers.get("idempotency-key");
        // A key that is not ASCII text reads as invalid, not as missing. HTTP stacks trim header
        // values, so the API sees the key without surrounding whitespace.
        let key = raw_key.map_or("", |value| {
            value
                .to_str()
                .unwrap_or("\u{0}")
                .trim_matches([' ', '\t', '\r', '\n'])
        });
        // Like the API, raw uploads are compared by query, content type and length, not bytes.
        let fingerprint = format!(
            "{method}\n{}\n{}\n{content_type}\n{}\n{}",
            url.path(),
            url.query().unwrap_or(""),
            raw.len(),
            if is_json {
                String::from_utf8_lossy(raw)
            } else {
                "".into()
            }
        );
        if raw_key.is_some() {
            if !valid_idempotency_key(key) {
                return Ok(
                    fail(ErrorCode::InvalidIdempotencyKey, "Invalid Idempotency-Key").response(),
                );
            }
            if let Some((saved, response)) = self.replays.get(key) {
                if *saved != fingerprint {
                    return Ok(fail(
                        ErrorCode::IdempotencyKeyReused,
                        "Idempotency-Key used for another request",
                    )
                    .response());
                }
                return Ok(response.clone().header("idempotent-replayed", "true"));
            }
        }
        // Raw uploads carry their content's own type, which may be JSON: only other requests
        // have a JSON body.
        let raw_upload = matches!(header(headers, "x-calmlens-upload"), "content" | "part");
        let body = if is_json && !raw_upload && !raw.is_empty() {
            match serde_json::from_slice::<Value>(raw) {
                Ok(Value::Object(body)) => body,
                _ => return Ok(invalid("The body is not a JSON object").response()),
            }
        } else {
            Map::new()
        };
        // Like the API: a new folder, hash list, entry or policy is 201 Created, a queued batch 202
        // Accepted. Adding a hash a list already holds returns the entry with 200.
        let operation = self.operation(method, url);
        let entries = self.storage.hash_list_entries.len();
        let outcome = self.dispatch(method, &parts, &query, body, raw, headers);
        let status = match operation {
            Some("folders.create" | "hashLists.create" | "policies.create") => 201,
            Some("hashLists.addEntry") if self.storage.hash_list_entries.len() > entries => 201,
            Some("assets.batch") => 202,
            _ => 200,
        };
        match outcome {
            Ok(value) => {
                let response = MockResponse::json(status, value);
                if !key.is_empty() {
                    self.replays
                        .insert(key.to_owned(), (fingerprint, response.clone()));
                }
                Ok(response)
            }
            // An error a `moderate` callback returned fails the request as it is.
            Err(Failure {
                raised: Some(error),
                ..
            }) => Err(error),
            Err(failure) => Ok(failure.response()),
        }
    }

    fn dispatch(
        &mut self,
        method: &Method,
        parts: &[String],
        q: &HashMap<String, String>,
        body: Map<String, Value>,
        raw: &[u8],
        headers: &HeaderMap,
    ) -> Outcome<Value> {
        let now = self.now();
        let method = method.as_str();
        match parts {
            [scope, project, route @ ..] if scope == "projects" && !route.is_empty() => {
                if *project != self.options.project_id {
                    return Err(fail(
                        ErrorCode::ApiKeyProjectMismatch,
                        "This API key belongs to a different project",
                    ));
                }
                match (method, route.join("/").as_str()) {
                    ("GET", "events") => self.list_events(q),
                    ("PUT", "lenses") => self.ensure_lenses(body, now),
                    ("GET", "folders") => self.list_folders(q),
                    ("POST", "folders") => self.create_folder(body, now),
                    ("GET", "hash-lists") => {
                        // Like the API: newest first unless ordering says otherwise, 50 to a page.
                        let size = bounded(q.get("pageSize"), 50, 1, 100, "pageSize")?;
                        let ordering = cursor_ordering(q)?;
                        let lists = self.own_hash_lists().collect();
                        let scope = json!(["hash-lists", self.options.project_id]).to_string();
                        keyset_page(lists, &ordering, q.get("cursor"), &scope, size)
                    }
                    ("POST", "hash-lists") => self.create_hash_list(body, now),
                    ("GET", "assets") => {
                        let folder = q.get("folderId").cloned();
                        let scope =
                            json!([self.options.project_id, q.get("filter"), folder]).to_string();
                        self.page(q, &scope, |asset| {
                            folder
                                .as_deref()
                                .is_none_or(|folder| asset["folderId"] == folder)
                        })
                    }
                    ("GET", "assets/search") => self.search(q),
                    ("POST", "assets/batch") => self.batch(body, now),
                    (_, "policy") => self.policy_route(method, route, body),
                    (_, path) if path.split('/').next() == Some("policies") => {
                        self.policy_route(method, route, body)
                    }
                    ("POST", "assets") => {
                        self.create_asset(header(headers, "x-calmlens-upload"), body, q, raw, now)
                    }
                    _ => Err(unknown_route()),
                }
            }
            [scope, id, suffix]
                if scope == "assets" && method == "POST" && suffix == "decision" =>
            {
                self.decide_asset(id, body)
            }
            [scope, id, suffix @ ..] if scope == "assets" => {
                self.asset_route(method, id, &suffix.join("/"), body, q, raw, now)
            }
            [scope, id, suffix @ ..] if scope == "folders" => {
                self.folder_route(method, id, &suffix.join("/"), body, now)
            }
            [scope, id, suffix @ ..] if scope == "hash-lists" => {
                self.hash_list_route(method, id, &suffix.join("/"), body, q, now)
            }
            [scope, id] if scope == "hash-list-entries" && method == "DELETE" => {
                let project = self.options.project_id.as_str();
                let before = self.storage.hash_list_entries.len();
                self.storage
                    .hash_list_entries
                    .retain(|entry| !(entry["id"] == id.as_str() && entry["projectId"] == project));
                if self.storage.hash_list_entries.len() == before {
                    return Err(fail(
                        ErrorCode::HashListEntryNotFound,
                        "Hash list entry not found",
                    ));
                }
                Ok(json!({}))
            }
            _ => Err(unknown_route()),
        }
    }

    fn owned<'a>(&self, map: &'a HashMap<String, Value>, id: &str) -> Option<&'a Value> {
        map.get(id)
            .filter(|value| value["projectId"] == self.options.project_id.as_str())
    }
    fn folder(&self, id: &str) -> Outcome<&Value> {
        self.owned(&self.storage.folders, id)
            .ok_or_else(|| fail(ErrorCode::FolderNotFound, "Folder not found"))
    }
    fn unique(&self, name: &Value, parent: &Value, exclude: Option<&str>) -> Outcome<()> {
        let taken = self.storage.folders.iter().any(|(id, folder)| {
            Some(id.as_str()) != exclude
                && folder["projectId"] == self.options.project_id.as_str()
                && folder["name"] == *name
                && folder["parentId"] == *parent
        });
        if taken {
            return Err(fail(
                ErrorCode::DuplicateFolderName,
                "A folder with this name already exists in this location",
            ));
        }
        Ok(())
    }
    /// Asks `moderate` how to decide `asset`, with its stored content (the parts in order;
    /// none once the content is removed). A stored asset that does not decode as an [`Asset`]
    /// fails with `sdk/invalid-response` rather than reaching the callback.
    ///
    /// [`Asset`]: crate::models::Asset
    fn decision_for(
        &self,
        asset: &Value,
        trigger: MockModerationTrigger,
        queued: bool,
    ) -> Outcome<MockDecision> {
        let id = text(&asset["id"]);
        let bytes = (asset["content"]["status"] != "removed")
            .then(|| self.storage.content.get(id).map(StoredContent::bytes))
            .flatten();
        let text = bytes
            .as_ref()
            .filter(|_| asset["type"] == "plaintext-document")
            .map(|bytes| String::from_utf8_lossy(bytes).into_owned());
        let typed = serde_json::from_value(asset.clone()).map_err(|cause| {
            raised(crate::Error::new(
                ErrorCode::InvalidResponse,
                format!("The stored asset {id} is not a valid asset: {cause}"),
            ))
        })?;
        let input = MockModerationInput {
            asset: typed,
            content: MockModerationContent { bytes, text },
            trigger,
            queued,
        };
        match &self.options.moderate {
            Some(moderate) => moderate(&input).map_err(raised),
            None => Ok(input.default_decision()),
        }
    }

    /// `asset` decided as `decision` says (which must not be `pending`), with its report.
    fn apply_decision(&mut self, asset: &mut Value, decision: &MockDecision, now: u64) {
        let status = decision.status().as_str();
        apply_outcome(asset, &mut self.storage.content, status, "policy", now);
        if let Some(report) = decision.report() {
            let moderation = &mut asset["classification"]["moderation"];
            for (key, value) in report {
                moderation[key] = value;
            }
        }
    }

    /// Stores a processing asset's `decision` and records its events; a `pending` decision
    /// leaves it processing.
    fn settle(&mut self, mut asset: Value, decision: &MockDecision, now: u64) -> Value {
        if decision.status() == MockOutcome::Pending {
            return asset;
        }
        self.apply_decision(&mut asset, decision, now);
        self.storage
            .assets
            .insert(text(&asset["id"]).to_owned(), asset.clone());
        self.record_processing_events(&asset, decision);
        asset
    }

    /// Asks `moderate` (unless `decision` is given) and settles a stored processing asset.
    fn moderate_stored(
        &mut self,
        asset: Value,
        trigger: MockModerationTrigger,
        decision: Option<MockDecision>,
        now: u64,
    ) -> Outcome<Value> {
        let decision = match decision {
            Some(decision) => decision,
            None => self.decision_for(&asset, trigger, true)?,
        };
        Ok(self.settle(asset, &decision, now))
    }

    /// Moderates a completed upload (`asset`, still processing and not yet stored), stores it and records `asset.uploaded` and the processing events.
    fn finish_upload(&mut self, mut asset: Value, queued: bool, now: u64) -> Outcome<Value> {
        let decision = self.decision_for(&asset, MockModerationTrigger::Upload, queued)?;
        let uploaded = asset.clone();
        if decision.status() != MockOutcome::Pending {
            self.apply_decision(&mut asset, &decision, now);
        }
        self.storage
            .assets
            .insert(text(&asset["id"]).to_owned(), asset.clone());
        self.record_uploaded(&uploaded);
        self.record_processing_events(&asset, &decision);
        Ok(asset)
    }

    /// Finishes processing a stored asset as the pipeline would: with `decision`, or else what
    /// `moderate` returns for the `complete` trigger.
    pub(super) fn complete_processing(
        &mut self,
        asset_id: &str,
        decision: Option<MockDecision>,
    ) -> crate::Result<Value> {
        let asset = self
            .owned(&self.storage.assets, asset_id)
            .ok_or_else(|| {
                crate::Error::new(ErrorCode::AssetNotFound, "Asset not found").with_status(404)
            })?
            .clone();
        if asset["classification"]["status"] != "processing" {
            return Err(crate::Error::new(
                ErrorCode::InvalidArgument,
                format!("asset {asset_id} isn't processing"),
            ));
        }
        let now = self.now();
        self.moderate_stored(asset, MockModerationTrigger::Complete, decision, now)
            .map_err(Failure::into_error)
    }

    /// `asset.uploaded`, as the API records it when an upload completes.
    fn record_uploaded(&mut self, asset: &Value) {
        let facts = json!([
            {"key": "asset-type", "value": asset["type"]},
            asset_name_fact(asset),
            {"key": "file-format", "value": asset["content"]["format"]},
        ]);
        self.push_event("asset.uploaded", "low", asset, facts);
    }

    /// The events the pipeline records when it settles an asset: `asset.classified` and the
    /// automated `asset.<status>`, or `asset.failed`.
    fn record_processing_events(&mut self, asset: &Value, decision: &MockDecision) {
        let status = decision.status();
        match status {
            MockOutcome::Pending => {}
            MockOutcome::Failed => {
                let reason = match &asset["classification"]["failureReason"] {
                    Value::Null => json!("processing-error"),
                    reason => reason.clone(),
                };
                let facts = json!([
                    asset_name_fact(asset),
                    {"key": "asset-type", "value": asset["type"]},
                    {"key": "previous-status", "value": "processing"},
                    {"key": "failure-reason", "value": reason},
                ]);
                self.push_event("asset.failed", "high", asset, facts);
            }
            _ => {
                let flagged = decision.flagged_categories();
                let facts = json!([
                    {"key": "flagged-categories", "value": flagged},
                    {"key": "moderation-status", "value": status.as_str()},
                    {"key": "asset-type", "value": asset["type"]},
                    asset_name_fact(asset),
                ]);
                self.push_event("asset.classified", "low", asset, facts);
                // Like the event catalog: only allowing and limiting are low severity.
                let severity = if matches!(status, MockOutcome::Allowed | MockOutcome::Limited) {
                    "low"
                } else {
                    "high"
                };
                let facts = json!([
                    {"key": "decided-by", "value": "automated"},
                    {"key": "flagged-categories", "value": flagged},
                    {"key": "asset-type", "value": asset["type"]},
                    asset_name_fact(asset),
                ]);
                self.push_event(&format!("asset.{status}"), severity, asset, facts);
            }
        }
    }

    fn list_events(&self, q: &HashMap<String, String>) -> Outcome<Value> {
        let events = &self.storage.events;
        // Like the API's query schema: an integer from 1 to 100, 50 by default.
        let size = bounded(q.get("pageSize"), 50, 1, 100, "pageSize")?;
        // Cursors are `<n>_mock`: the number of events already delivered. Without one, the
        // page is empty and its cursor marks now. `nextCursor` is never null: it is where to
        // keep polling from. The mock's key holds every permission, so no event type is excluded.
        let start = match q.get("cursor") {
            None => events.len(),
            Some(cursor) => cursor
                .strip_suffix("_mock")
                .and_then(|n| n.parse::<usize>().ok())
                .filter(|n| *n <= events.len())
                .ok_or_else(|| fail(ErrorCode::InvalidCursor, "Invalid cursor"))?,
        };
        let end = (start + size).min(events.len());
        Ok(json!({
            "items": events[start..end], "nextCursor": format!("{end}_mock"),
            "hasMore": end < events.len(), "excludedTypes": [],
        }))
    }

    /// Saves each definition in turn, like the API: a lens saved before a later one fails
    /// stays saved.
    fn ensure_lenses(&mut self, body: Map<String, Value>, now: u64) -> Outcome<Value> {
        let mut result = Vec::new();
        for mut definition in body
            .get("lenses")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            let identifier = text(&definition["identifier"]).to_owned();
            let old = self.lenses.get(&identifier);
            let same = old.is_some_and(|old| {
                [
                    "name",
                    "description",
                    "type",
                    "active",
                    "transform",
                    "version",
                ]
                .iter()
                .all(|key| old[key] == definition[key])
            });
            let lens = match old {
                Some(old) if same => old.clone(),
                Some(old) if definition["version"].as_u64() <= old["version"].as_u64() => {
                    let current = old["version"].as_u64().unwrap_or(0);
                    let mut failure = fail(
                        ErrorCode::LensVersionConflict,
                        "Lens updates require a greater version",
                    );
                    failure.details = json!({
                        "currentVersion": current, "minimumVersion": current + 1,
                        "requestedVersion": definition["version"],
                    });
                    return Err(failure);
                }
                _ => {
                    definition["id"] =
                        old.map_or_else(|| self.create_id("lens").into(), |old| old["id"].clone());
                    definition["createdAt"] =
                        old.map_or(now.into(), |old| old["createdAt"].clone());
                    definition["projectId"] = self.options.project_id.clone().into();
                    definition["updatedAt"] = now.into();
                    definition
                }
            };
            self.lenses.insert(identifier, lens.clone());
            result.push(lens);
        }
        Ok(json!({ "lenses": result }))
    }

    fn list_folders(&self, q: &HashMap<String, String>) -> Outcome<Value> {
        let get = |key: &str| q.get(key).map_or("", String::as_str);
        let search = get("search").trim().to_lowercase();
        let folders: Vec<&Value> = self
            .storage
            .folders
            .values()
            .filter(|folder| folder["projectId"] == self.options.project_id.as_str())
            .filter(|folder| text(&folder["parentId"]) == get("parentId"))
            .filter(|folder| text(&folder["name"]).to_lowercase().contains(&search))
            .collect();
        // Like the API: one ordering by name (the default, ascending) or createdAt, then the ID
        // in the same direction. Names compare by code point, so case matters.
        if q.contains_key("ordering[1][field]") {
            return Err(validation("too-big", "ordering"));
        }
        let (field, ascending) = match q.get("ordering[0][field]") {
            None => ("name".to_owned(), true),
            Some(field) => {
                if field != "name" && field != "createdAt" {
                    return Err(validation("invalid-value", "ordering.0.field"));
                }
                match get("ordering[0][direction]") {
                    "asc" => (field.clone(), true),
                    "desc" => (field.clone(), false),
                    _ => return Err(validation("invalid-value", "ordering.0.direction")),
                }
            }
        };
        let ordering = [(field, ascending), ("id".to_owned(), ascending)];
        let size = bounded(q.get("pageSize"), 50, 1, 100, "pageSize")?;
        let scope = json!([self.options.project_id, get("parentId"), search]).to_string();
        let mut result = keyset_page(folders, &ordering, q.get("cursor"), &scope, size)?;
        let page: Vec<Value> = result["items"].as_array().cloned().unwrap_or_default();
        // Ancestors: the folders on the paths to the parent and to the page's folders.
        let mut pending = vec![get("parentId").to_owned()];
        pending.extend(
            page.iter()
                .map(|folder| text(&folder["parentId"]).to_owned()),
        );
        let in_page: HashSet<&str> = page.iter().map(|folder| text(&folder["id"])).collect();
        let mut seen = HashSet::new();
        let mut ancestors = Vec::new();
        while let Some(id) = pending.pop() {
            if id.is_empty() || !seen.insert(id.clone()) {
                continue;
            }
            if let Ok(folder) = self.folder(&id) {
                pending.push(text(&folder["parentId"]).to_owned());
                if !in_page.contains(id.as_str()) {
                    ancestors.push(folder.clone());
                }
            }
        }
        result["ancestors"] = ancestors.into();
        Ok(result)
    }

    fn create_folder(&mut self, mut body: Map<String, Value>, now: u64) -> Outcome<Value> {
        if body.get("name").map_or("", text).is_empty() {
            return Err(invalid("Folder name is required"));
        }
        let parent = body.get("parentId").cloned().unwrap_or(Value::Null);
        if let Some(parent) = parent.as_str() {
            self.folder(parent)?;
        }
        self.unique(
            &body.get("name").cloned().unwrap_or_default(),
            &parent,
            None,
        )?;
        let id = self.create_id("fldr");
        body.insert("id".into(), id.clone().into());
        body.insert("parentId".into(), parent);
        body.insert("projectId".into(), self.options.project_id.clone().into());
        body.insert("createdAt".into(), now.into());
        body.insert("updatedAt".into(), now.into());
        let folder = Value::Object(body);
        self.storage.folders.insert(id, folder.clone());
        Ok(folder)
    }

    fn folder_route(
        &mut self,
        method: &str,
        id: &str,
        suffix: &str,
        body: Map<String, Value>,
        now: u64,
    ) -> Outcome<Value> {
        let folder = self.folder(id)?.clone();
        match (method, suffix) {
            ("GET", "") => return Ok(folder),
            ("DELETE", "") => {
                let has_assets = self.storage.assets.values().any(|a| a["folderId"] == id);
                let has_children = self.storage.folders.values().any(|f| f["parentId"] == id);
                if has_assets || has_children {
                    let mut failure = fail(ErrorCode::FolderNotEmpty, "Folder is not empty");
                    failure.details = json!({"hasAssets": has_assets, "hasChildren": has_children});
                    return Err(failure);
                }
                self.storage.folders.remove(id);
                return Ok(json!({}));
            }
            ("POST", "move") => {
                let parent = body.get("parentId").cloned().unwrap_or(Value::Null);
                let mut seen = HashSet::from([id.to_owned()]);
                let mut current = parent.as_str().map(str::to_owned);
                while let Some(next) = current {
                    if !seen.insert(next.clone()) {
                        return Err(fail(
                            ErrorCode::FolderParentCycle,
                            "A folder cannot move inside itself",
                        ));
                    }
                    current = self.folder(&next)?["parentId"].as_str().map(str::to_owned);
                }
                self.unique(&folder["name"], &parent, Some(id))?;
                self.storage.folders.get_mut(id).expect("folder")["parentId"] = parent;
            }
            ("PATCH", "") => {
                if let Some(name) = body.get("name") {
                    self.unique(name, &folder["parentId"], Some(id))?;
                    self.storage.folders.get_mut(id).expect("folder")["name"] = name.clone();
                }
            }
            _ => return Err(unknown_route()),
        }
        let folder = self.storage.folders.get_mut(id).expect("folder");
        folder["updatedAt"] = now.into();
        Ok(folder.clone())
    }

    /// This project's hash lists, in the order they were created.
    fn own_hash_lists(&self) -> impl DoubleEndedIterator<Item = &Value> {
        let project = self.options.project_id.as_str();
        self.storage
            .hash_lists
            .iter()
            .filter(move |list| list["projectId"] == project)
    }
    fn hash_list(&self, id: &str) -> Outcome<Value> {
        self.own_hash_lists()
            .find(|list| list["id"] == id)
            .cloned()
            .ok_or_else(|| fail(ErrorCode::HashListNotFound, "Hash list not found"))
    }
    fn create_hash_list(&mut self, body: Map<String, Value>, now: u64) -> Outcome<Value> {
        let name = body.get("name").and_then(Value::as_str).map(str::trim);
        let action = body.get("action").and_then(Value::as_str);
        let (Some(name), Some(action @ ("flag" | "block"))) = (name, action) else {
            return Err(invalid(
                "A hash list needs a name and an action of flag or block",
            ));
        };
        if name.is_empty() {
            return Err(invalid(
                "A hash list needs a name and an action of flag or block",
            ));
        }
        let list = json!({
            "id": self.create_id("hl"),
            "projectId": self.options.project_id,
            "name": name,
            "description": body.get("description").filter(|value| value.is_string()),
            "action": action,
            "createdAt": now,
            "updatedAt": now,
        });
        self.storage.hash_lists.push(list.clone());
        Ok(list)
    }
    /// `/hash-lists/:id` and its entries.
    fn hash_list_route(
        &mut self,
        method: &str,
        id: &str,
        suffix: &str,
        body: Map<String, Value>,
        q: &HashMap<String, String>,
        now: u64,
    ) -> Outcome<Value> {
        let list = self.hash_list(id)?;
        let position = |storage: &MockStorage| {
            storage
                .hash_lists
                .iter()
                .position(|stored| {
                    stored["id"] == list["id"] && stored["projectId"] == list["projectId"]
                })
                .expect("hash list")
        };
        match (method, suffix) {
            ("GET", "") => Ok(list),
            ("PATCH", "") => {
                let index = position(&self.storage);
                let stored = &mut self.storage.hash_lists[index];
                if let Some(name) = body.get("name").and_then(Value::as_str) {
                    stored["name"] = name.trim().into();
                }
                if let Some(description) = body.get("description") {
                    stored["description"] = description.clone();
                }
                if let Some(action @ ("flag" | "block")) =
                    body.get("action").and_then(Value::as_str)
                {
                    stored["action"] = action.into();
                }
                stored["updatedAt"] = now.into();
                Ok(stored.clone())
            }
            ("DELETE", "") => {
                let index = position(&self.storage);
                self.storage.hash_lists.remove(index);
                self.storage
                    .hash_list_entries
                    .retain(|entry| entry["hashListId"] != id);
                Ok(json!({}))
            }
            ("GET", "entries") => {
                let page_size = bounded(q.get("pageSize"), 50, 1, 100, "pageSize")?;
                let entries: Vec<&Value> = self
                    .storage
                    .hash_list_entries
                    .iter()
                    .filter(|entry| entry["hashListId"] == id)
                    .rev()
                    .collect();
                // Cursors are the number of entries already returned.
                let start = match q.get("cursor") {
                    None => 0,
                    Some(cursor) => cursor
                        .strip_suffix("_mock")
                        .and_then(|n| n.parse::<usize>().ok())
                        .ok_or_else(|| fail(ErrorCode::InvalidCursor, "Invalid cursor"))?,
                };
                let end = (start + page_size).min(entries.len());
                let has_more = end < entries.len();
                Ok(json!({
                    "items": entries.get(start..end).unwrap_or_default(),
                    "hasMore": has_more,
                    "nextCursor": has_more.then(|| format!("{end}_mock")),
                    "pageSize": page_size,
                    "ordering": [
                        {"field": "createdAt", "direction": "desc"},
                        {"field": "id", "direction": "desc"},
                    ],
                }))
            }
            ("POST", "entries") => self.add_hash_list_entry(id, body, now),
            _ => Err(unknown_route()),
        }
    }
    fn add_hash_list_entry(
        &mut self,
        list_id: &str,
        body: Map<String, Value>,
        now: u64,
    ) -> Outcome<Value> {
        let mut hash = body
            .get("hash")
            .and_then(Value::as_str)
            .map(|hash| hash.trim().to_ascii_lowercase());
        let mut quality = body
            .get("quality")
            .filter(|value| value.is_number())
            .cloned();
        let asset_id = body.get("assetId").and_then(Value::as_str);
        if hash.is_some() == asset_id.is_some() {
            return Err(invalid("Send either hash or assetId"));
        }
        if let Some(asset_id) = asset_id {
            let asset = self
                .owned(&self.storage.assets, asset_id)
                .ok_or_else(|| fail(ErrorCode::AssetNotFound, "Asset not found"))?;
            let image = &asset["content"]["image"];
            let Some(perceptual) = image["perceptualHash"].as_str() else {
                return Err(fail(
                    ErrorCode::HashListAssetNotHashed,
                    "This asset has no perceptual hash",
                ));
            };
            hash = Some(perceptual.to_owned());
            quality = image
                .get("perceptualHashQuality")
                .filter(|value| value.is_number())
                .cloned();
        }
        let hash = hash.unwrap_or_default();
        if hash.len() != 64 || !hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
            return Err(invalid("Use a PDQ hash of 64 hexadecimal characters"));
        }
        if let Some(existing) = self
            .storage
            .hash_list_entries
            .iter()
            .find(|entry| entry["hashListId"] == list_id && entry["hash"] == hash.as_str())
        {
            return Ok(existing.clone());
        }
        let entry = json!({
            "id": self.create_id("hle"),
            "projectId": self.options.project_id,
            "hashListId": list_id,
            "hash": hash,
            "quality": quality,
            "label": body.get("label").filter(|value| value.is_string()),
            "sourceAssetId": asset_id,
            "createdAt": now,
        });
        self.storage.hash_list_entries.push(entry.clone());
        Ok(entry)
    }

    /// `POST /projects/:id/assets`. `x-calmlens-upload` is empty for a JSON (URL) body,
    /// `content` for raw content and `part` for the first part of a multipart upload.
    fn create_asset(
        &mut self,
        mode: &str,
        body: Map<String, Value>,
        q: &HashMap<String, String>,
        raw: &[u8],
        now: u64,
    ) -> Outcome<Value> {
        let multipart = mode == "part";
        let mut options = body;
        if mode == "content" || multipart {
            options = Map::new();
            for (key, value) in q {
                let value = if ["metadata", "processingOptions", "context"].contains(&key.as_str())
                {
                    serde_json::from_str(value).map_err(|_| {
                        invalid("metadata, processingOptions and context must be JSON")
                    })?
                } else {
                    value.clone().into()
                };
                options.insert(key.clone(), value);
            }
            if q.get("sizeInBytes")
                .is_some_and(|size| *size != raw.len().to_string())
            {
                return Err(invalid("sizeInBytes does not match the body"));
            }
        }
        check_metadata(options.get("metadata"))?;
        if options.get("name").map_or("", text).is_empty() {
            return Err(invalid("Asset name is required"));
        }
        let website = options.contains_key("url");
        let mime = q.get("contentType").map_or("", String::as_str);
        if !website && !is_accepted_upload_mime_type(mime) {
            let mut failure = fail(
                ErrorCode::InvalidUploadMimeType,
                invalid_upload_mime_type(mime).message(),
            );
            failure.details = json!({ "mimeType": mime });
            return Err(failure);
        }
        let kind = if website { "website" } else { asset_type(mime) };
        let is_final = q.get("isFinal").is_some_and(|value| value == "true");
        let total = match q.get("totalSizeInBytes") {
            None => None,
            Some(total) => Some(
                total
                    .parse::<u64>()
                    .map_err(|_| validation("invalid-type", "totalSizeInBytes"))?,
            ),
        };
        if multipart {
            // Like the API: a declared total is checked before anything is stored, then a
            // single final part as the whole upload, then the part itself.
            let size = raw.len() as u64;
            let error = total
                .and_then(|total| image_size_error(kind, total, true))
                .or_else(|| {
                    is_final
                        .then(|| {
                            total_size_error(total, size, true)
                                .or_else(|| image_size_error(kind, size, true))
                        })
                        .flatten()
                });
            if let Some(code) = error {
                return Err(fail(code, "The upload's size is not accepted"));
            }
            check_part_size(size, is_final)?;
            if !is_final {
                if let Some(code) = total_size_error(total, size, false) {
                    return Err(fail(code, "The parts exceed totalSizeInBytes"));
                }
            }
        }
        if let Some(folder) = options.get("folderId").and_then(Value::as_str) {
            self.folder(folder)?;
        }
        if let Some(external) = options.get("externalId").and_then(Value::as_str) {
            if self.external_id_taken(external, None) {
                return Err(fail(
                    ErrorCode::DuplicateExternalId,
                    "An asset with this externalId already exists",
                ));
            }
        }
        let queue = q.get("queue").is_some_and(|value| value == "true");
        let open = multipart && !is_final;
        let processing = options
            .get("processingOptions")
            .cloned()
            .unwrap_or_else(|| json!({"keepContentAfterProcessing": false}));
        let keep = processing["keepContentAfterProcessing"] == true;
        let part_number: u64 = q
            .get("partNumber")
            .and_then(|number| number.parse().ok())
            .unwrap_or(1);
        // Like the API, only the posts CalmLens uses are kept, and only while the content is held.
        let context = match options.get("context") {
            None | Some(Value::Null) => Vec::new(),
            Some(context) => {
                let context: ModerationContext = serde_json::from_value(context.clone())
                    .map_err(|_| validation("invalid-type", "context"))?;
                select_moderation_context_items(&context.items)
            }
        };
        let id = self.create_id("asset");
        // Fields the API returns as `null` when they are not set.
        let mut asset = json!({
            "id": id, "projectId": self.options.project_id, "parentId": null,
            "folderId": null, "uploadPresetId": null, "createdAt": now, "updatedAt": now,
            "name": null, "description": null, "externalId": null, "externalUrl": null,
            "type": kind, "metadata": null, "authorId": null, "context": null, "tags": null,
            "processingOptions": processing,
            "visibility": "private",
            "content": {
                "status": if keep { "stored" } else { "temporary" }, "removalReason": null,
                "updatedAt": now, "safetyHold": null, "format": null, "extension": null,
                "sizeInBytes": null, "checksums": null, "image": null, "extractedText": null,
                "fileMetadata": null,
            },
            "upload": {
                "status": if open { "uploading" } else { "completed" }, "updatedAt": now,
                "partsReceived": if open { json!(part_number) } else { Value::Null },
            },
            "classification": {
                "status": if open { "pending" } else { "processing" }, "failureReason": null,
                "updatedAt": now, "completedAt": null, "moderation": {"status": "pending", "manualReviews": [], "flaggedCategories": [], "regions": []},
            },
        });
        for key in [
            "name",
            "description",
            "metadata",
            "authorId",
            "externalId",
            "externalUrl",
            "folderId",
            "visibility",
            "uploadPresetId",
        ] {
            if let Some(value) = options.get(key) {
                asset[key] = value.clone();
            }
        }
        if !context.is_empty() {
            asset["context"] = json!({ "items": context });
        }
        if website {
            asset["externalUrl"] = options["url"].clone();
        } else {
            if !mime.is_empty() {
                asset["content"]["format"] = mime.into();
            }
            asset["content"]["sizeInBytes"] = raw.len().into();
            self.storage.content.insert(
                id.clone(),
                StoredContent {
                    content_type: mime.to_owned(),
                    parts: BTreeMap::from([(1, raw.to_vec())]),
                },
            );
        }
        if !open {
            return self.finish_upload(asset, queue, now).inspect_err(|_| {
                self.storage.content.remove(&id);
            });
        }
        self.uploads.insert(
            id.clone(),
            Upload {
                queue,
                total_size: total,
            },
        );
        self.storage.assets.insert(id, asset.clone());
        Ok(asset)
    }

    fn external_id_taken(&self, external_id: &str, except: Option<&str>) -> bool {
        self.storage.assets.values().any(|other| {
            other["projectId"] == self.options.project_id.as_str()
                && other["externalId"] == external_id
                && except.is_none_or(|id| other["id"] != id)
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn asset_route(
        &mut self,
        method: &str,
        id: &str,
        suffix: &str,
        body: Map<String, Value>,
        q: &HashMap<String, String>,
        raw: &[u8],
        now: u64,
    ) -> Outcome<Value> {
        // Like the API, the body's schema is checked before the asset is looked up.
        match (method, suffix) {
            ("PATCH", "") => {
                check_metadata(body.get("metadata"))?;
                if body.get("name").is_some_and(Value::is_null) {
                    return Err(validation("invalid-type", "name"));
                }
            }
            ("POST", "signed-url") => {
                // None of these fields takes null.
                for key in [
                    "viewerClaims",
                    "resource",
                    "lens",
                    "transform",
                    "expiresInSeconds",
                ] {
                    if body.get(key).is_some_and(Value::is_null) {
                        let issue = if key == "resource" {
                            "invalid-value"
                        } else {
                            "invalid-type"
                        };
                        return Err(validation(issue, key));
                    }
                }
            }
            _ => {}
        }
        let mut asset = self
            .owned(&self.storage.assets, id)
            .ok_or_else(|| fail(ErrorCode::AssetNotFound, "Asset not found"))?
            .clone();
        let storage = &mut self.storage;
        match (method, suffix) {
            ("GET", "") => return Ok(asset),
            ("DELETE", "") => {
                storage.assets.remove(id);
                storage.content.remove(id);
                self.uploads.remove(id);
                self.record_lifecycle_event("asset.deleted", &asset);
                return Ok(json!({}));
            }
            ("GET", "children") => {
                return self.page(q, id, |child| child["parentId"] == id);
            }
            ("POST", "signed-url") => {
                let expires = body
                    .get("expiresInSeconds")
                    .and_then(Value::as_u64)
                    .unwrap_or(900);
                let resource = body.get("resource").map_or("rendered", text);
                let mut url = reqwest::Url::parse(&format!(
                    "{}/assets/{id}/{resource}",
                    self.options.signed_url_base_url
                ))
                .map_err(|_| invalid("Invalid signed URL base"))?;
                url.query_pairs_mut()
                    .append_pair("expiresInSeconds", &expires.to_string());
                for key in ["lens", "transform"] {
                    if let Some(value) = body.get(key).and_then(Value::as_str) {
                        url.query_pairs_mut().append_pair(key, value);
                    }
                }
                // Like the API, the URL carries the viewer claims its signature covers.
                if let Some(claims) = body.get("viewerClaims").filter(|claims| claims.is_object()) {
                    url.query_pairs_mut()
                        .append_pair("viewerClaims", &claims.to_string());
                }
                return Ok(json!({"url": url.as_str(), "expiresAt": now + expires * 1000}));
            }
            ("POST", "retry") => {
                if asset["classification"]["status"] != "failed"
                    || asset["classification"]["moderation"]["status"] != "pending"
                {
                    return Err(fail(
                        ErrorCode::AssetNotRetryable,
                        "Only failed assets can be retried",
                    ));
                }
                if asset["content"]["status"] == "removed" {
                    return Err(fail(
                        ErrorCode::AssetContentUnavailable,
                        "The content is no longer stored",
                    ));
                }
                // Back to processing, to be moderated again, with an `asset.retried` event.
                apply_outcome(&mut asset, &mut storage.content, "pending", "policy", now);
                storage.assets.insert(id.to_owned(), asset.clone());
                self.record_lifecycle_event("asset.retried", &asset);
                return self.moderate_stored(asset, MockModerationTrigger::Retry, None, now);
            }
            ("POST", "explain") => {
                if asset["classification"]["status"] != "completed" {
                    return Err(fail(
                        ErrorCode::AssetNotDecided,
                        "The asset has no moderation decision yet",
                    ));
                }
                if body.get("rerun") != Some(&Value::Bool(true)) {
                    // The evidence is completed and every action stays as decided.
                    let evidence = "/classification/moderation/explanationComplete";
                    if asset.pointer(evidence) != Some(&json!(false)) {
                        return Ok(asset);
                    }
                    *asset.pointer_mut(evidence).expect("evidence") = true.into();
                    asset["updatedAt"] = now.into();
                } else {
                    let reviews = &asset["classification"]["moderation"]["manualReviews"];
                    if reviews
                        .as_array()
                        .is_some_and(|reviews| !reviews.is_empty())
                    {
                        return Err(fail(
                            ErrorCode::AssetReviewed,
                            "A reviewer has decided the asset",
                        ));
                    }
                    if asset["content"]["status"] == "removed" {
                        return Err(fail(
                            ErrorCode::AssetContentUnavailable,
                            "The content is no longer stored",
                        ));
                    }
                    // Back to processing, to be moderated again under the current policy.
                    apply_outcome(&mut asset, &mut storage.content, "pending", "policy", now);
                    storage.assets.insert(id.to_owned(), asset.clone());
                    return self.moderate_stored(asset, MockModerationTrigger::Rerun, None, now);
                }
            }
            ("POST", "move") => {
                let folder = body.get("folderId").cloned().unwrap_or(Value::Null);
                if let Some(folder) = folder.as_str() {
                    self.folder(folder)?;
                }
                asset["folderId"] = folder;
                asset["updatedAt"] = now.into();
            }
            ("PATCH", "") => {
                // An externalId stays unique in the project; `null` clears a field.
                if let Some(external) = body.get("externalId").and_then(Value::as_str) {
                    if self.external_id_taken(external, Some(id)) {
                        return Err(fail(
                            ErrorCode::DuplicateExternalId,
                            "An asset with this externalId already exists",
                        ));
                    }
                }
                for (key, value) in body {
                    asset[key] = value;
                }
                asset["updatedAt"] = now.into();
            }
            ("DELETE", "content") => return Ok(self.remove_content(asset, now)),
            ("POST", "part") => {
                let (received, is_final) = self.check_part(&asset, q, raw)?;
                let part: u64 = q["partNumber"].parse().unwrap_or(0);
                let upload = self.uploads.get(id).expect("open upload");
                let queue = q.get("queue").map_or(upload.queue, |value| value == "true");
                let storage = &mut self.storage;
                let parts = &mut storage.content.get_mut(id).expect("content").parts;
                parts.insert(part as u32, raw.to_vec());
                asset["updatedAt"] = now.into();
                asset["content"]["sizeInBytes"] = received.into();
                asset["upload"]["updatedAt"] = now.into();
                // Like the API, a completed upload no longer counts parts.
                asset["upload"]["partsReceived"] = if is_final { Value::Null } else { part.into() };
                if is_final {
                    self.uploads.remove(id);
                    apply_outcome(
                        &mut asset,
                        &mut self.storage.content,
                        "pending",
                        "policy",
                        now,
                    );
                    return self.finish_upload(asset, queue, now);
                }
            }
            _ => return Err(unknown_route()),
        }
        self.storage.assets.insert(id.to_owned(), asset.clone());
        Ok(asset)
    }

    /// Checks a later part in the API's order: the upload must be open, parts arrive in order,
    /// image totals and the declared total hold, then the part itself (5 MiB unless it is the
    /// last). Returns the size received with it and whether it is the last.
    fn check_part(
        &self,
        asset: &Value,
        q: &HashMap<String, String>,
        raw: &[u8],
    ) -> Outcome<(u64, bool)> {
        let id = text(&asset["id"]);
        let upload = self.uploads.get(id);
        if upload.is_none() || asset["upload"]["status"] != "uploading" {
            return Err(fail(ErrorCode::UploadNotOpen, "The upload is not open"));
        }
        if q.get("sizeInBytes")
            .is_some_and(|size| *size != raw.len().to_string())
        {
            return Err(invalid("sizeInBytes does not match the body"));
        }
        let expected = asset["upload"]["partsReceived"].as_u64().unwrap_or(0) + 1;
        let received_number = q.get("partNumber").and_then(|n| n.parse::<u64>().ok());
        // Like the API: an upload has at most 10,000 parts.
        if received_number != Some(expected) || expected > MAX_UPLOAD_PARTS {
            let mut failure = fail(
                ErrorCode::InvalidUploadPartNumber,
                &format!("Expected part {expected}"),
            );
            failure.details = json!({
                "expectedPartNumber": expected, "receivedPartNumber": received_number,
            });
            return Err(failure);
        }
        let is_final = q.get("isFinal").is_some_and(|value| value == "true");
        let received = asset["content"]["sizeInBytes"].as_u64().unwrap_or(0) + raw.len() as u64;
        let total = upload.and_then(|upload| upload.total_size);
        let error = image_size_error(text(&asset["type"]), received, is_final)
            .or_else(|| total_size_error(total, received, is_final));
        if let Some(code) = error {
            return Err(fail(code, "The parts' size is not accepted"));
        }
        check_part_size(raw.len() as u64, is_final)?;
        Ok((received, is_final))
    }

    /// Project assets accepted by `include`, filtered, ordered and paged like the API. A cursor
    /// is tied to `scope` (the filter, folder or parent) and the ordering, so it only continues
    /// the query it came from.
    fn page(
        &self,
        q: &HashMap<String, String>,
        scope: &str,
        include: impl Fn(&Value) -> bool,
    ) -> Outcome<Value> {
        // In the API's order: the query schema (page size, then ordering), then the filter.
        let size = bounded(q.get("pageSize"), 50, 1, 100, "pageSize")?;
        let ordering = cursor_ordering(q)?;
        let filter = q
            .get("filter")
            .map(|expression| parse_filter(expression))
            .transpose()?;
        let items: Vec<&Value> = self
            .storage
            .assets
            .values()
            .filter(|asset| asset["projectId"] == self.options.project_id.as_str())
            .filter(|asset| include(asset))
            .filter(|asset| filter.as_ref().is_none_or(|filter| filter.matches(asset)))
            .collect();
        keyset_page(items, &ordering, q.get("cursor"), scope, size)
    }

    /// Keyword search like the API: every whitespace-separated query token (case-insensitive, at
    /// most 8 distinct) must appear in some searchable field. Results rank by the API's keyword
    /// score, then newest first. Semantic search is not simulated.
    fn search(&self, q: &HashMap<String, String>) -> Outcome<Value> {
        // Like the API's query schema: a trimmed query of 1 to 200 characters, a limit of 1 to 20.
        let query = q.get("query").map_or("", |query| query.trim());
        if query.is_empty() {
            return Err(validation("too-small", "query"));
        }
        if query.chars().count() > 200 {
            return Err(validation("too-big", "query"));
        }
        let limit = bounded(q.get("limit"), 10, 1, 20, "limit")?;
        let normalized = query.to_lowercase();
        let mut tokens: Vec<&str> = Vec::new();
        for token in normalized.split_whitespace() {
            if tokens.len() < SEARCH_TOKENS && !tokens.contains(&token) {
                tokens.push(token);
            }
        }
        let mut matches: Vec<(u32, Vec<&str>, &Value)> = Vec::new();
        for asset in self.storage.assets.values() {
            if asset["projectId"] != self.options.project_id.as_str() {
                continue;
            }
            let values = SEARCH_FIELDS.map(|field| {
                match lookup(asset, field) {
                    Value::Array(tags) => tags.iter().map(display).collect::<Vec<_>>().join(" "),
                    value => display(value),
                }
                .to_lowercase()
            });
            if !tokens
                .iter()
                .all(|token| values.iter().any(|value| value.contains(token)))
            {
                continue;
            }
            let fields: Vec<&str> = SEARCH_FIELDS
                .iter()
                .zip(&values)
                .filter(|(_, value)| tokens.iter().any(|token| value.contains(token)))
                .map(|(field, _)| *field)
                .collect();
            let [name, id, external_id, _, tags, ..] = &values;
            let score = if *id == normalized {
                1000
            } else if *external_id == normalized {
                950
            } else if *name == normalized {
                900
            } else if id.starts_with(&normalized) {
                800
            } else if external_id.starts_with(&normalized) {
                750
            } else if name.starts_with(&normalized) {
                700
            } else if name.contains(&normalized) {
                600
            } else if tags.contains(&normalized) {
                500
            } else {
                100
            };
            matches.push((score, fields, asset));
        }
        matches.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| compare(&b.2["createdAt"], &a.2["createdAt"]))
                .then_with(|| compare(&b.2["id"], &a.2["id"]))
        });
        let items: Vec<Value> = matches
            .into_iter()
            .take(limit)
            .map(|(score, fields, asset)| json!({"asset": asset, "score": score, "matchedFields": fields}))
            .collect();
        Ok(json!({"query": query, "items": items, "semanticStatus": "disabled"}))
    }

    /// A CDN request, served like the CDN: stored bytes with `Content-Type`, `Content-Length`,
    /// `Cache-Control`, `Cache-Tag`, the protection headers and, for images, `ETag` and
    /// `Expires`; or a JSON error. Delivery checks come first and refuse everyone (content
    /// uploading or removed, blocked, purged or failed assets); then private and age-restricted
    /// assets need the download permission. A `placeholder` is the image's ThumbHash as a PNG.
    fn serve(
        &self,
        parts: &[String],
        raw_parts: &[&str],
        q: &HashMap<String, String>,
        headers: &HeaderMap,
    ) -> MockResponse {
        let not_found =
            || custom(ErrorCode::AssetNotFound.as_str(), 404, "Asset not found").response();
        let not_available =
            || custom("asset/not-available", 403, "Asset is not available").response();
        // Like the CDN, the selector after the resource (as sent, still percent-encoded) is read
        // first, and lenses and transforms apply only to the rendered resource.
        let invalid_transform =
            || custom("asset/invalid-transform", 400, "Invalid transform selector").response();
        let selector = raw_parts.get(4..).unwrap_or_default().join("/");
        let Some(selector) = parse_transform_selector(&selector) else {
            return invalid_transform();
        };
        if parts.get(3).is_some_and(|resource| resource == "original")
            && (selector.lens.is_some() || selector.options.is_some())
        {
            return invalid_transform();
        }
        let [scope, project, identifier, resource, ..] = parts else {
            return not_found();
        };
        if scope != "assets" || *project != self.options.project_id {
            return not_found();
        }
        let Some(asset) = self.storage.assets.values().find(|asset| {
            asset["projectId"] == project.as_str()
                && (asset["id"] == identifier.as_str()
                    || asset["externalId"] == identifier.as_str())
        }) else {
            return not_found();
        };
        let id = text(&asset["id"]);
        let status = text(&asset["classification"]["moderation"]["status"]);
        let public = asset["visibility"] == "public";
        let can_download =
            || self.can_download(text(&asset["folderId"]), header(headers, "x-api-key"));
        if resource == "placeholder" {
            // Like the CDN's placeholder handler: an image's ThumbHash, public whatever the
            // asset's visibility or moderation; refused for purged assets and assets without one
            // (not yet classified, or content removed).
            let thumbhash = text(&asset["content"]["image"]["thumbhash"]);
            if thumbhash.is_empty() || status == "purged" {
                return not_available();
            }
            let Some(png) = super::placeholder::placeholder_png(thumbhash) else {
                return not_available();
            };
            return cdn_response(
                png,
                &[
                    ("content-type", "image/png".into()),
                    ("cache-control", "public, max-age=3600".into()),
                    ("cache-tag", format!("asset-{id}")),
                    ("etag", format!("\"{thumbhash}\"")),
                ],
            );
        }
        let stored = self.storage.content.get(id);
        let Some(stored) = stored.filter(|_| {
            asset["upload"]["status"] != "uploading"
                && status != "blocked"
                && status != "purged"
                && asset["classification"]["status"] != "failed"
                && asset["content"]["status"] != "removed"
        }) else {
            return not_available();
        };
        let claims: Value =
            serde_json::from_str(q.get("viewerClaims").map(String::as_str).unwrap_or("{}"))
                .unwrap_or(Value::Null);
        if status == "age-restricted" && claims["ageConfirmed"] != true {
            return custom(
                "viewer/age-confirmation-required",
                403,
                "Age confirmation required",
            )
            .response();
        }
        let restricted = !public;
        if restricted && !can_download() {
            return custom(
                "asset/api-key-missing-permission",
                403,
                "This API key needs assets:download permission for this asset's folder.",
            )
            .response();
        }
        // Then the options, checked against the transform schema once the asset may be served.
        if let Some(options) = selector.options {
            let (unknown, invalid) = check_transform_options(&Value::Object(options));
            if !unknown.is_empty() || !invalid.is_empty() {
                let keys = [unknown, invalid].concat().join(", ");
                return custom(
                    "asset/invalid-transform-options",
                    400,
                    &format!("Invalid transform options: {keys}"),
                )
                .response();
            }
        }
        // Like the CDN: an image's bytes are immutable for a year, other content is kept for an
        // hour, by shared caches only when delivery is public.
        let image = asset["type"] == "image";
        let access = if restricted { "private" } else { "public" };
        let lifetime = if image {
            "max-age=31536000, immutable"
        } else {
            "max-age=3600"
        };
        let mut response_headers = vec![
            ("content-type", stored.content_type.clone()),
            (
                "cache-control",
                if claims.as_object().is_some_and(|c| !c.is_empty()) {
                    "private, no-store".into()
                } else {
                    format!("{access}, {lifetime}")
                },
            ),
            ("cache-tag", format!("asset-{id}")),
        ];
        if image {
            response_headers.push(("etag", format!("\"{id}\"")));
            response_headers.push(("expires", http_date(self.now() / 1000 + 31_536_000)));
        }
        response_headers.push(("x-content-type-options", "nosniff".into()));
        response_headers.push((
            "content-security-policy",
            "sandbox; default-src 'none'".into(),
        ));
        if is_active_content_type(&stored.content_type) {
            response_headers.push(("content-disposition", "attachment".into()));
        }
        cdn_response(stored.bytes(), &response_headers)
    }

    fn can_download(&self, folder: &str, api_key: &str) -> bool {
        let grants = if api_key == self.options.api_key {
            self.grants.clone()
        } else {
            grants_of(api_key)
        };
        grants
            .iter()
            .filter(|grant| {
                grant
                    .actions
                    .iter()
                    .any(|action| action == "assets:download")
            })
            .any(|grant| {
                let Some(granted) = &grant.folder_id else {
                    return true;
                };
                let mut seen = HashSet::new();
                let mut current = folder.to_owned();
                while !current.is_empty() && seen.insert(current.clone()) {
                    if current == *granted {
                        return true;
                    }
                    if !grant.include_subfolders {
                        break;
                    }
                    current = self
                        .folder(&current)
                        .map_or(String::new(), |f| text(&f["parentId"]).to_owned());
                }
                false
            })
    }
}

impl Backend {
    /// Replaces the mock API key's grants; the key itself stays the same.
    pub(super) fn set_grants(&mut self, grants: &[MockApiKeyGrant]) {
        self.grants = grants.to_vec();
    }
    pub(super) fn queue_failure(&mut self, failure: QueuedFailure) {
        self.failures.push(failure);
    }
    /// The first queued failure for this request, removed from the queue.
    pub(super) fn take_failure(
        &mut self,
        method: &Method,
        url: &reqwest::Url,
    ) -> Option<QueuedFailure> {
        let operation = self.operation(method, url);
        let index = self.failures.iter().position(|queued| {
            queued
                .options
                .operation
                .as_deref()
                .is_none_or(|target| operation.is_some_and(|op| covers(target, op)))
        })?;
        Some(self.failures.remove(index))
    }
    /// The operation a request belongs to, by its route: an operation name in [`OPERATIONS`].
    fn operation(&self, method: &Method, url: &reqwest::Url) -> Option<&'static str> {
        if under(url, &self.options.cdn_base_url).is_some() {
            return Some("cdn.serve");
        }
        let rest = under(url, &self.options.api_base_url)?;
        let parts: Vec<&str> = rest.split('/').filter(|part| !part.is_empty()).collect();
        let queue = url
            .query_pairs()
            .any(|(key, value)| key == "queue" && value == "true");
        Some(match (method.as_str(), parts.as_slice()) {
            ("GET", ["projects", _, "events"]) => "events.list",
            ("PUT", ["projects", _, "lenses"]) => "ensureLenses",
            ("GET", ["projects", _, "folders"]) => "folders.list",
            ("POST", ["projects", _, "folders"]) => "folders.create",
            ("GET", ["projects", _, "assets"]) => "assets.list",
            ("GET", ["projects", _, "assets", "search"]) => "assets.search",
            ("POST", ["projects", _, "assets", "batch"]) => "assets.batch",
            ("POST", ["projects", _, "assets"]) if queue => "assets.create",
            ("POST", ["projects", _, "assets"]) => "assets.classify",
            ("GET", ["assets", _]) => "assets.retrieve",
            ("PATCH", ["assets", _]) => "assets.update",
            ("DELETE", ["assets", _]) => "assets.delete",
            ("GET", ["assets", _, "children"]) => "assets.listChildren",
            ("DELETE", ["assets", _, "content"]) => "assets.deleteContent",
            ("POST", ["assets", _, "signed-url"]) => "assets.createSignedUrl",
            ("POST", ["assets", _, "retry"]) => "assets.retry",
            ("POST", ["assets", _, "explain"]) => "assets.explain",
            ("POST", ["assets", _, "decision"]) => "assets.decide",
            ("POST", ["assets", _, "move"]) => "assets.move",
            ("POST", ["assets", _, "part"]) => "assets.uploadPart",
            ("GET", ["folders", _]) => "folders.retrieve",
            ("PATCH", ["folders", _]) => "folders.update",
            ("DELETE", ["folders", _]) => "folders.delete",
            ("POST", ["folders", _, "move"]) => "folders.move",
            ("GET", ["projects", _, "hash-lists"]) => "hashLists.list",
            ("POST", ["projects", _, "hash-lists"]) => "hashLists.create",
            ("GET", ["hash-lists", _]) => "hashLists.retrieve",
            ("PATCH", ["hash-lists", _]) => "hashLists.update",
            ("DELETE", ["hash-lists", _]) => "hashLists.delete",
            ("GET", ["hash-lists", _, "entries"]) => "hashLists.listEntries",
            ("POST", ["hash-lists", _, "entries"]) => "hashLists.addEntry",
            ("DELETE", ["hash-list-entries", _]) => "hashLists.removeEntry",
            ("GET", ["projects", _, "policies"]) => "policies.list",
            ("POST", ["projects", _, "policies"]) => "policies.create",
            ("GET", ["projects", _, "policies", _]) => "policies.retrieve",
            ("PATCH", ["projects", _, "policies", _]) => "policies.update",
            ("DELETE", ["projects", _, "policies", _]) => "policies.delete",
            ("POST", ["projects", _, "policies", _, "preset"]) => "policies.applyPreset",
            ("PUT", ["projects", _, "policies", _, "automatic-updates"]) => {
                "policies.setAutomaticUpdates"
            }
            ("PUT", ["projects", _, "policy"]) => "policies.assign",
            _ => return None,
        })
    }
}

/// Whether a failure queued for operation `target` applies to a request of `operation`:
/// conveniences fail with the request they send.
fn covers(target: &str, operation: &str) -> bool {
    target == operation
        || matches!(
            (target, operation),
            ("text.classify", "assets.classify")
                | ("assets.waitForDecision", "assets.retrieve")
                | ("assets.iterate", "assets.list")
                | ("assets.iterateChildren", "assets.listChildren")
                | ("events.pages", "events.list")
                | ("ensureLens", "ensureLenses")
        )
}

/// The grants a key made by [`create_mock_api_key`] carries; none for any other key.
fn grants_of(api_key: &str) -> Vec<MockApiKeyGrant> {
    api_key
        .strip_prefix("sk_test_")
        .and_then(|raw| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(raw)
                .ok()
        })
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .unwrap_or_default()
}

/// A successful CDN response with `headers` and `Content-Length`.
fn cdn_response(body: Vec<u8>, headers: &[(&str, String)]) -> MockResponse {
    let mut response = MockResponse::new(200);
    for (name, value) in headers {
        response = response.header(name, value);
    }
    response
        .header("content-length", &body.len().to_string())
        .body(body)
}

/// Like the CDN, content a browser could run as a document is served as a download.
fn is_active_content_type(content_type: &str) -> bool {
    let normalized = normalize_mime(content_type);
    [
        "image/svg+xml",
        "application/xhtml+xml",
        "text/html",
        "application/xml",
        "text/xml",
    ]
    .contains(&normalized.as_str())
        || normalized.ends_with("+xml")
}

/// An HTTP date (IMF-fixdate) for `seconds` since the Unix epoch.
fn http_date(seconds: u64) -> String {
    const DAYS: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let days = (seconds / 86_400) as i64;
    let time = seconds % 86_400;
    // The civil date from days since the epoch (Howard Hinnant's algorithm).
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{}, {day:02} {} {year} {:02}:{:02}:{:02} GMT",
        DAYS[(days % 7) as usize],
        MONTHS[(month - 1) as usize],
        time / 3600,
        time % 3600 / 60,
        time % 60
    )
}

/// Keyword search fields, in the order matches are reported.
const SEARCH_FIELDS: [&str; 9] = [
    "name",
    "id",
    "externalId",
    "description",
    "tags",
    "type",
    "content.format",
    "content.extension",
    "classification.moderation.status",
];
/// The most distinct query tokens a keyword search uses.
const SEARCH_TOKENS: usize = 8;

/// Whether an asset's content was purged, like the API: a reviewer purged it, or it was removed
/// by policy or disposed of.
fn content_purged(asset: &Value) -> bool {
    let moderation = &asset["classification"]["moderation"];
    moderation["status"] == "purged"
        || (asset["content"]["status"] == "removed"
            && matches!(
                text(&asset["content"]["removalReason"]),
                "policy" | "disposed"
            ))
        || moderation["manualReviews"]
            .as_array()
            .is_some_and(|reviews| {
                reviews.iter().any(|review| {
                    review["decision"] == "purged" && review["appliedToAsset"] == true
                })
            })
}

/// A cursor list's ordering by `createdAt` or `id`, as `(field, ascending)`: newest first by
/// default, with the `id` tie-breaker added like the API.
fn cursor_ordering(q: &HashMap<String, String>) -> Outcome<Vec<(String, bool)>> {
    let mut ordering = Vec::new();
    while let Some(field) = q.get(&format!("ordering[{}][field]", ordering.len())) {
        let direction = q
            .get(&format!("ordering[{}][direction]", ordering.len()))
            .cloned()
            .unwrap_or_default();
        // Like CURSOR_PAGE_QUERY_SCHEMA: a field of createdAt or id, then a direction.
        let index = ordering.len();
        if !["createdAt", "id"].contains(&field.as_str()) {
            return Err(validation(
                "invalid-value",
                &format!("ordering.{index}.field"),
            ));
        }
        if !["asc", "desc"].contains(&direction.as_str()) {
            return Err(validation(
                "invalid-value",
                &format!("ordering.{index}.direction"),
            ));
        }
        ordering.push((field.clone(), direction == "asc"));
    }
    if ordering.len() > 2 {
        return Err(validation("too-big", "ordering"));
    }
    if ordering.is_empty() {
        ordering.push(("createdAt".into(), false));
    }
    if !ordering.iter().any(|(field, _)| field == "id") {
        ordering.push(("id".into(), ordering[0].1));
    }
    Ok(ordering)
}

/// Sorts `items` by `ordering` (which ends with the `id` tie-breaker) and returns the page of up
/// to `size` items after `cursor`, like the API's cursor lists. A cursor holds the ordering
/// values of the last item it follows and continues only the query (`scope` and ordering) it
/// came from; `id` and `name` values are text, the others numbers.
fn keyset_page(
    mut items: Vec<&Value>,
    ordering: &[(String, bool)],
    cursor: Option<&String>,
    scope: &str,
    size: usize,
) -> Outcome<Value> {
    let order = |a: &Value, b: &Value| {
        ordering
            .iter()
            .map(|(field, ascending)| {
                let order = compare(&a[field], &b[field]);
                if *ascending {
                    order
                } else {
                    order.reverse()
                }
            })
            .find(|order| order.is_ne())
            .unwrap_or(Ordering::Equal)
    };
    items.sort_by(|a, b| order(a, b));
    let ordering_json: Vec<Value> = ordering
        .iter()
        .map(|(field, ascending)| {
            json!({"field": field, "direction": if *ascending { "asc" } else { "desc" }})
        })
        .collect();
    let signature = json!([scope, ordering_json]).to_string();
    let engine = base64::engine::general_purpose::STANDARD;
    if let Some(cursor) = cursor {
        let values: Vec<Value> = engine
            .decode(cursor)
            .ok()
            .and_then(|raw| serde_json::from_slice::<Value>(&raw).ok())
            .filter(|parsed| parsed["scope"] == signature.as_str())
            .and_then(|parsed| parsed["values"].as_array().cloned())
            .filter(|values| {
                values.len() == ordering.len()
                    && values.iter().zip(ordering).all(|(value, (field, _))| {
                        if field == "id" || field == "name" {
                            value.is_string()
                        } else {
                            value.is_number()
                        }
                    })
            })
            .ok_or_else(|| fail(ErrorCode::InvalidCursor, "Invalid cursor"))?;
        let boundary: Map<String, Value> = ordering
            .iter()
            .map(|(field, _)| field.clone())
            .zip(values)
            .collect();
        let boundary = Value::Object(boundary);
        items.retain(|item| order(item, &boundary).is_gt());
    }
    let has_more = items.len() > size;
    items.truncate(size);
    let next_cursor = match items.last() {
        Some(last) if has_more => {
            let values: Vec<Value> = ordering
                .iter()
                .map(|(field, _)| last[field].clone())
                .collect();
            let cursor = json!({"scope": signature, "values": values});
            Value::from(engine.encode(cursor.to_string()))
        }
        _ => Value::Null,
    };
    Ok(json!({
        "items": items, "nextCursor": next_cursor, "pageSize": size, "ordering": ordering_json,
        "hasMore": has_more,
    }))
}

/// Orders JSON values: null first, then numbers numerically, then everything else as text.
fn compare(a: &Value, b: &Value) -> Ordering {
    match (a, b) {
        (Value::Null, Value::Null) => Ordering::Equal,
        (Value::Null, _) => Ordering::Less,
        (_, Value::Null) => Ordering::Greater,
        _ => match (a.as_f64(), b.as_f64()) {
            (Some(a), Some(b)) => a.total_cmp(&b),
            _ => display(a).cmp(&display(b)),
        },
    }
}

/// An asset list filter as the API reads it (zodbase/rsql with @rsql/parser): `;` (and), which
/// binds tighter than `,` (or), `( … )` groups, quoted or unquoted values, and only the fields
/// and operators in `asset_filters`. Anything else is `validation/invalid-filter`.
/// Alternatives (`,`) of terms (`;`) that must all hold.
struct Filter(Vec<Vec<Term>>);
enum Term {
    Comparison(Comparison),
    Group(Filter),
}
struct Comparison {
    field: &'static str,
    operator: &'static str,
    values: Vec<Operand>,
}
/// A filter value read by its field's type: `null` only on a nullable field, a number on a
/// number field, and text otherwise.
enum Operand {
    Null,
    Number(f64),
    Text(String),
}
/// Characters that end an unquoted selector or value (@rsql/ast ReservedChars).
const RESERVED: &[char] = &[
    '"', '\'', '(', ')', ';', ',', '=', '!', '~', '<', '>', ' ', '\n', '\t', '\r',
];
fn invalid_filter() -> Failure {
    fail(ErrorCode::InvalidFilter, "Invalid filter")
}
/// Walks `text` outside quotes (honouring `\` escapes), calling `visit` with each character's
/// index, the character and the parenthesis depth before it.
fn scan(text: &str, mut visit: impl FnMut(usize, char, i32) -> bool) -> Option<i32> {
    let (mut depth, mut quote, mut escaped) = (0i32, None, false);
    for (index, c) in text.char_indices() {
        if let Some(q) = quote {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == q {
                quote = None;
            }
            continue;
        }
        if !visit(index, c, depth) {
            return None;
        }
        match c {
            '"' | '\'' => quote = Some(c),
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
    }
    quote.is_none().then_some(depth)
}
/// The expression inside `( … )` when the parentheses enclose all of `text`.
fn unwrap_group(text: &str) -> Option<&str> {
    if !text.starts_with('(') || !text.ends_with(')') {
        return None;
    }
    let mut closes_early = false;
    scan(text, |index, c, depth| {
        if c == ')' && depth == 1 && index != text.len() - 1 {
            closes_early = true;
        }
        true
    })?;
    (!closes_early).then(|| &text[1..text.len() - 1])
}
fn split_top(expression: &str, separator: char) -> Outcome<Vec<&str>> {
    let (mut parts, mut start) = (Vec::new(), 0);
    let depth = scan(expression, |index, c, depth| {
        if c == separator && depth == 0 {
            parts.push(&expression[start..index]);
            start = index + 1;
        }
        depth >= 0
    });
    if depth != Some(0) {
        return Err(invalid_filter());
    }
    parts.push(&expression[start..]);
    Ok(parts)
}
/// One value token: a quoted string with `\` escapes, or unquoted text without reserved
/// characters.
fn value_token(value: &str) -> Outcome<String> {
    let value = value.trim();
    match value.chars().next() {
        Some(q @ ('"' | '\'')) => {
            let mut out = String::new();
            let mut chars = value[1..].chars();
            while let Some(c) = chars.next() {
                match c {
                    '\\' => out.push(chars.next().ok_or_else(invalid_filter)?),
                    c if c == q => {
                        return chars
                            .as_str()
                            .is_empty()
                            .then_some(out)
                            .ok_or_else(invalid_filter)
                    }
                    c => out.push(c),
                }
            }
            Err(invalid_filter())
        }
        _ if value.is_empty() || value.contains(RESERVED) => Err(invalid_filter()),
        _ => Ok(value.to_owned()),
    }
}
fn parse_filter(expression: &str) -> Outcome<Filter> {
    if expression.trim().is_empty() {
        return Err(invalid_filter());
    }
    parse_group(expression)
}
fn parse_group(expression: &str) -> Outcome<Filter> {
    let mut alternatives = Vec::new();
    for alternative in split_top(expression, ',')? {
        let mut terms = Vec::new();
        for term in split_top(alternative, ';')? {
            let term = term.trim();
            if let Some(group) = unwrap_group(term) {
                terms.push(Term::Group(parse_group(group)?));
                continue;
            }
            terms.push(Term::Comparison(parse_comparison(term)?));
        }
        alternatives.push(terms);
    }
    Ok(Filter(alternatives))
}
fn parse_comparison(term: &str) -> Outcome<Comparison> {
    let selector_end = term.find(RESERVED).unwrap_or(term.len());
    let (selector, rest) = term.split_at(selector_end);
    let rest = rest.trim_start();
    // A canonical operator, or a FIQL-style `=word=` the API then refuses.
    let operator_len = ["==", "!=", "<=", ">=", "<", ">"]
        .into_iter()
        .find(|operator| rest.starts_with(operator))
        .map(str::len)
        .or_else(|| {
            let word = rest.strip_prefix('=')?;
            let letters = word.bytes().take_while(u8::is_ascii_lowercase).count();
            word[letters..].starts_with('=').then_some(letters + 2)
        })
        .ok_or_else(invalid_filter)?;
    let (field, kind, nullable) = *asset_filters::ASSET_FILTER_FIELDS
        .iter()
        .find(|(name, _, _)| *name == selector)
        .ok_or_else(invalid_filter)?;
    let operator = *asset_filters::FILTER_OPERATORS
        .iter()
        .find(|operator| **operator == &rest[..operator_len])
        .ok_or_else(invalid_filter)?;
    let raw = rest[operator_len..].trim();
    let tokens = match raw.strip_prefix('(') {
        Some(list) => {
            let list = list.strip_suffix(')').ok_or_else(invalid_filter)?;
            split_top(list, ',')?
        }
        None => vec![raw],
    };
    let mut values = Vec::new();
    for token in tokens {
        let text = value_token(token)?;
        values.push(if nullable && text == "null" {
            Operand::Null
        } else if kind == "number" {
            text.trim()
                .parse::<f64>()
                .ok()
                .filter(|number| number.is_finite() && !text.trim().is_empty())
                .map(Operand::Number)
                .ok_or_else(invalid_filter)?
        } else {
            Operand::Text(text)
        });
    }
    Ok(Comparison {
        field,
        operator,
        values,
    })
}
fn wildcard(pattern: &str, value: &str) -> bool {
    match pattern.split_once('*') {
        None => pattern == value,
        Some((prefix, rest)) => {
            let Some(value) = value.strip_prefix(prefix) else {
                return false;
            };
            (0..=value.len())
                .filter(|index| value.is_char_boundary(*index))
                .any(|index| wildcard(rest, &value[index..]))
        }
    }
}
impl Operand {
    /// Whether a present value equals this one, as SQL `=` compares them (case-sensitively).
    fn equals(&self, actual: &Value) -> bool {
        match self {
            Operand::Null => false,
            Operand::Number(number) => actual.as_f64() == Some(*number),
            Operand::Text(text) => actual.as_str() == Some(text.as_str()),
        }
    }
    /// A `*` pattern, matched regardless of case, when this is text that holds one.
    fn pattern(&self) -> Option<String> {
        match self {
            Operand::Text(text) if text.contains('*') => Some(text.to_lowercase()),
            _ => None,
        }
    }
    fn order(&self, actual: &Value) -> Option<Ordering> {
        match self {
            Operand::Null => None,
            Operand::Number(number) => actual.as_f64().map(|left| left.total_cmp(number)),
            Operand::Text(text) => actual.as_str().map(|left| left.cmp(text.as_str())),
        }
    }
}
impl Filter {
    fn matches(&self, asset: &Value) -> bool {
        self.0.iter().any(|terms| {
            terms.iter().all(|term| match term {
                Term::Group(group) => group.matches(asset),
                Term::Comparison(comparison) => comparison.matches(asset),
            })
        })
    }
}
impl Comparison {
    /// Like SQL, a comparison never matches a missing value, except `==null`.
    fn matches(&self, asset: &Value) -> bool {
        let actual = lookup(asset, self.field);
        let first = &self.values[0];
        if actual.is_null() {
            return self.operator == "==" && matches!(first, Operand::Null);
        }
        // Tags hold a list: a term matches when one of them does.
        let items: Vec<&Value> = match actual {
            Value::Array(items) => items.iter().collect(),
            value => vec![value],
        };
        let equals = |operand: &Operand| match operand.pattern() {
            Some(pattern) => items.iter().any(|item| {
                item.as_str()
                    .is_some_and(|text| wildcard(&pattern, &text.to_lowercase()))
            }),
            None => items.iter().any(|item| operand.equals(item)),
        };
        let listed = |operand: &Operand| items.iter().any(|item| operand.equals(item));
        let order = |test: fn(Ordering) -> bool| {
            items.iter().any(|item| first.order(item).is_some_and(test))
        };
        match self.operator {
            "==" => equals(first),
            "!=" => matches!(first, Operand::Null) || !equals(first),
            // Lists compare exactly: `*` is a wildcard only in `==` and `!=`.
            "=in=" => self.values.iter().any(listed),
            "=out=" => {
                !self
                    .values
                    .iter()
                    .any(|value| matches!(value, Operand::Null))
                    && !self.values.iter().any(listed)
            }
            ">" => order(Ordering::is_gt),
            ">=" => order(Ordering::is_ge),
            "<" => order(Ordering::is_lt),
            _ => order(Ordering::is_le),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::check_metadata;
    use serde_json::Value;

    /// The metadata scenario in `testdata/mock-scenarios.json` passes metadata the SDK's types
    /// can't hold, so its runner skips it: each step's metadata gets the step's outcome here.
    #[test]
    fn metadata_is_checked_like_the_api_schema() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/mock-scenarios.json");
        let file: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let scenario = file["scenarios"]
            .as_array()
            .unwrap()
            .iter()
            .find(|scenario| {
                scenario["steps"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|step| step["expect"]["error"]["details"]["path"] == "metadata")
            })
            .expect("a metadata scenario");
        let (mut refused, mut accepted) = (0, 0);
        for step in scenario["steps"].as_array().unwrap() {
            let Some(metadata) = step["args"].get("metadata") else {
                continue;
            };
            let outcome = check_metadata(Some(metadata));
            match step["expect"].get("error") {
                Some(error) => {
                    refused += 1;
                    let failure = outcome.expect_err(&metadata.to_string());
                    assert_eq!(failure.code, error["code"], "{metadata}");
                    assert_eq!(failure.status, error["status"], "{metadata}");
                    assert_eq!(
                        failure.details["path"], error["details"]["path"],
                        "{metadata}"
                    );
                }
                None => {
                    accepted += 1;
                    assert!(outcome.is_ok(), "{metadata}");
                }
            }
        }
        assert!(
            refused > 0 && accepted > 0,
            "the scenario refuses and accepts metadata"
        );
    }
}
