use base64::Engine;
use calmlens::{blocking, models::*, testing::MockServerClient, ErrorCode, ServerClient};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

const API_KEY: &str = "clsk_use_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHabcdef";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn signature(body: &str, api_key: &str) -> String {
    let secret = hex(&Sha256::digest(api_key.as_bytes()));
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(format!("calmlens-upload-token:v1:{body}").as_bytes());
    hex(&mac.finalize().into_bytes())
}

fn decode(token: &str) -> (Value, String, String) {
    let rest = token.strip_prefix("clut_").expect("clut_ prefix");
    let (body, signature) = rest.split_once('.').expect("signature");
    let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(body)
        .unwrap();
    (
        serde_json::from_slice(&claims).unwrap(),
        body.into(),
        signature.into(),
    )
}

#[test]
fn signs_a_token_the_backend_can_verify_against_the_keys_hash() {
    let client = ServerClient::new(API_KEY, "project").unwrap();
    let before = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let signed = client
        .upload_tokens()
        .sign(SignUploadToken {
            external_id: Some("post-42".into()),
            expires_in_seconds: Some(120),
            ..SignUploadToken::new("preset-1")
        })
        .unwrap();
    let (claims, body, sent) = decode(&signed.token);
    assert_eq!(claims["v"], 1);
    assert_eq!(claims["u"], "preset-1");
    assert_eq!(claims["x"], "post-42");
    assert_eq!(claims["k"], "clsk_use_abcd");
    assert_eq!(claims["e"], json!(signed.expires_at));
    let lifetime = signed.expires_at - before;
    assert!((120_000..121_000).contains(&lifetime), "{lifetime}");
    assert_eq!(sent, signature(&body, API_KEY));
    assert_ne!(sent, signature(&body, "other"));
}

#[test]
fn every_token_has_its_own_nonce_and_other_keys_use_an_eight_character_prefix() {
    let client = ServerClient::new("legacykey-1234", "project").unwrap();
    let sign = || {
        client
            .upload_tokens()
            .sign(SignUploadToken::new("p1"))
            .unwrap()
    };
    let (first, ..) = decode(&sign().token);
    let (second, ..) = decode(&sign().token);
    assert_ne!(first["n"], second["n"]);
    assert_eq!(first["k"], "legacyke");
    assert!(first.get("x").is_none());
}

#[test]
fn rejects_invalid_options() {
    let client = ServerClient::new(API_KEY, "project").unwrap();
    for options in [
        SignUploadToken::default(),
        SignUploadToken {
            expires_in_seconds: Some(3601),
            ..SignUploadToken::new("p")
        },
        SignUploadToken {
            expires_in_seconds: Some(0),
            ..SignUploadToken::new("p")
        },
        SignUploadToken {
            external_id: Some(String::new()),
            ..SignUploadToken::new("p")
        },
    ] {
        let error = client.upload_tokens().sign(options).unwrap_err();
        assert_eq!(error.code(), &ErrorCode::InvalidArgument);
    }
}

#[test]
fn the_blocking_and_mock_clients_sign_with_their_own_key() {
    let client = blocking::ServerClient::new(API_KEY, "project").unwrap();
    let signed = client
        .upload_tokens()
        .sign(SignUploadToken::new("preset-1"))
        .unwrap();
    let (_, body, sent) = decode(&signed.token);
    assert_eq!(sent, signature(&body, API_KEY));

    let mock = MockServerClient::new().unwrap();
    let signed = mock
        .upload_tokens()
        .sign(SignUploadToken::new("preset-1"))
        .unwrap();
    let (_, body, sent) = decode(&signed.token);
    assert!(mock.requests().is_empty());
    assert_eq!(sent, signature(&body, "mock-key"));
}

#[tokio::test]
async fn upload_preset_id_is_sent_as_a_query_parameter_and_in_url_bodies() {
    let mock = MockServerClient::new().unwrap();
    mock.enqueue(
        200,
        json!({"id": "a", "classification": {"moderation": {"decision": "pending"}}}),
    );
    mock.enqueue(
        200,
        json!({"id": "b", "classification": {"moderation": {"decision": "pending"}}}),
    );
    mock.assets()
        .create(SubmitAsset {
            upload_preset_id: Some("preset-1".into()),
            ..SubmitAsset::text("hi")
        })
        .await
        .unwrap();
    mock.assets()
        .create(SubmitAsset {
            upload_preset_id: Some("preset-2".into()),
            ..SubmitAsset::from_url("site", "https://example.com")
        })
        .await
        .unwrap();
    let requests = mock.requests();
    assert_eq!(requests[0].query_param("uploadPresetId"), Some("preset-1"));
    assert_eq!(
        serde_json::from_slice::<Value>(&requests[1].body).unwrap()["uploadPresetId"],
        "preset-2"
    );
}
