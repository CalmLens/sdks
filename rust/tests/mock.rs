mod common;
use calmlens::{
    models::*,
    testing::{MockResponse, MockServerClient},
    ErrorCode,
};
use common::typed;
use serde_json::{json, Value};

#[tokio::test]
async fn api_errors_have_a_message_and_queued_api_errors_their_status() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue_response(
        MockResponse::json(
            404,
            json!({"code":"asset/not-found","message":"Missing","requestId":"request-7","details":{"field":"id"}}),
        )
        .header("x-request-id", "request-7"),
    );
    let error = mock
        .assets()
        .retrieve(AssetId::new("missing"))
        .await
        .unwrap_err();
    // The fields themselves are in the shared client cases; these are the Rust accessors.
    assert!(error.is_not_found());
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

    // Its body is the API's error body, whose requestId is the response's X-Request-Id.
    mock.enqueue_api_error("asset/not-found", "Asset not found");
    let response = mock
        .cdn()
        .serve(CdnRequest {
            asset_identifier: "asset-1".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let body: Value = serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
    assert_eq!(request_id, "mock-request-3");
    assert_eq!(
        (&body["code"], &body["requestId"], &body["details"]),
        (&json!("asset/not-found"), &json!(request_id), &json!({}))
    );

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
    let unnumbered = mock
        .assets()
        .upload_part(UploadPart {
            asset_id: "asset-1".into(),
            part: Content::text("x"),
            ..Default::default()
        })
        .await;
    assert_eq!(
        unnumbered.unwrap_err().code(),
        &ErrorCode::InvalidUploadPartNumber
    );
    assert!(mock.requests().is_empty());
    assert_eq!(mock.remaining_responses(), 1);
}

#[tokio::test]
async fn multipart_sizes_are_refused_before_the_transport_without_a_status() {
    const MIB: usize = 1024 * 1024;
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(200, json!({"id":"one"}));
    let refusals = [
        // A part under 5 MiB that is not the last.
        mock.assets()
            .create(SubmitAsset::multipart(
                "clip.mp4",
                Content::bytes(vec![0; MIB], "video/mp4").part(1, false),
            ))
            .await
            .unwrap_err(),
        mock.assets()
            .upload_part(UploadPart {
                asset_id: "asset-1".into(),
                part: Content::bytes(vec![0; MIB], "video/mp4").part(2, false),
                ..Default::default()
            })
            .await
            .unwrap_err(),
        // A final first part is the whole image: under 10 MiB.
        mock.assets()
            .create(SubmitAsset::multipart(
                "small.png",
                Content::bytes(vec![0; MIB], "image/png").part(1, true),
            ))
            .await
            .unwrap_err(),
        // An image part over 20 MiB.
        mock.assets()
            .create(SubmitAsset::multipart(
                "large.png",
                Content::bytes(vec![0; 21 * MIB], "image/png").part(1, false),
            ))
            .await
            .unwrap_err(),
    ];
    let codes: Vec<_> = refusals
        .iter()
        .map(|error| (error.code().clone(), error.status()))
        .collect();
    assert_eq!(
        codes,
        [
            (ErrorCode::InvalidUploadPayload, None),
            (ErrorCode::InvalidUploadPayload, None),
            (ErrorCode::MultipartImageTooSmall, None),
            (ErrorCode::MultipartImageTooLarge, None),
        ]
    );
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
    assert_eq!(requests[0].header("x-api-key"), Some("key"));
}

/// The shared client cases cover a one-shot stream; a blocking reader is sent once too.
#[tokio::test]
async fn reader_uploads_are_sent_once() {
    let mock = MockServerClient::from_builder(
        calmlens::ServerClient::builder("key", "project-1").max_retries(2),
    )
    .unwrap();
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
    assert_eq!(mock.requests().len(), 1);
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
