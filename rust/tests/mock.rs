mod common;
use calmlens::{
    models::*,
    testing::{MockResponse, MockServerClient},
    ErrorCode, ENSURE_LENSES_MAX_PER_REQUEST,
};
use common::typed;
use futures_util::{StreamExt, TryStreamExt};
use serde_json::{json, Value};

#[tokio::test]
async fn all_operations_use_mock() {
    let fixtures: Value = serde_json::from_str(include_str!("../testdata/requests.json")).unwrap();
    for f in fixtures.as_array().unwrap() {
        let mock = MockServerClient::new().unwrap();
        mock.enqueue(200, f["response"].clone());
        common::invoke(
            &mock,
            f["operation"].as_str().unwrap(),
            f["options"].clone(),
        )
        .await
        .unwrap();
        let requests = mock.requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(
            f["request"],
            common::describe(&requests[0]),
            "{}",
            f["operation"]
        );
        assert_eq!(mock.remaining_responses(), 0);
    }
}

#[tokio::test]
async fn api_errors_carry_status_request_id_and_details() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue_response(
        MockResponse::json(
            404,
            json!({"code":"asset/not-found","message":"Missing","details":{"field":"id"},"traceId":"trace"}),
        )
        .header("x-request-id", "request-7"),
    );
    let error = mock
        .assets()
        .retrieve(AssetId::new("missing"))
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::AssetNotFound);
    assert_eq!(error.status(), Some(404));
    assert_eq!(error.request_id(), Some("request-7"));
    assert!(error.is_not_found());
    assert!(!error.is_retryable());
    assert_eq!(
        Value::Object(error.details().clone()),
        json!({"field":"id","traceId":"trace","network":true})
    );
    assert_eq!(error.message(), "Missing");
    assert_eq!(error.to_string(), "[calmlens] Missing");

    // A queued API error uses the status the API sends with that code.
    mock.enqueue_api_error("folder/not-empty", "Folder is not empty");
    let error = mock
        .folders()
        .delete(FolderId::new("folder-1"))
        .await
        .unwrap_err();
    assert_eq!(
        (error.code(), error.status()),
        (&ErrorCode::FolderNotEmpty, Some(409))
    );
    assert_eq!(error.request_id(), Some("mock-request-2"));

    // Codes this SDK does not know are kept as they are.
    mock.enqueue_api_error("billing/new-code", "New");
    let error = mock
        .folders()
        .list(ListFolders::default())
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::Other("billing/new-code".into()));
    assert_eq!(error.status(), Some(400));
}

#[tokio::test]
async fn validation_happens_before_the_transport() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(200, json!({"id":"one"}));
    let blank = mock.assets().classify(SubmitAsset::text(" ")).await;
    assert_eq!(blank.unwrap_err().code(), &"upload/invalid-payload");
    let unnamed = mock.assets().create(SubmitAsset::default()).await;
    assert_eq!(unnamed.unwrap_err().code(), &"upload/invalid-payload");
    let octet = mock
        .assets()
        .create(SubmitAsset::new(
            "file.bin",
            Content::bytes(vec![1, 2, 3], "application/octet-stream"),
        ))
        .await;
    assert_eq!(octet.unwrap_err().code(), &ErrorCode::InvalidUploadMimeType);
    assert!(mock.requests().is_empty());
    assert_eq!(mock.remaining_responses(), 1);
}

#[tokio::test]
async fn declared_payload_sizes_are_checked_for_first_and_later_parts() {
    let mock = MockServerClient::new().unwrap();
    for continuation in [false, true] {
        for declared in [5, 6] {
            for payload in [
                Payload::Text("hello".into()),
                Payload::Bytes(bytes::Bytes::from_static(b"hello")),
                Payload::Base64("aGVsbG8=".into()),
                Payload::Reader {
                    reader: Box::new(std::io::Cursor::new(b"hello")),
                    size: 5,
                },
            ] {
                let before = mock.requests().len();
                if declared == 5 {
                    mock.enqueue(
                        200,
                        Asset::new(
                            "asset-1",
                            AssetClassificationStatus::Completed,
                            AssetModerationStatus::Allowed,
                        ),
                    );
                }
                let part = Content {
                    payload,
                    size_in_bytes: Some(declared),
                    ..Content::text("")
                }
                .part(if continuation { 2 } else { 1 }, true);
                let result = if continuation {
                    mock.assets()
                        .upload_part(UploadPart {
                            asset_id: "asset-1".into(),
                            part,
                            ..Default::default()
                        })
                        .await
                } else {
                    mock.assets()
                        .create(SubmitAsset::multipart("note.txt", part))
                        .await
                };
                if declared == 5 {
                    assert_eq!(result.unwrap().id, "asset-1");
                    let request = mock.last_request().unwrap();
                    assert_eq!(request.query_param("sizeInBytes"), Some("5"));
                    assert_eq!(request.body, b"hello");
                } else {
                    assert_eq!(result.unwrap_err().code(), &"upload/invalid-payload");
                    assert_eq!(mock.requests().len(), before);
                }
            }
        }
    }
    assert_eq!(mock.requests().len(), 8);
    assert_eq!(mock.remaining_responses(), 0);
}

#[tokio::test]
async fn mock_simulates_transport_failures() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue_timeout();
    mock.enqueue_transport_error("connection reset by peer");
    mock.enqueue(200, EventsPage::new(vec![], "c", false));
    let timeout = mock.events().list(ListEvents::default()).await.unwrap_err();
    assert!(timeout.is_timeout());
    let cause = std::error::Error::source(&timeout)
        .unwrap()
        .downcast_ref::<std::io::Error>()
        .unwrap();
    assert_eq!(cause.kind(), std::io::ErrorKind::TimedOut);
    let reset = mock
        .cdn()
        .serve(CdnRequest {
            asset_identifier: "a".into(),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert_eq!(reset.code(), &ErrorCode::TransportError);
    assert!(mock.events().list(ListEvents::default()).await.is_ok());
    assert_eq!(mock.requests().len(), 3);
    assert_eq!(
        mock.events()
            .list(ListEvents::default())
            .await
            .unwrap_err()
            .code(),
        &"sdk/transport-error",
        "an empty queue never falls back to the network"
    );
}

#[tokio::test]
async fn binary_reader_and_stream_content_arrive_unchanged() {
    let data: Vec<u8> = (0..=255).collect();
    let mock = MockServerClient::new().unwrap();
    for _ in 0..3 {
        mock.enqueue(
            200,
            Asset::new(
                "asset-1",
                AssetClassificationStatus::Processing,
                AssetModerationStatus::Pending,
            ),
        );
    }
    mock.assets()
        .create(SubmitAsset::new(
            "all-bytes.png",
            Content::bytes(data.clone(), "image/png"),
        ))
        .await
        .unwrap();
    mock.assets()
        .create(SubmitAsset::new(
            "reader.png",
            Content::reader(std::io::Cursor::new(data.clone()), 256, "image/png"),
        ))
        .await
        .unwrap();
    let chunks = data
        .chunks(100)
        .map(|chunk| Ok::<_, std::io::Error>(bytes::Bytes::copy_from_slice(chunk)))
        .collect::<Vec<_>>();
    mock.assets()
        .create(SubmitAsset::new(
            "stream.png",
            Content::stream(futures_util::stream::iter(chunks), 256, "image/png"),
        ))
        .await
        .unwrap();
    for sent in mock.requests() {
        assert_eq!(sent.body, data);
        assert_eq!(sent.query_param("sizeInBytes"), Some("256"));
        assert_eq!(sent.query_param("contentType"), Some("image/png"));
        assert_eq!(sent.query_param("queue"), Some("true"));
    }

    // A reader that yields fewer bytes than declared fails instead of sending a short body.
    mock.enqueue(
        200,
        Asset::new(
            "asset-2",
            AssetClassificationStatus::Processing,
            AssetModerationStatus::Pending,
        ),
    );
    let short = mock
        .assets()
        .create(SubmitAsset::new(
            "short.png",
            Content::reader(std::io::Cursor::new(vec![1, 2, 3]), 10, "image/png"),
        ))
        .await
        .unwrap_err();
    assert_eq!(short.code(), &ErrorCode::TransportError);
}

#[tokio::test]
async fn files_stream_from_disk() {
    let path = std::env::temp_dir().join(format!("calmlens-sdk-{}.txt", std::process::id()));
    std::fs::write(&path, b"from disk").unwrap();
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(
        200,
        Asset::new(
            "asset-1",
            AssetClassificationStatus::Processing,
            AssetModerationStatus::Pending,
        ),
    );
    mock.assets()
        .create(SubmitAsset::new(
            "disk.txt",
            Content::file(&path, "text/plain").unwrap(),
        ))
        .await
        .unwrap();
    std::fs::remove_file(&path).unwrap();
    let sent = mock.last_request().unwrap();
    assert_eq!(sent.body, b"from disk");
    assert_eq!(sent.query_param("sizeInBytes"), Some("9"));
}

#[tokio::test]
async fn owned_clients_share_the_mock_queue_and_request_log() {
    let mock = MockServerClient::from_builder(
        calmlens::ServerClient::builder("key", "project-7").base_url("http://localhost:6110/v1"),
    )
    .unwrap();
    let owned = mock.client();
    mock.enqueue(
        200,
        Asset::new(
            "first",
            AssetClassificationStatus::Completed,
            AssetModerationStatus::Allowed,
        ),
    );
    mock.enqueue(
        200,
        Asset::new(
            "second",
            AssetClassificationStatus::Completed,
            AssetModerationStatus::Blocked,
        ),
    );
    let first = owned.assets().retrieve(AssetId::new("a")).await.unwrap();
    let second = mock.assets().retrieve(AssetId::new("b")).await.unwrap();
    assert_eq!(first.id, "first");
    assert_eq!(
        second.classification.moderation.status,
        AssetModerationStatus::Blocked
    );
    let requests = mock.requests();
    assert_eq!(requests[0].url, "http://localhost:6110/v1/assets/a");
    assert_eq!(requests[1].path, "/v1/assets/b");
    assert_eq!(requests[0].header("x-api-key"), Some("[redacted]"));
    assert!(requests[0]
        .header("user-agent")
        .unwrap()
        .starts_with(&format!("calmlens-rust/{} (rustc ", calmlens::VERSION)));
}

#[tokio::test]
async fn list_assets_scopes_to_a_folder() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(200, json!({"items":[],"nextCursor":null,"pageSize":12}));
    mock.assets()
        .list(ListAssets {
            cursor: Some("next-token".into()),
            page_size: Some(12),
            filter: Some("classification.moderation.status==allowed".into()),
            folder_id: Some("folder-1".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    let request = mock.last_request().unwrap();
    assert_eq!(request.path, "/v1/projects/project-1/assets/page");
    assert_eq!(request.query_param("folderId"), Some("folder-1"));
    assert_eq!(
        request.query_param("filter"),
        Some("classification.moderation.status==allowed")
    );
    assert_eq!(request.query_param("cursor"), Some("next-token"));
}

#[tokio::test]
async fn iterate_follows_pages_until_has_more_is_false() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(
        200,
        page_with_cursor(
            vec![
                Asset::new(
                    "a",
                    AssetClassificationStatus::Completed,
                    AssetModerationStatus::Allowed,
                ),
                Asset::new(
                    "b",
                    AssetClassificationStatus::Completed,
                    AssetModerationStatus::Allowed,
                ),
            ],
            true,
        ),
    );
    mock.enqueue(
        200,
        page_with_cursor(
            vec![Asset::new(
                "c",
                AssetClassificationStatus::Processing,
                AssetModerationStatus::Pending,
            )],
            false,
        ),
    );
    let ids: Vec<String> = mock
        .assets()
        .iterate(ListAssets {
            page_size: Some(2),
            filter: Some("classification.moderation.status==allowed".into()),
            ..Default::default()
        })
        .map_ok(|asset| asset.id)
        .try_collect()
        .await
        .unwrap();
    assert_eq!(ids, ["a", "b", "c"]);
    let pages: Vec<_> = mock
        .requests()
        .iter()
        .map(|r| {
            (
                r.query_param("cursor").unwrap_or("").to_owned(),
                r.query_param("filter").unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        pages,
        [
            (
                "".to_owned(),
                "classification.moderation.status==allowed".to_owned()
            ),
            (
                "next-token".to_owned(),
                "classification.moderation.status==allowed".to_owned()
            )
        ]
    );

    // Children page the same way, under the parent asset.
    mock.enqueue(
        200,
        page_with_cursor(
            vec![Asset::new(
                "child-1",
                AssetClassificationStatus::Completed,
                AssetModerationStatus::Allowed,
            )],
            true,
        ),
    );
    mock.enqueue_api_error("asset/not-found", "Gone");
    let children: Vec<_> = mock
        .assets()
        .iterate_children(ListChildren {
            asset_id: "parent".into(),
            ..Default::default()
        })
        .collect()
        .await;
    assert_eq!(children[0].as_ref().unwrap().id, "child-1");
    assert_eq!(
        children[1].as_ref().unwrap_err().code(),
        &ErrorCode::AssetNotFound
    );
    assert_eq!(children.len(), 2, "the stream ends after an error");
    assert_eq!(
        mock.last_request().unwrap().path,
        "/v1/assets/parent/children"
    );
}

#[tokio::test]
async fn event_pages_follow_the_cursor() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(
        200,
        EventsPage::new(vec![Event::new("event-1", "asset.blocked")], "c1", true),
    );
    mock.enqueue(
        200,
        EventsPage::new(vec![Event::new("event-2", "asset.allowed")], "c2", false),
    );
    let pages: Vec<EventsPage> = mock
        .events()
        .pages(ListEvents {
            after: Some("c0".into()),
            limit: Some(1),
        })
        .try_collect()
        .await
        .unwrap();
    assert_eq!(
        pages
            .iter()
            .map(|p| p.events[0].id.as_str())
            .collect::<Vec<_>>(),
        ["event-1", "event-2"]
    );
    assert_eq!(pages.last().unwrap().cursor, "c2");
    let cursors: Vec<_> = mock
        .requests()
        .iter()
        .map(|r| r.query_param("after").unwrap().to_owned())
        .collect();
    assert_eq!(cursors, ["c0", "c1"]);
    assert_eq!(mock.last_request().unwrap().query_param("limit"), Some("1"));
}

fn retrying_mock() -> MockServerClient {
    MockServerClient::from_builder(
        calmlens::ServerClient::builder("key", "project-1").max_retries(2),
    )
    .unwrap()
}

#[tokio::test]
async fn reads_are_retried_after_unavailable_and_rate_limits() {
    let mock = retrying_mock();
    mock.enqueue_response(
        MockResponse::api_error("sdk/http-error", "busy").header("retry-after", "0"),
    );
    mock.enqueue_response(
        MockResponse::json(503, json!({"code":"service/unavailable","message":"down"}))
            .header("retry-after", "0"),
    );
    mock.enqueue(
        200,
        Asset::new(
            "asset-1",
            AssetClassificationStatus::Completed,
            AssetModerationStatus::Allowed,
        ),
    );
    // The first reply is a 400: not retryable, so it fails straight away.
    let error = mock
        .assets()
        .retrieve(AssetId::new("asset-1"))
        .await
        .unwrap_err();
    assert_eq!(error.status(), Some(400));
    let asset = mock
        .assets()
        .retrieve(AssetId::new("asset-1"))
        .await
        .unwrap();
    assert_eq!(asset.id, "asset-1");
    assert_eq!(mock.requests().len(), 3);

    mock.enqueue_response(MockResponse::json(429, json!({})).header("retry-after", "0"));
    mock.enqueue_response(MockResponse::json(429, json!({})).header("retry-after", "0"));
    mock.enqueue_response(MockResponse::json(429, json!({})).header("retry-after", "0"));
    let error = mock
        .folders()
        .list(ListFolders::default())
        .await
        .unwrap_err();
    assert_eq!(error.status(), Some(429));
    assert_eq!(error.retry_after(), Some(std::time::Duration::ZERO));
    assert_eq!(mock.requests().len(), 6, "one attempt plus max_retries");
}

#[tokio::test]
async fn uploads_retry_with_one_idempotency_key() {
    let mock = retrying_mock();
    mock.enqueue_transport_error("connection reset");
    mock.enqueue_response(
        MockResponse::api_error("idempotency/request-in-progress", "wait")
            .header("retry-after", "0"),
    );
    mock.enqueue(
        200,
        Asset::new(
            "asset-1",
            AssetClassificationStatus::Processing,
            AssetModerationStatus::Pending,
        ),
    );
    mock.assets()
        .create(SubmitAsset::new("a.txt", Content::text("hello")))
        .await
        .unwrap();
    let keys: Vec<_> = mock
        .requests()
        .iter()
        .map(|r| r.header("idempotency-key").unwrap().to_owned())
        .collect();
    assert_eq!(keys.len(), 3);
    assert!(keys.iter().all(|key| *key == keys[0]));
    assert_eq!(keys[0].len(), 36);

    // A new call gets a new key; a caller's key is used as given.
    mock.enqueue(
        200,
        Asset::new(
            "asset-2",
            AssetClassificationStatus::Processing,
            AssetModerationStatus::Pending,
        ),
    );
    mock.assets()
        .create(SubmitAsset {
            idempotency_key: Some("order-42".into()),
            ..SubmitAsset::new("b.txt", Content::text("hello"))
        })
        .await
        .unwrap();
    assert_eq!(
        mock.last_request().unwrap().header("idempotency-key"),
        Some("order-42")
    );
}

#[tokio::test]
async fn writes_without_a_key_and_streamed_uploads_are_sent_once() {
    let mock = retrying_mock();
    mock.enqueue_transport_error("reset");
    let error = mock
        .folders()
        .create(CreateFolder {
            name: "Folder".into(),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::TransportError);
    assert_eq!(mock.requests().len(), 1);

    mock.enqueue_response(MockResponse::json(503, json!({})).header("retry-after", "0"));
    let error = mock
        .assets()
        .create(SubmitAsset::new(
            "a.txt",
            Content::reader(std::io::Cursor::new(b"hello".to_vec()), 5, "text/plain"),
        ))
        .await
        .unwrap_err();
    assert_eq!(error.status(), Some(503));
    assert_eq!(mock.requests().len(), 2);
}

#[tokio::test]
async fn multipart_parts_use_the_saved_queue_choice() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(
        200,
        Asset::new(
            "asset-1",
            AssetClassificationStatus::Pending,
            AssetModerationStatus::Pending,
        ),
    );
    mock.assets()
        .create(SubmitAsset {
            total_size_in_bytes: Some(5 * 1024 * 1024 + 5),
            ..SubmitAsset::multipart(
                "big.pdf",
                Content::bytes(vec![0; 5 * 1024 * 1024], "application/pdf").part(1, false),
            )
        })
        .await
        .unwrap();
    let start = mock.last_request().unwrap();
    assert_eq!(start.path, "/v1/projects/project-1/assets");
    assert_eq!(start.header("x-calmlens-upload"), Some("part"));
    assert_eq!(start.query_param("queue"), Some("true"));
    assert_eq!(start.query_param("totalSizeInBytes"), Some("5242885"));
    assert_eq!(start.query_param("partNumber"), Some("1"));

    mock.enqueue(
        200,
        Asset::new(
            "asset-1",
            AssetClassificationStatus::Processing,
            AssetModerationStatus::Pending,
        ),
    );
    mock.assets()
        .upload_part(UploadPart {
            asset_id: "asset-1".into(),
            part: Content::text("final").part(2, true),
            ..Default::default()
        })
        .await
        .unwrap();
    let part = mock.last_request().unwrap();
    assert_eq!(part.query_param("queue"), None);
    assert_eq!(part.query_param("partNumber"), Some("2"));
    assert_eq!(part.query_param("isFinal"), Some("true"));
    assert_eq!(part.body, b"final");

    mock.enqueue(
        200,
        Asset::new(
            "asset-1",
            AssetClassificationStatus::Completed,
            AssetModerationStatus::Allowed,
        ),
    );
    mock.assets()
        .upload_part(UploadPart {
            asset_id: "asset-1".into(),
            part: Content::text("again").part(3, true),
            queue: Some(false),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(
        mock.last_request().unwrap().query_param("queue"),
        Some("false")
    );

    let small = mock
        .assets()
        .upload_part(UploadPart {
            asset_id: "asset-1".into(),
            part: Content::text("small").part(4, false),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert_eq!(small.code(), &"upload/invalid-payload");
    let unnumbered = mock
        .assets()
        .upload_part(UploadPart {
            asset_id: "asset-1".into(),
            part: Content::text("x"),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert_eq!(unnumbered.code(), &ErrorCode::InvalidUploadPartNumber);
    let image = mock
        .assets()
        .create(SubmitAsset::multipart(
            "small.png",
            Content::bytes(vec![0; 10], "image/png").part(1, true),
        ))
        .await
        .unwrap_err();
    assert_eq!(image.code(), &ErrorCode::MultipartImageTooSmall);
    assert_eq!(mock.requests().len(), 3);
}

fn lens(identifier: &str, version: u32) -> LensDefinition {
    LensDefinition {
        identifier: identifier.into(),
        name: identifier.into(),
        lens_type: "image".into(),
        active: true,
        version,
        ..Default::default()
    }
}

#[tokio::test]
async fn ensure_lenses_keeps_request_order_and_caches() {
    let mock = MockServerClient::new().unwrap();
    let response = |ids: &[&str]| json!({"lenses": ids.iter().map(|id| json!({"id": format!("lens-{id}"), "identifier": id})).collect::<Vec<_>>()});
    mock.enqueue(200, response(&["zeta", "alpha", "mid"]));
    let lenses = mock
        .ensure_lenses(EnsureLenses {
            lenses: vec![lens("zeta", 1), lens("alpha", 1), lens("mid", 1)],
        })
        .await
        .unwrap();
    let identifiers: Vec<_> = lenses.iter().map(|l| l.identifier.as_str()).collect();
    assert_eq!(identifiers, ["zeta", "alpha", "mid"]);
    let sent: Vec<_> = mock.last_request().unwrap().json().unwrap()["lenses"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["identifier"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(sent, ["zeta", "alpha", "mid"]);

    // Cached definitions need no request; a changed one is sent alone and keeps its position.
    mock.enqueue(200, response(&["alpha"]));
    let lenses = mock
        .ensure_lenses(EnsureLenses {
            lenses: vec![lens("mid", 1), lens("alpha", 2), lens("zeta", 1)],
        })
        .await
        .unwrap();
    let ids: Vec<_> = lenses.iter().map(|l| l.identifier.as_str()).collect();
    assert_eq!(ids, ["mid", "alpha", "zeta"]);
    assert_eq!(mock.requests().len(), 2);
    assert_eq!(
        mock.last_request().unwrap().json().unwrap()["lenses"][0]["version"],
        2
    );

    // A response for another lens is refused.
    mock.enqueue(200, response(&["other"]));
    let error = mock.ensure_lens(lens("new", 1)).await.unwrap_err();
    assert_eq!(error.code(), &ErrorCode::InvalidResponse);
}

#[tokio::test]
async fn ensure_lenses_sends_large_batches_in_consecutive_requests() {
    let mock = MockServerClient::new().unwrap();
    let ids: Vec<String> = (0..=ENSURE_LENSES_MAX_PER_REQUEST)
        .map(|i| format!("lens-{i}"))
        .collect();
    let response = |ids: &[String]| json!({"lenses": ids.iter().map(|id| json!({"id": format!("id-{id}"), "identifier": id})).collect::<Vec<_>>()});
    mock.enqueue(200, response(&ids[..100]));
    mock.enqueue(200, response(&ids[100..]));
    let lenses = mock
        .ensure_lenses(EnsureLenses {
            lenses: ids.iter().map(|id| lens(id, 1)).collect(),
        })
        .await
        .unwrap();
    let requests = mock.requests();
    let methods: Vec<_> = requests.iter().map(|r| r.method.as_str()).collect();
    assert_eq!(methods, ["PUT", "PUT"]);
    let sent: Vec<Vec<String>> = requests
        .iter()
        .map(|r| {
            r.json().unwrap()["lenses"]
                .as_array()
                .unwrap()
                .iter()
                .map(|l| l["identifier"].as_str().unwrap().to_owned())
                .collect()
        })
        .collect();
    assert_eq!(sent, [ids[..100].to_vec(), ids[100..].to_vec()]);
    let identifiers: Vec<_> = lenses.iter().map(|l| l.identifier.clone()).collect();
    assert_eq!(identifiers, ids);
    let returned: Vec<_> = lenses.iter().map(|l| l.id.clone()).collect();
    let expected: Vec<_> = ids.iter().map(|id| Some(format!("id-{id}"))).collect();
    assert_eq!(returned, expected);
}

#[tokio::test]
async fn cdn_responses_keep_status_and_headers() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue_response(
        MockResponse::new(206)
            .header("content-type", "video/mp4")
            .header("content-range", "bytes 0-3/100")
            .body(&b"data"[..]),
    );
    let response = mock
        .cdn()
        .serve(CdnRequest {
            asset_identifier: "asset".into(),
            init: Some(HttpOptions {
                method: Some("GET".into()),
                headers: [("Range".into(), "bytes=0-3".into())].into(),
            }),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 206);
    assert_eq!(response.headers()["content-range"], "bytes 0-3/100");
    assert_eq!(response.bytes().await.unwrap(), &b"data"[..]);
    let request = mock.last_request().unwrap();
    assert_eq!(request.header("range"), Some("bytes=0-3"));
    assert_eq!(
        request.url,
        "https://cdn.calmlens.invalid/v1/assets/project-1/asset/rendered"
    );
}

#[tokio::test]
async fn delete_content_keeps_the_record_and_delete_returns_nothing() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(
        200,
        json!({"id":"asset-9","moderation":{"status":"allowed"},"content":{"status":"removed","removalReason":"requested","updatedAt":1700000000000u64}}),
    );
    let asset = mock
        .assets()
        .delete_content(AssetId::new("asset-9"))
        .await
        .unwrap();
    assert_eq!(
        (
            &asset.content.status,
            &asset.content.removal_reason,
            asset.content.updated_at
        ),
        (
            &AssetContentStatus::Removed,
            &Some(AssetContentRemovalReason::Requested),
            Some(1700000000000)
        )
    );
    let request = mock.last_request().unwrap();
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("DELETE", "/v1/assets/asset-9/content")
    );
    mock.enqueue(200, json!({}));
    mock.assets().delete(AssetId::new("asset-9")).await.unwrap();
    assert_eq!(mock.last_request().unwrap().path, "/v1/assets/asset-9");
}

#[tokio::test]
async fn patch_clear_is_distinct_from_omission() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(
        200,
        Asset::new(
            "asset",
            AssetClassificationStatus::Completed,
            AssetModerationStatus::Allowed,
        ),
    );
    mock.assets()
        .update(UpdateAsset {
            asset_id: "asset".into(),
            description: Patch::Null,
            tags: Patch::Value(vec![]),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(
        mock.last_request().unwrap().json(),
        Some(json!({"description": null, "tags": []}))
    );
}

#[test]
fn json_content_options_decode_to_native_payloads() {
    let options: SubmitAsset =
        typed(json!({"name":"x","content":{"base64":"aGk=","type":"text/plain"}}));
    assert!(matches!(
        options.content.unwrap().payload,
        Payload::Base64(ref encoded) if encoded == "aGk="
    ));
    let both = common::input::<SubmitAsset>(
        json!({"name":"x","content":{"base64":"aGk=","plainText":"hi","type":"text/plain"}}),
    );
    assert_eq!(both.unwrap_err().code(), &"upload/invalid-payload");
}

#[tokio::test]
async fn pagination_stops_when_a_page_does_not_advance() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(200, AssetPage::new(vec![], true));
    let assets: Vec<_> = mock.assets().iterate(ListAssets::default()).collect().await;
    assert!(assets.is_empty());
    assert_eq!(mock.requests().len(), 1);

    mock.enqueue(
        200,
        EventsPage::new(vec![Event::new("e", "asset.blocked")], "same", true),
    );
    let pages: Vec<_> = mock
        .events()
        .pages(ListEvents {
            after: Some("same".into()),
            ..Default::default()
        })
        .collect()
        .await;
    assert_eq!(pages.len(), 1);
    assert_eq!(mock.requests().len(), 2);
}

fn enqueue_status(
    mock: &MockServerClient,
    processing: AssetClassificationStatus,
    moderation: AssetModerationStatus,
    count: usize,
) {
    for _ in 0..count {
        mock.enqueue(
            200,
            Asset::new("asset-1", processing.clone(), moderation.clone()),
        );
    }
}

#[tokio::test]
async fn wait_for_decision_retrieves_with_growing_delays_until_decided() {
    let mock = MockServerClient::new().unwrap();
    enqueue_status(
        &mock,
        AssetClassificationStatus::Processing,
        AssetModerationStatus::Pending,
        7,
    );
    enqueue_status(
        &mock,
        AssetClassificationStatus::Completed,
        AssetModerationStatus::Blocked,
        1,
    );
    let started = std::time::Instant::now();
    let asset = mock
        .assets()
        .wait_for_decision(WaitForDecision::new("asset-1"))
        .await
        .unwrap();
    // The waits advance the mock's virtual clock and take no real time.
    assert!(started.elapsed() < std::time::Duration::from_secs(1));
    let waited = mock.elapsed();
    assert_eq!(asset.id, "asset-1");
    assert_eq!(
        asset.classification.moderation.status,
        AssetModerationStatus::Blocked
    );
    let requests: Vec<_> = mock
        .requests()
        .into_iter()
        .map(|request| (request.method, request.path))
        .collect();
    assert_eq!(
        requests,
        vec![("GET".to_string(), "/v1/assets/asset-1".to_string()); 8]
    );
    // 0.5s, then 1.5 times longer each time (0.75, 1.125, 1.6875, 2.53125, 3.796875), capped at 5s.
    assert_eq!(waited, std::time::Duration::from_secs_f64(15.390625));
}

#[tokio::test]
async fn wait_for_decision_times_out_at_the_deadline_with_the_last_status() {
    let mock = MockServerClient::new().unwrap();
    enqueue_status(
        &mock,
        AssetClassificationStatus::Processing,
        AssetModerationStatus::Pending,
        10,
    );
    let error = mock
        .assets()
        .wait_for_decision(
            WaitForDecision::new("asset-1").timeout(std::time::Duration::from_secs(3)),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::Timeout);
    assert_eq!(
        Value::Object(error.details().clone()),
        json!({"assetId": "asset-1", "classificationStatus": "processing", "moderationStatus": "pending"})
    );
    // Checks at 0, 0.5, 1.25 and 2.375s, then a shortened wait so the last check is at 3s.
    assert_eq!(mock.requests().len(), 5);
    assert_eq!(mock.elapsed(), std::time::Duration::from_secs(3));
}

#[tokio::test]
async fn dropping_wait_for_decision_stops_retrieving() {
    let mock = MockServerClient::new().unwrap();
    enqueue_status(
        &mock,
        AssetClassificationStatus::Processing,
        AssetModerationStatus::Pending,
        10,
    );
    let assets = mock.assets();
    use std::future::Future;
    let mut waiting = Box::pin(assets.wait_for_decision(WaitForDecision::new("asset-1")));
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    // The first poll retrieves once, then yields while it waits for the next check.
    assert!(waiting.as_mut().poll(&mut context).is_pending());
    drop(waiting);
    tokio::task::yield_now().await;
    // Nothing runs after the future is dropped.
    assert_eq!(mock.requests().len(), 1);
}

fn page_with_cursor(items: Vec<Asset>, more: bool) -> AssetPage {
    let mut page = AssetPage::new(items, more);
    page.next_cursor = more.then(|| "next-token".into());
    page
}
