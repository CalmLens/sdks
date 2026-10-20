use calmlens::{blocking, models::*, testing::MockServerClient, ErrorCode, ServerClient};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::Duration,
};

/// Reads one request (head and `Content-Length` body), returning its head and body.
fn read_request(stream: &mut TcpStream) -> (String, Vec<u8>) {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut head = Vec::new();
    let mut byte = [0];
    while !head.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).unwrap();
        head.push(byte[0]);
    }
    let head = String::from_utf8(head).unwrap().to_lowercase();
    let length = head
        .lines()
        .find_map(|line| line.strip_prefix("content-length: "))
        .map_or(0, |value| value.trim().parse::<usize>().unwrap());
    let mut body = vec![0; length];
    stream.read_exact(&mut body).unwrap();
    (head, body)
}

/// Serves `count` connections, answering each after `delay` with a JSON asset.
fn serve_assets(count: usize, delay: Duration) -> (String, thread::JoinHandle<Vec<Vec<u8>>>) {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", server.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let mut bodies = Vec::new();
        for _ in 0..count {
            let Ok((mut stream, _)) = server.accept() else {
                break;
            };
            let (_, body) = read_request(&mut stream);
            bodies.push(body);
            thread::sleep(delay);
            let response = r#"{"id":"asset","processing":{"status":"done"},"moderation":{"status":"approved"}}"#;
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            );
        }
        bodies
    });
    (url, worker)
}

#[tokio::test(flavor = "multi_thread")]
async fn blocking_client_can_be_created_and_dropped_inside_tokio() {
    let (url, worker) = serve_assets(1, Duration::ZERO);
    // Created and dropped on a runtime thread; only the blocking call moves off it.
    let client = blocking::ServerClient::builder("key", "project")
        .base_url(&url)
        .cdn_base_url(&url)
        .build()
        .unwrap();
    let worker_client = client.clone();
    let asset = tokio::task::spawn_blocking(move || {
        worker_client.assets().moderate(SubmitAsset::text("hello"))
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(asset.moderation.status, AssetModerationStatus::Approved);
    drop(client);
    assert_eq!(worker.join().unwrap(), [b"hello".to_vec()]);

    let mock = MockServerClient::new().unwrap();
    let blocking_mock = mock.blocking().unwrap();
    drop(blocking_mock);
    drop(mock);
}

#[test]
fn blocking_wait_for_decision_returns_a_failed_asset_as_decided() {
    let mock = MockServerClient::new().unwrap();
    let client = mock.blocking().unwrap();
    mock.enqueue(
        200,
        Asset::new(
            "asset-1",
            AssetProcessingStatus::Processing,
            AssetModerationStatus::Pending,
        ),
    );
    mock.enqueue(
        200,
        Asset::new(
            "asset-1",
            AssetProcessingStatus::Failed,
            AssetModerationStatus::Pending,
        ),
    );
    let asset = client
        .assets()
        .wait_for_decision(WaitForDecision::new("asset-1").timeout(Duration::from_secs(5)))
        .unwrap();
    assert_eq!(asset.id, "asset-1");
    assert_eq!(asset.processing.status, AssetProcessingStatus::Failed);
    assert_eq!(mock.requests().len(), 2);
    assert!(mock
        .requests()
        .iter()
        .all(|request| request.path == "/v1/assets/asset-1"));
}

#[test]
fn blocking_iterators_and_reads() {
    let mock = MockServerClient::new().unwrap();
    let client = mock.blocking().unwrap();
    mock.enqueue(200, {
        let mut page = AssetPage::new(
            vec![Asset::new(
                "a",
                AssetProcessingStatus::Done,
                AssetModerationStatus::Approved,
            )],
            true,
        );
        page.next_cursor = Some("next-token".into());
        page
    });
    mock.enqueue(
        200,
        AssetPage::new(
            vec![Asset::new(
                "b",
                AssetProcessingStatus::Done,
                AssetModerationStatus::Approved,
            )],
            false,
        ),
    );
    let ids: Vec<String> = client
        .assets()
        .iterate(ListAssets::default())
        .map(|asset| asset.unwrap().id)
        .collect();
    assert_eq!(ids, ["a", "b"]);
    mock.enqueue_raw(200, &b"streamed body"[..]);
    let mut response = client
        .cdn()
        .serve(CdnRequest {
            asset_identifier: "a".into(),
            ..Default::default()
        })
        .unwrap();
    let mut body = Vec::new();
    std::io::copy(&mut response, &mut body).unwrap();
    assert_eq!(body, b"streamed body");
}

#[test]
fn streaming_cdn_preserves_range_method_and_headers() {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", server.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (mut stream, _) = server.accept().unwrap();
        let (head, _) = read_request(&mut stream);
        assert!(head.starts_with("get "));
        assert!(head.contains("range: bytes=0-3"));
        assert!(head.contains("x-api-key: key"));
        assert!(!head.contains("override"));
        stream.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Type: video/mp4\r\nContent-Range: bytes 0-3/100\r\nConnection: close\r\n\r\ndata").unwrap();
    });
    let client = blocking::ServerClient::builder("key", "project")
        .base_url(&url)
        .cdn_base_url(&url)
        .build()
        .unwrap();
    let mut response = client
        .cdn()
        .serve(CdnRequest {
            asset_identifier: "asset".into(),
            init: Some(HttpOptions {
                method: Some("GET".into()),
                headers: [
                    ("Range".into(), "bytes=0-3".into()),
                    ("X-Api-Key".into(), "override".into()),
                ]
                .into(),
            }),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(response.status().as_u16(), 206);
    assert_eq!(response.headers()["content-type"], "video/mp4");
    let mut bytes = Vec::new();
    std::io::copy(&mut response, &mut bytes).unwrap();
    assert_eq!(bytes, b"data");
    worker.join().unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn reader_uploads_stream_with_their_declared_length() {
    // The test server reads exactly Content-Length bytes, so a chunked body arrives empty.
    let (url, worker) = serve_assets(1, Duration::ZERO);
    let client = ServerClient::builder("key", "project")
        .base_url(&url)
        .build()
        .unwrap();
    let data: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
    client
        .assets()
        .create(SubmitAsset::new(
            "large.bin.txt",
            Content::reader(std::io::Cursor::new(data.clone()), 300_000, "text/plain"),
        ))
        .await
        .unwrap();
    assert_eq!(worker.join().unwrap(), [data]);
}

#[tokio::test]
async fn uploads_are_not_cut_off_by_the_api_call_timeout() {
    let (url, worker) = serve_assets(3, Duration::from_millis(700));
    let client = ServerClient::builder("key", "project")
        .base_url(&url)
        .timeout(Duration::from_millis(300))
        .max_retries(0)
        .build()
        .unwrap();
    let upload = client
        .assets()
        .create(SubmitAsset::new("a.txt", Content::text("slow")))
        .await
        .unwrap();
    assert_eq!(upload.id, "asset");
    let call = client.assets().retrieve(AssetId::new("asset")).await;
    assert!(call.unwrap_err().is_timeout());
    let bounded = client
        .with_timeout(Duration::from_millis(300))
        .assets()
        .create(SubmitAsset::new("b.txt", Content::text("slow")))
        .await;
    assert!(bounded.unwrap_err().is_timeout());
    drop(client);
    worker.join().unwrap();
}

#[test]
fn unknown_enum_values_and_fields_decode() {
    let asset: Asset = serde_json::from_str(
        r#"{"id":"asset","visibility":"unlisted","newField":{"a":1},
            "content":{"status":"temporary","extractedText":{"content":"document text"},"futureContent":true},
            "moderation":{"status":"quarantined",
            "report":{"labels":[{"description":"cat"}],"media":{"segments":[{"source":"frame"}]},"futureScore":2}}}"#,
    )
    .unwrap();
    assert_eq!(
        asset.moderation.status,
        AssetModerationStatus::Unknown("quarantined".into())
    );
    assert_eq!(
        asset.visibility,
        Some(Visibility::Unknown("unlisted".into()))
    );
    assert_eq!(asset.extra["newField"], serde_json::json!({"a": 1}));
    assert_eq!(asset.content.extra["futureContent"], true);
    assert_eq!(
        asset.content.extracted_text.unwrap().content.as_deref(),
        Some("document text")
    );
    let report = asset.moderation.report.unwrap();
    assert_eq!(report.labels.unwrap()[0].description, "cat");
    assert_eq!(report.media.unwrap().segments[0].source, "frame");
    assert_eq!(report.extra["futureScore"], 2);
    let round_trip = serde_json::to_value(Asset::new(
        "a",
        AssetProcessingStatus::Done,
        AssetModerationStatus::Unknown("quarantined".into()),
    ))
    .unwrap();
    assert_eq!(
        (
            &round_trip["processing"]["status"],
            &round_trip["moderation"]["status"]
        ),
        (
            &serde_json::json!("done"),
            &serde_json::json!("quarantined")
        )
    );
}

#[test]
fn processing_features_serialize_as_the_api_expects() {
    let options = ProcessingOptions {
        features: Some(ProcessingFeatures {
            ocr: Some(FeatureOptions::enabled()),
            face_detection: Some(FaceDetectionOptions {
                age_estimation: Some(true),
                ..FaceDetectionOptions::enabled()
            }),
            ..ProcessingFeatures::default()
        }),
        ..ProcessingOptions::default()
    };
    assert_eq!(
        serde_json::to_value(&options).unwrap(),
        serde_json::json!({"features": {
            "ocr": {"enabled": true},
            "faceDetection": {"enabled": true, "ageEstimation": true}
        }})
    );
}

#[test]
fn report_feature_results_decode() {
    let report: ClassificationReport = serde_json::from_str(
        r#"{"features":{
            "personDetection":{"status":"not-evaluated","stage":"beta","reason":"not-supported"},
            "faceDetection":{"status":"evaluated","stage":"beta","faces":[
                {"box":{"left":-0.02,"top":0.2,"width":0.3,"height":0.4},"confidence":0.99,"ageRange":{"low":21,"high":30}},
                {"box":{"left":0.5,"top":0.5,"width":0.1,"height":0.1},"confidence":0.8}
            ]}}}"#,
    )
    .unwrap();
    let features = report.features.unwrap();
    let people = features.person_detection.unwrap();
    assert_eq!(people.status, Some(FeatureResultStatus::NotEvaluated));
    assert_eq!(people.reason, Some(FeatureNotEvaluatedReason::NotSupported));
    assert_eq!(people.people, None);
    let faces = features.face_detection.unwrap();
    assert_eq!(faces.status, Some(FeatureResultStatus::Evaluated));
    assert_eq!(faces.stage, Some(FeatureStage::Beta));
    let faces = faces.faces.unwrap();
    assert_eq!(faces[0].bounding_box.left, -0.02);
    assert_eq!(faces[0].bounding_box.height, 0.4);
    assert_eq!(faces[0].confidence, 0.99);
    let age = faces[0].age_range.as_ref().unwrap();
    assert_eq!((age.low, age.high), (21, 30));
    assert_eq!(faces[1].age_range, None);
}

#[test]
fn debug_output_redacts_the_api_key() {
    let builder = ServerClient::builder("secret-key-123", "project");
    let client = builder.clone().build().unwrap();
    let blocking = blocking::ServerClient::new("secret-key-123", "project").unwrap();
    for text in [
        format!("{builder:?}"),
        format!("{client:?}"),
        format!("{blocking:?}"),
    ] {
        assert!(!text.contains("secret-key-123"), "{text}");
        assert!(text.contains("project"), "{text}");
    }
}

#[test]
fn invalid_configuration_is_rejected() {
    let build = |builder: calmlens::ServerClientBuilder| builder.build().unwrap_err();
    for error in [
        build(ServerClient::builder("key", "project").timeout(Duration::ZERO)),
        build(ServerClient::builder("key", "project").base_url("not a url")),
        build(ServerClient::builder("key", "project").base_url("ftp://example.com")),
        build(ServerClient::builder("", "project")),
        build(ServerClient::builder("key", "..")),
    ] {
        assert_eq!(error.code(), &ErrorCode::InvalidConfig);
    }
    assert!(ServerClient::builder("key", "project")
        .base_url("http://localhost:1/v1")
        .build()
        .is_ok());
}
