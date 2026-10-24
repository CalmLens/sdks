//! The in-memory API behind [`MockServerClient::in_memory`](super::MockServerClient::in_memory).
use super::MockResponse;
use crate::error::ErrorCode;
use base64::Engine;
use http::{HeaderMap, Method};
use serde_json::{json, Map, Value};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashMap, HashSet},
    fmt,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) const API_BASE_URL: &str = "https://api.calmlens.invalid/v1";
pub(super) const CDN_BASE_URL: &str = "https://cdn.calmlens.invalid/v1";
const CDN_HOST: &str = "cdn.calmlens.invalid";

/// The simulated result of an upload, for [`MockOptions::queued_outcome`] and
/// [`MockOptions::analyzed_outcome`]. The mock does not classify content.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum MockOutcome {
    /// Processing continues with moderation `pending`.
    Pending,
    /// Processing completes with moderation `allowed`.
    Allowed,
    /// Processing completes with moderation `age-restricted`; the CDN then serves the asset
    /// only with the download permission, or a public one with `allow_age_restricted`.
    AgeRestricted,
    /// Processing completes with moderation `blocked`; the CDN refuses it.
    Blocked,
    /// Processing completes with moderation `purged` and the content is removed (reason `policy`).
    Purged,
    /// Processing fails (retryable) with moderation `pending`.
    Failed,
}
impl MockOutcome {
    /// The moderation status (or `failed`) this outcome sets.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Allowed => "allowed",
            Self::AgeRestricted => "age-restricted",
            Self::Blocked => "blocked",
            Self::Purged => "purged",
            Self::Failed => "failed",
        }
    }
}

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

type CreateId = Arc<dyn Fn() -> String + Send + Sync>;
type Now = Arc<dyn Fn() -> u64 + Send + Sync>;

/// Options for [`MockServerClient::in_memory`](super::MockServerClient::in_memory).
///
/// Defaults: project `mock-project`, `create_mock_api_key(&[])`, no retries, random IDs, the
/// system clock, queued outcome [`MockOutcome::Pending`] and analyzed outcome [`MockOutcome::Allowed`].
#[derive(Clone)]
pub struct MockOptions {
    pub(super) api_key: String,
    pub(super) project_id: String,
    pub(super) max_retries: u32,
    queued_outcome: MockOutcome,
    analyzed_outcome: MockOutcome,
    create_id: CreateId,
    now: Now,
    signed_url_base_url: String,
}
impl Default for MockOptions {
    fn default() -> Self {
        Self {
            api_key: create_mock_api_key(&[]),
            project_id: "mock-project".into(),
            max_retries: 0,
            queued_outcome: MockOutcome::Pending,
            analyzed_outcome: MockOutcome::Allowed,
            create_id: Arc::new(crate::transport::uuid),
            now: Arc::new(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_or(0, |elapsed| elapsed.as_millis() as u64)
            }),
            signed_url_base_url: "https://mock.calmlens.invalid".into(),
        }
    }
}
impl fmt::Debug for MockOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MockOptions")
            .field("project_id", &self.project_id)
            .field("max_retries", &self.max_retries)
            .field("queued_outcome", &self.queued_outcome)
            .field("analyzed_outcome", &self.analyzed_outcome)
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
    /// The outcome of `assets().create` and queued multipart uploads.
    pub fn queued_outcome(mut self, value: MockOutcome) -> Self {
        self.queued_outcome = value;
        self
    }
    /// The outcome of `assets().classify` and `text().classify`. Finished processing removes
    /// the content unless the upload set `keep_content_after_processing`.
    pub fn analyzed_outcome(mut self, value: MockOutcome) -> Self {
        self.analyzed_outcome = value;
        self
    }
    /// Creates asset, folder, lens and event IDs.
    pub fn create_id(mut self, value: impl Fn() -> String + Send + Sync + 'static) -> Self {
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
}
fn fail(code: ErrorCode, message: &str) -> Failure {
    Failure {
        status: code.http_status().unwrap_or(400),
        code: code.as_str().to_owned(),
        message: message.to_owned(),
        details: json!({}),
    }
}
fn custom(code: &str, status: u16, message: &str) -> Failure {
    Failure {
        code: code.to_owned(),
        status,
        message: message.to_owned(),
        details: json!({}),
    }
}
fn invalid(message: &str) -> Failure {
    fail(ErrorCode::InvalidUploadPayload, message)
}
fn unknown_route() -> Failure {
    custom(
        "mock/unknown-route",
        404,
        "The in-memory mock does not emulate this route; enqueue a response for it",
    )
}
impl Failure {
    fn response(&self) -> MockResponse {
        MockResponse::json(
            self.status,
            json!({"code": self.code, "message": self.message, "details": self.details}),
        )
    }
}
type Outcome<T> = std::result::Result<T, Failure>;

struct Upload {
    queue: bool,
    total_size: Option<u64>,
}

pub(super) struct Backend {
    pub(super) storage: MockStorage,
    options: MockOptions,
    uploads: HashMap<String, Upload>,
    lenses: HashMap<String, Value>,
    replays: HashMap<String, (String, MockResponse)>,
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
fn percent_decode(segment: &str) -> String {
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

/// Moves `asset` to `outcome` like the pipeline: a decision completes processing, `purged`
/// removes the content, and completed processing removes content held only temporarily.
fn apply_outcome(
    asset: &mut Value,
    content: &mut HashMap<String, StoredContent>,
    outcome: &str,
    now: u64,
) {
    let decided = outcome != "pending" && outcome != "failed";
    let classification = section(asset, "classification");
    classification.insert(
        "status".into(),
        match outcome {
            "pending" => "processing",
            "failed" => "failed",
            _ => "completed",
        }
        .into(),
    );
    classification.insert("updatedAt".into(), now.into());
    classification.insert(
        "completedAt".into(),
        if decided { now.into() } else { Value::Null },
    );
    let moderation = classification
        .entry("moderation")
        .or_insert_with(|| json!({"manualReviews": []}));
    moderation["status"] = if decided { outcome } else { "pending" }.into();
    let upload = section(asset, "upload");
    upload.insert("status".into(), "completed".into());
    upload.insert("updatedAt".into(), now.into());
    asset["updatedAt"] = now.into();
    if outcome == "purged" {
        remove_content(asset, content, "policy", now);
    } else if decided && asset["content"]["status"] == "temporary" {
        remove_content(asset, content, "retention", now);
    }
}
fn remove_content(
    asset: &mut Value,
    content: &mut HashMap<String, StoredContent>,
    reason: &str,
    now: u64,
) {
    content.remove(text(&asset["id"]));
    let section = section(asset, "content");
    if section.get("status").and_then(Value::as_str) == Some("removed") {
        return;
    }
    section.insert("status".into(), "removed".into());
    section.insert("removalReason".into(), reason.into());
    section.insert("updatedAt".into(), now.into());
    section.insert("extractedText".into(), Value::Null);
}
/// The asset snapshot events carry.
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

impl Backend {
    pub(super) fn new(options: MockOptions) -> Self {
        Self {
            storage: MockStorage::default(),
            options,
            uploads: HashMap::new(),
            lenses: HashMap::new(),
            replays: HashMap::new(),
        }
    }
    pub(super) fn create_id(&self) -> String {
        (self.options.create_id)()
    }
    pub(super) fn now(&self) -> u64 {
        (self.options.now)()
    }
    pub(super) fn project_id(&self) -> &str {
        &self.options.project_id
    }

    /// Records a reviewer decision on a stored asset and adds the matching `asset.<status>` event.
    pub(super) fn decide(&mut self, asset_id: &str, decision: &str) -> Option<Value> {
        let now = self.now();
        let review_id = self.create_id();
        let event_id = self.create_id();
        let project_id = self.options.project_id.clone();
        let storage = &mut self.storage;
        let asset = storage
            .assets
            .get_mut(asset_id)
            .filter(|asset| asset["projectId"] == project_id.as_str())?;
        apply_outcome(asset, &mut storage.content, decision, now);
        let moderation = &mut asset["classification"]["moderation"];
        if !moderation["manualReviews"].is_array() {
            moderation["manualReviews"] = json!([]);
        }
        moderation["manualReviews"]
            .as_array_mut()
            .expect("array")
            .push(json!({
                "id": review_id, "decision": decision, "note": null, "reviewerUserId": null,
                "reviewedAt": now, "appliedToAsset": true,
            }));
        let asset = asset.clone();
        let event_type = format!("asset.{decision}");
        storage.events.push(json!({
            "id": event_id, "projectId": project_id, "userId": null, "type": event_type,
            "severity": "low", "title": event_type, "description": null, "assetId": asset_id,
            "asset": snapshot(&asset), "facts": [{"key": "decided-by", "value": "reviewer"}],
            "notify": false, "createdAt": now, "updatedAt": now, "readAt": null,
        }));
        Some(asset)
    }

    pub(super) fn handle(
        &mut self,
        method: &Method,
        url: &reqwest::Url,
        headers: &HeaderMap,
        raw: &[u8],
    ) -> MockResponse {
        let parts: Vec<String> = url
            .path_segments()
            .into_iter()
            .flatten()
            .skip(1) // the base URLs' `/v1`
            .filter(|part| !part.is_empty())
            .map(percent_decode)
            .collect();
        let mut query = HashMap::new();
        for (key, value) in url.query_pairs().into_owned() {
            query.entry(key).or_insert(value);
        }
        if url.host_str() == Some(CDN_HOST) {
            let response = self.serve(&parts, &query, headers);
            return if method == Method::HEAD {
                response.body(Vec::new())
            } else {
                response
            };
        }
        if header(headers, "x-api-key") != self.options.api_key {
            return fail(ErrorCode::InvalidApiKey, "The API key is invalid").response();
        }
        let content_type = header(headers, "content-type");
        let is_json = content_type == "application/json";
        let key = header(headers, "idempotency-key");
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
        if !key.is_empty() {
            if key.len() > 255 || !key.bytes().all(|byte| (0x20..=0x7e).contains(&byte)) {
                return fail(ErrorCode::InvalidIdempotencyKey, "Invalid Idempotency-Key")
                    .response();
            }
            if let Some((saved, response)) = self.replays.get(key) {
                if *saved != fingerprint {
                    return fail(
                        ErrorCode::IdempotencyKeyReused,
                        "Idempotency-Key used for another request",
                    )
                    .response();
                }
                return response.clone().header("idempotent-replayed", "true");
            }
        }
        let body = if is_json && !raw.is_empty() {
            match serde_json::from_slice::<Value>(raw) {
                Ok(Value::Object(body)) => body,
                _ => return invalid("The body is not a JSON object").response(),
            }
        } else {
            Map::new()
        };
        match self.dispatch(method, &parts, &query, body, raw, headers) {
            Ok(value) => {
                let response = MockResponse::json(200, value);
                if !key.is_empty() {
                    self.replays
                        .insert(key.to_owned(), (fingerprint, response.clone()));
                }
                response
            }
            Err(failure) => failure.response(),
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
                    ("GET", "folders") => Ok(self.list_folders(q)),
                    ("POST", "folders") => self.create_folder(body, now),
                    ("GET", "assets/page") => {
                        let folder = q.get("folderId").cloned();
                        self.page(q, |asset| {
                            folder
                                .as_deref()
                                .is_none_or(|folder| asset["folderId"] == folder)
                        })
                    }
                    ("GET", "assets/search") => self.search(q),
                    ("POST", "assets") => {
                        self.create_asset(header(headers, "x-calmlens-upload"), body, q, raw, now)
                    }
                    _ => Err(unknown_route()),
                }
            }
            [scope, id, suffix @ ..] if scope == "assets" => {
                self.asset_route(method, id, &suffix.join("/"), body, q, raw, now)
            }
            [scope, id, suffix @ ..] if scope == "folders" => {
                self.folder_route(method, id, &suffix.join("/"), body, now)
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
    fn outcome(&self, queue: bool) -> &'static str {
        if queue {
            self.options.queued_outcome.as_str()
        } else {
            self.options.analyzed_outcome.as_str()
        }
    }

    fn list_events(&self, q: &HashMap<String, String>) -> Outcome<Value> {
        let events = &self.storage.events;
        let limit = match q.get("limit") {
            None => 100,
            Some(value) => value
                .parse::<usize>()
                .ok()
                .filter(|limit| (1..=100).contains(limit))
                .ok_or_else(|| invalid("limit must be from 1 to 100"))?,
        };
        // Cursors are `<n>_mock`: the number of events already delivered. Without one, the
        // page is empty and its cursor marks now.
        let start = match q.get("after") {
            None => events.len(),
            Some(after) => after
                .strip_suffix("_mock")
                .and_then(|n| n.parse::<usize>().ok())
                .filter(|n| *n <= events.len())
                .ok_or_else(|| fail(ErrorCode::InvalidEventCursor, "Invalid events cursor"))?,
        };
        let end = (start + limit).min(events.len());
        Ok(json!({
            "events": events[start..end], "cursor": format!("{end}_mock"),
            "hasMore": end < events.len(),
        }))
    }

    fn ensure_lenses(&mut self, body: Map<String, Value>, now: u64) -> Outcome<Value> {
        let mut pending = self.lenses.clone();
        let mut result = Vec::new();
        for mut definition in body
            .get("lenses")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            let identifier = text(&definition["identifier"]).to_owned();
            let old = pending.get(&identifier);
            let same = old.is_some_and(|old| {
                [
                    "name",
                    "description",
                    "type",
                    "active",
                    "transforms",
                    "version",
                ]
                .iter()
                .all(|key| old[key] == definition[key])
            });
            let lens = match old {
                Some(old) if same => old.clone(),
                Some(old) if definition["version"].as_u64() <= old["version"].as_u64() => {
                    return Err(fail(
                        ErrorCode::LensVersionConflict,
                        "Lens updates require a greater version",
                    ))
                }
                _ => {
                    definition["id"] =
                        old.map_or_else(|| self.create_id().into(), |old| old["id"].clone());
                    definition["createdAt"] =
                        old.map_or(now.into(), |old| old["createdAt"].clone());
                    definition["projectId"] = self.options.project_id.clone().into();
                    definition["userId"] = Value::Null;
                    definition["updatedAt"] = now.into();
                    definition
                }
            };
            pending.insert(identifier, lens.clone());
            result.push(lens);
        }
        self.lenses = pending;
        Ok(json!({ "lenses": result }))
    }

    fn list_folders(&self, q: &HashMap<String, String>) -> Value {
        let get = |key: &str| q.get(key).map_or("", String::as_str);
        let search = get("search").to_lowercase();
        let search_all = get("searchAll") == "true" && !search.is_empty();
        let mut folders: Vec<&Value> = self
            .storage
            .folders
            .values()
            .filter(|folder| folder["projectId"] == self.options.project_id.as_str())
            .filter(|folder| search_all || text(&folder["parentId"]) == get("parentId"))
            .filter(|folder| text(&folder["name"]).to_lowercase().contains(&search))
            .collect();
        let key = if get("sort") == "createdAt" {
            "createdAt"
        } else {
            "name"
        };
        folders.sort_by(|a, b| {
            let order = compare(&a[key], &b[key]).then_with(|| compare(&a["id"], &b["id"]));
            if get("direction") == "DESC" {
                order.reverse()
            } else {
                order
            }
        });
        let size = get("pageSize").parse().unwrap_or(100usize).max(1);
        let index = get("pageIndex").parse().unwrap_or(0usize);
        let resolve_only = get("resolveOnly") == "true";
        let page: Vec<&Value> = if resolve_only {
            Vec::new()
        } else {
            folders
                .iter()
                .skip(index * size)
                .take(size)
                .copied()
                .collect()
        };
        // Ancestors: the folders on the paths to the parent, the selected IDs and the page.
        let mut pending: Vec<String> = (0..)
            .map_while(|index| q.get(&format!("ids[{index}]")).cloned())
            .collect();
        pending.push(get("parentId").to_owned());
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
        json!({
            "folders": page, "ancestors": ancestors,
            "hasMore": !resolve_only && folders.len() > (index + 1) * size,
        })
    }

    fn create_folder(&mut self, mut body: Map<String, Value>, now: u64) -> Outcome<Value> {
        let parent = body.get("parentId").cloned().unwrap_or(Value::Null);
        if let Some(parent) = parent.as_str() {
            self.folder(parent)?;
        }
        self.unique(
            &body.get("name").cloned().unwrap_or_default(),
            &parent,
            None,
        )?;
        let id = self.create_id();
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
                let used = self.storage.assets.values().any(|a| a["folderId"] == id)
                    || self.storage.folders.values().any(|f| f["parentId"] == id);
                if used {
                    return Err(fail(ErrorCode::FolderNotEmpty, "Folder is not empty"));
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
                let value = if key == "metadata" || key == "processingOptions" {
                    serde_json::from_str(value)
                        .map_err(|_| invalid("metadata and processingOptions must be JSON"))?
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
        if options.get("name").map_or("", text).is_empty() {
            return Err(invalid("Asset name is required"));
        }
        if let Some(external) = options.get("externalId").and_then(Value::as_str) {
            if self.storage.assets.values().any(|other| {
                other["projectId"] == self.options.project_id.as_str()
                    && other["externalId"] == external
            }) {
                return Err(fail(
                    ErrorCode::DuplicateExternalId,
                    "An asset with this externalId already exists",
                ));
            }
        }
        if let Some(folder) = options.get("folderId").and_then(Value::as_str) {
            self.folder(folder)?;
        }
        let mime = q.get("contentType").map_or("", String::as_str);
        let website = options.contains_key("url");
        let kind = if website {
            "website"
        } else if mime.contains("pdf") || mime.contains("document") {
            "multimedia-document"
        } else if mime.starts_with("text/") {
            "plaintext-document"
        } else {
            ["image", "video", "audio"]
                .into_iter()
                .find(|prefix| mime.starts_with(&format!("{prefix}/")))
                .unwrap_or("file")
        };
        let queue = q.get("queue").is_some_and(|value| value == "true");
        let open = multipart && q.get("isFinal").is_none_or(|value| value != "true");
        let keep = options
            .get("processingOptions")
            .is_some_and(|processing| processing["keepContentAfterProcessing"] == true);
        let id = self.create_id();
        let mut asset = json!({
            "id": id, "projectId": self.options.project_id, "userId": null, "parentId": null,
            "folderId": null, "uploadPresetId": null, "type": kind, "createdAt": now,
            "updatedAt": now, "tags": [], "visibility": "private", "externalId": null,
            "upload": {
                "status": if open { "uploading" } else { "completed" }, "updatedAt": now,
                "partsReceived": if multipart { json!(1) } else { Value::Null },
            },
            "classification": {
                "status": if open { "pending" } else { "processing" }, "updatedAt": now,
                "completedAt": null, "moderation": {"status": "pending", "manualReviews": []},
            },
            "content": {
                "status": if keep { "stored" } else { "temporary" }, "removalReason": null,
                "updatedAt": now, "safetyHold": null, "format": null, "extension": null,
                "sizeInBytes": null, "checksums": null, "image": null, "extractedText": null,
            },
        });
        for key in [
            "name",
            "description",
            "metadata",
            "externalId",
            "externalUrl",
            "processingOptions",
            "folderId",
            "visibility",
            "uploadPresetId",
        ] {
            if let Some(value) = options.get(key) {
                asset[key] = value.clone();
            }
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
        if multipart && open {
            let total_size = match q.get("totalSizeInBytes") {
                None => None,
                Some(total) => Some(
                    total
                        .parse::<u64>()
                        .ok()
                        .filter(|total| *total >= raw.len() as u64)
                        .ok_or_else(|| {
                            fail(
                                ErrorCode::UploadSizeMismatch,
                                "totalSizeInBytes is too small",
                            )
                        })?,
                ),
            };
            self.uploads
                .insert(id.clone(), Upload { queue, total_size });
        }
        if !open {
            let outcome = self.outcome(queue);
            apply_outcome(&mut asset, &mut self.storage.content, outcome, now);
        }
        self.storage.assets.insert(id, asset.clone());
        Ok(asset)
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
        let asset = self
            .owned(&self.storage.assets, id)
            .ok_or_else(|| fail(ErrorCode::AssetNotFound, "Asset not found"))?
            .clone();
        match (method, suffix) {
            ("GET", "") => return Ok(asset),
            ("DELETE", "") => {
                self.storage.assets.remove(id);
                self.storage.content.remove(id);
                self.uploads.remove(id);
                return Ok(json!({}));
            }
            ("GET", "children") => {
                return self.page(q, |child| child["parentId"] == id);
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
                return Ok(json!({"url": url.as_str(), "expiresAt": now + expires * 1000}));
            }
            ("POST", "retry") => {
                if asset["classification"]["status"] != "failed" {
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
            }
            ("POST", "move") => {
                if let Some(folder) = body.get("folderId").and_then(Value::as_str) {
                    self.folder(folder)?;
                }
            }
            ("POST", "part") => self.check_part(&asset, q, raw)?,
            ("PATCH", "") | ("DELETE", "content") => {}
            _ => return Err(unknown_route()),
        }
        let storage = &mut self.storage;
        let stored = storage.assets.get_mut(id).expect("asset");
        match (method, suffix) {
            ("PATCH", _) => {
                for (key, value) in body {
                    stored[key] = value;
                }
            }
            // Like the API: the record and report stay; stored content and extracted text go.
            ("DELETE", _) => remove_content(stored, &mut storage.content, "requested", now),
            // Back to processing, to be moderated again.
            (_, "retry") => apply_outcome(stored, &mut storage.content, "pending", now),
            (_, "move") => {
                stored["folderId"] = body.get("folderId").cloned().unwrap_or(Value::Null)
            }
            _ => {
                let part: u32 = q["partNumber"].parse().unwrap_or(0);
                let parts = &mut storage.content.get_mut(id).expect("content").parts;
                parts.insert(part, raw.to_vec());
                let size: usize = parts.values().map(Vec::len).sum();
                stored["content"]["sizeInBytes"] = size.into();
                stored["upload"]["partsReceived"] = part.into();
                if q.get("isFinal").is_some_and(|value| value == "true") {
                    let upload = self.uploads.remove(id).expect("open upload");
                    let queue = q.get("queue").map_or(upload.queue, |value| value == "true");
                    let outcome = if queue {
                        self.options.queued_outcome
                    } else {
                        self.options.analyzed_outcome
                    };
                    apply_outcome(stored, &mut storage.content, outcome.as_str(), now);
                }
            }
        }
        stored["updatedAt"] = now.into();
        Ok(stored.clone())
    }

    fn check_part(&self, asset: &Value, q: &HashMap<String, String>, raw: &[u8]) -> Outcome<()> {
        let id = text(&asset["id"]);
        let (Some(upload), Some(stored)) = (self.uploads.get(id), self.storage.content.get(id))
        else {
            return Err(fail(ErrorCode::UploadNotOpen, "The upload is not open"));
        };
        if asset["upload"]["status"] != "uploading" {
            return Err(fail(ErrorCode::UploadNotOpen, "The upload is not open"));
        }
        if q.get("sizeInBytes")
            .is_some_and(|size| *size != raw.len().to_string())
        {
            return Err(invalid("sizeInBytes does not match the body"));
        }
        let expected = asset["upload"]["partsReceived"].as_u64().unwrap_or(0) + 1;
        if q.get("partNumber").and_then(|n| n.parse::<u64>().ok()) != Some(expected) {
            let mut failure = fail(ErrorCode::InvalidUploadPartNumber, "Unexpected part number");
            failure.details = json!({ "expectedPartNumber": expected });
            return Err(failure);
        }
        let size = stored.parts.values().map(Vec::len).sum::<usize>() as u64 + raw.len() as u64;
        let is_final = q.get("isFinal").is_some_and(|value| value == "true");
        if upload
            .total_size
            .is_some_and(|total| size > total || (is_final && size != total))
        {
            return Err(fail(
                ErrorCode::UploadSizeMismatch,
                "The parts do not add up to totalSizeInBytes",
            ));
        }
        Ok(())
    }

    /// Project assets accepted by `include`, filtered, ordered and paged like the API.
    fn page(
        &self,
        q: &HashMap<String, String>,
        include: impl Fn(&Value) -> bool,
    ) -> Outcome<Value> {
        let filter = q
            .get("filter")
            .map(|expression| parse_filter(expression))
            .transpose()?;
        let mut ordering = Vec::new();
        while let Some(field) = q.get(&format!("ordering[{}][field]", ordering.len())) {
            let direction = q
                .get(&format!("ordering[{}][direction]", ordering.len()))
                .map_or(String::new(), |d| d.to_uppercase());
            if !["createdAt", "id"].contains(&field.as_str())
                || !["ASC", "DESC"].contains(&direction.as_str())
            {
                return Err(invalid("Ordering must be createdAt or id, ASC or DESC"));
            }
            ordering.push((field.clone(), direction == "ASC"));
        }
        if ordering.is_empty() {
            ordering.push(("createdAt".into(), false));
        }
        if !ordering.iter().any(|(field, _)| field == "id") {
            ordering.push(("id".into(), ordering[0].1));
        }
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
        let mut items: Vec<&Value> = self
            .storage
            .assets
            .values()
            .filter(|asset| asset["projectId"] == self.options.project_id.as_str())
            .filter(|asset| include(asset))
            .filter(|asset| filter.as_ref().is_none_or(|filter| filter.matches(asset)))
            .collect();
        items.sort_by(|a, b| order(a, b));
        if let Some(cursor) = q.get("cursor") {
            let boundary: Value = base64::engine::general_purpose::STANDARD
                .decode(cursor)
                .ok()
                .and_then(|raw| serde_json::from_slice(&raw).ok())
                .filter(|boundary: &Value| {
                    ordering.iter().all(|(field, _)| !boundary[field].is_null())
                })
                .ok_or_else(|| fail(ErrorCode::InvalidCursor, "Invalid cursor"))?;
            items.retain(|item| order(item, &boundary).is_gt());
        }
        let size = match q.get("pageSize").map(|size| size.parse::<usize>()) {
            None => 10,
            Some(Ok(size)) if (1..=100).contains(&size) => size,
            Some(_) => return Err(invalid("pageSize must be from 1 to 100")),
        };
        let has_more = items.len() > size;
        items.truncate(size);
        let next_cursor = match items.last() {
            Some(last) if has_more => {
                let boundary: Map<String, Value> = ordering
                    .iter()
                    .map(|(field, _)| (field.clone(), last[field].clone()))
                    .collect();
                Value::from(
                    base64::engine::general_purpose::STANDARD
                        .encode(serde_json::to_vec(&boundary).expect("json")),
                )
            }
            _ => Value::Null,
        };
        let ordering: Vec<Value> = ordering
            .iter()
            .map(|(field, ascending)| {
                json!({"field": field, "direction": if *ascending { "ASC" } else { "DESC" }})
            })
            .collect();
        Ok(json!({
            "items": items, "nextCursor": next_cursor, "pageSize": size, "ordering": ordering,
            "hasMore": has_more,
        }))
    }

    /// Keyword search: assets whose name, ID, external ID, description or tags contain every
    /// query word. Semantic search is not simulated.
    fn search(&self, q: &HashMap<String, String>) -> Outcome<Value> {
        let query = q.get("query").map_or("", |query| query.trim());
        if query.is_empty() || query.len() > 200 {
            return Err(invalid("query must be 1 to 200 characters"));
        }
        let limit = match q.get("limit").map(|limit| limit.parse::<usize>()) {
            None => 10,
            Some(Ok(limit)) if (1..=20).contains(&limit) => limit,
            Some(_) => return Err(invalid("limit must be from 1 to 20")),
        };
        let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        const FIELDS: [&str; 5] = ["name", "id", "externalId", "description", "tags"];
        let mut matches: Vec<(f64, Vec<&str>, &Value)> = Vec::new();
        for asset in self.storage.assets.values() {
            if asset["projectId"] != self.options.project_id.as_str() {
                continue;
            }
            let values = FIELDS.map(|field| {
                match &asset[field] {
                    Value::Array(tags) => tags.iter().map(display).collect::<Vec<_>>().join(" "),
                    value => display(value),
                }
                .to_lowercase()
            });
            let fields: Vec<&str> = FIELDS
                .iter()
                .zip(&values)
                .filter(|(_, value)| words.iter().any(|word| value.contains(word)))
                .map(|(field, _)| *field)
                .collect();
            if words
                .iter()
                .all(|word| values.iter().any(|value| value.contains(word)))
            {
                matches.push((fields.len() as f64 / FIELDS.len() as f64, fields, asset));
            }
        }
        matches.sort_by(|a, b| {
            b.0.total_cmp(&a.0)
                .then_with(|| compare(&a.2["id"], &b.2["id"]))
        });
        let items: Vec<Value> = matches
            .into_iter()
            .take(limit)
            .map(|(score, fields, asset)| json!({"asset": asset, "score": score, "matchedFields": fields}))
            .collect();
        Ok(json!({"query": query, "items": items, "semanticStatus": "disabled"}))
    }

    /// A CDN request: stored bytes with their content type, refusing blocked and purged
    /// assets, and private or age-restricted ones without the download permission.
    fn serve(
        &self,
        parts: &[String],
        q: &HashMap<String, String>,
        headers: &HeaderMap,
    ) -> MockResponse {
        let not_found =
            || custom(ErrorCode::AssetNotFound.as_str(), 404, "Asset not found").response();
        let [scope, project, identifier, _resource, ..] = parts else {
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
        let status = text(&asset["classification"]["moderation"]["status"]);
        if status == "blocked" || status == "purged" {
            return custom("asset/not-available", 403, "Asset is not available").response();
        }
        let age_restricted = status == "age-restricted";
        let public = asset["visibility"] == "public";
        let restricted =
            !public || (age_restricted && q.get("allowAgeRestricted").is_none_or(|v| v != "true"));
        if restricted && !self.can_download(text(&asset["folderId"]), header(headers, "x-api-key"))
        {
            return custom(
                "asset/api-key-missing-permission",
                403,
                "The API key cannot download this asset",
            )
            .response();
        }
        let stored = self.storage.content.get(text(&asset["id"]));
        let Some(stored) = stored.filter(|_| asset["upload"]["status"] != "uploading") else {
            return custom(
                ErrorCode::AssetContentUnavailable.as_str(),
                404,
                "Asset content not found",
            )
            .response();
        };
        let data = stored.bytes();
        let cache = if restricted || age_restricted {
            "private, no-store"
        } else {
            "public, max-age=31536000"
        };
        let response = MockResponse::new(200)
            .header("content-type", &stored.content_type)
            .header("accept-ranges", "bytes")
            .header("cache-control", cache);
        let range = header(headers, "range").strip_prefix("bytes=");
        let Some(spec) = range.filter(|spec| !spec.contains(',')) else {
            return response.body(data);
        };
        let (start, end) = spec.split_once('-').unwrap_or((spec, ""));
        let last = data.len().saturating_sub(1);
        let start = start.parse::<usize>().ok();
        let end = if end.is_empty() {
            Some(last)
        } else {
            end.parse::<usize>().ok()
        };
        match (start, end) {
            (Some(start), Some(end)) if start <= end && start < data.len() => {
                let end = end.min(last);
                MockResponse {
                    status: 206,
                    ..response
                }
                .header(
                    "content-range",
                    &format!("bytes {start}-{end}/{}", data.len()),
                )
                .body(data[start..=end].to_vec())
            }
            _ => custom("cdn/invalid-range", 416, "Range Not Satisfiable").response(),
        }
    }

    fn can_download(&self, folder: &str, api_key: &str) -> bool {
        let grants: Vec<MockApiKeyGrant> = api_key
            .strip_prefix("sk_test_")
            .and_then(|raw| {
                base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .decode(raw)
                    .ok()
            })
            .and_then(|raw| serde_json::from_slice(&raw).ok())
            .unwrap_or_default();
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

/// An RSQL subset: `;` (and), `,` (or), `==` and `!=` (with `*` wildcards), `=in=`, `=out=`,
/// `=gt=`, `=ge=`, `=lt=`, `=le=` and quoted values. Parentheses only enclose value lists.
struct Filter(Vec<Vec<Comparison>>);
struct Comparison {
    field: String,
    operator: &'static str,
    values: Vec<String>,
}
fn split_top(expression: &str, separator: char) -> Vec<&str> {
    let (mut parts, mut start, mut depth, mut quote) = (Vec::new(), 0, 0i32, None);
    for (index, c) in expression.char_indices() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(c),
            (None, '(') => depth += 1,
            (None, ')') => depth -= 1,
            (None, c) if c == separator && depth == 0 => {
                parts.push(&expression[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }
    parts.push(&expression[start..]);
    parts
}
fn unquote(value: &str) -> String {
    let value = value.trim();
    match value.chars().next() {
        Some(q @ ('"' | '\'')) if value.len() >= 2 && value.ends_with(q) => {
            value[1..value.len() - 1].replace(&format!("\\{q}"), &q.to_string())
        }
        _ => value.to_owned(),
    }
}
fn parse_filter(expression: &str) -> Outcome<Filter> {
    let unsupported = |reason: &str| {
        let mut failure = custom(
            "mock/invalid-filter",
            400,
            "The mock cannot evaluate this filter",
        );
        failure.details = json!({ "filter": expression, "reason": reason });
        failure
    };
    let mut groups = Vec::new();
    for group in split_top(expression, ',') {
        let mut comparisons = Vec::new();
        for term in split_top(group, ';') {
            let term = term.trim();
            let field_end = term
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '_'))
                .unwrap_or(term.len());
            let (field, rest) = term.split_at(field_end);
            let operator = ["==", "!=", "=in=", "=out=", "=gt=", "=ge=", "=lt=", "=le="]
                .into_iter()
                .find(|operator| rest.starts_with(operator))
                .filter(|_| !field.is_empty())
                .ok_or_else(|| unsupported("expected `field<operator>value`"))?;
            let raw = rest[operator.len()..].trim();
            let values = if operator == "=in=" || operator == "=out=" {
                let list = raw
                    .strip_prefix('(')
                    .and_then(|list| list.strip_suffix(')'))
                    .ok_or_else(|| unsupported("=in= and =out= take a (list)"))?;
                split_top(list, ',').into_iter().map(unquote).collect()
            } else if raw.starts_with('(') {
                return Err(unsupported("parentheses only enclose =in= and =out= lists"));
            } else {
                vec![unquote(raw)]
            };
            comparisons.push(Comparison {
                field: field.to_owned(),
                operator,
                values,
            });
        }
        groups.push(comparisons);
    }
    Ok(Filter(groups))
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
impl Filter {
    fn matches(&self, asset: &Value) -> bool {
        self.0.iter().any(|group| {
            group.iter().all(|comparison| {
                let actual = lookup(asset, &comparison.field);
                let texts: Vec<String> = match actual {
                    Value::Array(items) => items.iter().map(display).collect(),
                    value => vec![display(value)],
                };
                let first = &comparison.values[0];
                let number =
                    |op: fn(f64, f64) -> bool| match (actual.as_f64(), first.parse::<f64>()) {
                        (Some(left), Ok(right)) => op(left, right),
                        _ => false,
                    };
                match comparison.operator {
                    "==" => texts.iter().any(|text| wildcard(first, text)),
                    "!=" => !texts.iter().any(|text| wildcard(first, text)),
                    "=in=" => texts.iter().any(|text| comparison.values.contains(text)),
                    "=out=" => !texts.iter().any(|text| comparison.values.contains(text)),
                    "=gt=" => number(|a, b| a > b),
                    "=ge=" => number(|a, b| a >= b),
                    "=lt=" => number(|a, b| a < b),
                    _ => number(|a, b| a <= b),
                }
            })
        })
    }
}
