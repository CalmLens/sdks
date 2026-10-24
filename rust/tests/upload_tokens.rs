use base64::Engine;
use calmlens::{blocking, models::*, testing::MockServerClient, ServerClient};
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::{Digest, Sha256};

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
fn every_token_has_its_own_nonce() {
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
