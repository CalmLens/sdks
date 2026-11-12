//! Signed asset URLs and the info resource in the in-memory API and CDN.
use super::{cdn_response, custom, fail, text, validation, Backend, Outcome};
use crate::error::ErrorCode;
use crate::{DEFAULT_SIGNED_URL_EXPIRES_IN, MAX_SIGNED_URL_EXPIRES_IN};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// The asset segment of a URL that names the asset by its external ID starts with this.
pub(super) const EXTERNAL_ID_PREFIX: &str = "ext:";

/// What a signed asset URL from the mock grants: one asset, original access or not, until
/// `expires_at` (milliseconds since the Unix epoch).
pub(super) struct MockGrant {
    pub(super) asset_id: String,
    pub(super) original: bool,
    pub(super) expires_at: u64,
}
impl MockGrant {
    /// The grant's asset segment: `sig_` and the lowercase hex of the UTF-8 string
    /// `{assetId}.{1|0}.{expiresAt}`. Every SDK's mock writes it the same way. It is readable,
    /// not signed, as the mock has no secret to keep.
    fn encode(&self) -> String {
        let text = format!(
            "{}.{}.{}",
            self.asset_id,
            u8::from(self.original),
            self.expires_at
        );
        let hex: String = text.bytes().map(|byte| format!("{byte:02x}")).collect();
        format!("sig_{hex}")
    }
    /// Reads a grant segment, or `None` for one the mock didn't sign.
    pub(super) fn decode(segment: &str) -> Option<Self> {
        let hex = segment.strip_prefix("sig_")?;
        if hex.is_empty()
            || hex.len() % 2 != 0
            || !hex
                .bytes()
                .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        {
            return None;
        }
        let bytes = (0..hex.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).ok())
            .collect::<Option<Vec<u8>>>()?;
        let text = String::from_utf8(bytes).ok()?;
        let (rest, expires_at) = text.rsplit_once('.')?;
        let (asset_id, original) = rest.rsplit_once('.')?;
        if asset_id.is_empty()
            || expires_at.is_empty()
            || !expires_at.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        let original = match original {
            "1" => true,
            "0" => false,
            _ => return None,
        };
        Some(Self {
            asset_id: asset_id.to_owned(),
            original,
            expires_at: expires_at.parse().ok()?,
        })
    }
}

/// Percent-encodes like JavaScript's `encodeURIComponent`.
fn encode_component(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

impl Backend {
    /// Signs an asset URL like the API (`POST /projects/:projectId/signed-asset-urls`): a grant to
    /// one asset, by ID or external ID, until it expires, serving the original only when asked.
    /// Only the mock's CDN accepts the grant.
    pub(super) fn sign_asset_url(&self, body: Map<String, Value>, now: u64) -> Outcome<Value> {
        // Like the API's schema, none of these fields takes null.
        for key in ["assetId", "externalId", "expiresIn", "original"] {
            if body.get(key).is_some_and(Value::is_null) {
                return Err(validation("invalid-type", key));
            }
        }
        let (asset_id, external_id) = (body.get("assetId"), body.get("externalId"));
        if asset_id.is_some() == external_id.is_some() {
            let mut failure = fail(
                ErrorCode::InvalidRequest,
                "Send either assetId or externalId",
            );
            failure.details = json!({
                "issues": [{"path": "", "message": "Send either assetId or externalId", "code": "custom"}],
            });
            return Err(failure);
        }
        for (key, value) in [("assetId", asset_id), ("externalId", external_id)] {
            if value.is_some_and(|value| !value.is_string()) {
                return Err(validation("invalid-type", key));
            }
        }
        let expires_in = match body.get("expiresIn") {
            None => DEFAULT_SIGNED_URL_EXPIRES_IN as f64,
            Some(value) => match value.as_f64() {
                Some(seconds) if seconds.fract() == 0.0 => seconds,
                _ => return Err(validation("invalid-type", "expiresIn")),
            },
        };
        if expires_in < 1.0 {
            return Err(validation("too-small", "expiresIn"));
        }
        if expires_in > MAX_SIGNED_URL_EXPIRES_IN as f64 {
            return Err(validation("too-big", "expiresIn"));
        }
        let original = match body.get("original") {
            None => false,
            Some(value) => value
                .as_bool()
                .ok_or_else(|| validation("invalid-type", "original"))?,
        };
        let project = self.options.project_id.as_str();
        let asset =
            match external_id {
                Some(external_id) => self.storage.assets.values().find(|asset| {
                    asset["projectId"] == project && asset["externalId"] == *external_id
                }),
                None => self.owned(&self.storage.assets, text(asset_id.unwrap_or(&Value::Null))),
            }
            .ok_or_else(|| fail(ErrorCode::AssetNotFound, "Asset not found"))?;
        if !asset["content"]["safetyHold"].is_null() {
            let mut failure = fail(ErrorCode::AssetHeld, "This asset is under a safety hold");
            failure.details = json!({ "hold": "safety" });
            return Err(failure);
        }
        let expires_at = now + expires_in as u64 * 1000;
        let grant = MockGrant {
            asset_id: text(&asset["id"]).to_owned(),
            original,
            expires_at,
        };
        let url = format!(
            "{}/assets/{}/{}",
            self.options.cdn_base_url,
            encode_component(project),
            grant.encode()
        );
        Ok(json!({"url": url, "expiresAt": expires_at}))
    }
}

/// The info resource, like the CDN's (AssetInfo.ts): the allowlisted fields and whether the
/// viewer the claims describe can see the content, decided as the other resources decide it. A
/// private asset's info needs a grant or an API key with `assets:download`.
pub(super) fn serve_info(
    asset: &Value,
    authorised: bool,
    q: &HashMap<String, String>,
) -> super::MockResponse {
    let private = asset["visibility"] != "public";
    if private && !authorised {
        return custom("asset/not-found", 404, "Asset not found").response();
    }
    let claims = match q.get("viewerClaims") {
        None => Value::Null,
        Some(raw) => match serde_json::from_str::<Value>(raw) {
            Ok(claims) => claims,
            Err(_) => {
                return fail(ErrorCode::InvalidViewerClaims, "Invalid viewer claims").response()
            }
        },
    };
    let content = &asset["content"];
    let classification = &asset["classification"];
    let status = text(&classification["moderation"]["decision"]);
    let restricted = private || status == "blocked" || status == "purged";
    if restricted && !authorised {
        return custom("asset/not-available", 403, "Asset is not available").response();
    }
    let availability = if !content["safetyHold"].is_null()
        || asset["upload"]["status"] == "uploading"
        || status == "blocked"
        || status == "purged"
        || classification["status"] == "failed"
        || content["status"] == "removed"
    {
        "unavailable"
    } else if status == "age-restricted" && claims["ageConfirmed"] != true {
        "age-restricted"
    } else {
        "available"
    };
    let info = json!({
        "id": asset["id"], "projectId": asset["projectId"], "type": asset["type"],
        "externalUrl": asset["externalUrl"],
        "content": {
            "format": content["format"], "width": content["width"], "height": content["height"],
            "durationSeconds": content["durationSeconds"], "pageCount": content["pageCount"],
            "rendered": content["rendered"], "preview": content["preview"], "hls": content["hls"],
        },
        "availability": availability,
    });
    let cache = if restricted {
        "private, no-store"
    } else {
        "public, no-cache"
    };
    cdn_response(
        info.to_string().into_bytes(),
        &[
            ("content-type", "application/json".into()),
            ("cache-control", cache.into()),
            ("cache-tag", format!("asset-{}", text(&asset["id"]))),
        ],
    )
}
