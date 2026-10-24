//! Replays `testdata/surface.json` and `testdata/rejections.json` (packages/sdk-contract/surface.ts):
//! every capability a server SDK must offer exists under its Rust name, and every request the API
//! would reject is refused before anything is sent. Names are compile-time references below.
use calmlens::models::*;
use calmlens::testing::{self, MockOptions, MockResponse, MockServerClient};
use calmlens::{
    AssetsClient, CdnClient, ErrorCode, EventsClient, FoldersClient, ServerClient, TextClient,
    UploadTokensClient,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// Items that exist when this file compiles, by their surface.json name.
macro_rules! references {
    ($($name:literal => $($item:expr),+;)*) => {{
        $( let _ = ($($item,)+); )*
        BTreeSet::from([$($name),*])
    }};
}

fn references() -> BTreeSet<&'static str> {
    references! {
        "folders().list" => ServerClient::folders, FoldersClient::list;
        "folders().retrieve" => ServerClient::folders, FoldersClient::retrieve;
        "folders().create" => ServerClient::folders, FoldersClient::create;
        "folders().update" => ServerClient::folders, FoldersClient::update;
        "folders().delete" => ServerClient::folders, FoldersClient::delete;
        "folders().move_folder" => ServerClient::folders, FoldersClient::move_folder;
        "assets().create" => ServerClient::assets, AssetsClient::create;
        "assets().upload_part" => ServerClient::assets, AssetsClient::upload_part;
        "assets().list" => ServerClient::assets, AssetsClient::list;
        "assets().search" => ServerClient::assets, AssetsClient::search;
        "assets().retrieve" => ServerClient::assets, AssetsClient::retrieve;
        "assets().list_children" => ServerClient::assets, AssetsClient::list_children;
        "assets().delete_content" => ServerClient::assets, AssetsClient::delete_content;
        "assets().delete" => ServerClient::assets, AssetsClient::delete;
        "assets().move_asset" => ServerClient::assets, AssetsClient::move_asset;
        "assets().retry" => ServerClient::assets, AssetsClient::retry;
        "assets().explain" => ServerClient::assets, AssetsClient::explain;
        "assets().create_signed_url" => ServerClient::assets, AssetsClient::create_signed_url;
        "assets().classify" => ServerClient::assets, AssetsClient::classify;
        "assets().update" => ServerClient::assets, AssetsClient::update;
        "assets().wait_for_decision" => ServerClient::assets, AssetsClient::wait_for_decision;
        "assets().iterate" => ServerClient::assets, AssetsClient::iterate;
        "assets().iterate_children" => ServerClient::assets, AssetsClient::iterate_children;
        "ensure_lens" => ServerClient::ensure_lens;
        "ensure_lenses" => ServerClient::ensure_lenses;
        "events().list" => ServerClient::events, EventsClient::list;
        "events().pages" => ServerClient::events, EventsClient::pages;
        "text().classify" => ServerClient::text, TextClient::classify;
        "upload_tokens().sign" => ServerClient::upload_tokens, UploadTokensClient::sign;
        "cdn().get_asset_url" => ServerClient::cdn, CdnClient::get_asset_url;
        "cdn().serve" => ServerClient::cdn, CdnClient::serve;
        "verify_webhook_signature" => |body: &[u8]| calmlens::verify_webhook_signature(body, "", "", "", 0, 0);
        "construct_webhook_event" => |body: &[u8], headers: &http::HeaderMap| calmlens::construct_webhook_event(body, headers, "");
        "create_webhook_signature_header" => |body: &[u8]| calmlens::create_webhook_signature_header(body, "", "");
        "create_webhook_headers" => |body: &[u8]| calmlens::create_webhook_headers(body, "", 0, "");
        "models::WebhookEventPayload::from_event" => WebhookEventPayload::from_event;
        "CdnRequest::allow_age_restricted" => |request: &CdnRequest| request.allow_age_restricted;
        "testing::MockServerClient::in_memory" => MockServerClient::in_memory;
        "MockOptions::queued_outcome" => MockOptions::queued_outcome;
        "MockOptions::analyzed_outcome" => MockOptions::analyzed_outcome;
        "decide" => MockServerClient::decide;
        "enqueue_event" => MockServerClient::enqueue_event;
        "testing::create_mock_api_key" => testing::create_mock_api_key;
    }
}

/// Constants and CDN resources with their values.
fn values() -> BTreeMap<&'static str, String> {
    BTreeMap::from([
        (
            "WEBHOOK_DELIVERY_HEADER",
            calmlens::WEBHOOK_DELIVERY_HEADER.to_owned(),
        ),
        (
            "WEBHOOK_TIMESTAMP_HEADER",
            calmlens::WEBHOOK_TIMESTAMP_HEADER.to_owned(),
        ),
        (
            "WEBHOOK_SIGNATURE_HEADER",
            calmlens::WEBHOOK_SIGNATURE_HEADER.to_owned(),
        ),
        (
            "ErrorCode::AssetNotFound",
            ErrorCode::AssetNotFound.as_str().to_owned(),
        ),
        (
            "ErrorCode::InvalidArgument",
            ErrorCode::InvalidArgument.as_str().to_owned(),
        ),
        (
            "CdnResource::Original",
            CdnResource::Original.as_str().to_owned(),
        ),
        (
            "CdnResource::Rendered",
            CdnResource::Rendered.as_str().to_owned(),
        ),
        (
            "CdnResource::Placeholder",
            CdnResource::Placeholder.as_str().to_owned(),
        ),
    ])
}

type Field = fn(&calmlens::Error) -> Value;

/// Error accessors, as the JSON value surface.json expects.
fn error_fields() -> BTreeMap<&'static str, Field> {
    BTreeMap::from([
        ("code()", (|e| json!(e.code().as_str())) as Field),
        ("status()", |e| json!(e.status())),
        ("request_id()", |e| json!(e.request_id())),
        ("retry_after()", |e| {
            json!(e.retry_after().map(|d| d.as_secs()))
        }),
    ])
}

fn testdata(name: &str) -> Value {
    let path = format!("{}/testdata/{name}.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[tokio::test]
async fn offers_every_capability() {
    let surface = testdata("surface");
    let spec = &surface["errorResponse"];
    let mock = MockServerClient::new().unwrap();
    let mut response = MockResponse::json(spec["status"].as_u64().unwrap() as u16, &spec["body"]);
    for (name, value) in spec["headers"].as_object().unwrap() {
        response = response.header(name, value.as_str().unwrap());
    }
    mock.enqueue_response(response);
    let error = mock
        .client()
        .with_max_retries(0)
        .assets()
        .retrieve(serde_json::from_value(spec["options"].clone()).unwrap())
        .await
        .unwrap_err();
    let expected = &spec["expected"];
    let want = |id: &str| match id {
        "errors.code" => expected["code"].clone(),
        "errors.status" => expected["status"].clone(),
        "errors.requestId" => expected["requestId"].clone(),
        "errors.retryAfter" => expected["retryAfterSeconds"].clone(),
        other => panic!("unknown error field {other}"),
    };
    let client = ServerClient::new("key", "project-1").unwrap();
    let (references, values, fields) = (references(), values(), error_fields());
    let mut used = BTreeSet::new();
    let mut missing = Vec::new();
    for capability in surface["capabilities"].as_array().unwrap() {
        let id = capability["id"].as_str().unwrap();
        let name = capability["names"]["rust"].as_str().unwrap();
        let value = capability["value"].as_str();
        let present = match capability["kind"].as_str().unwrap() {
            "constant" => values.get(name).map(String::as_str) == value,
            "cdn-resource" => {
                let request = CdnRequest {
                    asset_identifier: "asset-1".into(),
                    resource: value.map(CdnResource::from),
                    ..Default::default()
                };
                values.get(name).map(String::as_str) == value
                    && client.cdn().get_asset_url(&request).is_ok_and(|url| {
                        url.ends_with(&format!("/asset-1/{}", value.unwrap_or_default()))
                    })
            }
            "error-field" => fields
                .get(name)
                .is_some_and(|field| field(&error) == want(id)),
            _ => references.contains(name),
        };
        used.insert(name);
        if !present {
            missing.push(format!("{id} ({name})"));
        }
    }
    assert_eq!(missing, Vec::<String>::new(), "missing capabilities");
    let known: BTreeSet<&str> = references
        .iter()
        .copied()
        .chain(values.keys().copied())
        .chain(fields.keys().copied())
        .collect();
    let stale: Vec<_> = known.difference(&used).collect();
    assert!(
        stale.is_empty(),
        "references not in surface.json: {stale:?}"
    );
}

/// Fixture options a Rust type cannot hold, so the type already refuses the request.
const REJECTED_BY_TYPE: [(&str, &str); 2] = [
    (
        "signed URL lifetime below 1 second",
        "SignedUrlOptions::expires_in_seconds is a u64",
    ),
    (
        "signed URL lifetime of a fraction of a second",
        "SignedUrlOptions::expires_in_seconds is a u64",
    ),
];

async fn reject(
    client: &ServerClient,
    operation: &str,
    options: Value,
) -> Result<calmlens::Result<()>, serde_json::Error> {
    fn decode<T: serde::de::DeserializeOwned>(options: Value) -> Result<T, serde_json::Error> {
        serde_json::from_value(options)
    }
    Ok(match operation {
        "assets.createSignedUrl" => client
            .assets()
            .create_signed_url(decode(options)?)
            .await
            .map(drop),
        "text.classify" => client.text().classify(decode(options)?).await.map(drop),
        "assets.retrieve" => client.assets().retrieve(decode(options)?).await.map(drop),
        "assets.waitForDecision" => client
            .assets()
            .wait_for_decision(WaitForDecision::new(decode::<AssetId>(options)?.asset_id))
            .await
            .map(drop),
        "assets.delete" => client.assets().delete(decode(options)?).await,
        "folders.retrieve" => client.folders().retrieve(decode(options)?).await.map(drop),
        "cdn.serve" => client.cdn().serve(decode(options)?).await.map(drop),
        other => panic!("unhandled operation {other}"),
    })
}

#[tokio::test]
async fn refuses_rejected_requests_before_sending() {
    let mock = MockServerClient::new().unwrap();
    for rejection in testdata("rejections").as_array().unwrap() {
        let name = rejection["name"].as_str().unwrap();
        let operation = rejection["operation"].as_str().unwrap();
        let result = reject(&mock, operation, rejection["options"].clone()).await;
        match REJECTED_BY_TYPE.iter().find(|(case, _)| *case == name) {
            Some((_, reason)) => assert!(result.is_err(), "{name}: {reason}, yet it decoded"),
            None => {
                let error = result
                    .unwrap_or_else(|cause| panic!("{name}: {cause}"))
                    .expect_err(name);
                assert_eq!(rejection["error"], error.code().as_str(), "{name}");
            }
        }
    }
    assert_eq!(mock.requests().len(), 0);
}
