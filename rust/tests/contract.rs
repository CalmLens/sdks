mod common;
use calmlens::models::*;
use common::typed;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

#[tokio::test]
async fn request_contracts() {
    let fixtures: Value = serde_json::from_str(include_str!("../testdata/requests.json")).unwrap();
    for fixture in fixtures.as_array().unwrap() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let response = fixture["response"].to_string();
        let server = thread::spawn(move || {
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
        });
        let client = calmlens::ServerClient::builder("key", "project-1")
            .base_url(format!("http://127.0.0.1:{port}/v1"))
            .build()
            .unwrap();
        common::invoke(
            &client,
            fixture["operation"].as_str().unwrap(),
            fixture["options"].clone(),
        )
        .await
        .unwrap();
        assert_eq!(
            fixture["request"],
            server.join().unwrap(),
            "{}",
            fixture["operation"]
        );
    }
}

#[tokio::test]
async fn path_safety_contracts() {
    let paths: Value = serde_json::from_str(include_str!("../testdata/paths.json")).unwrap();
    let mock = calmlens::testing::MockServerClient::new().unwrap();
    for rejection in paths["rejections"].as_array().unwrap() {
        let error = common::invoke(
            &mock,
            rejection["operation"].as_str().unwrap(),
            rejection["options"].clone(),
        )
        .await
        .unwrap_err();
        assert_eq!(rejection["error"], error.code().as_str(), "{rejection}");
    }
    assert_eq!(mock.requests().len(), 0);
    let client = calmlens::ServerClient::new("key", "project-1").unwrap();
    for cdn in paths["cdnUrls"].as_array().unwrap() {
        let result = client.cdn().get_asset_url(&typed(cdn["options"].clone()));
        match cdn["url"].as_str() {
            Some(url) => assert_eq!(url, result.unwrap(), "{cdn}"),
            None => assert_eq!(cdn["error"], result.unwrap_err().code().as_str(), "{cdn}"),
        }
    }
}

#[test]
fn webhook_contracts() {
    let fixtures: Value = serde_json::from_str(include_str!("../testdata/webhooks.json")).unwrap();
    for v in fixtures["verification"].as_array().unwrap() {
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
            ),
            "{}",
            v["name"]
        );
    }
}

#[test]
fn webhook_signature_round_trip() {
    let fixtures: Value = serde_json::from_str(include_str!("../testdata/webhooks.json")).unwrap();
    for v in fixtures["signatures"].as_array().unwrap() {
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
    }
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
    let body =
        r#"{"id":"event-1","type":"asset.rejected","data":{"assetId":"asset-1","facts":[]}}"#;
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
fn webhook_payload_contracts() {
    let fixtures: Value = serde_json::from_str(include_str!("../testdata/webhooks.json")).unwrap();
    let payloads = fixtures["payloads"].as_array().unwrap();
    assert!(payloads.len() >= 2);
    for item in payloads {
        let expected = &item["payload"];
        let parsed = calmlens::parse_webhook_event(serde_json::to_vec(expected).unwrap()).unwrap();
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
            *expected,
            "{}",
            item["event"]["type"]
        );
    }
}

#[test]
fn invalid_webhook_payloads() {
    for body in [
        "",
        "not json",
        "[]",
        r#"{"type":"asset.flagged","data":{}}"#,
        r#"{"id":"event-1","data":{}}"#,
        r#"{"id":"event-1","type":"asset.flagged"}"#,
        r#"{"id":"","type":"asset.flagged","data":{}}"#,
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
        transform: Some("imageTransform[format=avif]".into()),
        ..Default::default()
    };
    assert_eq!(
        client.cdn().get_asset_url(&both).unwrap(),
        "https://cdn.calmlens.com/v1/assets/project-1/x/content/@one,imageTransform[format=avif]"
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
            transform_type: "blur".into(),
            options: json!({ "radius": number }),
        };
        assert_eq!(
            CdnTransform::from(step).selector().unwrap(),
            format!("blur[radius={text}]"),
            "{number}"
        );
    }
}

#[test]
fn error_codes_match_the_api() {
    let fixtures: Value = serde_json::from_str(include_str!("../testdata/errors.json")).unwrap();
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
    for (code, status) in &expected {
        let parsed = calmlens::ErrorCode::parse(code);
        assert!(!matches!(parsed, calmlens::ErrorCode::Other(_)), "{code}");
        assert_eq!(parsed.http_status(), Some(*status), "{code}");
    }
}

#[test]
fn future_webhook_fields_and_types_are_accepted() {
    let fixtures: Value = serde_json::from_str(include_str!("../testdata/webhooks.json")).unwrap();
    for f in fixtures["parsing"].as_array().unwrap() {
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
    }
}
