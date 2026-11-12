//! Automatic multipart uploads: content larger than `part_size_bytes` goes in parts.
use calmlens::{models::*, testing::*, ErrorCode, ServerClient};
use serde_json::json;
use std::sync::{Arc, Mutex};

const MIB: usize = 1024 * 1024;

/// Distinct bytes, so a part sent at the wrong offset shows.
fn file_of(length: usize) -> Vec<u8> {
    (0..length).map(|index| (index * 7 % 251) as u8).collect()
}

fn kept(name: &str, content: Content, key: &str) -> SubmitAsset {
    SubmitAsset::new(name, content)
        .processing_options(ProcessingOptions::new().retain_content(true))
        .idempotency_key(key)
}

fn stored(mock: &MockServerClient, asset_id: &str) -> Vec<u8> {
    mock.with_storage(|storage| storage.content[asset_id].bytes())
}

fn keys(mock: &MockServerClient) -> Vec<String> {
    mock.requests()
        .iter()
        .map(|request| request.header("idempotency-key").unwrap_or("").to_owned())
        .collect()
}

fn params(mock: &MockServerClient, name: &str) -> Vec<Option<String>> {
    mock.requests()
        .iter()
        .map(|request| request.query_param(name).map(str::to_owned))
        .collect()
}

fn uploading(parts: u32) -> Asset {
    let mut asset = Asset::new("asset-1", AssetClassificationStatus::Queued, None);
    asset.upload.status = "uploading".into();
    asset.upload.parts_received = Some(parts);
    asset
}

fn completed() -> Asset {
    Asset::new(
        "asset-1",
        AssetClassificationStatus::Completed,
        Some(AssetModerationDecision::Allowed),
    )
}

fn scripted(part_size: u64) -> MockServerClient {
    MockServerClient::from_builder(
        ServerClient::builder("key", "project-1")
            .part_size_bytes(part_size)
            .max_retries(0),
    )
    .unwrap()
}

#[tokio::test]
async fn content_over_the_part_size_is_split_and_joined_in_order() {
    let mock = MockServerClient::in_memory(
        MockOptions::new()
            .project_id("project-1")
            .part_size_bytes(5 * MIB as u64),
    )
    .unwrap();
    let file = file_of(11 * MIB);
    let asset = mock
        .assets()
        .classify(kept(
            "clip.mp4",
            Content::bytes(file.clone(), "video/mp4"),
            "upload-1",
        ))
        .await
        .unwrap();
    assert_eq!(asset.upload.status, "completed");
    assert_eq!(stored(&mock, &asset.id), file);
    let paths: Vec<String> = mock.requests().iter().map(|r| r.path.clone()).collect();
    let part_path = format!("/assets/{}/part", asset.id);
    assert_eq!(
        paths,
        ["/projects/project-1/assets", &part_path, &part_path]
    );
    assert_eq!(
        keys(&mock),
        ["upload-1", "upload-1:part-2", "upload-1:part-3"]
    );
    assert_eq!(
        params(&mock, "sizeInBytes"),
        [5 * MIB, 5 * MIB, MIB].map(|size| Some(size.to_string()))
    );
    assert_eq!(
        params(&mock, "totalSizeInBytes"),
        [Some((11 * MIB).to_string()), None, None]
    );
    assert_eq!(
        params(&mock, "isFinal"),
        ["false", "false", "true"].map(|value| Some(value.to_owned()))
    );
}

#[tokio::test]
async fn a_file_over_the_part_size_is_read_part_by_part() {
    let path = std::env::temp_dir().join(format!("calmlens-sdk-parts-{}.bin", std::process::id()));
    let file = file_of(9 * MIB);
    std::fs::write(&path, &file).unwrap();
    let mock = MockServerClient::in_memory(MockOptions::new()).unwrap();
    let asset = mock
        .assets()
        .create(kept(
            "report.pdf",
            Content::file(&path, "application/pdf").unwrap(),
            "file-1",
        ))
        .await
        .unwrap();
    std::fs::remove_file(&path).unwrap();
    assert_eq!(mock.requests().len(), 2);
    assert_eq!(stored(&mock, &asset.id), file);
}

#[tokio::test]
async fn a_failed_part_resumes_with_the_same_key() {
    let moderated = Arc::new(Mutex::new(Vec::new()));
    let seen = moderated.clone();
    let mock =
        MockServerClient::in_memory(MockOptions::new().part_size_bytes(5 * MIB as u64).moderate(
            move |input: &MockModerationInput| {
                let size = input.content.bytes.as_ref().map_or(0, Vec::len);
                seen.lock().unwrap().push(size);
                MockOutcome::Allowed
            },
        ))
        .unwrap();
    let file = file_of(12 * MIB);
    let options = || {
        kept(
            "report.pdf",
            Content::bytes(file.clone(), "application/pdf"),
            "upload-2",
        )
    };
    // Part 1 arrives, then part 2's connection fails.
    mock.fail_next_request(
        MockFailure::TransportError,
        MockFailureOptions::new().operation("assets.uploadPart"),
    )
    .unwrap();
    let error = mock.assets().classify(options()).await.unwrap_err();
    assert_eq!(error.code(), &ErrorCode::TransportError);
    let finished = mock.assets().classify(options()).await.unwrap();
    assert_eq!(finished.upload.status, "completed");
    assert_eq!(stored(&mock, &finished.id), file);
    let page = mock.assets().list(ListAssets::default()).await.unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(*moderated.lock().unwrap(), [12 * MIB]);
    // The second call replays part 1 and sends parts 2 and 3 with their own keys.
    assert_eq!(
        keys(&mock)[2..5],
        ["upload-2", "upload-2:part-2", "upload-2:part-3"]
    );
}

#[tokio::test]
async fn a_part_the_api_already_has_is_skipped() {
    let mock = scripted(5 * MIB as u64);
    mock.enqueue(200, uploading(1));
    mock.enqueue(200, uploading(2));
    mock.enqueue_response(MockResponse::json(
        409,
        json!({
            "code": "upload-part/invalid-number",
            "message": "Expected part 4",
            "requestId": "req-1",
            "details": { "expectedPartNumber": 4, "receivedPartNumber": 3 },
        }),
    ));
    mock.enqueue(200, completed());
    let file = file_of(16 * MIB);
    let asset = mock
        .assets()
        .create(kept(
            "report.pdf",
            Content::bytes(file.clone(), "application/pdf"),
            "upload-3",
        ))
        .await
        .unwrap();
    assert_eq!(asset.upload.status, "completed");
    assert_eq!(
        params(&mock, "partNumber"),
        ["1", "2", "3", "4"].map(|value| Some(value.to_owned()))
    );
    assert_eq!(
        keys(&mock),
        [
            "upload-3",
            "upload-3:part-2",
            "upload-3:part-3",
            "upload-3:part-4"
        ]
    );
    assert_eq!(mock.requests()[3].body, file[15 * MIB..]);
}

#[tokio::test]
async fn a_final_part_that_finds_the_upload_closed_reads_the_asset_back() {
    let mock = scripted(calmlens::DEFAULT_PART_SIZE_BYTES);
    mock.enqueue(200, uploading(1));
    mock.enqueue_api_error("upload/not-open", "The upload is not open");
    mock.enqueue(200, completed());
    let asset = mock
        .assets()
        .create(SubmitAsset::new(
            "clip.mp4",
            Content::bytes(file_of(9 * MIB), "video/mp4"),
        ))
        .await
        .unwrap();
    assert_eq!(asset.upload.status, "completed");
    let requests = mock.requests();
    assert_eq!(requests[2].method, "GET");
    assert_eq!(requests[2].path, "/assets/asset-1");
    // Without a caller's key, the parts share a generated one.
    assert_eq!(
        requests[1].header("idempotency-key").unwrap(),
        format!("{}:part-2", requests[0].header("idempotency-key").unwrap())
    );
}

#[tokio::test]
async fn streams_and_content_of_one_part_go_in_one_request() {
    let mock = MockServerClient::in_memory(MockOptions::new()).unwrap();
    let file = file_of(9 * MIB);
    let chunks = vec![Ok::<_, std::io::Error>(bytes::Bytes::from(file.clone()))];
    let streamed = mock
        .assets()
        .create(kept(
            "stream.pdf",
            Content::stream(
                futures_util::stream::iter(chunks),
                file.len() as u64,
                "application/pdf",
            ),
            "stream-1",
        ))
        .await
        .unwrap();
    mock.assets()
        .create(SubmitAsset::new(
            "exact.pdf",
            Content::bytes(file_of(8 * MIB), "application/pdf"),
        ))
        .await
        .unwrap();
    assert_eq!(params(&mock, "partNumber"), [None, None]);
    assert_eq!(
        params(&mock, "sizeInBytes"),
        [Some((9 * MIB).to_string()), Some((8 * MIB).to_string())]
    );
    assert_eq!(stored(&mock, &streamed.id), file);
}

#[test]
fn a_part_size_outside_5_to_64_mib_is_refused() {
    for size in [5 * MIB as u64 - 1, 64 * MIB as u64 + 1, 0] {
        let error = ServerClient::builder("key", "project-1")
            .part_size_bytes(size)
            .build()
            .unwrap_err();
        assert_eq!(error.code(), &ErrorCode::InvalidConfig, "{size}");
    }
    for size in [5 * MIB as u64, 64 * MIB as u64] {
        ServerClient::builder("key", "project-1")
            .part_size_bytes(size)
            .build()
            .unwrap();
    }
}

#[tokio::test]
async fn a_split_upload_refuses_a_long_key_and_an_image_over_20_mib_before_sending() {
    let mock = scripted(calmlens::DEFAULT_PART_SIZE_BYTES);
    let long = mock
        .assets()
        .create(kept(
            "clip.mp4",
            Content::bytes(file_of(9 * MIB), "video/mp4"),
            &"k".repeat(241),
        ))
        .await
        .unwrap_err();
    assert_eq!(long.code(), &ErrorCode::InvalidArgument);
    let huge = mock
        .assets()
        .create(SubmitAsset::new(
            "huge.png",
            Content::bytes(file_of(21 * MIB), "image/png"),
        ))
        .await
        .unwrap_err();
    assert_eq!(huge.code(), &ErrorCode::UploadTooLarge);
    assert_eq!(huge.details().get("limitBytes"), Some(&json!(20 * MIB)));
    assert!(mock.requests().is_empty());
    // A 240-character key fits, and an image up to 20 MiB goes in parts.
    mock.enqueue(200, uploading(1));
    mock.enqueue(200, uploading(2));
    mock.enqueue(200, completed());
    mock.assets()
        .create(kept(
            "large.png",
            Content::bytes(file_of(20 * MIB), "image/png"),
            &"k".repeat(240),
        ))
        .await
        .unwrap();
    assert_eq!(mock.requests().len(), 3);
}

#[tokio::test]
async fn a_multipart_upload_through_a_preset_takes_its_settings_and_its_declared_total_its_limit() {
    let mock =
        MockServerClient::in_memory(MockOptions::new().part_size_bytes(5 * MIB as u64)).unwrap();
    let presets = mock
        .upload_presets()
        .ensure(EnsureUploadPresets::new(vec![
            UploadPresetDefinition::new("public", "Public").visibility(Visibility::Public),
            // Each part fits, but the declared total doesn't.
            UploadPresetDefinition::new("small", "Small").max_size_in_bytes(6 * MIB as u64),
        ]))
        .await
        .unwrap()
        .upload_presets;
    let upload = |preset: usize| {
        SubmitAsset::new("clip.mp4", Content::bytes(file_of(11 * MIB), "video/mp4"))
            .upload_preset_id(presets[preset].id.clone())
    };
    let asset = mock.assets().classify(upload(0)).await.unwrap();
    assert_eq!(asset.visibility, Visibility::Public);
    mock.clear_requests();
    let error = mock.assets().classify(upload(1)).await.unwrap_err();
    assert_eq!(*error.code(), ErrorCode::UploadTooLarge);
    assert_eq!(error.status().map(|status| status.as_u16()), Some(413));
    assert_eq!(
        error.details().get("limitBytes"),
        Some(&json!(6 * MIB)),
        "{error:?}"
    );
    assert_eq!(error.details().get("source"), Some(&json!("preset")));
    assert_eq!(mock.requests().len(), 1);
}
