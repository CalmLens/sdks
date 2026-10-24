//! Replays every shared SDK contract fixture in `testdata/` (packages/sdk-contract/README.md):
//! requests, paths, webhooks, errors, transform options, mock behaviour scenarios, the capability
//! surface and refused requests. Each fixture case runs on its own and a failure names the case.
mod common;
use calmlens::models::*;
use calmlens::testing::{self, MockOptions, MockResponse, MockServerClient};
use calmlens::{
    AssetsClient, CdnClient, ErrorCode, EventsClient, FoldersClient, ServerClient, TextClient,
    UploadTokensClient,
};
use common::{input, invoke, typed};
use futures_util::FutureExt;
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    future::Future,
    io::{Read, Write},
    net::TcpListener,
    panic::AssertUnwindSafe,
    thread,
    time::Duration,
};

/// Loads a shared fixture file from `testdata/`.
fn fixture(name: &str) -> Value {
    let path = format!("{}/testdata/{name}.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// Runs every named case, so one failure doesn't hide the others, then fails naming each failed case.
async fn each_case<'a, F, Fut>(
    group: &str,
    cases: impl IntoIterator<Item = (String, &'a Value)>,
    run: F,
) where
    F: Fn(&'a Value) -> Fut,
    Fut: Future<Output = ()>,
{
    let mut count = 0;
    let mut failed = Vec::new();
    for (name, case) in cases {
        count += 1;
        if AssertUnwindSafe(run(case)).catch_unwind().await.is_err() {
            failed.push(name);
        }
    }
    println!("{group}: {count} cases");
    assert!(count > 0, "{group} has no cases");
    assert_eq!(failed, Vec::<String>::new(), "failed {group} cases");
}

/// Cases named by their index and a field of each.
fn named<'a>(cases: &'a Value, field: &'a str) -> impl Iterator<Item = (String, &'a Value)> + 'a {
    cases
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(move |(i, case)| (format!("{i}: {}", case[field]), case))
}

// requests.json

/// Serves one fixture response on a local port and returns the request it received.
fn serve_once(listener: TcpListener, response: String) -> thread::JoinHandle<Value> {
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        let end = loop {
            let n = stream.read(&mut buffer).unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&buffer[..n]);
            if let Some(index) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                break index + 4;
            }
        };
        let headers = String::from_utf8(bytes[..end].to_vec()).unwrap();
        let mut parts = headers.lines().next().unwrap().split_whitespace();
        let method = parts.next().unwrap().to_string();
        let path = parts.next().unwrap();
        let url = reqwest::Url::parse(&format!("http://localhost{path}")).unwrap();
        let query = Value::Object(
            url.query_pairs()
                .map(|(k, v)| (k.into_owned(), json!(v.into_owned())))
                .collect(),
        );
        let length = headers
            .lines()
            .find_map(|line| {
                line.to_lowercase()
                    .strip_prefix("content-length: ")
                    .and_then(|v| v.parse::<usize>().ok())
            })
            .unwrap_or(0);
        while bytes.len() < end + length {
            let n = stream.read(&mut buffer).unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&buffer[..n]);
        }
        let body = &bytes[end..end + length];
        let lower = headers.to_lowercase();
        let body = if length == 0 {
            Value::Null
        } else if lower.contains("content-type: application/json") {
            serde_json::from_slice(body).unwrap()
        } else {
            json!(String::from_utf8(body.to_vec()).unwrap())
        };
        assert!(lower.contains("x-api-key: key"));
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
        json!({"method": method, "path": url.path(), "query": query, "body": body})
    })
}

#[tokio::test]
async fn request_contracts() {
    let fixtures = fixture("requests");
    each_case(
        "requests",
        named(&fixtures, "operation"),
        |fixture| async move {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = serve_once(listener, fixture["response"].to_string());
            let client = calmlens::ServerClient::builder("key", "project-1")
                .base_url(format!("http://127.0.0.1:{port}/v1"))
                .build()
                .unwrap();
            invoke(
                &client,
                fixture["operation"].as_str().unwrap(),
                fixture["options"].clone(),
            )
            .await
            .unwrap();
            assert_eq!(fixture["request"], server.join().unwrap());
        },
    )
    .await;
}

/// Queued responses still pass through the real client, so every request contract holds against the mock.
#[tokio::test]
async fn request_contracts_through_the_mock() {
    let fixtures = fixture("requests");
    each_case(
        "mock requests",
        named(&fixtures, "operation"),
        |f| async move {
            let mock = MockServerClient::new().unwrap();
            mock.enqueue(200, f["response"].clone());
            invoke(
                &mock,
                f["operation"].as_str().unwrap(),
                f["options"].clone(),
            )
            .await
            .unwrap();
            let requests = mock.requests();
            assert_eq!(requests.len(), 1);
            assert_eq!(f["request"], common::describe(&requests[0]));
            assert_eq!(mock.remaining_responses(), 0);
        },
    )
    .await;
}

// paths.json

#[tokio::test]
async fn path_safety_contracts() {
    let paths = fixture("paths");
    let mock = &MockServerClient::new().unwrap();
    each_case(
        "path rejections",
        named(&paths["rejections"], "operation"),
        |rejection| async move {
            let error = invoke(
                mock,
                rejection["operation"].as_str().unwrap(),
                rejection["options"].clone(),
            )
            .await
            .unwrap_err();
            assert_eq!(rejection["error"], error.code().as_str(), "{rejection}");
        },
    )
    .await;
    assert_eq!(mock.requests().len(), 0);
}

#[tokio::test]
async fn cdn_url_contracts() {
    let paths = fixture("paths");
    let client = &calmlens::ServerClient::new("key", "project-1").unwrap();
    each_case(
        "CDN URLs",
        named(&paths["cdnUrls"], "options"),
        |cdn| async move {
            let request: CdnRequest = typed(cdn["options"].clone());
            // Every fixture option must reach the request; serde would otherwise ignore one silently.
            // An invalid transform cannot be re-encoded, so it is checked by presence.
            let decoded = serde_json::to_value(CdnRequest {
                transform: None,
                ..request.clone()
            })
            .unwrap();
            for key in cdn["options"].as_object().unwrap().keys() {
                let kept = match key.as_str() {
                    "transform" => request.transform.is_some(),
                    _ => decoded.get(key).is_some(),
                };
                assert!(kept, "unsupported CDN option {key}: {cdn}");
            }
            let result = client.cdn().get_asset_url(&request);
            match cdn["url"].as_str() {
                Some(url) => assert_eq!(url, result.unwrap(), "{cdn}"),
                None => assert_eq!(cdn["error"], result.unwrap_err().code().as_str(), "{cdn}"),
            }
        },
    )
    .await;
}

// webhooks.json

#[tokio::test]
async fn webhook_verification_contracts() {
    let fixtures = fixture("webhooks");
    each_case(
        "webhook verification",
        named(&fixtures["verification"], "name"),
        |v| async move {
            assert_eq!(
                v["valid"].as_bool().unwrap(),
                calmlens::verify_webhook_signature(
                    v["body"].as_str().unwrap(),
                    v["signature"].as_str().unwrap(),
                    v["timestamp"].as_str().unwrap(),
                    v["secret"].as_str().unwrap(),
                    v["now"].as_u64().unwrap(),
                    v.get("toleranceSeconds")
                        .and_then(Value::as_u64)
                        .unwrap_or(calmlens::WEBHOOK_SIGNATURE_TOLERANCE_SECONDS)
                )
            );
        },
    )
    .await;
}

#[tokio::test]
async fn webhook_signature_contracts() {
    let fixtures = fixture("webhooks");
    each_case(
        "webhook signatures",
        named(&fixtures["signatures"], "timestamp"),
        |v| async move {
            let (body, timestamp, secret) = (
                v["body"].as_str().unwrap(),
                v["timestamp"].as_str().unwrap(),
                v["secret"].as_str().unwrap(),
            );
            let signature = calmlens::create_webhook_signature_header(body, timestamp, secret);
            assert_eq!(signature, v["signature"].as_str().unwrap());
            assert!(calmlens::verify_webhook_signature(
                body,
                &signature,
                timestamp,
                secret,
                timestamp.parse().unwrap(),
                300
            ));
        },
    )
    .await;
}

#[tokio::test]
async fn webhook_payload_contracts() {
    let fixtures = fixture("webhooks");
    each_case(
        "webhook payloads",
        fixtures["payloads"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(i, item)| (format!("{i}: {}", item["event"]["type"]), item)),
        |item| async move {
            let expected = &item["payload"];
            let parsed =
                calmlens::parse_webhook_event(serde_json::to_vec(expected).unwrap()).unwrap();
            assert_eq!(parsed.id, expected["id"].as_str().unwrap());
            assert_eq!(
                parsed.event_type.as_str(),
                expected["type"].as_str().unwrap()
            );
            assert_eq!(
                parsed.data.asset_id.as_deref(),
                expected["data"]["assetId"].as_str()
            );
            assert_eq!(
                parsed
                    .data
                    .asset
                    .as_ref()
                    .and_then(|asset| asset.upload_preset_id.as_deref()),
                expected["data"]["asset"]["uploadPresetId"].as_str()
            );
            assert_eq!(serde_json::to_value(&parsed).unwrap(), *expected);
            // The same conversion CalmLens applies to a stored event before delivering it.
            let event: Event = typed(item["event"].clone());
            assert_eq!(
                serde_json::to_value(WebhookEventPayload::from_event(&event)).unwrap(),
                *expected
            );
        },
    )
    .await;
}

#[tokio::test]
async fn future_webhook_fields_and_types_are_accepted() {
    let fixtures = fixture("webhooks");
    each_case(
        "webhook parsing",
        named(&fixtures["parsing"], "expectedType"),
        |f| async move {
            let event = calmlens::construct_webhook_event_at(
                f["body"].as_str().unwrap(),
                f["signature"].as_str().unwrap(),
                f["timestamp"].as_str().unwrap(),
                f["secret"].as_str().unwrap(),
                f["now"].as_u64().unwrap(),
                300,
            )
            .unwrap();
            assert_eq!(
                event.event_type.as_str(),
                f["expectedType"].as_str().unwrap()
            );
            assert_eq!(
                event.data.facts[0].key,
                f["expectedFactKey"].as_str().unwrap()
            );
            assert_eq!(event.data.facts[0].value, serde_json::json!({"count": 3}));
        },
    )
    .await;
}

#[test]
fn webhook_verification_uses_exact_raw_bytes() {
    // 0xff is not valid UTF-8, so this body cannot be passed through a `&str`.
    let body: &[u8] = b"{\"a\":\"\xff\"}";
    let header = calmlens::create_webhook_signature_header(body, "1700000000", "key");
    let verify = |body: &[u8]| {
        calmlens::verify_webhook_signature(body, &header, "1700000000", "key", 1_700_000_000, 300)
    };
    assert!(verify(body));
    assert!(!verify(String::from_utf8_lossy(body).as_bytes()));
    let mut tampered = body.to_vec();
    tampered[6] = 0xfe;
    assert!(!verify(&tampered));
}

fn signed_delivery(body: &str, timestamp: u64) -> http::HeaderMap {
    let mut headers = http::HeaderMap::new();
    let stamp = timestamp.to_string();
    headers.insert(
        calmlens::WEBHOOK_SIGNATURE_HEADER,
        calmlens::create_webhook_signature_header(body, &stamp, "secret")
            .parse()
            .unwrap(),
    );
    headers.insert(calmlens::WEBHOOK_TIMESTAMP_HEADER, stamp.parse().unwrap());
    headers
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

#[test]
fn construct_webhook_event_verifies_headers_then_parses() {
    let body = r#"{"id":"event-1","type":"asset.blocked","data":{"assetId":"asset-1","facts":[]}}"#;
    let event =
        calmlens::construct_webhook_event(body, &signed_delivery(body, now()), "secret").unwrap();
    assert_eq!(
        (event.id.as_str(), event.data.asset_id.as_deref()),
        ("event-1", Some("asset-1"))
    );

    let wrong_secret =
        calmlens::construct_webhook_event(body, &signed_delivery(body, now()), "another-secret")
            .unwrap_err();
    assert_eq!(
        wrong_secret.code(),
        &calmlens::ErrorCode::InvalidWebhookSignature
    );

    let stale = signed_delivery(
        body,
        now() - calmlens::WEBHOOK_SIGNATURE_TOLERANCE_SECONDS - 60,
    );
    let error = calmlens::construct_webhook_event(body, &stale, "secret").unwrap_err();
    assert_eq!(error.code(), &"sdk/invalid-webhook-signature");

    let unsigned = calmlens::construct_webhook_event(body, &http::HeaderMap::new(), "secret");
    assert_eq!(
        unsigned.unwrap_err().code(),
        &"sdk/invalid-webhook-signature"
    );

    let tampered = body.replace("asset-1", "asset-2");
    let error =
        calmlens::construct_webhook_event(&tampered, &signed_delivery(body, now()), "secret")
            .unwrap_err();
    assert_eq!(error.code(), &"sdk/invalid-webhook-signature");

    let not_a_delivery = r#"{"hello":"world"}"#;
    let error = calmlens::construct_webhook_event(
        not_a_delivery,
        &signed_delivery(not_a_delivery, now()),
        "secret",
    )
    .unwrap_err();
    assert_eq!(error.code(), &"sdk/invalid-webhook-payload");
}

#[test]
fn invalid_webhook_payloads() {
    for body in [
        "",
        "not json",
        "[]",
        r#"{"type":"asset.classified","data":{}}"#,
        r#"{"id":"event-1","data":{}}"#,
        r#"{"id":"event-1","type":"asset.classified"}"#,
        r#"{"id":"","type":"asset.classified","data":{}}"#,
    ] {
        assert_eq!(
            calmlens::parse_webhook_event(body).unwrap_err().code(),
            &"sdk/invalid-webhook-payload",
            "{body}"
        );
    }
    let minimal =
        calmlens::parse_webhook_event(r#"{"id":"event-1","type":"test.sent","data":{}}"#).unwrap();
    assert!(minimal.data.facts.is_empty());
}

#[test]
fn create_webhook_headers_sign_a_delivery_construct_webhook_event_accepts() {
    let body = r#"{"id":"event-1","type":"asset.allowed","data":{"facts":[]}}"#;
    let headers = calmlens::create_webhook_headers(body, "delivery-1", now(), "secret").unwrap();
    assert_eq!(headers[calmlens::WEBHOOK_DELIVERY_HEADER], "delivery-1");
    assert_eq!(headers[http::header::CONTENT_TYPE], "application/json");
    let event = calmlens::construct_webhook_event(body, &headers, "secret").unwrap();
    assert_eq!(event.id, "event-1");
    let error = calmlens::construct_webhook_event(body, &headers, "other").unwrap_err();
    assert_eq!(error.code().as_str(), "sdk/invalid-webhook-signature");
    let invalid = calmlens::create_webhook_headers(body, "bad\nid", now(), "secret").unwrap_err();
    assert_eq!(invalid.code().as_str(), "sdk/invalid-argument");
}

// errors.json

#[test]
fn error_codes_match_the_api() {
    let fixtures = fixture("errors");
    let expected: Vec<(String, u16)> = fixtures
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let status = e["status"].as_u64().unwrap() as u16;
            (e["code"].as_str().unwrap().to_owned(), status)
        })
        .collect();
    let generated: Vec<(String, u16)> = calmlens::ErrorCode::API_CODES
        .iter()
        .map(|(code, status)| ((*code).to_owned(), *status))
        .collect();
    assert_eq!(generated, expected);
}

#[tokio::test]
async fn each_api_error_code_parses_with_its_status() {
    let fixtures = fixture("errors");
    each_case("errors", named(&fixtures, "code"), |e| async move {
        let code = e["code"].as_str().unwrap();
        let parsed = calmlens::ErrorCode::parse(code);
        assert!(!matches!(parsed, calmlens::ErrorCode::Other(_)), "{code}");
        assert_eq!(
            parsed.http_status(),
            Some(e["status"].as_u64().unwrap() as u16)
        );
    })
    .await;
}

// transform-options.json

/// Every transform option, decoded into `ImageTransformOptions` and serialized, gives the step the
/// CDN writes for it: an option the type doesn't know lands in `extra` and fails here.
#[tokio::test]
async fn transform_option_contracts() {
    let fixture = fixture("transform-options");
    each_case(
        "transform options",
        named(&fixture["cases"], "selector"),
        |case| async move {
            let options: ImageTransformOptions =
                serde_json::from_value(case["options"].clone()).unwrap();
            assert!(
                options.extra.is_empty(),
                "{}: {:?}",
                case["options"],
                options.extra
            );
            let selector = CdnTransform::Steps(vec![Transform::image(options)])
                .selector()
                .unwrap();
            assert_eq!(selector, case["selector"].as_str().unwrap());
        },
    )
    .await;
}

#[tokio::test]
async fn validation_and_urls() {
    let client = calmlens::ServerClient::new("key", "project-1").unwrap();
    let invalid_base64 = SubmitAsset::new(
        "x",
        Content {
            mime_type: "text/plain".into(),
            payload: Payload::Base64("!".into()),
            ..Default::default()
        },
    );
    assert_eq!(
        client
            .assets()
            .create(invalid_base64)
            .await
            .unwrap_err()
            .code(),
        &"upload/invalid-payload"
    );
    let both = CdnRequest {
        asset_identifier: "x".into(),
        lens: Some("one".into()),
        transform: Some("format=avif".into()),
        ..Default::default()
    };
    assert_eq!(
        client.cdn().get_asset_url(&both).unwrap(),
        "https://cdn.calmlens.com/v1/assets/project-1/x/rendered/@one/format=avif"
    );
}

#[test]
fn structured_transform_numbers_format_like_javascript() {
    for (number, text) in [
        (json!(1e21), "1e%2B21"),
        (json!(1.5e-7), "1.5e-7"),
        (json!(0.000001), "0.000001"),
        (json!(123456789012345680000.0), "123456789012345680000"),
        (json!(-2.5), "-2.5"),
        (json!(-0.0), "0"),
        (json!(-3), "-3"),
    ] {
        let step = Transform::Unknown {
            transform_type: "imageTransform".into(),
            options: json!({ "blur": number }),
        };
        assert_eq!(
            CdnTransform::from(step).selector().unwrap(),
            format!("blur={text}"),
            "{number}"
        );
    }
}

// mock-scenarios.json: replayed against `MockServerClient::in_memory`.

/// Follows a dotted path: numeric segments index arrays, `length` is an array's length.
fn at(value: &Value, path: &str) -> Value {
    path.split('.')
        .fold(value.clone(), |current, segment| match current {
            Value::Array(items) if segment == "length" => json!(items.len()),
            Value::Array(items) => segment
                .parse::<usize>()
                .ok()
                .and_then(|index| items.get(index).cloned())
                .unwrap_or(Value::Null),
            Value::Object(map) => map.get(segment).cloned().unwrap_or(Value::Null),
            _ => Value::Null,
        })
}

fn resolve(value: &Value, saved: &HashMap<String, Value>) -> Value {
    match value {
        Value::Object(map) if map.contains_key("$ref") => {
            let reference = map["$ref"].as_str().unwrap();
            let (name, rest) = reference.split_once('.').unwrap();
            at(&saved[name], rest)
        }
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), resolve(item, saved)))
                .collect(),
        ),
        Value::Array(items) => {
            Value::Array(items.iter().map(|item| resolve(item, saved)).collect())
        }
        other => other.clone(),
    }
}

async fn run_step(
    mock: &MockServerClient,
    operation: &str,
    args: Value,
) -> calmlens::Result<Value> {
    match operation {
        "mock.decide" => {
            let decision: AssetModerationDecision = typed(args["outcome"].clone());
            let asset = mock.decide(args["assetId"].as_str().unwrap(), decision)?;
            Ok(serde_json::to_value(asset).unwrap())
        }
        "mock.enqueueEvent" => {
            let mut event = args.clone();
            event["id"] = json!("");
            Ok(serde_json::to_value(mock.enqueue_event(typed(event))).unwrap())
        }
        "cdn.serve" => {
            let response = mock.cdn().serve(input(args)?).await?;
            let status = response.status().as_u16();
            // HTTP header names are lowercase; expectations name them case-insensitively.
            let headers: Map<String, Value> = response
                .headers()
                .iter()
                .map(|(name, value)| (name.as_str().to_owned(), json!(value.to_str().unwrap())))
                .collect();
            let json = response
                .headers()
                .get("content-type")
                .is_some_and(|value| value == "application/json");
            let body = response.text().await?;
            let code = if json {
                serde_json::from_str::<Value>(&body).unwrap()["code"].clone()
            } else {
                Value::Null
            };
            Ok(json!({"status": status, "code": code, "body": body, "headers": headers}))
        }
        "assets.waitForDecision" => {
            let timeout = Duration::from_millis(args["timeoutMs"].as_u64().unwrap());
            let request = WaitForDecision::new(args["assetId"].as_str().unwrap()).timeout(timeout);
            Ok(serde_json::to_value(mock.assets().wait_for_decision(request).await?).unwrap())
        }
        _ => invoke(mock, operation, args).await,
    }
}

async fn check_step(
    mock: &MockServerClient,
    scenario: &str,
    step: &Value,
    saved: &mut HashMap<String, Value>,
) {
    let operation = step["operation"].as_str().unwrap();
    let label = format!("{scenario}: {operation} {}", step["args"]);
    let args = resolve(step.get("args").unwrap_or(&json!({})), saved);
    let empty = Value::Object(Map::new());
    let expect = step.get("expect").unwrap_or(&empty);
    let outcome = run_step(mock, operation, args).await;
    if let Some(wanted) = expect.get("error") {
        let error = outcome.expect_err(&label);
        assert_eq!(
            json!({"code": error.code().as_str(), "status": error.status()}),
            *wanted,
            "{label}"
        );
        return;
    }
    let result = outcome.unwrap_or_else(|error| panic!("{label}: {error:?}"));
    if let Some(Value::Object(cdn)) = expect.get("cdn") {
        for (key, wanted) in cdn {
            if key == "headers" {
                for (name, value) in wanted.as_object().unwrap() {
                    let served = &result["headers"][name.to_ascii_lowercase()];
                    assert_eq!(served, value, "{label}: cdn header {name}");
                }
            } else {
                assert_eq!(result[key], *wanted, "{label}: cdn {key}");
            }
        }
    }
    if let Some(name) = expect["sameAs"].as_str() {
        let first = saved
            .get(name)
            .unwrap_or_else(|| panic!("{label}: nothing saved as {name}"));
        assert_eq!(result, *first, "{label}: same as {name}");
    }
    if let Some(Value::Object(paths)) = expect.get("result") {
        for (path, raw) in paths {
            let actual = at(&result, path);
            if let Some(member) = raw.get("$contains") {
                let member = resolve(member, saved);
                let items = actual
                    .as_array()
                    .unwrap_or_else(|| panic!("{label}: {path} is not an array"));
                assert!(
                    items.contains(&member),
                    "{label}: {path} {actual} lacks {member}"
                );
            } else {
                assert_eq!(actual, resolve(raw, saved), "{label}: {path}");
            }
        }
    }
    if let Some(name) = step["save"].as_str() {
        saved.insert(name.to_owned(), result);
    }
}

fn outcome(value: Option<&Value>, default: testing::MockOutcome) -> testing::MockOutcome {
    use testing::MockOutcome;
    match value.and_then(Value::as_str) {
        None => default,
        Some("pending") => MockOutcome::Pending,
        Some("allowed") => MockOutcome::Allowed,
        Some("age-restricted") => MockOutcome::AgeRestricted,
        Some("blocked") => MockOutcome::Blocked,
        Some("purged") => MockOutcome::Purged,
        Some("failed") => MockOutcome::Failed,
        Some(other) => panic!("unknown outcome {other}"),
    }
}

#[tokio::test]
async fn mock_scenarios() {
    let file = fixture("mock-scenarios");
    each_case(
        "mock scenarios",
        named(&file["scenarios"], "name"),
        |scenario| async move {
            let name = scenario["name"].as_str().unwrap();
            let options = &scenario["mock"];
            let grants: Vec<testing::MockApiKeyGrant> =
                typed(options.get("apiKeyGrants").cloned().unwrap_or(json!([])));
            let mock = MockServerClient::in_memory(
                MockOptions::new()
                    .project_id("project-1")
                    .api_key(testing::create_mock_api_key(&grants))
                    .queued_outcome(outcome(
                        options.get("queuedOutcome"),
                        testing::MockOutcome::Pending,
                    ))
                    .analyzed_outcome(outcome(
                        options.get("analyzedOutcome"),
                        testing::MockOutcome::Allowed,
                    )),
            )
            .unwrap();
            let started = std::time::Instant::now();
            let mut saved = HashMap::new();
            for step in scenario["steps"].as_array().unwrap() {
                check_step(&mock, name, step, &mut saved).await;
            }
            // Mock waits take no real time.
            assert!(started.elapsed() < Duration::from_secs(5), "{name}");
        },
    )
    .await;
}

// surface.json: every capability a server SDK must offer exists under its Rust name. Names are
// compile-time references below.

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

/// The error surface.json's `errorResponse` raises.
async fn surface_error(spec: &Value) -> calmlens::Error {
    let mock = MockServerClient::new().unwrap();
    let mut response = MockResponse::json(spec["status"].as_u64().unwrap() as u16, &spec["body"]);
    for (name, value) in spec["headers"].as_object().unwrap() {
        response = response.header(name, value.as_str().unwrap());
    }
    mock.enqueue_response(response);
    mock.client()
        .with_max_retries(0)
        .assets()
        .retrieve(serde_json::from_value(spec["options"].clone()).unwrap())
        .await
        .unwrap_err()
}

#[tokio::test]
async fn offers_every_capability() {
    let surface = fixture("surface");
    let spec = &surface["errorResponse"];
    let error = &surface_error(spec).await;
    let expected = &spec["expected"];
    let want = |id: &str| match id {
        "errors.code" => expected["code"].clone(),
        "errors.status" => expected["status"].clone(),
        "errors.requestId" => expected["requestId"].clone(),
        "errors.retryAfter" => expected["retryAfterSeconds"].clone(),
        other => panic!("unknown error field {other}"),
    };
    let want = &want;
    let client = &ServerClient::new("key", "project-1").unwrap();
    let (references, values, fields) = (&references(), &values(), &error_fields());
    each_case(
        "capabilities",
        named(&surface["capabilities"], "id"),
        |capability| async move {
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
                    .is_some_and(|field| field(error) == want(id)),
                _ => references.contains(name),
            };
            assert!(present, "missing capability {id} ({name})");
        },
    )
    .await;
    let used: BTreeSet<&str> = surface["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|capability| capability["names"]["rust"].as_str().unwrap())
        .collect();
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

// rejections.json: every request the API would reject is refused before anything is sent.

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
    let rejections = fixture("rejections");
    let mock = &MockServerClient::new().unwrap();
    each_case(
        "rejections",
        named(&rejections, "name"),
        |rejection| async move {
            let name = rejection["name"].as_str().unwrap();
            let operation = rejection["operation"].as_str().unwrap();
            let result = reject(mock, operation, rejection["options"].clone()).await;
            match REJECTED_BY_TYPE.iter().find(|(case, _)| *case == name) {
                Some((_, reason)) => assert!(result.is_err(), "{name}: {reason}, yet it decoded"),
                None => {
                    let error = result
                        .unwrap_or_else(|cause| panic!("{name}: {cause}"))
                        .expect_err(name);
                    assert_eq!(rejection["error"], error.code().as_str(), "{name}");
                }
            }
        },
    )
    .await;
    assert_eq!(mock.requests().len(), 0);
}
