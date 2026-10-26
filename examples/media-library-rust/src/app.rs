//! Calmlibrary: a private team media library on CalmLens storage and moderation. Folders
//! organise the library, metadata records who shot an image and under which licence,
//! natural-language search finds it, lenses deliver thumbnails and web-size downloads, and
//! lifecycle actions remove a file or the whole asset.
//!
//! [`router`] builds the axum application. One [`Library`] (holding one SDK client in live
//! mode) is created at startup and shared through [`AppState`]. Local state (the activity log
//! and processed webhook IDs) sits behind short-lived `std::sync::Mutex` guards that are never
//! held across an `.await`.
use crate::demo::demo_outcome;
use crate::library::{Delivery, Library, NewUpload, THUMB_LENS, WEB_LENS};
use crate::messages::{
    explain, log_error, rejected, Failure, Notice, GENERIC_FAILURE, LIBRARY_UNAVAILABLE,
};
use crate::page;
use axum::body::Bytes;
use axum::extract::multipart::MultipartRejection;
use axum::extract::rejection::{BytesRejection, QueryRejection};
use axum::extract::{DefaultBodyLimit, FromRequest, Multipart, Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{middleware, Form, Router};
use calmlens::models::{
    Asset, AssetClassificationStatus, AssetContentStatus, AssetModerationStatus, AssetPage,
    AssetSearchResponse, EventFact, Folder, MetadataItem, WebhookEventData, WebhookEventPayload,
};
use calmlens::ErrorCode;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashSet, VecDeque};
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;

pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_FORM_BYTES: usize = MAX_IMAGE_BYTES + 64 * 1024;
pub const MAX_SMALL_FORM_BYTES: usize = 16 * 1024;
pub const MAX_WEBHOOK_BYTES: usize = 1024 * 1024;
/// Every request, including reading its body, must finish within this time.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
pub const MAX_NAME: usize = 100;
pub const MAX_FOLDER_NAME: usize = 60;
pub const MAX_DESCRIPTION: usize = 500;
pub const MAX_META: usize = 80;
pub const MAX_TAGS: usize = 10;
pub const MAX_QUERY: usize = 200;
pub const MAX_CATALOGUE_ID: usize = 64;
const MAX_UPLOAD_FIELDS: usize = 16;
pub const PAGE_SIZE: u32 = 12;
pub const SEARCH_LIMIT: u32 = 20;
const MAX_ACTIVITY: usize = 50;
const MAX_SEEN_EVENTS: usize = 1000;

/// Every asset this app uploads gets `external_id = "calmlibrary:<catalogue ID>"`. The prefix
/// ties CalmLens assets back to the library's own catalogue: events for assets without it were
/// not uploaded through this app and are ignored.
pub const EXTERNAL_ID_PREFIX: &str = "calmlibrary:";

/// Metadata item IDs. Define fields with the same IDs in the portal to filter by them there.
pub const META_PHOTOGRAPHER: &str = "photographer";
pub const META_LICENCE: &str = "licence";
pub const META_CAMPAIGN: &str = "campaign";
pub const LICENCES: [(&str, &str); 4] = [
    ("staff", "Staff photographer"),
    ("licensed-stock", "Licensed stock"),
    ("cc-by-4.0", "CC BY 4.0"),
    ("editorial-only", "Editorial use only"),
];

/// Status filters for the folder listing. Only these fixed values are turned into a filter.
pub const STATUS_FILTERS: [(&str, &str); 8] = [
    ("", "All statuses"),
    ("allowed", "Allowed"),
    ("limited", "Limited"),
    ("pending", "In review"),
    ("age-restricted", "Age-restricted"),
    ("blocked", "Blocked"),
    ("purged", "Purged"),
    ("failed", "Processing failed"),
];
pub const SEARCH_MODES: [(&str, &str); 3] = [
    ("hybrid", "Hybrid"),
    ("keyword", "Keyword"),
    ("semantic", "Semantic"),
];

/// Registered fact keys and labels from packages/shared/src/EventCatalog.ts shown in the activity
/// log. Other keys, such as the hidden `reviewer-user-id`, are not shown.
const FACT_LABELS: [(&str, &str); 7] = [
    ("asset-name", "Asset"),
    ("decided-by", "Decided by"),
    ("previous-status", "Previous status"),
    ("moderation-status", "Moderation status"),
    ("flagged-categories", "Categories"),
    ("reviewer-name", "Reviewer"),
    ("note", "Note"),
];
/// `asset.allowed`, `asset.limited`, `asset.age-restricted`, `asset.blocked` and `asset.purged`
/// report every outcome, from automated moderation or a reviewer; their `decided-by` fact says
/// which.
const EVENT_LABELS: [(&str, &str); 7] = [
    ("asset.classified", "Classified"),
    ("asset.allowed", "Allowed"),
    ("asset.limited", "Limited"),
    ("asset.age-restricted", "Age-restricted"),
    ("asset.blocked", "Blocked"),
    ("asset.purged", "Purged"),
    ("asset.failed", "Processing failed"),
];

#[derive(Clone, Debug)]
pub struct FactRow {
    pub label: &'static str,
    pub value: String,
    pub url: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Activity {
    pub kind: &'static str,
    pub text: String,
    pub facts: Vec<FactRow>,
    pub at: SystemTime,
}

/// Processed webhook event and delivery IDs. A key is claimed while its event is applied, so a
/// concurrent duplicate delivery is not applied twice, and released if applying fails so the
/// retried delivery runs again.
#[derive(Default)]
struct SeenEvents {
    done: HashSet<String>,
    order: VecDeque<String>,
    in_flight: HashSet<String>,
}

/// What a verified webhook did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventOutcome {
    Applied,
    Duplicate,
    TestSend,
    /// Not an asset event this library handles.
    Ignored,
    /// The event's asset was not uploaded by this library, or belongs to another project.
    UnknownAsset,
}

pub struct AppState {
    pub library: Library,
    csrf: String,
    webhook_secret: String,
    activity: Mutex<VecDeque<Activity>>,
    seen: Mutex<SeenEvents>,
}

pub type SharedState = Arc<AppState>;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// What the library page shows, from its query string.
#[derive(Clone, Debug, Default)]
pub struct LibraryQuery {
    /// `None` shows all assets.
    pub folder: Option<String>,
    pub cursor: Option<String>,
    pub status: &'static str,
    pub search: String,
    pub mode: &'static str,
    pub asset: Option<String>,
}

/// The raw query string of the library page. Every field is optional text, validated by
/// [`LibraryQuery::from`].
#[derive(Deserialize, Default)]
#[serde(default)]
struct HomeParams {
    folder: String,
    cursor: String,
    status: String,
    q: String,
    mode: String,
    asset: String,
    notice: String,
}

impl From<&HomeParams> for LibraryQuery {
    fn from(params: &HomeParams) -> Self {
        let pick = |value: &str, options: &[(&'static str, &str)]| {
            options
                .iter()
                .find(|(key, _)| *key == value.trim())
                .map_or(options[0].0, |(key, _)| *key)
        };
        Self {
            folder: Some(params.folder.trim().to_string()).filter(|id| valid_id(id)),
            cursor: Some(params.cursor.clone())
                .filter(|cursor| !cursor.is_empty() && cursor.len() <= 8192),
            status: pick(&params.status, &STATUS_FILTERS),
            search: params.q.trim().chars().take(MAX_QUERY).collect(),
            mode: pick(&params.mode, &SEARCH_MODES),
            asset: Some(params.asset.trim().to_string()).filter(|id| valid_id(id)),
        }
    }
}

/// A notice at the top of the page: fixed app text, plus the error code it explains.
#[derive(Clone, Debug)]
pub struct NoticeText {
    pub message: String,
    pub code: Option<String>,
}

impl NoticeText {
    fn plain(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: None,
        }
    }
}

/// Everything the page renders.
pub(crate) struct View {
    pub query: LibraryQuery,
    pub notice: Option<NoticeText>,
    pub folders: Vec<Folder>,
    pub listing: Option<AssetPage>,
    pub search: Option<AssetSearchResponse>,
    pub selected: Option<Asset>,
    /// True when the library could not be loaded; nothing is shown or delivered.
    pub unavailable: bool,
}

impl View {
    fn unavailable(query: LibraryQuery) -> Self {
        Self {
            query,
            notice: None,
            folders: Vec::new(),
            listing: None,
            search: None,
            selected: None,
            unavailable: true,
        }
    }
}

/// What the page needs from the app besides the view.
pub(crate) struct PageContext {
    pub demo: bool,
    pub csrf: String,
    pub webhooks_enabled: bool,
    pub activity: Vec<Activity>,
}

impl AppState {
    pub fn new(library: Library, webhook_secret: impl Into<String>) -> SharedState {
        Arc::new(Self {
            library,
            csrf: random_hex(32),
            webhook_secret: webhook_secret.into(),
            activity: Mutex::default(),
            seen: Mutex::default(),
        })
    }

    /// The form token embedded in every form on the page.
    pub fn csrf(&self) -> &str {
        &self.csrf
    }

    /// A snapshot of the activity log, newest first.
    pub fn activity(&self) -> Vec<Activity> {
        lock(&self.activity).iter().cloned().collect()
    }

    fn record(&self, kind: &'static str, text: String, facts: Vec<FactRow>) {
        let mut activity = lock(&self.activity);
        activity.push_front(Activity {
            kind,
            text,
            facts,
            at: SystemTime::now(),
        });
        activity.truncate(MAX_ACTIVITY);
    }

    fn token_matches(&self, token: &str) -> bool {
        // Constant-time comparison of equal-length tokens.
        token.len() == self.csrf.len()
            && token
                .bytes()
                .zip(self.csrf.bytes())
                .fold(0u8, |difference, (a, b)| difference | (a ^ b))
                == 0
    }

    // ------------------------------------------------------------ pages

    /// Loads the folder tree, then either search results or one page of the current folder,
    /// and the selected asset.
    async fn view(&self, query: LibraryQuery) -> Result<View, Failure> {
        let folders = self.library.folders().await?;
        let (mut listing, mut search) = (None, None);
        if query.search.is_empty() {
            listing = Some(
                self.library
                    .list(
                        query.folder.as_deref(),
                        query.status,
                        query.cursor.as_deref(),
                        PAGE_SIZE,
                    )
                    .await?,
            );
        } else {
            search = Some(
                self.library
                    .search(&query.search, query.mode, SEARCH_LIMIT)
                    .await?,
            );
        }
        let selected = match &query.asset {
            Some(id) => Some(self.library.retrieve(id).await?),
            None => None,
        };
        Ok(View {
            query,
            notice: None,
            folders,
            listing,
            search,
            selected,
            unavailable: false,
        })
    }

    /// Renders the library page. A library that cannot be loaded shows nothing from it.
    async fn page(
        &self,
        query: LibraryQuery,
        notice: Option<NoticeText>,
        status: StatusCode,
    ) -> Response {
        // An error page keeps its own status even when the library cannot be shown with it.
        let failed = if status == StatusCode::OK {
            StatusCode::BAD_GATEWAY
        } else {
            status
        };
        let (mut view, status) = match self.view(query.clone()).await {
            Ok(view) => (view, status),
            Err(Failure::CalmLens(error))
                if *error.code() == ErrorCode::AssetNotFound && query.asset.is_some() =>
            {
                // The selected asset was deleted; show the folder without it.
                let query = LibraryQuery {
                    asset: None,
                    ..query
                };
                match self.view(query.clone()).await {
                    Ok(view) => (view, status),
                    Err(failure) => {
                        log_failure("Loading the library", &failure);
                        (View::unavailable(query), failed)
                    }
                }
            }
            Err(failure) => {
                log_failure("Loading the library", &failure);
                (View::unavailable(query), failed)
            }
        };
        view.notice = match notice {
            None if view.unavailable => Some(NoticeText::plain(LIBRARY_UNAVAILABLE)),
            notice => notice,
        };
        let pending = view.listing.as_ref().is_some_and(|page| {
            page.items
                .iter()
                .any(|asset| decision(asset) == Decision::Pending)
        });
        let context = PageContext {
            demo: self.library.is_demo(),
            csrf: self.csrf.clone(),
            webhooks_enabled: !self.webhook_secret.is_empty(),
            activity: self.activity(),
        };
        let mut response = (
            status,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            page::render(&context, &view),
        )
            .into_response();
        if pending {
            response
                .headers_mut()
                .insert(header::REFRESH, HeaderValue::from_static("3"));
        }
        response
    }

    /// The page for a failed action. Only fixed messages are shown; CalmLens errors show
    /// their code when the library explains it, and are logged with the request ID.
    async fn failure_page(&self, failure: Failure) -> Response {
        match failure {
            Failure::Rejected(status, message) => {
                self.page(
                    LibraryQuery::default(),
                    Some(NoticeText::plain(message)),
                    status,
                )
                .await
            }
            Failure::CalmLens(error) => {
                log_error("A CalmLens request", &error);
                let notice = match explain(error.code()) {
                    Some(message) => (
                        NoticeText {
                            message: message.into(),
                            code: Some(error.code().as_str().to_string()),
                        },
                        error
                            .status()
                            .and_then(|status| StatusCode::from_u16(status).ok())
                            .unwrap_or(StatusCode::CONFLICT),
                    ),
                    None => (NoticeText::plain(GENERIC_FAILURE), StatusCode::BAD_GATEWAY),
                };
                self.page(LibraryQuery::default(), Some(notice.0), notice.1)
                    .await
            }
        }
    }

    /// Token-checked form posts that end in redirect-after-submit.
    async fn submit(
        &self,
        token: &str,
        action: impl Future<Output = Result<String, Failure>>,
    ) -> Response {
        if !self.token_matches(token) {
            return text(
                StatusCode::FORBIDDEN,
                "Invalid form token. Reload the page.",
            );
        }
        match action.await {
            Ok(location) => redirect(&location),
            Err(failure) => self.failure_page(failure).await,
        }
    }

    // ------------------------------------------------------------ delivery

    /// Thumbnails and downloads. The asset's current state is retrieved first; only an allowed
    /// or limited asset whose file is still stored is delivered, and only through a lens.
    async fn media(&self, id: &str, lens: &str) -> Response {
        if !valid_id(id) {
            return not_found().await;
        }
        let asset = match self.library.retrieve(id).await {
            Ok(asset) => asset,
            Err(Failure::CalmLens(error)) if error.is_not_found() => return not_found().await,
            Err(failure) => {
                log_failure("Checking an asset for delivery", &failure);
                return text(StatusCode::BAD_GATEWAY, "Image unavailable");
            }
        };
        if !deliverable(&asset) {
            return text(
                StatusCode::FORBIDDEN,
                "This image is not allowed or its file was removed",
            );
        }
        match self.library.deliver(&asset, lens).await {
            Ok(Delivery::Redirect(url)) => match HeaderValue::from_str(&url) {
                Ok(location) if safe_url(&url) => {
                    (StatusCode::SEE_OTHER, [(header::LOCATION, location)]).into_response()
                }
                _ => {
                    eprintln!("Calmlibrary: refused an unsafe signed URL for asset {id}");
                    text(StatusCode::BAD_GATEWAY, "Image unavailable")
                }
            },
            Ok(Delivery::Content { bytes, mime }) => {
                let mut response =
                    (StatusCode::OK, [(header::CONTENT_TYPE, mime)], bytes).into_response();
                if lens == WEB_LENS {
                    response.headers_mut().insert(
                        header::CONTENT_DISPOSITION,
                        HeaderValue::from_static("attachment"),
                    );
                }
                response
            }
            Ok(Delivery::Missing) => not_found().await,
            Err(failure) => {
                log_failure("Delivery", &failure);
                text(StatusCode::BAD_GATEWAY, "Image unavailable")
            }
        }
    }

    // ------------------------------------------------------------ review decisions

    /// Applies one verified event once. Duplicate event IDs and delivery IDs are skipped.
    pub async fn apply_event(
        &self,
        payload: &WebhookEventPayload,
        delivery_id: Option<&str>,
    ) -> Result<EventOutcome, Failure> {
        if payload.id.is_empty() {
            return Ok(EventOutcome::Ignored);
        }
        let mut keys = vec![format!("event:{}", payload.id)];
        if let Some(delivery) = delivery_id {
            keys.push(format!("delivery:{delivery}"));
        }
        {
            let mut seen = lock(&self.seen);
            if keys
                .iter()
                .any(|key| seen.done.contains(key) || seen.in_flight.contains(key))
            {
                return Ok(EventOutcome::Duplicate);
            }
            seen.in_flight.extend(keys.iter().cloned());
        }
        let outcome = self.apply_claimed(payload).await;
        let mut seen = lock(&self.seen);
        for key in &keys {
            seen.in_flight.remove(key);
        }
        // A failure leaves the event unseen, so the retried delivery applies it.
        if outcome.is_ok() {
            for key in keys {
                if seen.done.insert(key.clone()) {
                    seen.order.push_back(key);
                }
            }
            while seen.order.len() > MAX_SEEN_EVENTS {
                if let Some(oldest) = seen.order.pop_front() {
                    seen.done.remove(&oldest);
                }
            }
        }
        outcome
    }

    /// Retrieves the asset's current state instead of trusting the event's snapshot, and checks
    /// that it is one of this library's assets.
    async fn apply_claimed(&self, payload: &WebhookEventPayload) -> Result<EventOutcome, Failure> {
        let event_type = payload.event_type.as_str();
        let facts = &payload.data.facts;
        if facts
            .iter()
            .any(|fact| fact.key == "test" && fact.value == Value::Bool(true))
        {
            self.record(
                "test",
                format!(
                    "Test event received ({}). Nothing changed.",
                    event_label(event_type).unwrap_or("unknown event")
                ),
                Vec::new(),
            );
            return Ok(EventOutcome::TestSend);
        }
        let (Some(label), Some(asset_id)) = (
            event_label(event_type),
            payload.data.asset_id.as_deref().filter(|id| valid_id(id)),
        ) else {
            return Ok(EventOutcome::Ignored);
        };
        if payload.project_id != self.library.project_id() {
            self.record_unknown(label);
            return Ok(EventOutcome::UnknownAsset);
        }
        let text = match self.library.retrieve(asset_id).await {
            Ok(asset) if !self.owns(&asset) => {
                self.record_unknown(label);
                return Ok(EventOutcome::UnknownAsset);
            }
            Ok(asset) => format!(
                "{label}: {} is now {}{}.",
                asset.name.as_deref().unwrap_or(asset_id),
                decision(&asset).as_str(),
                if deliverable(&asset) {
                    ""
                } else {
                    " and is not delivered"
                }
            ),
            Err(Failure::CalmLens(error)) if error.is_not_found() => {
                format!("{label}: the asset no longer exists in this project.")
            }
            Err(failure) => return Err(failure),
        };
        self.record("review", text, display_facts(facts));
        Ok(EventOutcome::Applied)
    }

    fn record_unknown(&self, label: &str) {
        self.record(
            "ignored",
            format!("{label}: ignored an event for an asset this library did not upload."),
            Vec::new(),
        );
    }

    /// Whether an asset is one of this library's records: it belongs to this project and its
    /// external ID is a catalogue ID this app issued.
    fn owns(&self, asset: &Asset) -> bool {
        asset
            .project_id
            .as_deref()
            .is_none_or(|project| project == self.library.project_id())
            && catalogue_id(asset).is_some()
    }

    /// Demo only: a simulated reviewer blocking an asset, applied through the same code as a
    /// webhook.
    async fn simulate_blocking(&self, asset_id: &str) -> Result<String, Failure> {
        if !valid_id(asset_id) || !self.library.simulate_blocking(asset_id) {
            return Err(rejected(
                StatusCode::CONFLICT,
                "That asset is no longer in the library.",
            ));
        }
        let fact = |key: &str, value: &str| EventFact {
            key: key.into(),
            value: Value::String(value.into()),
            url: None,
            extra: Default::default(),
        };
        let mut data = WebhookEventData::default();
        data.asset_id = Some(asset_id.into());
        data.facts = vec![
            fact("decided-by", "reviewer"),
            fact("reviewer-user-id", "demo-reviewer"),
            fact("reviewer-name", "Demo reviewer"),
            fact("note", "Simulated portal decision"),
        ];
        let mut payload = WebhookEventPayload::default();
        payload.id = format!("demo-event-{}", random_hex(8));
        payload.event_type = "asset.blocked".into();
        payload.project_id = self.library.project_id().into();
        payload.data = data;
        self.apply_event(&payload, None).await?;
        let folder = self.library.retrieve(asset_id).await?.folder_id;
        Ok(location(
            folder.as_deref(),
            Some(asset_id),
            Notice::ReviewSimulated,
        ))
    }
}

// ------------------------------------------------------------ router

/// The application with the production request timeout.
pub fn router(state: SharedState) -> Router {
    router_with_timeout(state, REQUEST_TIMEOUT)
}

/// The application. Every route has a request body limit, and the whole request, including
/// reading a slow body, must finish within `timeout` (408 otherwise).
pub fn router_with_timeout(state: SharedState, timeout: Duration) -> Router {
    let forms = Router::new()
        .route("/folders", post(create_folder))
        .route("/folders/{id}/rename", post(rename_folder))
        .route("/folders/{id}/move", post(move_folder))
        .route("/folders/{id}/delete", post(delete_folder))
        .route("/assets/{id}/edit", post(edit_asset))
        .route("/assets/{id}/move", post(move_asset))
        .route("/assets/{id}/remove-file", post(remove_file))
        .route("/assets/{id}/delete", post(delete_asset))
        .route("/demo/review", post(demo_review));
    let uploads = Router::new().route("/assets", post(upload));
    let webhooks = Router::new().route("/webhooks/calmlens", post(webhook));
    Router::new()
        .route("/", get(home))
        .route("/assets/{id}/thumb", get(thumbnail))
        .route("/assets/{id}/download", get(download))
        .merge(limited(forms, MAX_SMALL_FORM_BYTES))
        .merge(limited(uploads, MAX_FORM_BYTES))
        .merge(limited(webhooks, MAX_WEBHOOK_BYTES))
        .fallback(not_found)
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            timeout,
        ))
        .layer(middleware::map_response(security_headers))
        .with_state(state)
}

/// Rejects a declared `Content-Length` over `limit` before reading, and stops reading a body
/// that grows past it.
fn limited(router: Router<SharedState>, limit: usize) -> Router<SharedState> {
    router
        .layer(DefaultBodyLimit::max(limit))
        .layer(RequestBodyLimitLayer::new(limit))
}

async fn security_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    for (name, value) in [
        (header::CACHE_CONTROL, "no-store"),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        (header::REFERRER_POLICY, "no-referrer"),
        (
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: http://127.0.0.1:* http://localhost:*; form-action 'self'; frame-ancestors 'none'",
        ),
    ] {
        headers.insert(name, HeaderValue::from_static(value));
    }
    response
}

/// `axum::Form` with fixed error responses instead of the parser's message.
pub struct AppForm<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for AppForm<T> {
    type Rejection = Response;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        match Form::<T>::from_request(request, state).await {
            Ok(Form(value)) => Ok(AppForm(value)),
            Err(rejection) => Err(match rejection.status() {
                StatusCode::UNSUPPORTED_MEDIA_TYPE => {
                    text(StatusCode::UNSUPPORTED_MEDIA_TYPE, "Use a form submission")
                }
                StatusCode::PAYLOAD_TOO_LARGE => body_too_large(),
                _ => text(StatusCode::BAD_REQUEST, "Malformed form"),
            }),
        }
    }
}

// ------------------------------------------------------------ handlers

async fn home(
    State(state): State<SharedState>,
    params: Result<Query<HomeParams>, QueryRejection>,
) -> Response {
    let params = params.map(|Query(params)| params).unwrap_or_default();
    let notice =
        Notice::parse(params.notice.trim()).map(|notice| NoticeText::plain(notice.message()));
    state
        .page(LibraryQuery::from(&params), notice, StatusCode::OK)
        .await
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct FolderForm {
    csrf: String,
    name: String,
    parent: String,
}

async fn create_folder(
    State(state): State<SharedState>,
    AppForm(form): AppForm<FolderForm>,
) -> Response {
    state
        .submit(&form.csrf, async {
            let name = folder_name(&form.name)?;
            let parent = optional_id(&form.parent)?;
            let folder = state
                .library
                .create_folder(&name, parent.as_deref())
                .await?;
            state.record("folder", format!("Created the folder {name}."), Vec::new());
            Ok(location(Some(&folder.id), None, Notice::FolderCreated))
        })
        .await
}

async fn rename_folder(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    AppForm(form): AppForm<FolderForm>,
) -> Response {
    if !valid_id(&id) {
        return not_found().await;
    }
    state
        .submit(&form.csrf, async {
            let name = folder_name(&form.name)?;
            state.library.rename_folder(&id, &name).await?;
            state.record("folder", format!("Renamed a folder to {name}."), Vec::new());
            Ok(location(Some(&id), None, Notice::FolderRenamed))
        })
        .await
}

async fn move_folder(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    AppForm(form): AppForm<FolderForm>,
) -> Response {
    if !valid_id(&id) {
        return not_found().await;
    }
    state
        .submit(&form.csrf, async {
            let parent = optional_id(&form.parent)?;
            state.library.move_folder(&id, parent.as_deref()).await?;
            Ok(location(Some(&id), None, Notice::FolderMoved))
        })
        .await
}

async fn delete_folder(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    AppForm(form): AppForm<FolderForm>,
) -> Response {
    if !valid_id(&id) {
        return not_found().await;
    }
    state
        .submit(&form.csrf, async {
            state.library.delete_folder(&id).await?;
            state.record("folder", "Deleted an empty folder.".into(), Vec::new());
            Ok(location(None, None, Notice::FolderDeleted))
        })
        .await
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct AssetForm {
    csrf: String,
    description: String,
    tags: String,
    photographer: String,
    licence: String,
    campaign: String,
    folder: String,
    confirm: String,
    return_folder: String,
}

async fn edit_asset(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    AppForm(form): AppForm<AssetForm>,
) -> Response {
    if !valid_id(&id) {
        return not_found().await;
    }
    state
        .submit(&form.csrf, async {
            let description = description(&form.description)?;
            let tags: Vec<String> = form
                .tags
                .split(',')
                .map(|tag| tag.trim().to_lowercase())
                .filter(|tag| !tag.is_empty())
                .collect();
            if tags.len() > MAX_TAGS
                || tags
                    .iter()
                    .any(|tag| tag.chars().count() > 30 || tag.chars().any(char::is_control))
            {
                return Err(rejected(
                    StatusCode::BAD_REQUEST,
                    format!("Use at most {MAX_TAGS} comma-separated tags of up to 30 characters."),
                ));
            }
            let metadata = metadata_items(&form.photographer, &form.licence, &form.campaign)?;
            let asset = state
                .library
                .update(&id, description, tags, metadata)
                .await?;
            Ok(location(
                asset.folder_id.as_deref(),
                Some(&id),
                Notice::DetailsSaved,
            ))
        })
        .await
}

async fn move_asset(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    AppForm(form): AppForm<AssetForm>,
) -> Response {
    if !valid_id(&id) {
        return not_found().await;
    }
    state
        .submit(&form.csrf, async {
            let folder = optional_id(&form.folder)?;
            state.library.move_asset(&id, folder.as_deref()).await?;
            Ok(location(folder.as_deref(), Some(&id), Notice::AssetMoved))
        })
        .await
}

/// Removes the stored file. The record, its metadata and classification results stay; the CDN
/// stops serving the content.
async fn remove_file(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    AppForm(form): AppForm<AssetForm>,
) -> Response {
    if !valid_id(&id) {
        return not_found().await;
    }
    state
        .submit(&form.csrf, async {
            if form.confirm != "yes" {
                return Err(rejected(
                    StatusCode::BAD_REQUEST,
                    "Tick the box to confirm removing the file.",
                ));
            }
            let asset = state.library.delete_content(&id).await?;
            state.record(
                "lifecycle",
                format!(
                    "Removed the file of {}. Its record and metadata remain.",
                    asset.name.as_deref().unwrap_or(&id)
                ),
                Vec::new(),
            );
            Ok(location(
                asset.folder_id.as_deref(),
                Some(&id),
                Notice::FileRemoved,
            ))
        })
        .await
}

/// Deletes the asset record and its content.
async fn delete_asset(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    AppForm(form): AppForm<AssetForm>,
) -> Response {
    if !valid_id(&id) {
        return not_found().await;
    }
    state
        .submit(&form.csrf, async {
            if form.confirm != "yes" {
                return Err(rejected(
                    StatusCode::BAD_REQUEST,
                    "Tick the box to confirm deleting the asset.",
                ));
            }
            let folder = optional_id(&form.return_folder)?;
            state.library.delete(&id).await?;
            state.record("lifecycle", "Deleted an asset.".into(), Vec::new());
            Ok(location(folder.as_deref(), None, Notice::AssetDeleted))
        })
        .await
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ReviewForm {
    csrf: String,
    asset: String,
}

async fn demo_review(
    State(state): State<SharedState>,
    AppForm(form): AppForm<ReviewForm>,
) -> Response {
    if !state.library.is_demo() {
        return not_found().await;
    }
    state
        .submit(&form.csrf, state.simulate_blocking(form.asset.trim()))
        .await
}

async fn thumbnail(State(state): State<SharedState>, Path(id): Path<String>) -> Response {
    state.media(&id, THUMB_LENS).await
}

async fn download(State(state): State<SharedState>, Path(id): Path<String>) -> Response {
    state.media(&id, WEB_LENS).await
}

/// The upload form's fields, read from `multipart/form-data`.
#[derive(Default)]
pub(crate) struct UploadFields {
    csrf: String,
    name: String,
    description: String,
    folder: String,
    external_id: String,
    photographer: String,
    licence: String,
    campaign: String,
    demo_outcome: String,
    file_name: Option<String>,
    file: Option<Bytes>,
}

/// The error is the response to send, so it is returned as-is.
#[allow(clippy::result_large_err)]
async fn read_upload(mut multipart: Multipart) -> Result<UploadFields, Response> {
    let malformed = |error: axum::extract::multipart::MultipartError| {
        if error.status() == StatusCode::PAYLOAD_TOO_LARGE || exceeds_body_limit(&error) {
            body_too_large()
        } else {
            text(StatusCode::BAD_REQUEST, "Malformed form")
        }
    };
    let mut fields = UploadFields::default();
    let mut count = 0;
    while let Some(field) = multipart.next_field().await.map_err(malformed)? {
        count += 1;
        if count > MAX_UPLOAD_FIELDS {
            return Err(text(StatusCode::BAD_REQUEST, "Too many form fields"));
        }
        let name = field.name().unwrap_or("").to_string();
        if name == "file" && field.file_name().is_some() {
            fields.file_name = field.file_name().map(str::to_string);
            fields.file = Some(field.bytes().await.map_err(malformed)?);
            continue;
        }
        let slot = match name.as_str() {
            "csrf" => &mut fields.csrf,
            "name" => &mut fields.name,
            "description" => &mut fields.description,
            "folder" => &mut fields.folder,
            "external_id" => &mut fields.external_id,
            "photographer" => &mut fields.photographer,
            "licence" => &mut fields.licence,
            "campaign" => &mut fields.campaign,
            "demo_outcome" => &mut fields.demo_outcome,
            _ => continue,
        };
        *slot = field.text().await.map_err(malformed)?.trim().to_string();
    }
    Ok(fields)
}

/// Whether a body read failed because the request body limit was reached.
fn exceeds_body_limit(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut cause = Some(error);
    while let Some(error) = cause {
        if error.is::<http_body_util::LengthLimitError>() {
            return true;
        }
        cause = error.source();
    }
    false
}

async fn upload(
    State(state): State<SharedState>,
    multipart: Result<Multipart, MultipartRejection>,
) -> Response {
    let Ok(multipart) = multipart else {
        return text(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Use a multipart form submission",
        );
    };
    let fields = match read_upload(multipart).await {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    let csrf = fields.csrf.clone();
    state
        .submit(&csrf, async {
            let upload = prepare_upload(fields, state.library.is_demo())?;
            let folder = upload.folder.clone();
            let name = upload.name.clone();
            let asset = state.library.upload(upload).await?;
            state.record(
                "upload",
                format!("Uploaded {name} privately. It is in review."),
                Vec::new(),
            );
            Ok(location(
                folder.as_deref(),
                Some(&asset.id),
                Notice::Uploaded,
            ))
        })
        .await
}

/// Validates an upload: a sniffed image type, a bounded name and details, a catalogue ID and,
/// in demo mode, an explicitly selected outcome.
fn prepare_upload(fields: UploadFields, demo: bool) -> Result<NewUpload, Failure> {
    let Some(bytes) = fields.file.filter(|bytes| !bytes.is_empty()) else {
        return Err(rejected(
            StatusCode::BAD_REQUEST,
            "Choose an image to upload.",
        ));
    };
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(rejected(
            StatusCode::BAD_REQUEST,
            "The image must be at most 5MiB.",
        ));
    }
    let Some(mime) = image_type(&bytes) else {
        return Err(rejected(
            StatusCode::BAD_REQUEST,
            "Use a JPEG, PNG, GIF, or WebP image.",
        ));
    };
    let name = match fields.name.as_str() {
        "" => file_name(fields.file_name.as_deref()),
        name => name.to_string(),
    };
    if name.chars().count() > MAX_NAME || name.chars().any(char::is_control) {
        return Err(rejected(
            StatusCode::BAD_REQUEST,
            format!("Use a name of at most {MAX_NAME} characters on one line."),
        ));
    }
    let catalogue = match fields.external_id.as_str() {
        "" => format!("img-{}", random_hex(8)),
        id if valid_catalogue_id(id) => id.to_string(),
        _ => {
            return Err(rejected(
                StatusCode::BAD_REQUEST,
                format!(
                    "Use a catalogue ID of at most {MAX_CATALOGUE_ID} letters, digits, '-', '_', '.' or ':'."
                ),
            ))
        }
    };
    let demo_outcome = if demo {
        demo_outcome(&fields.demo_outcome)
            .ok_or_else(|| rejected(StatusCode::BAD_REQUEST, "Choose a demo outcome."))?
    } else {
        Decision::Pending
    };
    Ok(NewUpload {
        name,
        bytes,
        mime,
        folder: optional_id(&fields.folder)?,
        external_id: format!("{EXTERNAL_ID_PREFIX}{catalogue}"),
        description: description(&fields.description)?,
        metadata: metadata_items(&fields.photographer, &fields.licence, &fields.campaign)?,
        demo_outcome,
    })
}

async fn webhook(
    State(state): State<SharedState>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let body = match body {
        Ok(body) => body,
        Err(rejection) if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE => {
            return body_too_large()
        }
        Err(_) => return text(StatusCode::BAD_REQUEST, "Incomplete request body"),
    };
    if state.webhook_secret.is_empty() {
        return text(
            StatusCode::SERVICE_UNAVAILABLE,
            "Set CALMLENS_WEBHOOK_SECRET to enable webhooks.",
        );
    }
    // Verify the exact raw bytes and the timestamp before parsing anything.
    let payload = match calmlens::construct_webhook_event(&body, &headers, &state.webhook_secret) {
        Ok(payload) => payload,
        Err(error) if *error.code() == ErrorCode::InvalidWebhookSignature => {
            return text(StatusCode::UNAUTHORIZED, "Invalid signature")
        }
        Err(_) => return text(StatusCode::BAD_REQUEST, "Invalid event"),
    };
    let delivery = headers
        .get(calmlens::WEBHOOK_DELIVERY_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 200);
    match state.apply_event(&payload, delivery).await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(failure) => {
            // A failed refresh returns an error so CalmLens retries the delivery.
            log_failure("Refreshing an asset for a webhook", &failure);
            text(StatusCode::BAD_GATEWAY, "Could not refresh asset")
        }
    }
}

async fn not_found() -> Response {
    text(StatusCode::NOT_FOUND, "Not found")
}

// ------------------------------------------------------------ helpers

fn log_failure(context: &str, failure: &Failure) {
    match failure {
        Failure::CalmLens(error) => log_error(context, error),
        Failure::Rejected(status, _) => eprintln!("Calmlibrary: {context} was refused ({status})"),
    }
}

fn event_label(event_type: &str) -> Option<&'static str> {
    EVENT_LABELS
        .iter()
        .find(|(key, _)| *key == event_type)
        .map(|(_, label)| *label)
}

/// What the library shows for an asset: its moderation status, or failed processing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Still uploading, processing or waiting for a reviewer.
    Pending,
    /// Delivered.
    Allowed,
    /// Delivered like an allowed asset, marked so apps can reduce its reach. This team library
    /// has no recommendations or feeds, so it shows it like an allowed one.
    Limited,
    /// CalmLens delivers it only through signed URLs or API keys, for an app that checks ages.
    /// This team library has no age check, so it does not deliver it.
    AgeRestricted,
    /// Not delivered; the file is kept.
    Blocked,
    /// Not delivered, and the file was deleted.
    Purged,
    /// Processing failed; there is no decision.
    Failed,
}

impl Decision {
    pub fn as_str(self) -> &'static str {
        match self {
            Decision::Pending => "pending",
            Decision::Allowed => "allowed",
            Decision::Limited => "limited",
            Decision::AgeRestricted => "age-restricted",
            Decision::Blocked => "blocked",
            Decision::Purged => "purged",
            Decision::Failed => "failed",
        }
    }
}

/// The asset's moderation status. Statuses this SDK version does not know count as pending, so
/// they are never delivered.
pub fn decision(asset: &Asset) -> Decision {
    if asset.classification.status == AssetClassificationStatus::Failed {
        return Decision::Failed;
    }
    match asset.classification.moderation.status {
        AssetModerationStatus::Allowed => Decision::Allowed,
        AssetModerationStatus::Limited => Decision::Limited,
        AssetModerationStatus::AgeRestricted => Decision::AgeRestricted,
        AssetModerationStatus::Blocked => Decision::Blocked,
        AssetModerationStatus::Purged => Decision::Purged,
        _ => Decision::Pending,
    }
}

/// Whether the asset's file was removed. The record, metadata and report stay.
pub fn content_removed(asset: &Asset) -> bool {
    asset.content.status == AssetContentStatus::Removed
}

/// Only an explicitly allowed (or limited) asset whose file is still stored is delivered.
pub fn deliverable(asset: &Asset) -> bool {
    matches!(decision(asset), Decision::Allowed | Decision::Limited)
        && asset.content.status == AssetContentStatus::Stored
}

/// The catalogue ID this app issued for an asset, or `None` for an asset it did not upload.
pub fn catalogue_id(asset: &Asset) -> Option<&str> {
    asset
        .external_id
        .as_deref()?
        .strip_prefix(EXTERNAL_ID_PREFIX)
        .filter(|id| valid_catalogue_id(id))
}

fn valid_catalogue_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_CATALOGUE_ID
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b))
}

pub(crate) fn metadata_value<'a>(asset: &'a Asset, id: &str) -> &'a str {
    asset
        .metadata
        .iter()
        .flatten()
        .find(|item| item.id == id)
        .and_then(|item| item.value.as_str())
        .unwrap_or("")
}

fn metadata_items(
    photographer: &str,
    licence: &str,
    campaign: &str,
) -> Result<Vec<MetadataItem>, Failure> {
    let licence = licence.trim();
    if !licence.is_empty() && !LICENCES.iter().any(|(key, _)| *key == licence) {
        return Err(rejected(
            StatusCode::BAD_REQUEST,
            "Choose a licence from the list.",
        ));
    }
    let mut items = Vec::new();
    for (id, value) in [
        (META_PHOTOGRAPHER, photographer),
        (META_LICENCE, licence),
        (META_CAMPAIGN, campaign),
    ] {
        let value = value.trim();
        if value.chars().count() > MAX_META || value.chars().any(char::is_control) {
            return Err(rejected(
                StatusCode::BAD_REQUEST,
                format!("Keep each detail to {MAX_META} characters on one line."),
            ));
        }
        if !value.is_empty() {
            items.push(MetadataItem::new(id, value));
        }
    }
    Ok(items)
}

fn description(value: &str) -> Result<Option<String>, Failure> {
    let value = value.trim();
    if value.chars().count() > MAX_DESCRIPTION {
        return Err(rejected(
            StatusCode::BAD_REQUEST,
            format!("Keep the description to {MAX_DESCRIPTION} characters."),
        ));
    }
    Ok(Some(value.to_string()).filter(|value| !value.is_empty()))
}

fn folder_name(name: &str) -> Result<String, Failure> {
    let name = name.trim();
    if name.is_empty()
        || name.chars().count() > MAX_FOLDER_NAME
        || name.chars().any(|c| c.is_control() || c == '/')
    {
        return Err(rejected(
            StatusCode::BAD_REQUEST,
            format!("Use a folder name of 1 to {MAX_FOLDER_NAME} characters without '/'."),
        ));
    }
    Ok(name.to_string())
}

/// An empty value means the project root; anything else must look like an ID.
fn optional_id(value: &str) -> Result<Option<String>, Failure> {
    match value.trim() {
        "" => Ok(None),
        id if valid_id(id) => Ok(Some(id.to_string())),
        _ => Err(rejected(StatusCode::BAD_REQUEST, "Unknown folder.")),
    }
}

/// IDs travel in paths and query strings, so only plain ID characters are accepted.
pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Registered facts become display rows. Only absolute HTTP(S) URLs become links.
pub(crate) fn display_facts(facts: &[EventFact]) -> Vec<FactRow> {
    facts
        .iter()
        .filter_map(|fact| {
            let label = FACT_LABELS.iter().find(|(key, _)| *key == fact.key)?.1;
            let value = match &fact.value {
                Value::Null => return None,
                Value::String(value) => value.clone(),
                Value::Array(values) => values
                    .iter()
                    .map(|value| {
                        value
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| value.to_string())
                    })
                    .collect::<Vec<_>>()
                    .join(", "),
                other => other.to_string(),
            };
            if value.is_empty() {
                return None;
            }
            let url = fact.url.clone().filter(|url| {
                url::Url::parse(url).is_ok_and(|parsed| {
                    matches!(parsed.scheme(), "http" | "https") && parsed.host().is_some()
                })
            });
            Some(FactRow {
                label,
                value: value.chars().take(200).collect(),
                url,
            })
        })
        .collect()
}

/// Signed URLs must be HTTPS; plain HTTP is allowed only for a local CalmLens on loopback.
pub(crate) fn safe_url(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    matches!(
        (url.scheme(), url.host_str()),
        ("https", Some(_)) | ("http", Some("127.0.0.1" | "localhost"))
    )
}

/// Sniffs the image type from its first bytes; the browser's declared type is not trusted.
pub(crate) fn image_type(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn file_name(name: Option<&str>) -> String {
    let name: String = name
        .unwrap_or("")
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .collect();
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        "image".into()
    } else {
        name.into()
    }
}

/// A query string built from `pairs`, encoded as `application/x-www-form-urlencoded`.
pub(crate) fn href(pairs: &[(&str, &str)]) -> String {
    let mut query = form_urlencoded::Serializer::new(String::new());
    for (key, value) in pairs {
        query.append_pair(key, value);
    }
    format!("/?{}", query.finish())
}

/// A library page location: a folder, a selected asset and a notice identifier.
pub(crate) fn location(folder: Option<&str>, asset: Option<&str>, notice: Notice) -> String {
    let mut pairs = Vec::new();
    if let Some(folder) = folder {
        pairs.push(("folder", folder));
    }
    if let Some(asset) = asset {
        pairs.push(("asset", asset));
    }
    pairs.push(("notice", notice.id()));
    href(&pairs)
}

pub fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::getrandom(&mut buffer).expect("the operating system provides randomness");
    buffer.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn redirect(location: &str) -> Response {
    match HeaderValue::from_str(location) {
        Ok(value) => (StatusCode::SEE_OTHER, [(header::LOCATION, value)]).into_response(),
        Err(_) => text(StatusCode::INTERNAL_SERVER_ERROR, "Invalid redirect"),
    }
}

fn body_too_large() -> Response {
    text(StatusCode::PAYLOAD_TOO_LARGE, "Request body is too large")
}

pub fn text(status: StatusCode, message: &'static str) -> Response {
    (
        status,
        [(
            HeaderName::from_static("content-type"),
            "text/plain; charset=utf-8",
        )],
        format!("{message}\n"),
    )
        .into_response()
}
