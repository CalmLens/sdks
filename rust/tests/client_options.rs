//! Client setup and per-call options: environment defaults, `app_info`, `with_options`, the raw
//! `request` escape hatch, `last_response`, the attempt hook and the SDK-owned HTTP options.
mod common;
use calmlens::{
    models::*,
    testing::{MockResponse, MockServerClient},
    AttemptEvent, ErrorCode, ErrorKind, RequestOptions, ServerClient,
};
use common::complete;
use serde_json::json;
use std::sync::{Arc, Mutex};

fn folder(id: &str) -> serde_json::Value {
    complete::<Folder>(json!({"id": id, "name": "Photos", "projectId": "project-1"}))
}

#[test]
fn the_environment_supplies_the_api_key_project_and_base_url() {
    // The only test in this binary that touches these variables.
    std::env::remove_var("CALMLENS_API_KEY");
    std::env::set_var("CALMLENS_PROJECT_ID", "project-1");
    let missing = ServerClient::from_env().unwrap_err();
    assert_eq!(missing.code(), &ErrorCode::InvalidConfig);
    assert_eq!(missing.kind(), ErrorKind::Configuration);

    std::env::set_var("CALMLENS_API_KEY", "key-from-env");
    std::env::set_var("CALMLENS_BASE_URL", "http://localhost:6110/v1");
    let builder = calmlens::ServerClientBuilder::from_env().unwrap();
    let mock = MockServerClient::from_builder(builder).unwrap();
    assert_eq!(mock.client().project_id(), "project-1");
    for name in [
        "CALMLENS_API_KEY",
        "CALMLENS_PROJECT_ID",
        "CALMLENS_BASE_URL",
    ] {
        std::env::remove_var(name);
    }
}

#[tokio::test]
async fn app_info_is_appended_to_the_user_agent() {
    let mock = MockServerClient::from_builder(ServerClient::builder("key", "project-1").app_info(
        "Gallery",
        Some("2.1.0"),
        Some("https://gallery.example"),
    ))
    .unwrap();
    mock.enqueue(200, folder("fldr_1"));
    mock.folders()
        .retrieve(FolderId::new("fldr_1"))
        .await
        .unwrap();
    let agent = &mock.last_request().unwrap().headers["user-agent"];
    assert_eq!(
        agent,
        &format!(
            "{} Gallery/2.1.0 (https://gallery.example)",
            calmlens::user_agent()
        )
    );
    let invalid = ServerClient::builder("key", "project-1")
        .app_info("Gallery\n", None, None)
        .build()
        .unwrap_err();
    assert_eq!(invalid.code(), &ErrorCode::InvalidConfig);
}

#[tokio::test]
async fn request_options_add_headers_query_body_and_an_idempotency_key() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(200, folder("fldr_1"));
    let client = mock.client().with_options(
        RequestOptions::new()
            .header("X-Trace", "trace-1")
            .header("X-Api-Key", "replaced")
            .query("expand", "ancestors")
            .body_field("color", "teal")
            .idempotency_key("create-photos"),
    );
    client
        .folders()
        .create(CreateFolder::new("Photos"))
        .await
        .unwrap();
    let request = mock.last_request().unwrap();
    assert_eq!(request.headers["x-trace"], "trace-1");
    assert_eq!(request.headers["x-api-key"], "mock-key");
    assert_eq!(request.headers["idempotency-key"], "create-photos");
    assert!(request
        .query
        .contains(&("expand".to_owned(), "ancestors".to_owned())));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&request.body).unwrap(),
        json!({"name": "Photos", "color": "teal"})
    );
}

#[tokio::test]
async fn request_options_set_the_retry_limit_of_their_calls() {
    let mock = MockServerClient::new().unwrap();
    for _ in 0..3 {
        mock.enqueue_api_error("server/internal-error", "down");
    }
    let error = mock
        .client()
        .with_options(RequestOptions::new().max_retries(1))
        .folders()
        .retrieve(FolderId::new("fldr_1"))
        .await
        .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::Server);
    assert_eq!(mock.requests().len(), 2);
}

#[tokio::test]
async fn the_raw_request_reuses_auth_and_error_mapping() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(200, json!({"beta": true}));
    let value = mock
        .client()
        .request(
            http::Method::POST,
            "/projects/project-1/beta",
            Some(&json!({"a": 1})),
        )
        .await
        .unwrap();
    assert_eq!(value, json!({"beta": true}));
    let request = mock.last_request().unwrap();
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("POST", "/projects/project-1/beta")
    );
    assert_eq!(request.headers["x-api-key"], "mock-key");

    mock.enqueue_api_error("asset/not-found", "Asset not found");
    let error = mock
        .client()
        .request(http::Method::GET, "/assets/asset_1", None)
        .await
        .unwrap_err();
    assert!(error.is(ErrorKind::NotFound) && error.is(ErrorKind::Api));
    let refused = mock
        .client()
        .request(http::Method::GET, "https://example.com/x", None)
        .await
        .unwrap_err();
    assert_eq!(refused.code(), &ErrorCode::InvalidArgument);
}

#[tokio::test]
async fn results_keep_the_response_they_came_from() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue_response(
        MockResponse::json(200, folder("fldr_1")).header("x-request-id", "req-42"),
    );
    let folder = mock
        .folders()
        .retrieve(FolderId::new("fldr_1"))
        .await
        .unwrap();
    let response = folder.last_response().unwrap();
    assert_eq!(
        (response.status, response.request_id.as_deref()),
        (http::StatusCode::OK, Some("req-42"))
    );
    let decoded: Folder = serde_json::from_value(self::folder("fldr_2")).unwrap();
    assert!(decoded.last_response().is_none());
}

#[tokio::test]
async fn the_attempt_hook_sees_every_attempt_without_secrets() {
    let events: Arc<Mutex<Vec<AttemptEvent>>> = Arc::default();
    let seen = events.clone();
    let mock = MockServerClient::from_builder(
        ServerClient::builder("secret-key", "project-1")
            .max_retries(1)
            .on_attempt(move |event| seen.lock().unwrap().push(event.clone())),
    )
    .unwrap();
    mock.enqueue_api_error("server/internal-error", "down");
    mock.enqueue_response(
        MockResponse::json(200, folder("fldr_1")).header("x-request-id", "req-2"),
    );
    mock.folders()
        .retrieve(FolderId::new("fldr_1"))
        .await
        .unwrap();
    let events = events.lock().unwrap();
    let summary: Vec<_> = events
        .iter()
        .map(|event| {
            (
                event.operation,
                event.method.as_str(),
                event.attempt,
                event.status.map(|status| status.as_u16()),
                event.error_code.as_ref().map(ErrorCode::as_str),
                event.retry_delay.is_some(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            (
                Some("folders.retrieve"),
                "GET",
                1,
                Some(500),
                Some("server/internal-error"),
                true
            ),
            (Some("folders.retrieve"), "GET", 2, Some(200), None, false)
        ]
    );
    assert_eq!(events[1].request_id.as_deref(), Some("req-2"));
    assert!(!format!("{events:?}").contains("secret-key"));
}

#[tokio::test]
async fn signed_url_grants_are_redacted_from_attempt_paths() {
    let events: Arc<Mutex<Vec<AttemptEvent>>> = Arc::default();
    let seen = events.clone();
    let mock = MockServerClient::from_builder(
        ServerClient::builder("key", "project-1")
            .on_attempt(move |event| seen.lock().unwrap().push(event.clone())),
    )
    .unwrap();
    mock.enqueue_response(MockResponse::new(200).body(&b"bytes"[..]));
    let signed = format!(
        "{}/project-1/sig_abc123/rendered",
        calmlens::DEFAULT_CDN_BASE_URL
    );
    mock.fetch_cdn(&signed).await.unwrap();
    let path = events.lock().unwrap()[0].path.clone();
    assert!(
        path.contains("[redacted]") && !path.contains("sig_abc123"),
        "{path}"
    );
}

#[test]
fn proxy_and_root_certificates_are_checked_when_the_client_is_built() {
    let proxy = ServerClient::builder("key", "project-1")
        .proxy("not a url")
        .build()
        .unwrap_err();
    assert_eq!(proxy.code(), &ErrorCode::InvalidConfig);
    let certificate = ServerClient::builder("key", "project-1")
        .add_root_certificate(b"not a certificate".to_vec())
        .build()
        .unwrap_err();
    assert_eq!(certificate.code(), &ErrorCode::InvalidConfig);
    ServerClient::builder("key", "project-1")
        .proxy("http://proxy.internal:3128")
        .build()
        .unwrap();
}

/// Every sub-client's futures and the shared types are `Send` (and the clients `Sync`), so they
/// work in Tokio tasks and web handlers: this fails to compile otherwise.
#[test]
fn client_futures_and_types_are_send() {
    fn send<T: Send>(_: &T) {}
    fn shared<T: Send + Sync>() {}
    shared::<ServerClient>();
    shared::<calmlens::blocking::ServerClient>();
    shared::<calmlens::Error>();
    shared::<Asset>();
    shared::<RequestOptions>();
    let client = ServerClient::new("key", "project-1").unwrap();
    send(&client.assets().retrieve(AssetId::new("a")));
    send(&client.folders().list(ListFolders::new()));
    send(&client.hash_lists().list(ListHashLists::new()));
    send(&client.policies().list(ListPolicies::new()));
    send(&client.upload_presets().list(ListUploadPresets::new()));
    send(&client.project_settings().get());
    send(&client.metadata_fields().list());
    send(&client.lenses().list(ListLenses::new()));
    send(&client.events().list(ListEvents::new()));
    send(&client.text().classify(ClassifyText::new("hi")));
    send(&client.cdn().serve(CdnRequest::new().asset_id("a")));
    send(&client.request(http::Method::GET, "/x", None));
}
