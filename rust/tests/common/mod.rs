//! Invokes SDK operations by their shared contract names with JSON options.
#![allow(dead_code)]
use futures_util::{stream::BoxStream, StreamExt, TryStreamExt};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

/// The one loader of the shared SDK contract fixtures: `testdata/<name>.json`
/// (packages/sdk-contract/README.md, "Runners").
pub fn fixture(name: &str) -> Value {
    let path = format!("{}/testdata/{name}.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// Decodes JSON options into a native options type.
pub fn input<T: DeserializeOwned>(value: Value) -> calmlens::Result<T> {
    serde_json::from_value(value).map_err(|cause| {
        calmlens::Error::new(calmlens::ErrorCode::InvalidUploadPayload, cause.to_string())
            .with_source(cause)
    })
}
fn output<T: Serialize>(result: calmlens::Result<T>) -> calmlens::Result<Value> {
    result.map(|value| serde_json::to_value(value).expect("serializable SDK model"))
}
/// Decodes JSON into a native type, panicking on failure.
pub fn typed<T: DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).unwrap()
}

/// A list's item iterator by its contract name, such as `folders.iterate`, with JSON options;
/// `None` for an operation that isn't one. `events.iterate` yields pages.
pub fn iterator(
    client: &calmlens::ServerClient,
    operation: &str,
    options: Value,
) -> Option<calmlens::Result<BoxStream<'static, calmlens::Result<Value>>>> {
    fn values<T: Serialize + Send + 'static>(
        stream: BoxStream<'static, calmlens::Result<T>>,
    ) -> BoxStream<'static, calmlens::Result<Value>> {
        stream
            .map_ok(|item| serde_json::to_value(item).expect("serializable SDK model"))
            .boxed()
    }
    let stream =
        |result: calmlens::Result<BoxStream<'static, calmlens::Result<Value>>>| Some(result);
    match operation {
        "assets.iterate" => stream(input(options).map(|o| values(client.assets().iterate(o)))),
        "assets.iterateChildren" => {
            stream(input(options).map(|o| values(client.assets().iterate_children(o))))
        }
        "assets.iterateTimeline" => {
            stream(input(options).map(|o| values(client.assets().iterate_timeline(o))))
        }
        "folders.iterate" => stream(input(options).map(|o| values(client.folders().iterate(o)))),
        "hashLists.iterate" => {
            stream(input(options).map(|o| values(client.hash_lists().iterate(o))))
        }
        "hashLists.iterateEntries" => {
            stream(input(options).map(|o| values(client.hash_lists().iterate_entries(o))))
        }
        "policies.iterate" => stream(input(options).map(|o| values(client.policies().iterate(o)))),
        "lenses.iterate" => stream(input(options).map(|o| values(client.lenses().iterate(o)))),
        "uploadPresets.iterate" => {
            stream(input(options).map(|o| values(client.upload_presets().iterate(o))))
        }
        "events.iterate" => stream(input(options).map(|o| values(client.events().iterate(o)))),
        "events.pages" => stream(input(options).map(|o| values(client.events().pages(o)))),
        _ => None,
    }
}

pub async fn invoke(
    client: &calmlens::ServerClient,
    operation: &str,
    options: Value,
) -> calmlens::Result<Value> {
    match operation {
        "text.classify" => output(client.text().classify(input(options)?).await),
        "assets.create" => output(client.assets().create(input(options)?).await),
        "assets.classify" => output(client.assets().classify(input(options)?).await),
        "assets.search" => output(client.assets().search(input(options)?).await),
        "assets.list" => output(client.assets().list(input(options)?).await),
        "assets.retrieve" => output(client.assets().retrieve(input(options)?).await),
        "assets.update" => output(client.assets().update(input(options)?).await),
        "assets.retry" => output(client.assets().retry(input(options)?).await),
        "assets.decide" => output(client.assets().decide(input(options)?).await),
        "assets.explain" => output(client.assets().explain(input(options)?).await),
        "assets.removeContent" => output(client.assets().remove_content(input(options)?).await),
        "assets.delete" => output(client.assets().delete(input(options)?).await),
        "assets.move" => output(client.assets().move_asset(input(options)?).await),
        "assets.batch" => output(client.assets().batch(input(options)?).await),
        "assets.listChildren" => output(client.assets().list_children(input(options)?).await),
        "assets.listTimeline" => output(client.assets().list_timeline(input(options)?).await),
        "assets.uploadPart" => output(client.assets().upload_part(input(options)?).await),
        "cdn.signAssetUrl" => output(client.cdn().sign_asset_url(input(options)?).await),
        "cdn.getAssetUrl" => output(client.cdn().get_asset_url(&input(options)?)),
        "cdn.getAssetInfo" => {
            let url = options["url"].as_str().unwrap_or_default().to_owned();
            let mut info = options;
            if let Some(info) = info.as_object_mut() {
                info.remove("url");
            }
            output(client.cdn().get_asset_info(&url, input(info)?).await)
        }
        "folders.list" => output(client.folders().list(input(options)?).await),
        "folders.create" => output(client.folders().create(input(options)?).await),
        "folders.retrieve" => output(client.folders().retrieve(input(options)?).await),
        "folders.update" => output(client.folders().update(input(options)?).await),
        "folders.move" => output(client.folders().move_folder(input(options)?).await),
        "folders.delete" => output(client.folders().delete(input(options)?).await),
        "hashLists.list" => output(client.hash_lists().list(input(options)?).await),
        "hashLists.retrieve" => output(client.hash_lists().retrieve(input(options)?).await),
        "hashLists.create" => output(client.hash_lists().create(input(options)?).await),
        "hashLists.update" => output(client.hash_lists().update(input(options)?).await),
        "hashLists.delete" => output(client.hash_lists().delete(input(options)?).await),
        "hashLists.listEntries" => output(client.hash_lists().list_entries(input(options)?).await),
        "hashLists.addEntry" => output(client.hash_lists().add_entry(input(options)?).await),
        "hashLists.removeEntry" => output(client.hash_lists().remove_entry(input(options)?).await),
        "policies.list" => output(client.policies().list(input(options)?).await),
        "policies.retrieve" => output(client.policies().retrieve(input(options)?).await),
        "policies.create" => output(client.policies().create(input(options)?).await),
        "policies.update" => output(client.policies().update(input(options)?).await),
        "policies.reset" => output(client.policies().reset(input(options)?).await),
        "policies.upgrade" => output(client.policies().upgrade(input(options)?).await),
        "policies.setAutomaticUpdates" => output(
            client
                .policies()
                .set_automatic_updates(input(options)?)
                .await,
        ),
        "policies.delete" => output(client.policies().delete(input(options)?).await),
        "policies.retrieveAssigned" => output(client.policies().retrieve_assigned().await),
        "policies.assign" => output(client.policies().assign(input(options)?).await),
        "lenses.list" => output(client.lenses().list(input(options)?).await),
        "lenses.create" => output(client.lenses().create(input(options)?).await),
        "lenses.retrieve" => output(client.lenses().retrieve(input(options)?).await),
        "lenses.update" => output(client.lenses().update(input(options)?).await),
        "lenses.delete" => output(client.lenses().delete(input(options)?).await),
        "uploadPresets.list" => output(client.upload_presets().list(input(options)?).await),
        "uploadPresets.ensure" => output(client.upload_presets().ensure(input(options)?).await),
        "uploadPresets.delete" => output(client.upload_presets().delete(input(options)?).await),
        "projectSettings.get" => output(client.project_settings().get().await),
        "projectSettings.update" => output(client.project_settings().update(input(options)?).await),
        "metadataFields.list" => output(client.metadata_fields().list().await),
        "metadataFields.ensure" => output(client.metadata_fields().ensure(input(options)?).await),
        "metadataFields.delete" => output(client.metadata_fields().delete(input(options)?).await),
        "events.list" => output(client.events().list(input(options)?).await),
        "ensureLenses" => output(client.ensure_lenses(input(options)?).await),
        "cdn.serve" => {
            let response = client.cdn().serve(input(options)?).await?;
            let status = response.status().as_u16();
            let body = response.text().await?;
            Ok(serde_json::json!({"status": status, "body": body}))
        }
        _ => Err(calmlens::Error::new(
            "sdk/unsupported-operation",
            format!("Unsupported adapter operation: {operation}"),
        )),
    }
}

/// The request a fixture describes, rebuilt from a captured mock request.
pub fn describe(request: &calmlens::testing::Request) -> Value {
    let query = Value::Object(
        request
            .query
            .iter()
            .map(|(key, value)| (key.clone(), serde_json::json!(value)))
            .collect(),
    );
    let body = if request.body.is_empty() {
        Value::Null
    } else if request.header("content-type") == Some("application/json") {
        serde_json::from_slice(&request.body).unwrap()
    } else {
        serde_json::json!(String::from_utf8(request.body.clone()).unwrap())
    };
    // The fixtures name the path as sent, under the base URL's `/v1`.
    let path = reqwest::Url::parse(&request.url).unwrap().path().to_owned();
    serde_json::json!({"method": request.method, "path": path, "query": query, "body": body})
}

/// `value` with whole floats as integers: typed `f64` fields serialize `950` as `950.0`, and JSON
/// compares them as one number.
pub fn whole_numbers(value: Value) -> Value {
    match value {
        Value::Number(number) => match number.as_f64() {
            Some(float) if number.is_f64() && float.fract() == 0.0 && float.abs() < 1e15 => {
                serde_json::json!(float as i64)
            }
            _ => Value::Number(number),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(whole_numbers).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, whole_numbers(value)))
                .collect(),
        ),
        other => other,
    }
}

/// Whether a typed result serialized to JSON equals the API's JSON `expected`. Typed models
/// write every field they declare, so a field `expected` lacks must hold that field's empty
/// default (`null`, `false`, `0`, `""`, `[]` or `{}`); every field `expected` has must be equal. Returns the
/// path of the first difference.
pub fn compare_typed(actual: &Value, expected: &Value) -> Result<(), String> {
    fn walk(actual: &Value, expected: &Value, path: &str) -> Result<(), String> {
        match (actual, expected) {
            (Value::Object(actual), Value::Object(expected)) => {
                for (key, wanted) in expected {
                    let here = format!("{path}.{key}");
                    match actual.get(key) {
                        Some(value) => walk(value, wanted, &here)?,
                        None => return Err(format!("{here}: missing, expected {wanted}")),
                    }
                }
                for (key, value) in actual {
                    if !expected.contains_key(key) && !is_default(value) {
                        return Err(format!("{path}.{key}: unexpected {value}"));
                    }
                }
                Ok(())
            }
            (Value::Array(actual), Value::Array(expected)) if actual.len() == expected.len() => {
                for (index, (value, wanted)) in actual.iter().zip(expected).enumerate() {
                    walk(value, wanted, &format!("{path}.{index}"))?;
                }
                Ok(())
            }
            _ if actual == expected => Ok(()),
            _ => Err(format!("{path}: {actual} != {expected}")),
        }
    }
    walk(&whole_numbers(actual.clone()), expected, "$")
}

/// Whether `value` is what a typed model serializes for a field the response left out: `null`,
/// `false`, zero, an empty string or list, or an object of such values (a defaulted struct).
fn is_default(value: &Value) -> bool {
    match value {
        Value::Null | Value::Bool(false) => true,
        Value::Number(number) => number.as_f64() == Some(0.0),
        Value::String(text) => text.is_empty(),
        Value::Array(items) => items.is_empty(),
        Value::Object(map) => map.values().all(is_default),
        _ => false,
    }
}

/// An error as the fixtures describe it: `{code, status, requestId, retryAfter, details}`, with
/// `null` for what it lacks (no details is `null`).
pub fn error_json(error: &calmlens::Error) -> Value {
    serde_json::json!({
        "code": error.code().as_str(),
        "status": error.status().map(|status| status.as_u16()),
        "requestId": error.request_id(),
        "retryAfter": error.retry_after().map(|delay| delay.as_secs()),
        // API responses' errors carry the body's `details` object; errors raised before sending
        // (SDK codes, or API codes without a status) have none unless they set some.
        "details": if error.details().is_empty()
            && (error.code().as_str().starts_with("sdk/") || error.status().is_none())
        {
            Value::Null
        } else {
            Value::Object(error.details().clone())
        },
    })
}

/// One part of a `multipart/form-data` body.
pub struct FormPart {
    pub name: String,
    pub content_type: String,
    pub body: Vec<u8>,
}

/// The parts of a `multipart/form-data` body, split with the boundary from `content_type`.
pub fn parse_form(content_type: &str, body: &[u8], label: &str) -> Vec<FormPart> {
    let boundary =
        regex_lite::Regex::new(r#"^multipart/form-data; ?boundary=(?:"([^"]+)"|(\S+))$"#)
            .unwrap()
            .captures(content_type)
            .and_then(|captures| captures.get(1).or_else(|| captures.get(2)))
            .unwrap_or_else(|| panic!("{label}: no form boundary in {content_type:?}"))
            .as_str()
            .to_owned();
    let find = |needle: &[u8], from: usize| {
        body.get(from..)
            .and_then(|rest| rest.windows(needle.len()).position(|w| w == needle))
            .map(|at| at + from)
    };
    let opening = format!("--{boundary}\r\n").into_bytes();
    assert!(
        body.starts_with(&opening),
        "{label}: the form must open with its boundary"
    );
    let delimiter = format!("\r\n--{boundary}").into_bytes();
    let name_pattern = regex_lite::Regex::new(r#"\bname="([^"]*)""#).unwrap();
    let mut parts = Vec::new();
    let mut start = opening.len();
    loop {
        let head_end =
            find(b"\r\n\r\n", start).unwrap_or_else(|| panic!("{label}: form part headers"));
        let head = std::str::from_utf8(&body[start..head_end]).unwrap();
        let end =
            find(&delimiter, head_end + 4).unwrap_or_else(|| panic!("{label}: form part end"));
        let mut part = FormPart {
            name: String::new(),
            content_type: String::new(),
            body: body[head_end + 4..end].to_vec(),
        };
        for line in head.split("\r\n") {
            let (name, value) = line
                .split_once(':')
                .unwrap_or_else(|| panic!("{label}: form part header {line:?}"));
            match name.to_ascii_lowercase().as_str() {
                "content-disposition" => {
                    part.name = name_pattern
                        .captures(value)
                        .unwrap_or_else(|| panic!("{label}: form part name in {value:?}"))[1]
                        .to_owned();
                }
                "content-type" => part.content_type = value.trim().to_owned(),
                _ => {}
            }
        }
        parts.push(part);
        let after = end + delimiter.len();
        if body[after..] == *b"--\r\n" {
            return parts;
        }
        assert_eq!(
            body.get(after..after + 2),
            Some(b"\r\n".as_slice()),
            "{label}: form part delimiter"
        );
        start = after + 2;
    }
}

/// A captured upload form request's `options` part as JSON and its `file` part, checking that
/// it holds exactly those two parts in that order.
pub fn upload_form(request: &calmlens::testing::Request) -> (Value, FormPart) {
    let content_type = request
        .header("content-type")
        .expect("an upload form has a Content-Type");
    let mut parts = parse_form(content_type, &request.body, "upload form");
    let names: Vec<&str> = parts.iter().map(|part| part.name.as_str()).collect();
    assert_eq!(names, ["options", "file"], "upload form parts");
    let file = parts.pop().unwrap();
    let options = serde_json::from_slice(&parts[0].body).expect("the options part is JSON");
    (options, file)
}

/// Every [`calmlens::ErrorKind`], to resolve `surface.json`'s `errorKinds` names.
pub const ERROR_KINDS: &[calmlens::ErrorKind] = {
    use calmlens::ErrorKind::*;
    &[
        Api,
        BadRequest,
        Authentication,
        PermissionDenied,
        NotFound,
        Conflict,
        PayloadTooLarge,
        UnprocessableEntity,
        RateLimit,
        Server,
        Connection,
        Timeout,
        Cancelled,
        InvalidArgument,
        Configuration,
        InvalidResponse,
        WebhookVerification,
    ]
};

/// The kind `surface.json`'s `errorKinds` names `id`, by its Rust name (`ErrorKind::NotFound`);
/// `None` for the root kind, `error`, which every error is.
pub fn error_kind(id: &str) -> Option<calmlens::ErrorKind> {
    let surface = fixture("surface");
    let entry = surface["errorKinds"]
        .as_array()
        .unwrap()
        .iter()
        .find(|kind| kind["id"] == id)
        .unwrap_or_else(|| panic!("unknown error kind {id}"));
    let name = entry["names"]["rust"].as_str().unwrap();
    let name = name.strip_prefix("ErrorKind::")?;
    Some(
        *ERROR_KINDS
            .iter()
            .find(|kind| format!("{kind:?}") == name)
            .unwrap_or_else(|| panic!("no ErrorKind named {name}")),
    )
}

/// Checks that `error` is kind `id` exactly, and every kind above it in `surface.json`.
pub fn check_kind(error: &calmlens::Error, id: &str, label: &str) {
    let surface = fixture("surface");
    let kinds = surface["errorKinds"].as_array().unwrap();
    if let Some(kind) = error_kind(id) {
        assert_eq!(error.kind(), kind, "{label}: kind");
    }
    let mut current = Some(id.to_owned());
    while let Some(id) = current {
        if let Some(kind) = error_kind(&id) {
            assert!(error.is(kind), "{label}: is {id}");
        }
        current = kinds
            .iter()
            .find(|kind| kind["id"] == id.as_str())
            .and_then(|kind| kind["parent"].as_str())
            .map(str::to_owned);
    }
}

/// `fields` laid over the JSON of `T::default()`, so a test spells out only the fields it checks
/// and the rest of the model is present, as a real response's required fields are. Objects are
/// merged deeply; arrays and other values replace the default.
pub fn complete<T: Default + Serialize>(fields: Value) -> Value {
    fn merge(base: &mut Value, over: Value) {
        match (base, over) {
            (Value::Object(base), Value::Object(over)) => {
                for (key, value) in over {
                    match base.get_mut(&key) {
                        Some(slot) => merge(slot, value),
                        None => {
                            base.insert(key, value);
                        }
                    }
                }
            }
            (slot, value) => *slot = value,
        }
    }
    let mut base = serde_json::to_value(T::default()).expect("serializable SDK model");
    merge(&mut base, fields);
    base
}

/// A `tracing` subscriber that keeps every event at or above `level` as a line of text, for
/// checking what the SDK logs.
pub struct CapturedLogs {
    level: tracing::Level,
    pub lines: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}
impl CapturedLogs {
    pub fn new(level: tracing::Level) -> Self {
        Self {
            level,
            lines: Default::default(),
        }
    }
}
impl tracing::Subscriber for CapturedLogs {
    fn enabled(&self, metadata: &tracing::Metadata<'_>) -> bool {
        *metadata.level() <= self.level
    }
    fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }
    fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
    fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
    fn event(&self, event: &tracing::Event<'_>) {
        struct Line(String);
        impl tracing::field::Visit for Line {
            fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
                self.0.push_str(&format!(" {}={value:?}", field.name()));
            }
        }
        let mut line = Line(format!(
            "{} {}",
            event.metadata().level(),
            event.metadata().target()
        ));
        event.record(&mut line);
        self.lines.lock().unwrap().push(line.0);
    }
    fn enter(&self, _: &tracing::span::Id) {}
    fn exit(&self, _: &tracing::span::Id) {}
}
