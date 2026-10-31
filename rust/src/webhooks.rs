//! Webhook signature verification and payload parsing. Available without any client feature.
use crate::error::ErrorCode;
use crate::models::WebhookEventPayload;
use crate::{Error, Result};
use hmac::{Hmac, Mac};
use serde_json::{Map, Value};
use sha2::Sha256;

/// Header carrying `v1=<hex HMAC-SHA256>` signatures of `"<timestamp>.<raw body>"`.
pub const WEBHOOK_SIGNATURE_HEADER: &str = "x-calmlens-signature";
/// Header carrying the Unix timestamp (seconds) that was signed.
pub const WEBHOOK_TIMESTAMP_HEADER: &str = "x-calmlens-timestamp";
/// Header carrying the delivery ID; use it to deduplicate retried deliveries.
pub const WEBHOOK_DELIVERY_HEADER: &str = "x-calmlens-delivery";
/// Deliveries whose timestamp is further than this from the receiver's clock are rejected.
pub const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS: u64 = 300;

fn webhook_mac(body: &[u8], timestamp: &str, secret: &str) -> Hmac<Sha256> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .expect("HMAC supports arbitrary key lengths");
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(body);
    mac
}

/// Returns the [`WEBHOOK_SIGNATURE_HEADER`] value for the raw `body` signed at `timestamp`.
/// Arguments follow the same order as [`verify_webhook_signature`].
pub fn create_webhook_signature_header(
    body: impl AsRef<[u8]>,
    timestamp: &str,
    secret: &str,
) -> String {
    let digest = webhook_mac(body.as_ref(), timestamp, secret)
        .finalize()
        .into_bytes();
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("v1={hex}")
}

/// The headers of one signed delivery of the raw `body`, as CalmLens sends them: `content-type`,
/// [`WEBHOOK_DELIVERY_HEADER`], [`WEBHOOK_TIMESTAMP_HEADER`] (`timestamp`, Unix seconds) and
/// [`WEBHOOK_SIGNATURE_HEADER`]. Use it to test a webhook handler with the current time, since
/// handlers reject deliveries more than five minutes old. Fails with `sdk/invalid-argument` when
/// `delivery_id` is not a valid header value.
pub fn create_webhook_headers(
    body: impl AsRef<[u8]>,
    delivery_id: &str,
    timestamp: u64,
    secret: &str,
) -> Result<http::HeaderMap> {
    let stamp = timestamp.to_string();
    let value = |value: &str| {
        http::HeaderValue::from_str(value).map_err(|cause| {
            Error::new(ErrorCode::InvalidArgument, "Invalid webhook header value")
                .with_source(cause)
        })
    };
    let mut headers = http::HeaderMap::new();
    headers.insert(http::header::CONTENT_TYPE, value("application/json")?);
    headers.insert(WEBHOOK_DELIVERY_HEADER, value(delivery_id)?);
    headers.insert(WEBHOOK_TIMESTAMP_HEADER, value(&stamp)?);
    headers.insert(
        WEBHOOK_SIGNATURE_HEADER,
        value(&create_webhook_signature_header(body, &stamp, secret))?,
    );
    Ok(headers)
}

/// Verifies the exact raw `body` bytes against the [`WEBHOOK_SIGNATURE_HEADER`] and
/// [`WEBHOOK_TIMESTAMP_HEADER`] values, rejecting timestamps more than `tolerance` seconds from
/// `now` (Unix seconds; use [`WEBHOOK_SIGNATURE_TOLERANCE_SECONDS`]). Pass the request body as
/// received, never a re-serialized JSON value; it need not be valid UTF-8.
pub fn verify_webhook_signature(
    body: impl AsRef<[u8]>,
    signature: &str,
    timestamp: &str,
    secret: &str,
    now: u64,
    tolerance: u64,
) -> bool {
    let stamp = timestamp.trim();
    if secret.is_empty()
        || signature.is_empty()
        || stamp.is_empty()
        || !stamp.bytes().all(|v| v.is_ascii_digit())
    {
        return false;
    }
    let Ok(time) = stamp.parse::<u64>() else {
        return false;
    };
    if now.abs_diff(time) > tolerance {
        return false;
    }
    let mut matched = false;
    for candidate in signature
        .split(',')
        .map(str::trim)
        .filter_map(|v| v.strip_prefix("v1="))
    {
        if candidate.len() != 64 {
            continue;
        }
        let decoded = (0..64)
            .step_by(2)
            .map(|i| {
                candidate
                    .get(i..i + 2)
                    .and_then(|v| u8::from_str_radix(v, 16).ok())
            })
            .collect::<Option<Vec<_>>>();
        if let Some(bytes) = decoded {
            matched |= webhook_mac(body.as_ref(), stamp, secret)
                .verify_slice(&bytes)
                .is_ok();
        }
    }
    matched
}

/// Parses a webhook delivery body without verifying it; prefer [`construct_webhook_event`].
///
/// The body must be a JSON object with string `id`, `type` and `projectId`, a numeric
/// `createdAt`, and its other fields, when present, must have the API's types: `severity` and `title` strings, `description` and `assetId` strings or null, `asset` null or
/// an object with a string `id`, and `facts` an array of `{key, value, url?}` objects with a
/// string `key` and `url`. Anything else returns `sdk/invalid-webhook-payload`. Unknown fields
/// are kept: [`WebhookEventPayload::json`] returns the body as received.
pub fn parse_webhook_event(body: impl AsRef<[u8]>) -> Result<WebhookEventPayload> {
    let invalid = |message: &str| Error::new(ErrorCode::InvalidWebhookPayload, message);
    let value: Value = serde_json::from_slice(body.as_ref())
        .map_err(|cause| invalid("Webhook body is not a delivery payload").with_source(cause))?;
    check_payload(&value).map_err(|field| {
        invalid(&format!(
            "Webhook body is not a delivery payload: invalid {field}"
        ))
    })?;
    let payload: WebhookEventPayload = serde_json::from_value(value.clone())
        .map_err(|cause| invalid("Webhook body is not a delivery payload").with_source(cause))?;
    Ok(payload.received(value))
}

/// Checks a delivery's field types as the API's received-payload schema does, returning the
/// first invalid field.
fn check_payload(value: &Value) -> std::result::Result<(), &'static str> {
    let payload = value.as_object().ok_or("body")?;
    let string = |object: &Map<String, Value>, key| object.get(key).is_some_and(Value::is_string);
    let optional = |object: &Map<String, Value>, key, nullable: bool| match object.get(key) {
        None | Some(Value::String(_)) => true,
        Some(Value::Null) => nullable,
        Some(_) => false,
    };
    for key in ["id", "type", "projectId"] {
        if !string(payload, key) {
            return Err(match key {
                "id" => "id",
                "type" => "type",
                _ => "projectId",
            });
        }
    }
    if !payload.get("createdAt").is_some_and(Value::is_number) {
        return Err("createdAt");
    }
    if !optional(payload, "severity", false) {
        return Err("severity");
    }
    if !optional(payload, "title", false) {
        return Err("title");
    }
    if !optional(payload, "description", true) {
        return Err("description");
    }
    if !optional(payload, "assetId", true) {
        return Err("assetId");
    }
    match payload.get("asset") {
        None | Some(Value::Null) => {}
        Some(Value::Object(asset)) if string(asset, "id") => {}
        Some(_) => return Err("asset"),
    }
    match payload.get("facts") {
        None => {}
        Some(Value::Array(facts)) => {
            for fact in facts {
                let fact = fact.as_object().ok_or("facts")?;
                if !string(fact, "key") || !fact.contains_key("value") {
                    return Err("facts");
                }
                if !optional(fact, "url", false) {
                    return Err("facts");
                }
            }
        }
        Some(_) => return Err("facts"),
    }
    Ok(())
}

/// The value of header `name` (any case), with repeated headers joined by `,`.
fn joined_header(headers: &http::HeaderMap, name: &str) -> String {
    headers
        .get_all(name)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .collect::<Vec<_>>()
        .join(",")
}

/// Verifies a delivery from its request headers: [`WEBHOOK_SIGNATURE_HEADER`] and
/// [`WEBHOOK_TIMESTAMP_HEADER`], whose names `http::HeaderMap` matches in any case. Repeated
/// headers are joined with `,`, so a signature list split across headers verifies (and a
/// repeated timestamp does not). Takes the raw body, `now` in Unix seconds and the tolerance in
/// seconds, like [`verify_webhook_signature`].
pub fn verify_webhook_headers(
    body: impl AsRef<[u8]>,
    headers: &http::HeaderMap,
    secret: &str,
    now: u64,
    tolerance: u64,
) -> bool {
    verify_webhook_signature(
        body,
        &joined_header(headers, WEBHOOK_SIGNATURE_HEADER),
        &joined_header(headers, WEBHOOK_TIMESTAMP_HEADER),
        secret,
        now,
        tolerance,
    )
}

/// Verifies a delivery's signature and freshness from its headers, then parses it.
///
/// Pass the raw request body exactly as received and the request headers, e.g. axum's
/// `axum::body::Bytes` and `http::HeaderMap`; headers are read as [`verify_webhook_headers`]
/// reads them. A missing, wrong or stale signature returns `sdk/invalid-webhook-signature`
/// (answer 401); a body that is not a delivery returns `sdk/invalid-webhook-payload` (answer
/// 400).
pub fn construct_webhook_event(
    body: impl AsRef<[u8]>,
    headers: &http::HeaderMap,
    secret: &str,
) -> Result<WebhookEventPayload> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);
    construct_webhook_event_at(
        body,
        &joined_header(headers, WEBHOOK_SIGNATURE_HEADER),
        &joined_header(headers, WEBHOOK_TIMESTAMP_HEADER),
        secret,
        now,
        WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
    )
}

/// [`construct_webhook_event`] for frameworks with their own header types (such as
/// actix-web), and for tests: takes the header values (repeated headers joined with `,`), the
/// current Unix time and the tolerance in seconds.
pub fn construct_webhook_event_at(
    body: impl AsRef<[u8]>,
    signature: &str,
    timestamp: &str,
    secret: &str,
    now: u64,
    tolerance: u64,
) -> Result<WebhookEventPayload> {
    if !verify_webhook_signature(&body, signature, timestamp, secret, now, tolerance) {
        return Err(Error::new(
            ErrorCode::InvalidWebhookSignature,
            "Webhook signature is missing, invalid or outside the tolerance",
        ));
    }
    parse_webhook_event(body)
}
