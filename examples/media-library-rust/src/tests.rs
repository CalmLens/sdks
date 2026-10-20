use crate::app::{
    router, router_with_timeout, AppState, SharedState, MAX_FORM_BYTES, MAX_IMAGE_BYTES,
    MAX_SMALL_FORM_BYTES, MAX_WEBHOOK_BYTES, PAGE_SIZE,
};
use crate::config::{settings_from_env, StartupError};
use crate::library::{list_filter, Library, SIGNED_URL_SECONDS, THUMB_LENS, WEB_LENS};
use crate::messages::Notice;
use axum::body::Body;
use axum::http::{header, HeaderMap, Request, StatusCode};
use axum::Router;
use calmlens::testing::MockServerClient;
use calmlens::ErrorCode;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tower::ServiceExt;

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89\0\0\0\rIDATx\xdacd\xf8\xcf\x50\x0f\0\x03\x86\x01\x80Z4}k\0\0\0\0IEND\xaeB`\x82";
const SECRET: &str = "a-local-development-secret";

// ------------------------------------------------------------ helpers

struct App {
    state: SharedState,
    router: Router,
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|value| value.to_str().ok())
    }
    fn html(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
    /// A query parameter of the redirect location.
    fn param(&self, name: &str) -> Option<String> {
        let (_, query) = self.header("location")?.split_once('?')?;
        form_urlencoded::parse(query.as_bytes())
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    }
}

fn app(library: Library, secret: &str) -> App {
    let state = AppState::new(library, secret);
    App {
        router: router(state.clone()),
        state,
    }
}

fn demo() -> App {
    app(Library::demo(), "")
}

/// An app that treats the mock as the live API.
fn live(mock: &MockServerClient, secret: &str) -> App {
    app(Library::Live(mock.client()), secret)
}

impl App {
    async fn send(&self, request: Request<Body>) -> Reply {
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let body = response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec();
        Reply {
            status,
            headers,
            body,
        }
    }

    async fn get(&self, path: &str) -> Reply {
        self.send(Request::get(path).body(Body::empty()).unwrap())
            .await
    }

    async fn post(&self, path: &str, form: &str) -> Reply {
        let body = format!("csrf={}&{form}", self.state.csrf());
        self.post_raw(path, &body).await
    }

    async fn post_raw(&self, path: &str, body: &str) -> Reply {
        self.send(
            Request::post(path)
                .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
    }

    async fn upload(&self, fields: &[(&str, &str)], data: &[u8]) -> Reply {
        let token = self.state.csrf().to_string();
        self.upload_with_token(&token, fields, data).await
    }

    async fn upload_with_token(&self, token: &str, fields: &[(&str, &str)], data: &[u8]) -> Reply {
        let boundary = "----calmlibrary-test";
        let mut body = Vec::new();
        for (key, value) in [("csrf", token)].iter().chain(fields) {
            body.extend_from_slice(
                format!(
                    "--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n"
                )
                .as_bytes(),
            );
        }
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"harbour.png\"\r\nContent-Type: image/png\r\n\r\n").as_bytes());
        body.extend_from_slice(data);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        self.send(
            Request::post("/assets")
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
    }

    /// Uploads a demo image with the given outcome and returns its asset ID.
    async fn demo_upload(&self, folder: &str, outcome: &str, photographer: &str) -> String {
        let response = self
            .upload(
                &[
                    ("folder", folder),
                    ("photographer", photographer),
                    ("licence", "staff"),
                    ("campaign", "Spring launch"),
                    ("demo_outcome", outcome),
                ],
                PNG,
            )
            .await;
        assert_eq!(
            response.status,
            StatusCode::SEE_OTHER,
            "{}",
            response.html()
        );
        response
            .param("asset")
            .expect("the redirect selects the new asset")
    }

    async fn create_folder(&self, name: &str, parent: &str) -> String {
        let response = self
            .post("/folders", &format!("name={name}&parent={parent}"))
            .await;
        assert_eq!(
            response.status,
            StatusCode::SEE_OTHER,
            "{}",
            response.html()
        );
        response
            .param("folder")
            .expect("the redirect opens the new folder")
    }

    async fn webhook(&self, body: &[u8], headers: &[(&str, &str)]) -> Reply {
        let mut request = Request::post("/webhooks/calmlens");
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        self.send(request.body(Body::from(body.to_vec())).unwrap())
            .await
    }

    async fn signed_webhook(&self, body: &str, delivery: Option<&str>) -> Reply {
        let timestamp = now();
        let signature = calmlens::create_webhook_signature_header(body, &timestamp, SECRET);
        let mut headers = vec![
            (calmlens::WEBHOOK_TIMESTAMP_HEADER, timestamp.as_str()),
            (calmlens::WEBHOOK_SIGNATURE_HEADER, signature.as_str()),
        ];
        if let Some(delivery) = delivery {
            headers.push((calmlens::WEBHOOK_DELIVERY_HEADER, delivery));
        }
        self.webhook(body.as_bytes(), &headers).await
    }

    fn activity_kinds(&self) -> Vec<&'static str> {
        self.state
            .activity()
            .iter()
            .map(|entry| entry.kind)
            .collect()
    }
}

/// Requests that change something; error pages may also read the library.
fn writes(mock: &MockServerClient) -> Vec<calmlens::testing::Request> {
    mock.requests()
        .into_iter()
        .filter(|request| request.method != "GET")
        .collect()
}

/// An asset uploaded by this library in the mock's project, with its file stored: `approved`,
/// `rejected` or `pending` moderation, or `failed` processing.
fn asset(id: &str, decision: &str) -> Value {
    let (processing, moderation) = match decision {
        "failed" => ("failed", "pending"),
        "pending" => ("processing", "pending"),
        decided => ("done", decided),
    };
    json!({"id": id, "name": format!("{id}.png"), "folderId": "folder-1",
           "projectId": "project-1", "externalId": format!("calmlibrary:{id}"),
           "processing": {"status": processing},
           "moderation": {"status": moderation, "action": null},
           "content": {"status": "stored"}})
}

fn now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string()
}

fn event(id: &str, event_type: &str, asset_id: &str, facts: Value) -> String {
    json!({
        "id": id, "type": event_type, "createdAt": 1_760_000_000_000u64, "projectId": "project-1",
        "data": {"severity": "high", "title": "t", "description": null, "assetId": asset_id,
                 "asset": {"id": asset_id, "processing": {"status": "done"},
                           "moderation": {"status": "approved", "action": null},
                           "content": {"status": "stored"}},
                 "facts": facts}
    })
    .to_string()
}

fn env(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
    move |name: &str| {
        pairs
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.to_string())
    }
}

// ------------------------------------------------------------ startup

#[test]
fn startup_refuses_without_credentials_unless_demo_is_requested() {
    let error = |pairs, flag| settings_from_env(env(pairs), flag).err();
    let demo = |pairs, flag| {
        settings_from_env(env(pairs), flag)
            .ok()
            .map(|settings| settings.library.is_demo())
    };
    assert_eq!(error(&[], false), Some(StartupError::MissingCredentials));
    assert_eq!(
        error(&[("CALMLENS_DEMO", "0")], false),
        Some(StartupError::MissingCredentials)
    );
    assert_eq!(demo(&[("CALMLENS_DEMO", "1")], false), Some(true));
    assert_eq!(demo(&[], true), Some(true));

    // Partial credentials stop startup, with or without a demo request.
    for flag in [false, true] {
        assert_eq!(
            error(&[("CALMLENS_API_KEY", "key")], flag),
            Some(StartupError::PartialCredentials)
        );
        assert_eq!(
            error(&[("CALMLENS_PROJECT_ID", "project")], flag),
            Some(StartupError::PartialCredentials)
        );
    }
    let both: &[(&str, &str)] = &[
        ("CALMLENS_API_KEY", "key"),
        ("CALMLENS_PROJECT_ID", "project"),
    ];
    assert_eq!(demo(both, false), Some(false));
    assert_eq!(error(both, true), Some(StartupError::DemoWithCredentials));
}

// ------------------------------------------------------------ folders

#[tokio::test]
async fn demo_folder_tree_supports_create_rename_move_and_delete() {
    let app = demo();
    let photos = app.create_folder("Photos", "").await;
    let events = app.create_folder("Events", &photos).await;
    assert!(app.get("/").await.html().contains("Photos / Events"));

    let renamed = app
        .post(&format!("/folders/{events}/rename"), "name=Conferences")
        .await;
    assert_eq!(renamed.status, StatusCode::SEE_OTHER);
    assert_eq!(
        renamed.param("notice").as_deref(),
        Some(Notice::FolderRenamed.id())
    );
    assert!(app.get("/").await.html().contains("Photos / Conferences"));

    // Moving the child to the root, then the old parent into it.
    let moved = app
        .post(&format!("/folders/{events}/move"), "parent=")
        .await;
    assert_eq!(moved.status, StatusCode::SEE_OTHER);
    let moved = app
        .post(
            &format!("/folders/{photos}/move"),
            &format!("parent={events}"),
        )
        .await;
    assert_eq!(moved.status, StatusCode::SEE_OTHER);
    assert!(app.get("/").await.html().contains("Conferences / Photos"));

    let deleted = app.post(&format!("/folders/{photos}/delete"), "").await;
    assert_eq!(deleted.status, StatusCode::SEE_OTHER);
    let page = app.get("/").await.html();
    assert!(!page.contains(&format!("folder={photos}")));
    assert!(page.contains(&format!("folder={events}")));
}

#[tokio::test]
async fn demo_folder_errors_surface_their_codes() {
    let app = demo();
    let parent = app.create_folder("Brand", "").await;
    let child = app.create_folder("Logos", &parent).await;

    let cycle = app
        .post(
            &format!("/folders/{parent}/move"),
            &format!("parent={child}"),
        )
        .await;
    assert_eq!(cycle.status, StatusCode::CONFLICT);
    assert!(cycle.html().contains("<code>folder/parent-cycle</code>"));

    let not_empty = app.post(&format!("/folders/{parent}/delete"), "").await;
    assert_eq!(not_empty.status, StatusCode::CONFLICT);
    assert!(not_empty.html().contains("<code>folder/not-empty</code>"));

    let duplicate = app
        .post("/folders", &format!("name=logos&parent={parent}"))
        .await;
    assert_eq!(duplicate.status, StatusCode::CONFLICT);
    assert!(duplicate
        .html()
        .contains("<code>folder/duplicate-name</code>"));

    // A folder that holds an image is not empty either.
    app.demo_upload(&child, "approved", "Ana").await;
    let with_asset = app.post(&format!("/folders/{child}/delete"), "").await;
    assert_eq!(with_asset.status, StatusCode::CONFLICT);
    assert!(with_asset.html().contains("<code>folder/not-empty</code>"));
}

#[tokio::test]
async fn live_folder_calls_use_the_folders_api_and_surface_error_codes() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    mock.enqueue(
        200,
        json!({"id": "folder-2", "name": "Events", "parentId": "folder-1"}),
    );
    let created = app.post("/folders", "name=Events&parent=folder-1").await;
    assert_eq!(created.param("folder").as_deref(), Some("folder-2"));
    let request = mock.last_request().unwrap();
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("POST", "/v1/projects/project-1/folders")
    );
    assert_eq!(
        request.json(),
        Some(json!({"name": "Events", "parentId": "folder-1"}))
    );

    mock.enqueue_api_error(ErrorCode::FolderNotEmpty, "Folder must be empty");
    let response = app.post("/folders/folder-1/delete", "").await;
    assert_eq!(
        writes(&mock)
            .last()
            .map(|r| (r.method.clone(), r.path.clone())),
        Some(("DELETE".into(), "/v1/folders/folder-1".into()))
    );
    assert_eq!(response.status, StatusCode::CONFLICT);
    assert!(response.html().contains("<code>folder/not-empty</code>"));

    mock.enqueue_api_error(ErrorCode::FolderParentCycle, "Cycle");
    let response = app.post("/folders/folder-1/move", "parent=folder-2").await;
    let request = writes(&mock).pop().unwrap();
    assert_eq!(request.path, "/v1/folders/folder-1/move");
    assert_eq!(request.json(), Some(json!({"parentId": "folder-2"})));
    assert_eq!(response.status, StatusCode::CONFLICT);
    assert!(response.html().contains("<code>folder/parent-cycle</code>"));
}

// ------------------------------------------------------------ messages

#[tokio::test]
async fn sdk_error_text_is_never_reflected() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");

    // An explained code shows the code, never the API's message.
    mock.enqueue_api_error(ErrorCode::FolderNotEmpty, "<b>API-DETAIL-17</b>");
    let explained = app.post("/folders/folder-1/delete", "").await;
    assert_eq!(explained.status, StatusCode::CONFLICT);
    assert!(explained.html().contains("<code>folder/not-empty</code>"));
    assert!(!explained.html().contains("API-DETAIL-17"));

    // Any other failure is generic: neither its code nor its message is shown.
    mock.enqueue_api_error(ErrorCode::AssetUpdateFailed, "INTERNAL-TRACE-42");
    let generic = app.post("/assets/asset-1/edit", "description=&tags=").await;
    assert_eq!(generic.status, StatusCode::BAD_GATEWAY);
    assert!(!generic.html().contains("INTERNAL-TRACE-42"));
    assert!(!generic.html().contains("asset/update-failed"));

    mock.enqueue_error(calmlens::Error::new(
        "custom/<script>INJECTED</script>",
        "SERVER-SUPPLIED-TEXT",
    ));
    let unknown = app.post("/folders/folder-1/delete", "").await;
    assert_eq!(unknown.status, StatusCode::BAD_GATEWAY);
    assert!(!unknown.html().contains("INJECTED"));
    assert!(!unknown.html().contains("SERVER-SUPPLIED-TEXT"));
}

#[tokio::test]
async fn notice_parameter_only_accepts_known_identifiers() {
    let app = demo();
    let known = app
        .get(&format!("/?notice={}", Notice::FolderCreated.id()))
        .await
        .html();
    assert!(known.contains(r#"role="status""#));
    assert!(known.contains(Notice::FolderCreated.message()));

    let arbitrary = app
        .get("/?notice=Your+account+is+locked.+Call+0800-ATTACKER")
        .await
        .html();
    assert!(!arbitrary.contains("0800-ATTACKER"));
    assert!(!arbitrary.contains(r#"role="status""#));
}

// ------------------------------------------------------------ uploads

#[tokio::test]
async fn live_upload_sends_folder_metadata_catalogue_id_and_keeps_content() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    mock.enqueue(200, asset("asset-1", "pending"));
    let response = app
        .upload(
            &[
                ("folder", "folder-1"),
                ("name", "Harbour at dawn"),
                ("description", "Boats leaving the harbour"),
                ("external_id", "CAM-2026-014"),
                ("photographer", "Ana Ruiz"),
                ("licence", "cc-by-4.0"),
                ("campaign", "Spring launch"),
                // Ignored in live mode.
                ("demo_outcome", "rejected"),
            ],
            PNG,
        )
        .await;
    assert_eq!(response.status, StatusCode::SEE_OTHER);
    assert_eq!(response.param("asset").as_deref(), Some("asset-1"));
    assert_eq!(
        response.param("notice").as_deref(),
        Some(Notice::Uploaded.id())
    );
    let sent = mock.last_request().unwrap();
    assert_eq!(sent.path, "/v1/projects/project-1/assets");
    assert_eq!(sent.header("x-calmlens-upload"), Some("content"));
    assert_eq!(sent.body, PNG);
    assert_eq!(sent.query_param("folderId"), Some("folder-1"));
    assert_eq!(
        sent.query_param("externalId"),
        Some("calmlibrary:CAM-2026-014")
    );
    assert_eq!(sent.query_param("visibility"), Some("private"));
    assert_eq!(sent.query_param("contentType"), Some("image/png"));
    assert_eq!(sent.query_param("queue"), Some("true"));
    let metadata: Value = serde_json::from_str(sent.query_param("metadata").unwrap()).unwrap();
    assert_eq!(
        metadata,
        json!([
            {"id": "photographer", "value": "Ana Ruiz"},
            {"id": "licence", "value": "cc-by-4.0"},
            {"id": "campaign", "value": "Spring launch"}
        ])
    );
    let processing: Value =
        serde_json::from_str(sent.query_param("processingOptions").unwrap()).unwrap();
    assert_eq!(processing["keepContentAfterProcessing"], json!(true));
}

#[tokio::test]
async fn duplicate_catalogue_ids_surface_their_code() {
    let app = demo();
    let fields = [("external_id", "CAM-1"), ("demo_outcome", "approved")];
    assert_eq!(app.upload(&fields, PNG).await.status, StatusCode::SEE_OTHER);
    let duplicate = app.upload(&fields, PNG).await;
    assert_eq!(duplicate.status, StatusCode::CONFLICT);
    assert!(duplicate
        .html()
        .contains("<code>asset/duplicate-external-id</code>"));
}

#[tokio::test]
async fn invalid_uploads_are_rejected_before_any_request() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    let oversized = [PNG, &vec![0u8; MAX_IMAGE_BYTES]].concat();
    let long_name = "x".repeat(81);
    for (fields, data) in [
        (vec![], b"not an image".as_slice()),
        (vec![], oversized.as_slice()),
        (vec![("licence", "public-domain-ish")], PNG),
        (vec![("external_id", "has spaces")], PNG),
        (vec![("folder", "../etc")], PNG),
        (vec![("photographer", long_name.as_str())], PNG),
    ] {
        let response = app.upload(&fields, data).await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST, "{fields:?}");
    }
    // Error pages may reload the library, but nothing is uploaded.
    assert!(writes(&mock).is_empty());
}

#[tokio::test]
async fn demo_uploads_need_an_explicit_outcome() {
    let app = demo();
    assert_eq!(app.upload(&[], PNG).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        app.upload(&[("demo_outcome", "keyword-guess")], PNG)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(app.state.library.demo_counts(), (0, 0));
}

// ------------------------------------------------------------ listing and search

#[tokio::test]
async fn live_listing_paginates_and_filters_the_folder() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    mock.enqueue(
        200,
        json!({"folders": [{"id": "folder-1", "name": "Photos"}]}),
    );
    mock.enqueue(
        200,
        json!({"items": [asset("asset-1", "approved")], "nextCursor": "next-token",
               "pageSize": PAGE_SIZE, "hasMore": true}),
    );
    let response = app
        .get("/?folder=folder-1&cursor=previous-token&status=approved")
        .await;
    assert_eq!(response.status, StatusCode::OK);
    let list = &mock.requests()[1];
    assert_eq!(list.path, "/v1/projects/project-1/assets/page");
    assert_eq!(list.query_param("folderId"), Some("folder-1"));
    assert_eq!(list.query_param("cursor"), Some("previous-token"));
    assert_eq!(list.query_param("pageSize"), Some("12"));
    assert_eq!(
        list.query_param("filter"),
        Some("parentId==null;moderation.status==approved")
    );
    let page = response.html();
    assert!(page.contains(r#"href="/?cursor=next-token&amp;folder=folder-1&amp;status=approved""#));
    assert!(page.contains(r#"href="/?folder=folder-1&amp;status=approved""#));
    assert!(page.contains(r#"src="/assets/asset-1/thumb""#));
}

#[tokio::test]
async fn listing_filters_only_accept_known_statuses() {
    assert_eq!(list_filter(""), "parentId==null");
    // A failed upload has no decision, so it is listed under "failed", never "pending".
    assert_eq!(
        list_filter("failed"),
        "parentId==null;processing.status==failed"
    );
    assert_eq!(
        list_filter("pending"),
        "parentId==null;moderation.status==pending;processing.status!=failed"
    );
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    mock.enqueue(200, json!({"folders": []}));
    mock.enqueue(200, json!({"items": [], "total": 0}));
    app.get("/?status=approved,status==rejected").await;
    assert_eq!(
        mock.requests()[1].query_param("filter"),
        Some("parentId==null")
    );
}

#[tokio::test]
async fn live_search_sends_the_query_and_shows_matched_fields_and_semantic_status() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    mock.enqueue(200, json!({"folders": []}));
    mock.enqueue(
        200,
        json!({"query": "cyclists at sunrise", "semanticStatus": "indexing", "items": [
            {"asset": asset("asset-7", "approved"), "score": 0.82, "matchedFields": ["visual"]}
        ]}),
    );
    let page = app
        .get("/?q=cyclists+at+sunrise&mode=semantic")
        .await
        .html();
    let search = &mock.requests()[1];
    assert_eq!(search.path, "/v1/projects/project-1/assets/search");
    assert_eq!(search.query_param("query"), Some("cyclists at sunrise"));
    assert_eq!(search.query_param("mode"), Some("semantic"));
    assert_eq!(search.query_param("limit"), Some("20"));
    assert!(page.contains(r#"data-semantic-status="indexing""#));
    assert!(page.contains(r#"data-matched-fields="visual""#));
    assert!(page.contains(r#"src="/assets/asset-7/thumb""#));

    // An unknown mode falls back to hybrid.
    mock.enqueue(200, json!({"folders": []}));
    mock.enqueue(
        200,
        json!({"query": "x", "semanticStatus": "ready", "items": []}),
    );
    app.get("/?q=boats&mode=everything").await;
    assert_eq!(mock.requests()[3].query_param("mode"), Some("hybrid"));
}

#[tokio::test]
async fn demo_search_matches_only_approved_stored_images() {
    let app = demo();
    let approved = app.demo_upload("", "approved", "Ana Ruiz").await;
    let rejected = app.demo_upload("", "rejected", "Ana Ruiz").await;
    let removed = app.demo_upload("", "approved", "Ana Ruiz").await;
    app.state.library.expire_demo_reviews();
    app.post(&format!("/assets/{removed}/remove-file"), "confirm=yes")
        .await;

    let page = app.get("/?q=ruiz&mode=hybrid").await.html();
    assert!(page.contains(r#"data-semantic-status="disabled""#));
    assert!(page.contains(&format!("asset={approved}")));
    assert!(page.contains(r#"data-matched-fields="metadata""#));
    assert!(!page.contains(&format!("asset={rejected}")));
    assert!(!page.contains(&format!("asset={removed}")));

    // There is no semantic matching offline.
    let semantic = app.get("/?q=ruiz&mode=semantic").await.html();
    assert!(!semantic.contains(&format!("asset={approved}")));
}

// ------------------------------------------------------------ delivery

#[tokio::test]
async fn demo_thumbnails_appear_only_for_approved_images() {
    for outcome in ["approved", "rejected", "failed"] {
        let app = demo();
        let id = app.demo_upload("", outcome, "Ana").await;
        let pending = app.get("/").await;
        assert_eq!(pending.header("refresh"), Some("3"), "{outcome}");
        assert!(!pending.html().contains(&format!("/assets/{id}/thumb")));
        assert_eq!(
            app.get(&format!("/assets/{id}/thumb")).await.status,
            StatusCode::FORBIDDEN
        );

        app.state.library.expire_demo_reviews();
        let page = app.get("/").await.html();
        let thumb = app.get(&format!("/assets/{id}/thumb")).await;
        let download = app.get(&format!("/assets/{id}/download")).await;
        if outcome == "approved" {
            assert!(page.contains(&format!("/assets/{id}/thumb")));
            assert_eq!(thumb.status, StatusCode::OK);
            assert_eq!(thumb.body, PNG);
            assert_eq!(download.status, StatusCode::OK);
            assert_eq!(download.header("content-disposition"), Some("attachment"));
        } else {
            assert!(!page.contains(&format!("/assets/{id}/thumb")), "{outcome}");
            assert_eq!(thumb.status, StatusCode::FORBIDDEN, "{outcome}");
            assert_eq!(download.status, StatusCode::FORBIDDEN, "{outcome}");
        }
    }
}

#[tokio::test]
async fn live_delivery_uses_lenses_and_short_lived_signed_urls() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    let lens_reply =
        |identifier: &str| json!({"lenses": [{"identifier": identifier, "version": 1}]});
    mock.enqueue(200, asset("asset-1", "approved"));
    mock.enqueue(200, lens_reply(THUMB_LENS));
    mock.enqueue(200, json!({"url": "https://cdn.example.com/signed-thumb"}));
    let thumb = app.get("/assets/asset-1/thumb").await;
    assert_eq!(thumb.status, StatusCode::SEE_OTHER);
    assert_eq!(
        thumb.header("location"),
        Some("https://cdn.example.com/signed-thumb")
    );
    let requests = mock.requests();
    assert_eq!(requests[0].path, "/v1/assets/asset-1");
    assert_eq!(
        (requests[1].method.as_str(), requests[1].path.as_str()),
        ("PUT", "/v1/projects/project-1/lenses")
    );
    let lens = &requests[1].json().unwrap()["lenses"][0];
    assert_eq!(lens["identifier"], THUMB_LENS);
    assert_eq!(lens["transforms"][0]["options"]["width"], 320);
    let body = requests[2].json().unwrap();
    assert_eq!(requests[2].path, "/v1/assets/asset-1/signed-url");
    assert_eq!(body["lens"], THUMB_LENS);
    assert_eq!(body["expiresInSeconds"], SIGNED_URL_SECONDS);
    assert_eq!(body["resource"], "content");

    // Downloads use the 1600px web lens.
    mock.enqueue(200, asset("asset-1", "approved"));
    mock.enqueue(200, lens_reply(WEB_LENS));
    mock.enqueue(200, json!({"url": "https://cdn.example.com/signed-web"}));
    let download = app.get("/assets/asset-1/download").await;
    assert_eq!(download.status, StatusCode::SEE_OTHER);
    let requests = mock.requests();
    assert_eq!(
        requests[4].json().unwrap()["lenses"][0]["transforms"][0]["options"]["width"],
        1600
    );
    assert_eq!(requests[5].json().unwrap()["lens"], WEB_LENS);

    // The shared client caches ensured lenses, so a second thumbnail only signs.
    mock.enqueue(200, asset("asset-1", "approved"));
    mock.enqueue(
        200,
        json!({"url": "https://cdn.example.com/signed-thumb-2"}),
    );
    assert_eq!(
        app.get("/assets/asset-1/thumb").await.status,
        StatusCode::SEE_OTHER
    );
    assert_eq!(mock.requests().len(), 8);
}

#[tokio::test]
async fn unapproved_or_unsafe_delivery_never_signs() {
    for status in ["pending", "rejected", "failed"] {
        let mock = MockServerClient::new().unwrap();
        let app = live(&mock, "");
        mock.enqueue(200, asset("asset-1", status));
        assert_eq!(
            app.get("/assets/asset-1/thumb").await.status,
            StatusCode::FORBIDDEN
        );
        assert_eq!(mock.requests().len(), 1, "{status}");
    }
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    mock.enqueue_transport_error("connection refused");
    assert_eq!(
        app.get("/assets/asset-1/thumb").await.status,
        StatusCode::BAD_GATEWAY
    );
    assert_eq!(mock.requests().len(), 1);

    mock.enqueue(200, asset("asset-1", "approved"));
    mock.enqueue(200, json!({"lenses": [{"identifier": THUMB_LENS}]}));
    mock.enqueue(200, json!({"url": "javascript:alert(1)"}));
    let unsafe_url = app.get("/assets/asset-1/thumb").await;
    assert_eq!(unsafe_url.status, StatusCode::BAD_GATEWAY);
    assert_eq!(unsafe_url.header("location"), None);
}

// ------------------------------------------------------------ edits and moves

#[tokio::test]
async fn live_edit_and_move_send_the_asset_changes() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    mock.enqueue(200, asset("asset-1", "approved"));
    let response = app
        .post(
            "/assets/asset-1/edit",
            "description=&tags=Boats,+Harbour&photographer=Ana&licence=staff&campaign=",
        )
        .await;
    assert_eq!(response.status, StatusCode::SEE_OTHER);
    let request = mock.last_request().unwrap();
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("PATCH", "/v1/assets/asset-1")
    );
    assert_eq!(
        request.json(),
        Some(json!({
            "description": null,
            "tags": ["boats", "harbour"],
            "metadata": [{"id": "photographer", "value": "Ana"}, {"id": "licence", "value": "staff"}]
        }))
    );

    mock.enqueue(200, asset("asset-1", "approved"));
    let moved = app.post("/assets/asset-1/move", "folder=folder-2").await;
    assert_eq!(moved.param("folder").as_deref(), Some("folder-2"));
    let request = mock.last_request().unwrap();
    assert_eq!(request.path, "/v1/assets/asset-1/move");
    assert_eq!(request.json(), Some(json!({"folderId": "folder-2"})));

    mock.enqueue(200, asset("asset-1", "approved"));
    app.post("/assets/asset-1/move", "folder=").await;
    assert_eq!(
        mock.last_request().unwrap().json(),
        Some(json!({"folderId": null}))
    );
}

#[tokio::test]
async fn demo_moves_change_which_folder_lists_the_image() {
    let app = demo();
    let first = app.create_folder("First", "").await;
    let second = app.create_folder("Second", "").await;
    let id = app.demo_upload(&first, "approved", "Ana").await;
    let listed = |page: String| page.contains(&format!("asset={id}"));
    assert!(listed(app.get(&format!("/?folder={first}")).await.html()));
    app.post(&format!("/assets/{id}/move"), &format!("folder={second}"))
        .await;
    assert!(!listed(app.get(&format!("/?folder={first}")).await.html()));
    assert!(listed(app.get(&format!("/?folder={second}")).await.html()));
}

// ------------------------------------------------------------ lifecycle

#[tokio::test]
async fn removing_the_file_stops_thumbnails_and_keeps_the_record() {
    let app = demo();
    let id = app.demo_upload("", "approved", "Ana Ruiz").await;
    app.state.library.expire_demo_reviews();
    let thumb = format!("/assets/{id}/thumb");
    assert_eq!(app.get(&thumb).await.status, StatusCode::OK);

    let unconfirmed = app.post(&format!("/assets/{id}/remove-file"), "").await;
    assert_eq!(unconfirmed.status, StatusCode::BAD_REQUEST);
    assert_eq!(app.get(&thumb).await.status, StatusCode::OK);

    let removed = app
        .post(&format!("/assets/{id}/remove-file"), "confirm=yes")
        .await;
    assert_eq!(removed.status, StatusCode::SEE_OTHER);
    assert_eq!(app.get(&thumb).await.status, StatusCode::FORBIDDEN);
    assert_eq!(
        app.get(&format!("/assets/{id}/download")).await.status,
        StatusCode::FORBIDDEN
    );
    let record = app.state.library.retrieve(&id).await.unwrap();
    assert_eq!(
        record.content.status,
        calmlens::models::AssetContentStatus::Removed
    );
    assert_eq!(
        record.moderation.status,
        calmlens::models::AssetModerationStatus::Approved
    );
    assert_eq!(
        crate::app::metadata_value(&record, "photographer"),
        "Ana Ruiz"
    );
    let page = app.get(&format!("/?asset={id}")).await.html();
    assert!(page.contains("Ana Ruiz"));
    assert!(!page.contains(&thumb));
}

#[tokio::test]
async fn live_remove_file_calls_delete_content() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    let mut removed = asset("asset-1", "approved");
    removed["content"] = json!({"status": "removed", "removalReason": "requested"});
    mock.enqueue(200, removed.clone());
    assert_eq!(
        app.post("/assets/asset-1/remove-file", "confirm=yes")
            .await
            .status,
        StatusCode::SEE_OTHER
    );
    let request = mock.last_request().unwrap();
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("DELETE", "/v1/assets/asset-1/content")
    );
    // Afterwards the retrieved record is never delivered.
    mock.enqueue(200, removed);
    assert_eq!(
        app.get("/assets/asset-1/thumb").await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(mock.requests().len(), 2);
}

#[tokio::test]
async fn deleting_removes_the_asset() {
    let app = demo();
    let folder = app.create_folder("Archive", "").await;
    let id = app.demo_upload(&folder, "approved", "Ana").await;
    assert_eq!(
        app.post(&format!("/assets/{id}/delete"), "").await.status,
        StatusCode::BAD_REQUEST
    );
    let deleted = app
        .post(
            &format!("/assets/{id}/delete"),
            &format!("confirm=yes&return_folder={folder}"),
        )
        .await;
    assert_eq!(deleted.param("folder").as_deref(), Some(folder.as_str()));
    match app.state.library.retrieve(&id).await {
        Err(crate::messages::Failure::CalmLens(error)) => {
            assert_eq!(*error.code(), ErrorCode::AssetNotFound)
        }
        other => panic!("expected asset/not-found, got {other:?}"),
    }
    assert_eq!(
        app.get(&format!("/assets/{id}/thumb")).await.status,
        StatusCode::NOT_FOUND
    );
    // The folder is empty again, so it can be deleted.
    assert_eq!(
        app.post(&format!("/folders/{folder}/delete"), "")
            .await
            .status,
        StatusCode::SEE_OTHER
    );

    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    mock.enqueue_response(calmlens::testing::MockResponse::new(204));
    assert_eq!(
        app.post("/assets/asset-1/delete", "confirm=yes")
            .await
            .status,
        StatusCode::SEE_OTHER
    );
    let request = mock.last_request().unwrap();
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("DELETE", "/v1/assets/asset-1")
    );
}

// ------------------------------------------------------------ review decisions

#[tokio::test]
async fn simulated_reviewer_rejection_stops_delivery() {
    let app = demo();
    let id = app.demo_upload("", "approved", "Ana").await;
    app.state.library.expire_demo_reviews();
    let thumb = format!("/assets/{id}/thumb");
    assert_eq!(app.get(&thumb).await.status, StatusCode::OK);
    let review = app.post("/demo/review", &format!("asset={id}")).await;
    assert_eq!(review.status, StatusCode::SEE_OTHER);
    assert_eq!(app.get(&thumb).await.status, StatusCode::FORBIDDEN);
    let activity = app.state.activity();
    assert_eq!(activity[0].kind, "review");
    assert!(activity[0]
        .facts
        .iter()
        .any(|fact| fact.label == "Reviewer" && fact.value == "Demo reviewer"));
    assert_eq!(
        app.post("/demo/review", "asset=missing").await.status,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn simulated_review_is_not_available_live() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    assert_eq!(
        app.post("/demo/review", "asset=asset-1").await.status,
        StatusCode::NOT_FOUND
    );
    assert!(mock.requests().is_empty());
}

#[tokio::test]
async fn webhooks_need_a_secret() {
    let app = demo();
    let body = event("event-1", "asset.rejected", "asset-1", json!([]));
    assert_eq!(
        app.webhook(body.as_bytes(), &[]).await.status,
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[tokio::test]
async fn webhook_rejects_forged_tampered_and_stale_deliveries() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, SECRET);
    let body = event("event-1", "asset.rejected", "asset-1", json!([]));
    let timestamp = now();
    let signature = calmlens::create_webhook_signature_header(&body, &timestamp, SECRET);
    let ts = calmlens::WEBHOOK_TIMESTAMP_HEADER;
    let sig = calmlens::WEBHOOK_SIGNATURE_HEADER;
    assert_eq!(
        app.webhook(body.as_bytes(), &[(ts, &timestamp)])
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    let forged = calmlens::create_webhook_signature_header(&body, &timestamp, "wrong");
    assert_eq!(
        app.webhook(body.as_bytes(), &[(ts, &timestamp), (sig, &forged)])
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    let tampered = body.replace("asset.rejected", "asset.approved");
    assert_eq!(
        app.webhook(tampered.as_bytes(), &[(ts, &timestamp), (sig, &signature)])
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    let stale = "1000";
    let old = calmlens::create_webhook_signature_header(&body, stale, SECRET);
    assert_eq!(
        app.webhook(body.as_bytes(), &[(ts, stale), (sig, &old)])
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    // A correctly signed body that is not an event is a bad request.
    let junk = "not json";
    let junk_signature = calmlens::create_webhook_signature_header(junk, &timestamp, SECRET);
    assert_eq!(
        app.webhook(junk.as_bytes(), &[(ts, &timestamp), (sig, &junk_signature)])
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    assert!(mock.requests().is_empty());
    assert!(app.state.activity().is_empty());
}

#[tokio::test]
async fn verified_webhook_refreshes_from_the_api_and_ignores_replays_and_tests() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, SECRET);
    let body = event(
        "event-1",
        "asset.rejected",
        "asset-1",
        json!([
            {"key": "reviewer-user-id", "value": "user-9"},
            {"key": "reviewer-name", "value": "Sam"},
            {"key": "note", "value": "Not licensed"}
        ]),
    );
    // A failed refresh asks CalmLens to retry the delivery.
    mock.enqueue_transport_error("connection reset");
    assert_eq!(
        app.signed_webhook(&body, Some("delivery-1")).await.status,
        StatusCode::BAD_GATEWAY
    );
    assert!(app.state.activity().is_empty());

    // The retry is applied.
    mock.enqueue(200, asset("asset-1", "rejected"));
    assert_eq!(
        app.signed_webhook(&body, Some("delivery-1")).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(mock.requests()[1].path, "/v1/assets/asset-1");
    let activity = app.state.activity();
    assert_eq!(activity[0].kind, "review");
    let labels: Vec<&str> = activity[0].facts.iter().map(|f| f.label).collect();
    assert_eq!(labels, ["Reviewer", "Note"]);

    // A replay of the event, or of the delivery under another event ID, changes nothing and
    // makes no request.
    assert_eq!(
        app.signed_webhook(&body, None).await.status,
        StatusCode::NO_CONTENT
    );
    let same_delivery = event("event-9", "asset.approved", "asset-1", json!([]));
    assert_eq!(
        app.signed_webhook(&same_delivery, Some("delivery-1"))
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(mock.requests().len(), 2);
    assert_eq!(app.activity_kinds(), ["review"]);

    let test_send = event(
        "event-2",
        "asset.rejected",
        "asset-1",
        json!([{"key": "test", "value": true}]),
    );
    assert_eq!(
        app.signed_webhook(&test_send, None).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(mock.requests().len(), 2);
    assert_eq!(app.activity_kinds(), ["test", "review"]);
}

#[tokio::test]
async fn webhooks_for_assets_the_library_did_not_upload_are_ignored() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, SECRET);
    // An asset in the project without this library's catalogue ID.
    mock.enqueue(
        200,
        json!({"id": "asset-2", "processing": {"status": "done"},
               "moderation": {"status": "rejected", "action": "hide"},
               "projectId": "project-1", "externalId": "crm-4411"}),
    );
    let body = event("event-1", "asset.rejected", "asset-2", json!([]));
    assert_eq!(
        app.signed_webhook(&body, None).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(mock.requests()[0].path, "/v1/assets/asset-2");

    // An event from another project is ignored without a request.
    let other = event("event-2", "asset.rejected", "asset-1", json!([])).replace(
        r#""projectId":"project-1""#,
        r#""projectId":"project-other""#,
    );
    assert_eq!(
        app.signed_webhook(&other, None).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(mock.requests().len(), 1);
    assert_eq!(app.activity_kinds(), ["ignored", "ignored"]);
}

#[tokio::test]
async fn demo_webhook_refreshes_from_the_demo_library() {
    let app = app(Library::demo(), SECRET);
    let id = app.demo_upload("", "approved", "Ana").await;
    app.state.library.expire_demo_reviews();
    let body = event(
        "event-1",
        "asset.approved",
        &id,
        json!([{"key": "decided-by", "value": "automated"}]),
    )
    .replace(
        r#""projectId":"project-1""#,
        &format!(r#""projectId":"{}""#, crate::library::DEMO_PROJECT_ID),
    );
    assert_eq!(
        app.signed_webhook(&body, None).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(app.activity_kinds()[0], "review");
}

// ------------------------------------------------------------ forms, limits, headers

#[tokio::test]
async fn forms_need_the_page_token() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    assert_eq!(
        app.post_raw("/folders", "name=Photos").await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.post_raw("/assets/asset-1/delete", "csrf=wrong&confirm=yes")
            .await
            .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.upload_with_token("wrong", &[], PNG).await.status,
        StatusCode::FORBIDDEN
    );
    assert!(mock.requests().is_empty());
}

#[tokio::test]
async fn rejects_invalid_form_requests() {
    let app = demo();
    let long_name = app
        .post("/folders", &format!("name={}", "a".repeat(61)))
        .await;
    assert_eq!(long_name.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        app.post("/folders", "name=a%2Fb").await.status,
        StatusCode::BAD_REQUEST
    );
    let json = app
        .send(
            Request::post("/folders")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;
    assert_eq!(json.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    let not_multipart = app
        .send(
            Request::post("/assets")
                .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body(Body::from("csrf=x"))
                .unwrap(),
        )
        .await;
    assert_eq!(not_multipart.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(app.state.library.demo_counts(), (0, 0));
    assert_eq!(
        app.get("/assets/..%2F/thumb").await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.get("/folders").await.status,
        StatusCode::METHOD_NOT_ALLOWED
    );
}

#[tokio::test]
async fn oversized_bodies_get_413() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, SECRET);
    let form = format!(
        "csrf={}&name={}",
        app.state.csrf(),
        "a".repeat(MAX_SMALL_FORM_BYTES)
    );
    // With a declared length, and streamed without one.
    let declared = app
        .send(
            Request::post("/folders")
                .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
                .header(header::CONTENT_LENGTH, form.len())
                .body(Body::from(form.clone()))
                .unwrap(),
        )
        .await;
    assert_eq!(declared.status, StatusCode::PAYLOAD_TOO_LARGE);
    let streamed = app.post_raw("/folders", &form).await;
    assert_eq!(streamed.status, StatusCode::PAYLOAD_TOO_LARGE);

    let upload = app
        .upload(&[], &[PNG, &vec![0u8; MAX_FORM_BYTES]].concat())
        .await;
    assert_eq!(
        upload.status,
        StatusCode::PAYLOAD_TOO_LARGE,
        "{}",
        upload.html()
    );

    let hook = app.webhook(&vec![b' '; MAX_WEBHOOK_BYTES + 1], &[]).await;
    assert_eq!(hook.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(mock.requests().is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_stalled_request_body_times_out() {
    let state = AppState::new(Library::demo(), "");
    let app = App {
        router: router_with_timeout(state.clone(), Duration::from_secs(5)),
        state,
    };
    let never = futures_util::stream::pending::<Result<Vec<u8>, std::io::Error>>();
    let response = app
        .send(
            Request::post("/folders")
                .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body(Body::from_stream(never))
                .unwrap(),
        )
        .await;
    assert_eq!(response.status, StatusCode::REQUEST_TIMEOUT);
    assert_eq!(app.state.library.demo_counts(), (0, 0));
}

#[tokio::test]
async fn responses_carry_security_headers() {
    let app = demo();
    for response in [app.get("/").await, app.get("/missing").await] {
        assert_eq!(response.header("x-content-type-options"), Some("nosniff"));
        assert_eq!(response.header("cache-control"), Some("no-store"));
        assert!(response
            .header("content-security-policy")
            .is_some_and(|policy| policy.starts_with("default-src 'none'")));
    }
}

#[tokio::test]
async fn escapes_library_text() {
    let app = demo();
    let response = app
        .upload(
            &[
                ("name", "<script>alert(1)</script>"),
                ("photographer", "\"><img src=x>"),
                ("demo_outcome", "approved"),
            ],
            PNG,
        )
        .await;
    let id = response.param("asset").unwrap();
    let page = app.get(&format!("/?asset={id}")).await.html();
    assert!(!page.contains("<script>alert(1)</script>"));
    assert!(page.contains("&lt;script&gt;"));
    assert!(!page.contains("\"><img src=x>"));
}

#[tokio::test]
async fn library_load_failure_shows_nothing() {
    let mock = MockServerClient::new().unwrap();
    let app = live(&mock, "");
    mock.enqueue(200, json!({"folders": []}));
    mock.enqueue_timeout();
    let response = app.get("/").await;
    assert_eq!(response.status, StatusCode::BAD_GATEWAY);
    assert!(!response.html().contains("/assets/"));
}
