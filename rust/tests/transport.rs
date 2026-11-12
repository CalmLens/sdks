mod common;
use calmlens::{blocking, models::*, testing::MockServerClient, ServerClient};
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
            let response = common::complete::<Asset>(serde_json::json!({"id": "asset", "upload": {"status": "completed"}, "classification": {"status": "completed", "moderation": {"decision": "allowed"}}})).to_string();
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
        worker_client.assets().classify(SubmitAsset::text("hello"))
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        asset.classification.moderation.decision,
        Some(AssetModerationDecision::Allowed)
    );
    drop(client);
    let bodies = worker.join().unwrap();
    assert_eq!(bodies.len(), 1);
    let body: serde_json::Value = serde_json::from_slice(&bodies[0]).unwrap();
    assert_eq!(
        body["content"],
        serde_json::json!({"plainText": "hello", "type": "text/plain"})
    );

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
        Asset::new("asset-1", AssetClassificationStatus::Processing, None),
    );
    mock.enqueue(
        200,
        Asset::new("asset-1", AssetClassificationStatus::Failed, None),
    );
    let asset = client
        .assets()
        .wait_for_decision(WaitForDecision::new("asset-1").timeout(Duration::from_secs(5)))
        .unwrap();
    assert_eq!(asset.id, "asset-1");
    assert_eq!(
        asset.classification.status,
        AssetClassificationStatus::Failed
    );
    assert_eq!(mock.requests().len(), 2);
    assert!(mock
        .requests()
        .iter()
        .all(|request| request.path == "/assets/asset-1"));
}

#[test]
fn blocking_iterators_and_reads() {
    let mock = MockServerClient::new().unwrap();
    let client = mock.blocking().unwrap();
    mock.enqueue(200, {
        let mut page = AssetPage::new(
            vec![Asset::new(
                "a",
                AssetClassificationStatus::Completed,
                Some(AssetModerationDecision::Allowed),
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
                AssetClassificationStatus::Completed,
                Some(AssetModerationDecision::Allowed),
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
    let mut response = client.cdn().serve(CdnRequest::new().asset_id("a")).unwrap();
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
    let mut response =
        client
            .cdn()
            .serve(
                CdnRequest::new()
                    .asset_id("asset")
                    .init(HttpOptions::new().method("GET").headers(
                        std::collections::HashMap::from([
                            ("Range".to_owned(), "bytes=0-3".to_owned()),
                            ("X-Api-Key".to_owned(), "override".to_owned()),
                        ]),
                    )),
            )
            .unwrap();
    assert_eq!(response.status().as_u16(), 206);
    assert_eq!(response.headers()["content-type"], "video/mp4");
    let mut bytes = Vec::new();
    std::io::copy(&mut response, &mut bytes).unwrap();
    assert_eq!(bytes, b"data");
    worker.join().unwrap();
}

#[test]
fn an_api_error_without_a_request_id_header_takes_the_body_request_id() {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", server.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (mut stream, _) = server.accept().unwrap();
        read_request(&mut stream);
        let body = r#"{"code":"asset/not-found","message":"Asset not found","requestId":"req-body","details":{}}"#;
        let _ = write!(
            stream,
            "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
    });
    let client = blocking::ServerClient::builder("key", "project")
        .base_url(&url)
        .max_retries(0)
        .build()
        .unwrap();
    let error = client
        .assets()
        .retrieve(AssetId::new("asset-1"))
        .unwrap_err();
    assert_eq!(
        (
            error.code(),
            error.status().map(|status| status.as_u16()),
            error.request_id()
        ),
        (
            &calmlens::ErrorCode::AssetNotFound,
            Some(404),
            Some("req-body")
        )
    );
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
    let bodies = worker.join().unwrap();
    assert_eq!(bodies.len(), 1);
    // The form's boundary opens its body.
    let boundary = bodies[0].split(|byte| *byte == b'\r').next().unwrap();
    let boundary = std::str::from_utf8(&boundary[2..]).unwrap();
    let parts = common::parse_form(
        &format!("multipart/form-data; boundary={boundary}"),
        &bodies[0],
        "reader upload",
    );
    let names: Vec<&str> = parts.iter().map(|part| part.name.as_str()).collect();
    assert_eq!(names, ["options", "file"]);
    assert_eq!(parts[1].body, data);
}

/// Binary uploads have no timeout unless `upload_timeout` or `with_timeout` sets one; text
/// uploads, like API calls, have the client timeout.
#[tokio::test]
async fn binary_uploads_are_not_cut_off_by_the_api_call_timeout() {
    let (url, worker) = serve_assets(4, Duration::from_millis(700));
    let client = ServerClient::builder("key", "project")
        .base_url(&url)
        .timeout(Duration::from_millis(300))
        .max_retries(0)
        .build()
        .unwrap();
    let file = || SubmitAsset::new("a.pdf", Content::bytes(&b"slow"[..], "application/pdf"));
    let upload = client.assets().create(file()).await.unwrap();
    assert_eq!(upload.id, "asset");
    let text = client
        .assets()
        .create(SubmitAsset::new("a.txt", Content::text("slow")))
        .await;
    assert!(text.unwrap_err().is_timeout());
    let bounded = client
        .with_timeout(Duration::from_millis(300))
        .assets()
        .create(file())
        .await;
    assert!(bounded.unwrap_err().is_timeout());
    let configured = ServerClient::builder("key", "project")
        .base_url(&url)
        .upload_timeout(Duration::from_millis(300))
        .max_retries(0)
        .build()
        .unwrap();
    assert!(configured
        .assets()
        .create(file())
        .await
        .unwrap_err()
        .is_timeout());
    drop((client, configured));
    worker.join().unwrap();
}

#[test]
fn unknown_enum_values_and_fields_decode() {
    let asset: Asset = serde_json::from_value(common::complete::<Asset>(
        serde_json::from_str(r#"{"id":"asset","visibility":"unlisted","newField":{"a":1},"content":{"status":"temporary","extractedText":{"type":"string","content":"document text"},"futureContent":true},"classification":{"moderation":{"futureScore":2,"decision":"quarantined","flaggedCategories":[],"regions":[],"timeline":{"segmentCount":2,"futureCount":1}},"futureList":[{"description":"cat"}]}}"#).unwrap(),
    ))
    .unwrap();
    assert_eq!(
        asset.classification.moderation.decision,
        Some(AssetModerationDecision::from("quarantined"))
    );
    assert_eq!(asset.visibility, Visibility::from("unlisted"));
    assert_eq!(asset.extra["newField"], serde_json::json!({"a": 1}));
    assert_eq!(asset.content.extra["futureContent"], true);
    assert_eq!(
        asset.content.extracted_text.unwrap().content.as_deref(),
        Some("document text")
    );
    let report = asset.classification.moderation;
    assert_eq!(
        asset.classification.extra["futureList"],
        serde_json::json!([{"description": "cat"}])
    );
    assert_eq!(report.timeline.as_ref().unwrap().extra["futureCount"], 1);
    assert_eq!(report.extra["futureScore"], 2);
    let round_trip = serde_json::to_value(Asset::new(
        "a",
        AssetClassificationStatus::Completed,
        Some(AssetModerationDecision::from("quarantined")),
    ))
    .unwrap();
    assert_eq!(
        (
            &round_trip["classification"]["status"],
            &round_trip["classification"]["moderation"]["decision"]
        ),
        (
            &serde_json::json!("completed"),
            &serde_json::json!("quarantined")
        )
    );
}

#[test]
fn processing_features_serialize_as_the_api_expects() {
    let options = ProcessingOptions::new().features(
        ProcessingFeatures::new()
            .ocr(FeatureOptions::enabled())
            .face_detection(FaceDetectionOptions::enabled().age_estimation(true))
            .streaming(FeatureOptions::new(false)),
    );
    assert_eq!(
        serde_json::to_value(&options).unwrap(),
        serde_json::json!({"features": {
            "ocr": {"enabled": true},
            "faceDetection": {"enabled": true, "ageEstimation": true},
            "streaming": {"enabled": false}
        }})
    );
}

#[test]
fn report_feature_results_decode() {
    let report: AssetClassification = serde_json::from_value(common::complete::<AssetClassification>(
        serde_json::from_str(r#"{
            "personDetection":{"status":"not-evaluated","reason":"not-supported"},
            "faceDetection":{"status":"evaluated","faces":[
                {"box":{"left":-0.02,"top":0.2,"width":0.3,"height":0.4},"confidence":0.99,"ageRange":{"low":21,"high":30}},
                {"box":{"left":0.5,"top":0.5,"width":0.1,"height":0.1},"confidence":0.8}
            ]}}"#).unwrap(),
    ))
    .unwrap();
    let features = report;
    let people = features.person_detection.unwrap();
    assert_eq!(people.status, FeatureResultStatus::NotEvaluated);
    assert_eq!(people.reason, Some(FeatureNotEvaluatedReason::NotSupported));
    assert_eq!(people.people, None);
    let faces = features.face_detection.unwrap();
    assert_eq!(faces.status, FeatureResultStatus::Evaluated);
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

/// Concurrent calls for one lens definition send it once: the second waits for the first and
/// answers from the cache it fills.
#[tokio::test(flavor = "multi_thread")]
async fn concurrent_ensure_lenses_send_a_definition_once() {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", server.local_addr().unwrap());
    server.set_nonblocking(true).unwrap();
    let worker = thread::spawn(move || {
        let mut served = 0;
        let until = std::time::Instant::now() + Duration::from_millis(1500);
        while std::time::Instant::now() < until {
            let Ok((mut stream, _)) = server.accept() else {
                thread::sleep(Duration::from_millis(10));
                continue;
            };
            stream.set_nonblocking(false).unwrap();
            read_request(&mut stream);
            served += 1;
            thread::sleep(Duration::from_millis(300));
            let lens = common::complete::<Lens>(
                serde_json::json!({"id": "lens-thumb", "identifier": "thumb", "name": "thumb", "type": "image"}),
            );
            let response = serde_json::json!({"lenses": [lens]}).to_string();
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            );
        }
        served
    });
    let client = ServerClient::builder("key", "project")
        .base_url(&url)
        .build()
        .unwrap();
    let ensure = || {
        client.ensure_lenses(EnsureLenses::new(vec![LensDefinition::new(
            "thumb", "thumb", "image",
        )
        .active(true)]))
    };
    let (first, second) = tokio::join!(ensure(), ensure());
    assert_eq!(first.unwrap()[0].id, "lens-thumb");
    assert_eq!(second.unwrap()[0].id, "lens-thumb");
    assert_eq!(worker.join().unwrap(), 1);
}
