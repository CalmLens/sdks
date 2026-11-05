//! Checks the SDK shares with the API and CDN: transform options against the image transform
//! schema, CDN selectors as the CDN reads them, and the upload MIME types the API accepts.

use serde_json::{Map, Value};
use std::sync::OnceLock;

use crate::transform_schema::TRANSFORM_OPTIONS_SCHEMA;

fn schema() -> &'static Value {
    static SCHEMA: OnceLock<Value> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        serde_json::from_str(TRANSFORM_OPTIONS_SCHEMA).expect("generated transform schema")
    })
}

/// A schema rule's `type`.
fn rule_type(rule: &Value) -> Option<&str> {
    rule.get("type").and_then(Value::as_str)
}

/// Whether `value` has the schema type `kind`; a rule without a type takes any value.
fn has_rule_type(kind: Option<&str>, value: &Value) -> bool {
    match kind {
        Some("object") => value.is_object(),
        Some("string") => value.is_string(),
        Some("boolean") => value.is_boolean(),
        Some("number") => value.as_f64().is_some_and(f64::is_finite),
        Some("integer") => {
            value.is_i64()
                || value.is_u64()
                || value
                    .as_f64()
                    .is_some_and(|number| number.is_finite() && number.fract() == 0.0)
        }
        _ => true,
    }
}

/// JSON equality with numbers compared by value, so `90` and `90.0` are the same option.
fn same(left: &Value, right: &Value) -> bool {
    match (left.as_f64(), right.as_f64()) {
        (Some(left), Some(right)) => left == right,
        _ => left == right,
    }
}

/// The dotted keys of transform options the schema doesn't know, and of those whose values it
/// refuses (or that are required and missing), as the CDN checks them. `null` options are left
/// out of a selector, so they are not checked.
pub(crate) fn check_transform_options(options: &Value) -> (Vec<String>, Vec<String>) {
    fn check(
        schema: &Value,
        value: &Value,
        key: &str,
        unknown: &mut Vec<String>,
        invalid: &mut Vec<String>,
    ) {
        let rule = match schema.get("oneOf").and_then(Value::as_array) {
            Some(branches) => branches
                .iter()
                .find(|branch| has_rule_type(rule_type(branch), value)),
            None => Some(schema),
        };
        let bound = |name: &str| rule.and_then(|rule| rule.get(name)).and_then(Value::as_f64);
        let number = value.as_f64();
        let Some(rule) = rule.filter(|rule| {
            has_rule_type(rule_type(rule), value)
                && rule
                    .get("enum")
                    .and_then(Value::as_array)
                    .is_none_or(|allowed| allowed.iter().any(|item| same(item, value)))
                && bound("minimum").is_none_or(|low| number.is_some_and(|n| n >= low))
                && bound("maximum").is_none_or(|high| number.is_some_and(|n| n <= high))
        }) else {
            invalid.push(key.to_owned());
            return;
        };
        let Some(object) = value
            .as_object()
            .filter(|_| rule_type(rule) == Some("object"))
        else {
            return;
        };
        let path = |name: &str| {
            if key.is_empty() {
                name.to_owned()
            } else {
                format!("{key}.{name}")
            }
        };
        for name in rule
            .get("required")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if object.get(name).is_none_or(Value::is_null) {
                invalid.push(path(name));
            }
        }
        let mut names: Vec<&String> = object.keys().collect();
        // Option names are ASCII, so byte order is JavaScript's UTF-16 order.
        names.sort();
        for name in names {
            let child = &object[name];
            if child.is_null() {
                continue;
            }
            match rule
                .get("properties")
                .and_then(|properties| properties.get(name))
            {
                Some(child_rule) => check(child_rule, child, &path(name), unknown, invalid),
                None => unknown.push(path(name)),
            }
        }
    }
    let (mut unknown, mut invalid) = (Vec::new(), Vec::new());
    check(schema(), options, "", &mut unknown, &mut invalid);
    (unknown, invalid)
}

/// Fails with `sdk/invalid-argument` naming each transform option the CDN would refuse, with
/// `unknownKeys` and `invalidKeys` in its details.
pub(crate) fn assert_transform_options(options: &Value) -> crate::Result<()> {
    let (unknown, invalid) = check_transform_options(options);
    if unknown.is_empty() && invalid.is_empty() {
        return Ok(());
    }
    let plural = |keys: &[String]| if keys.len() > 1 { "s" } else { "" };
    let mut problems = Vec::new();
    if !unknown.is_empty() {
        problems.push(format!(
            "unknown option{} {}",
            plural(&unknown),
            unknown.join(", ")
        ));
    }
    if !invalid.is_empty() {
        problems.push(format!(
            "invalid value{} for {}",
            plural(&invalid),
            invalid.join(", ")
        ));
    }
    let mut details = Map::new();
    details.insert("unknownKeys".into(), unknown.into());
    details.insert("invalidKeys".into(), invalid.into());
    Err(crate::Error::new(
        crate::ErrorCode::InvalidArgument,
        format!(
            "Transform options are invalid: {}. Set the options themselves, such as \
             ImageTransformOptions {{ width: Some(640), format: Some(ImageFormat::Webp), .. }}.",
            problems.join("; ")
        ),
    )
    .with_details(details))
}

/// Whether the API accepts an upload of this MIME type: an image, audio, video, text, document
/// or website type, not a container such as `application/octet-stream`. It refuses any other
/// type with `upload/unsupported-type`.
#[cfg(feature = "async")]
pub(crate) fn is_accepted_upload_mime_type(mime_type: &str) -> bool {
    use crate::upload_mime_types::{
        UPLOAD_MIME_PREFIXES, UPLOAD_MIME_REJECTED, UPLOAD_MIME_SUFFIXES, UPLOAD_MIME_TYPES,
    };
    let kind = normalize_upload_mime_type(mime_type);
    if UPLOAD_MIME_REJECTED.contains(&kind.as_str()) {
        return false;
    }
    UPLOAD_MIME_PREFIXES
        .iter()
        .any(|prefix| kind.starts_with(prefix))
        || UPLOAD_MIME_SUFFIXES
            .iter()
            .any(|suffix| kind.ends_with(suffix))
        || UPLOAD_MIME_TYPES.contains(&kind.as_str())
}

/// A MIME type in lower case, without parameters.
#[cfg(feature = "async")]
pub(crate) fn normalize_upload_mime_type(mime_type: &str) -> String {
    mime_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase()
}

/// The `upload/unsupported-type` error for an upload of `mime_type`, with it and the `calmlens`
/// source in the details.
#[cfg(feature = "async")]
pub(crate) fn invalid_upload_mime_type(mime_type: &str) -> crate::Error {
    let mut details = Map::new();
    details.insert("mimeType".into(), mime_type.into());
    details.insert("source".into(), "calmlens".into());
    crate::Error::new(
        crate::ErrorCode::UnsupportedUploadType,
        format!(
            "{} is not a valid upload file type. Uploads must use a concrete file MIME type that \
             CalmLens can store and process, such as image/png, image/jpeg, application/pdf, or \
             text/plain.",
            normalize_upload_mime_type(mime_type)
        ),
    )
    .with_details(details)
}

/// A CDN selector's lens and options.
#[cfg(feature = "testing")]
pub(crate) struct TransformSelector {
    pub(crate) lens: Option<String>,
    pub(crate) options: Option<Map<String, Value>>,
}

/// Reads a CDN selector, the path after the resource as sent (still percent-encoded), as the
/// CDN does: an optional first `@lens`, then `key=value` options with dotted keys for nested
/// ones (a bare key is `true`). Values are numbers, `true`, `false`, hex colours (`#` added)
/// for colour options, or text. `None` for anything the CDN refuses as
/// `transform/invalid`.
#[cfg(feature = "testing")]
pub(crate) fn parse_transform_selector(selector: &str) -> Option<TransformSelector> {
    let mut parsed = TransformSelector {
        lens: None,
        options: None,
    };
    if selector.is_empty() {
        return Some(parsed);
    }
    if selector.contains('/') {
        return None;
    }
    let decode = |text: &str| decode_component(text);
    let mut entries: Vec<&str> = selector.split(',').collect();
    if let Some(lens) = entries[0].strip_prefix('@') {
        let lens = decode(lens)?;
        let valid = (1..=50).contains(&lens.len())
            && lens
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if !valid {
            return None;
        }
        parsed.lens = Some(lens);
        entries.remove(0);
    }
    if entries.is_empty() {
        return Some(parsed);
    }
    let mut options = Map::new();
    for entry in entries {
        if entry.is_empty() || entry.starts_with('@') {
            return None;
        }
        let (key, text) = match entry.split_once('=') {
            Some((key, text)) => (key, Some(text)),
            None => (entry, None),
        };
        let parts: Vec<&str> = key.split('.').collect();
        if !parts.iter().all(|part| is_option_name(part)) {
            return None;
        }
        let value = match text {
            None => Value::Bool(true),
            Some(text) => {
                let text = decode(text)?;
                if text.is_empty() {
                    return None;
                }
                selector_value(key, text)
            }
        };
        let (last, parents) = parts.split_last()?;
        let mut target = &mut options;
        for part in parents {
            target = target
                .entry(part.to_string())
                .or_insert_with(|| Value::Object(Map::new()))
                .as_object_mut()?;
        }
        if target.contains_key(*last) {
            return None;
        }
        target.insert(last.to_string(), value);
    }
    parsed.options = Some(options);
    Some(parsed)
}

#[cfg(feature = "testing")]
fn is_option_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes.next().is_some_and(|b| b.is_ascii_lowercase()) && bytes.all(|b| b.is_ascii_alphanumeric())
}

/// A selector value as the CDN reads it.
#[cfg(feature = "testing")]
fn selector_value(key: &str, text: String) -> Value {
    const COLOUR_KEYS: &[&str] = &["background", "border.color", "trim.border.color"];
    let hex = matches!(text.len(), 3 | 4 | 6 | 8) && text.bytes().all(|b| b.is_ascii_hexdigit());
    if COLOUR_KEYS.contains(&key) && hex {
        return Value::String(format!("#{}", text.to_ascii_lowercase()));
    }
    if is_selector_number(&text) {
        if let Ok(number) = serde_json::from_str::<serde_json::Number>(&text) {
            return Value::Number(number);
        }
    }
    match text.as_str() {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        _ => Value::String(text),
    }
}

/// Whether `text` matches `^-?(?:0|[1-9]\d*)(?:\.\d+)?$`.
#[cfg(feature = "testing")]
fn is_selector_number(text: &str) -> bool {
    let unsigned = text.strip_prefix('-').unwrap_or(text);
    let (whole, fraction) = match unsigned.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (unsigned, None),
    };
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
    digits(whole) && (whole == "0" || !whole.starts_with('0')) && fraction.is_none_or(digits)
}

/// Percent-decodes a selector component as `decodeURIComponent` does, or `None` for a malformed
/// escape or bytes that aren't UTF-8.
#[cfg(feature = "testing")]
fn decode_component(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;
            if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}
