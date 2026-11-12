//! Replays `testdata/client-cases.json`, `testdata/errors.json` and `surface.json`'s `defaults`
//! (packages/sdk-contract/README.md, "Scripted client cases") against the real `ServerClient`;
//! `contract.rs` replays the other fixtures, all read through `common::fixture`. Its injectable transport is
//! `MockServerClient::from_builder`: canned responses, connection failures and hangs replace the
//! network, requests are recorded as sent, and waits are recorded on a virtual clock instead of
//! taking time, so `sleepsMs` compare exactly.
mod common;
use base64::{engine::general_purpose::STANDARD, Engine};
use calmlens::models::*;
use calmlens::testing::{MockResponse, MockServerClient};
use calmlens::{AttemptEvent, Error, RequestOptions, ServerClient};
use common::{
    check_kind, compare_typed, error_json, fixture, input, invoke, iterator, whole_numbers,
};
use futures_util::StreamExt;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    time::Duration,
};

/// Options a case gives that the Rust types cannot hold, so the client can never be configured or
/// called with them; the type itself refuses what the fixture expects the SDK to refuse.
fn refused_by_type(client: &Map<String, Value>, step: &Value) -> Option<&'static str> {
    if client.get("maxRetries").is_some_and(|value| {
        value
            .as_u64()
            .is_none_or(|retries| retries > u32::MAX as u64)
    }) {
        return Some("ServerClientBuilder::max_retries takes a u32");
    }
    if step["operation"] == "assets.waitForDecision"
        && step["args"]
            .get("timeoutMs")
            .is_some_and(|value| value.as_u64().is_none())
    {
        return Some("WaitForDecision::timeout is a Duration, which cannot be negative");
    }
    None
}

/// The case's client builder: from the environment with `clientFromEnv`, else from the options.
fn builder(
    defaults: &Value,
    overrides: &Map<String, Value>,
    from_env: bool,
) -> calmlens::Result<calmlens::ServerClientBuilder> {
    let option = |name: &str| overrides.get(name).or_else(|| defaults.get(name));
    let text = |name: &str| option(name).and_then(Value::as_str).unwrap_or_default();
    let mut builder = if from_env {
        calmlens::ServerClientBuilder::from_env()?
    } else {
        ServerClient::builder(text("apiKey"), text("projectId"))
    };
    if let Some(info) = overrides.get("appInfo") {
        builder = builder.app_info(
            info["name"].as_str().unwrap(),
            info["version"].as_str(),
            info["url"].as_str(),
        );
    }
    if let Some(url) = option("baseUrl").and_then(Value::as_str) {
        builder = builder.base_url(url);
    }
    if let Some(url) = option("cdnBaseUrl").and_then(Value::as_str) {
        builder = builder.cdn_base_url(url);
    }
    if let Some(retries) = option("maxRetries").and_then(Value::as_u64) {
        builder = builder.max_retries(retries as u32);
    }
    if let Some(timeout) = option("timeoutMs").and_then(Value::as_u64) {
        builder = builder.timeout(Duration::from_millis(timeout));
    }
    if let Some(limit) = option("maxResponseBytes").and_then(Value::as_u64) {
        builder = builder.max_response_bytes(limit as usize);
    }
    if let Some(size) = option("partSizeBytes").and_then(Value::as_u64) {
        builder = builder.part_size_bytes(size);
    }
    Ok(builder)
}

/// A step's `requestOptions` as [`RequestOptions`].
fn request_options(options: &Value) -> RequestOptions {
    let mut built = RequestOptions::new();
    if let Some(timeout) = options["timeoutMs"].as_u64() {
        built = built.timeout(Duration::from_millis(timeout));
    }
    if let Some(retries) = options["maxRetries"].as_u64() {
        built = built.max_retries(retries as u32);
    }
    if let Some(key) = options["idempotencyKey"].as_str() {
        built = built.idempotency_key(key);
    }
    for (name, value) in options["headers"].as_object().into_iter().flatten() {
        built = built.header(name, value.as_str().unwrap());
    }
    for (name, value) in options["extraQuery"].as_object().into_iter().flatten() {
        built = built.query(name, value.as_str().unwrap());
    }
    for (name, value) in options["extraBody"].as_object().into_iter().flatten() {
        built = built.body_field(name, value.clone());
    }
    built
}

/// The JSON a case's `attempts` lists for an attempt.
fn attempt_json(event: &AttemptEvent) -> Value {
    json!({
        "operation": event.operation,
        "method": event.method.as_str(),
        "path": event.path,
        "attempt": event.attempt,
        "delayMs": event.retry_delay.map(|delay| delay.as_millis() as u64),
        "status": event.status.map(|status| status.as_u16()),
        "requestId": event.request_id,
        "errorCode": event.error_code.as_ref().map(calmlens::ErrorCode::as_str),
    })
}

/// A result's `lastResponse` as a case lists it.
fn last_response_json(response: Option<&LastResponse>) -> Value {
    response.map_or(Value::Null, |response| {
        json!({
            "status": response.status.as_u16(),
            "requestId": response.request_id,
            "idempotencyKey": response.idempotency_key,
        })
    })
}

fn enqueue(mock: &MockServerClient, response: &Value) {
    if response["transportError"] == true {
        return mock.enqueue_transport_error("connection reset");
    }
    if response["hang"] == true {
        return mock.enqueue_hang();
    }
    let mut queued = MockResponse::new(response["status"].as_u64().unwrap() as u16);
    for (name, value) in response["headers"].as_object().into_iter().flatten() {
        queued = queued.header(name, value.as_str().unwrap());
    }
    queued = if let Some(body) = response.get("body") {
        queued.body(serde_json::to_vec(body).unwrap())
    } else if let Some(text) = response["bodyText"].as_str() {
        queued.body(text.to_owned())
    } else if let Some(encoded) = response["bodyBase64"].as_str() {
        queued.body(STANDARD.decode(encoded).unwrap())
    } else {
        queued
    };
    mock.enqueue_response(queued);
}

/// The bytes of a `$bytes`, `$stream` or `$fill` marker.
fn marker_bytes(value: &Value) -> Vec<u8> {
    if let Some(encoded) = value
        .get("$bytes")
        .or_else(|| value.get("$stream"))
        .and_then(Value::as_str)
    {
        return STANDARD.decode(encoded).unwrap();
    }
    let fill = &value["$fill"];
    vec![fill["byte"].as_u64().unwrap() as u8; fill["length"].as_u64().unwrap() as usize]
}

/// Upload content from the JavaScript shape: `uint8Array`/`buffer` are bytes, `data` a one-shot
/// stream, `base64` and `plainText` as they are.
fn content(value: &Value) -> Content {
    let size = value["sizeInBytes"].as_u64();
    let mime = value["type"].as_str().unwrap_or_default();
    let mut content = if let Some(text) = value["plainText"].as_str() {
        Content::text(text)
    } else if let Some(encoded) = value["base64"].as_str() {
        Content {
            payload: Payload::Base64(encoded.into()),
            ..Content::default()
        }
    } else if let Some(bytes) = value.get("uint8Array").or_else(|| value.get("buffer")) {
        Content::bytes(marker_bytes(bytes), mime)
    } else {
        let bytes = bytes::Bytes::from(marker_bytes(&value["data"]));
        let stream = futures_util::stream::iter([Ok::<_, std::io::Error>(bytes)]);
        match size {
            Some(size) => Content::stream(stream, size, mime),
            None => Content::unsized_stream(stream, mime),
        }
    };
    content.mime_type = mime.into();
    content.size_in_bytes = size;
    content.part_number = value["partNumber"].as_u64().map(|number| number as u32);
    content.is_final = value["isFinal"].as_bool();
    content
}

/// `args` without `field`, decoded as `T`, and `field`'s content.
fn with_content<T: serde::de::DeserializeOwned>(
    args: &Value,
    field: &str,
    placeholder: bool,
) -> calmlens::Result<(T, Option<Content>)> {
    let mut rest = args.clone();
    let taken = rest.as_object_mut().unwrap().remove(field);
    if placeholder {
        rest[field] = json!({"plainText": ""});
    }
    Ok((input(rest)?, taken.as_ref().map(content)))
}

/// What a step returns: a value, or an error with what an iterator yielded first.
enum Outcome {
    Value(Value),
    Failed(Error, Option<Vec<Value>>),
}

async fn collect<T: serde::Serialize>(
    stream: futures_util::stream::BoxStream<'static, calmlens::Result<T>>,
    stop_after: Option<usize>,
) -> Outcome {
    let mut stream = stream;
    let mut items = Vec::new();
    // A caller that breaks out of its loop stops reading after that many items.
    while stop_after.is_none_or(|stop| items.len() < stop) {
        let Some(item) = stream.next().await else {
            break;
        };
        match item {
            Ok(item) => items.push(serde_json::to_value(item).unwrap()),
            Err(error) => return Outcome::Failed(error, Some(items)),
        }
    }
    Outcome::Value(Value::Array(items))
}

async fn run(
    client: &ServerClient,
    operation: &str,
    args: &Value,
    last: &mut Option<Value>,
    stop_after: Option<usize>,
) -> Outcome {
    let result: calmlens::Result<Value> = async {
        Ok(match operation {
            "request" => {
                let mut path = args["path"].as_str().unwrap().to_owned();
                let mut client = client.clone();
                if let Some(query) = args["query"].as_object() {
                    let mut encoded = reqwest::Url::parse("http://query.invalid/").unwrap();
                    encoded.query_pairs_mut().extend_pairs(
                        query
                            .iter()
                            .map(|(key, value)| (key, value.as_str().unwrap())),
                    );
                    path = format!("{path}?{}", encoded.query().unwrap_or_default());
                }
                if let Some(headers) = args["headers"].as_object() {
                    let mut options = RequestOptions::new();
                    for (name, value) in headers {
                        options = options.header(name, value.as_str().unwrap());
                    }
                    client = client.with_options(options);
                }
                let method =
                    http::Method::from_bytes(args["method"].as_str().unwrap().as_bytes()).unwrap();
                let body = args.get("body").filter(|body| !body.is_null());
                client.request(method, &path, body).await?
            }
            "assets.retrieve" => {
                let asset = client.assets().retrieve(input(args.clone())?).await?;
                *last = Some(last_response_json(asset.last_response()));
                serde_json::to_value(asset).unwrap()
            }
            "assets.create" | "assets.classify" => {
                let field = if args.get("part").is_some() {
                    "part"
                } else {
                    "content"
                };
                let (mut options, content): (SubmitAsset, _) = with_content(args, field, false)?;
                if field == "part" {
                    options.part = content;
                } else {
                    options.content = content;
                }
                let asset = if operation == "assets.create" {
                    client.assets().create(options).await?
                } else {
                    client.assets().classify(options).await?
                };
                *last = Some(last_response_json(asset.last_response()));
                serde_json::to_value(asset).unwrap()
            }
            "assets.uploadPart" => {
                let (mut options, part): (UploadPart, _) = with_content(args, "part", true)?;
                options.part = part.unwrap();
                serde_json::to_value(client.assets().upload_part(options).await?).unwrap()
            }
            "ensureLens" => {
                serde_json::to_value(client.ensure_lens(input(args.clone())?).await?).unwrap()
            }
            "assets.waitForDecision" => {
                let mut options = WaitForDecision::new(args["assetId"].as_str().unwrap());
                if let Some(timeout) = args["timeoutMs"].as_u64() {
                    options = options.timeout(Duration::from_millis(timeout));
                }
                serde_json::to_value(client.assets().wait_for_decision(options).await?).unwrap()
            }
            "cdn.serve" => {
                let response = client.cdn().serve(input(args.clone())?).await?;
                let status = response.status().as_u16();
                let headers: Map<String, Value> = response
                    .headers()
                    .iter()
                    .map(|(name, value)| (name.to_string(), json!(value.to_str().unwrap())))
                    .collect();
                let body = response.bytes().await?;
                json!({"status": status, "headers": headers, "bodyBase64": STANDARD.encode(body)})
            }
            _ => invoke(client, operation, args.clone()).await?,
        })
    }
    .await;
    match iterator(client, operation, args.clone()) {
        Some(Ok(stream)) => collect(stream, stop_after).await,
        Some(Err(error)) => Outcome::Failed(error, None),
        None => match result {
            Ok(value) => Outcome::Value(value),
            Err(error) => Outcome::Failed(error, None),
        },
    }
}

/// Checks an outcome against a step's `expect`; panics naming the difference.
fn check(outcome: Outcome, expect: &Value, label: &str) {
    match (outcome, expect.get("error")) {
        (Outcome::Failed(error, partial), Some(wanted)) => {
            let mut actual = error_json(&error);
            if let (Some(Value::Number(at_least)), Some(seconds)) = (
                wanted["retryAfter"].get("$gte"),
                error.retry_after().map(|delay| delay.as_secs()),
            ) {
                assert!(seconds >= at_least.as_u64().unwrap(), "{label}: retryAfter");
                actual["retryAfter"] = wanted["retryAfter"].clone();
            }
            assert_eq!(&actual, wanted, "{label}: error {error:?}");
            if let Some(wanted) = expect.get("partialResult") {
                let partial = Value::Array(partial.expect("an iterator's partial result"));
                compare_typed(&partial, wanted).unwrap_or_else(|path| panic!("{label}: {path}"));
            }
        }
        (Outcome::Failed(error, _), None) => panic!("{label}: unexpected error {error:?}"),
        (Outcome::Value(value), Some(wanted)) => {
            panic!("{label}: expected error {wanted}, got {value}")
        }
        (Outcome::Value(value), None) => {
            if let Some(cdn) = expect.get("cdn") {
                assert_eq!(value["status"], cdn["status"], "{label}: status");
                // A body the case scripted as JSON is compared as JSON: the harness serialized
                // it, so its key order is the harness's, not the fixture's.
                let served = STANDARD
                    .decode(value["bodyBase64"].as_str().unwrap())
                    .unwrap();
                let wanted = STANDARD
                    .decode(cdn["bodyBase64"].as_str().unwrap())
                    .unwrap();
                match (
                    serde_json::from_slice::<Value>(&served),
                    serde_json::from_slice::<Value>(&wanted),
                ) {
                    (Ok(served), Ok(wanted)) => assert_eq!(served, wanted, "{label}: body"),
                    _ => assert_eq!(served, wanted, "{label}: body"),
                }
                for (name, wanted) in cdn["headers"].as_object().into_iter().flatten() {
                    let served = &value["headers"][name.to_ascii_lowercase()];
                    assert_eq!(served, wanted, "{label}: header {name}");
                }
            } else {
                compare_typed(&value, &expect["result"])
                    .unwrap_or_else(|path| panic!("{label}: {path}"));
            }
        }
    }
}

/// Checks one recorded request's headers against the fixture's exact values and markers.
fn check_headers(
    request: &calmlens::testing::Request,
    wanted: &Map<String, Value>,
    uuids: &mut HashMap<String, String>,
    label: &str,
) {
    let uuid = regex_lite::Regex::new(
        "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    )
    .unwrap();
    for (name, spec) in wanted {
        let actual = request.header(name);
        let context = format!("{label}: header {name} = {actual:?}");
        if let Some(text) = spec.as_str() {
            assert_eq!(actual, Some(text), "{context}");
        } else if spec["$absent"] == true {
            assert_eq!(actual, None, "{context}");
        } else if let Some(pattern) = spec["$regex"].as_str() {
            let pattern = regex_lite::Regex::new(pattern).unwrap();
            assert!(
                actual.is_some_and(|value| pattern.is_match(value)),
                "{context}"
            );
        } else if let Some(name) = spec["$uuid"].as_str() {
            let value = actual.unwrap_or_else(|| panic!("{context}"));
            assert!(uuid.is_match(value), "{context}: not a v4 UUID");
            let first = uuids
                .entry(name.to_owned())
                .or_insert_with(|| value.to_owned());
            assert_eq!(first, value, "{context}: {name} changed");
            let others = uuids.iter().filter(|(_, other)| *other == value).count();
            assert_eq!(others, 1, "{context}: shared with another label");
        } else {
            panic!("{context}: unknown marker {spec}");
        }
    }
}

fn check_request(
    request: &calmlens::testing::Request,
    wanted: &Value,
    every: &Map<String, Value>,
    uuids: &mut HashMap<String, String>,
    label: &str,
) {
    let url = reqwest::Url::parse(&request.url).unwrap();
    let origin = url.origin().ascii_serialization();
    assert_eq!(request.method, wanted["method"], "{label}: method");
    assert_eq!(origin, wanted["origin"], "{label}: origin");
    assert_eq!(url.path(), wanted["path"], "{label}: path");
    let pairs = |pairs: Vec<(String, String)>| {
        let mut pairs = pairs;
        pairs.sort();
        pairs
    };
    let expected: Vec<(String, String)> = wanted["query"]
        .as_array()
        .unwrap()
        .iter()
        .map(|pair| {
            (
                pair[0].as_str().unwrap().to_owned(),
                pair[1].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        pairs(request.query.clone()),
        pairs(expected),
        "{label}: query"
    );
    check_headers(request, every, uuids, label);
    check_headers(
        request,
        wanted["headers"].as_object().unwrap(),
        uuids,
        label,
    );
    if let Some(body) = wanted.get("body") {
        let actual = if request.body.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&request.body)
                .unwrap_or_else(|_| panic!("{label}: body is not JSON"))
        };
        assert_eq!(&actual, body, "{label}: body");
    } else if let Some(form) = wanted.get("form") {
        let content_type = request
            .header("content-type")
            .unwrap_or_else(|| panic!("{label}: no Content-Type"));
        let parts = common::parse_form(content_type, &request.body, label);
        let names: Vec<&str> = parts.iter().map(|part| part.name.as_str()).collect();
        assert_eq!(names, ["options", "file"], "{label}: form parts");
        let options: Value = serde_json::from_slice(&parts[0].body)
            .unwrap_or_else(|_| panic!("{label}: options part is not JSON"));
        assert_eq!(options, form["options"], "{label}: form options");
        let file = &parts[1];
        assert_eq!(
            Some(file.content_type.as_str()),
            form["file"]["contentType"].as_str(),
            "{label}: file Content-Type"
        );
        check_bytes(&file.body, &form["file"], &format!("{label}: file"));
    } else {
        check_bytes(&request.body, wanted, label);
    }
}

/// Checks `body` against a fixture's `bodyLength`, `bodySha256` and optional `bodyBase64`.
fn check_bytes(body: &[u8], wanted: &Value, label: &str) {
    assert_eq!(
        body.len() as u64,
        wanted["bodyLength"].as_u64().unwrap(),
        "{label}: body length"
    );
    let digest: String = Sha256::digest(body)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(digest, wanted["bodySha256"], "{label}: body SHA-256");
    if let Some(encoded) = wanted["bodyBase64"].as_str() {
        assert_eq!(STANDARD.encode(body), encoded, "{label}: body");
    }
}

fn check_sleeps(sleeps: &[Duration], wanted: Option<&Value>, label: &str) {
    let sleeps: Vec<u64> = sleeps
        .iter()
        .map(|sleep| sleep.as_millis() as u64)
        .collect();
    let wanted = wanted
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    assert_eq!(sleeps.len(), wanted.len(), "{label}: sleeps {sleeps:?}");
    for (sleep, wanted) in sleeps.iter().zip(&wanted) {
        match wanted {
            Value::Array(range) => {
                let (min, max) = (range[0].as_u64().unwrap(), range[1].as_u64().unwrap());
                assert!(
                    (min..=max).contains(sleep),
                    "{label}: sleep {sleep} not in {range:?}"
                );
            }
            exact => assert_eq!(Some(*sleep), exact.as_u64(), "{label}: sleep"),
        }
    }
}

/// The reason a capability doesn't apply to Rust, from surface.json.
fn not_applicable(id: &str) -> Option<String> {
    let surface = fixture("surface");
    let capability = surface["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|capability| capability["id"] == id)
        .unwrap_or_else(|| panic!("unknown capability {id}"));
    capability["notApplicable"]["rust"]
        .as_str()
        .map(str::to_owned)
}

async fn replay(file: &Value, case: &Value) {
    let name = case["name"].as_str().unwrap();
    let overrides = case["client"].as_object().cloned().unwrap_or_default();
    let steps = case["steps"].as_array().unwrap();
    if let Some(reason) = refused_by_type(&overrides, &steps[0]) {
        assert!(case["requests"].as_array().unwrap().is_empty(), "{name}");
        assert!(steps[0]["expect"].get("error").is_some(), "{name}");
        println!("refused by type: {name}: {reason}");
        return;
    }
    // The case's environment, with every other CALMLENS_* variable cleared, while the client is made.
    let env = case["env"].as_object();
    if let Some(env) = env {
        for (name, _) in std::env::vars().filter(|(name, _)| name.starts_with("CALMLENS_")) {
            std::env::remove_var(name);
        }
        for (name, value) in env {
            std::env::set_var(name, value.as_str().unwrap());
        }
    }
    let attempts: std::sync::Arc<std::sync::Mutex<Vec<AttemptEvent>>> = Default::default();
    let seen = attempts.clone();
    let made =
        builder(&file["client"], &overrides, case["clientFromEnv"] == true).and_then(|builder| {
            MockServerClient::from_builder(
                builder.on_attempt(move |event| seen.lock().unwrap().push(event.clone())),
            )
        });
    if let Some(env) = env {
        for name in env.keys() {
            std::env::remove_var(name);
        }
    }
    let mock = match made {
        Ok(mock) => mock,
        Err(error) => {
            // An option the SDK refuses fails at construction; the first step expected it.
            check(Outcome::Failed(error, None), &steps[0]["expect"], name);
            assert!(case["requests"].as_array().unwrap().is_empty(), "{name}");
            return;
        }
    };
    for response in case["responses"].as_array().unwrap() {
        enqueue(&mock, response);
    }
    let logs = case.get("logs").map(|logs| {
        let level = match logs["level"].as_str().unwrap() {
            "debug" => tracing::Level::DEBUG,
            _ => tracing::Level::INFO,
        };
        common::CapturedLogs::new(level)
    });
    let lines = logs.as_ref().map(|logs| logs.lines.clone());
    let _logging = logs.map(tracing::subscriber::set_default);
    let client = mock.client();
    for (index, step) in steps.iter().enumerate() {
        let operation = step["operation"].as_str().unwrap();
        let label = format!("{name}: step {index} {operation}");
        let args = step.get("args").cloned().unwrap_or_else(|| json!({}));
        let client = match step.get("requestOptions") {
            Some(options) => client.with_options(request_options(options)),
            None => client.clone(),
        };
        let mut last = None;
        let stop_after = step["stopAfter"].as_u64().map(|stop| stop as usize);
        let outcome = run(&client, operation, &args, &mut last, stop_after).await;
        let failed = matches!(outcome, Outcome::Failed(..));
        if let Some(wanted) = step["expect"].get("lastResponse") {
            assert_eq!(last.as_ref(), Some(wanted), "{label}: lastResponse");
            continue;
        }
        check(outcome, &step["expect"], &label);
        if failed {
            break;
        }
    }
    if let Some(wanted) = case.get("attempts") {
        let seen: Vec<Value> = attempts.lock().unwrap().iter().map(attempt_json).collect();
        assert_eq!(&Value::Array(seen), wanted, "{name}: attempts");
    }
    if let Some(lines) = lines {
        let lines = lines.lock().unwrap();
        assert!(!lines.is_empty(), "{name}: no log lines");
        for secret in case["logs"]["mustNotContain"].as_array().unwrap() {
            let secret = secret.as_str().unwrap();
            assert!(
                lines.iter().all(|line| !line.contains(secret)),
                "{name}: a log line holds {secret}"
            );
        }
    }
    let requests = mock.requests();
    let wanted = case["requests"].as_array().unwrap();
    assert_eq!(requests.len(), wanted.len(), "{name}: request count");
    let mut every = file["everyRequest"]["headers"].as_object().unwrap().clone();
    if let Some(key) = overrides.get("apiKey") {
        every.insert("x-api-key".into(), key.clone());
    }
    let every = &every;
    let mut uuids = HashMap::new();
    for (index, (request, wanted)) in requests.iter().zip(wanted).enumerate() {
        check_request(
            request,
            wanted,
            every,
            &mut uuids,
            &format!("{name}: request {index}"),
        );
    }
    assert_eq!(mock.remaining_responses(), 0, "{name}: unused responses");
    check_sleeps(&mock.sleeps(), case.get("sleepsMs"), name);
}

#[tokio::test]
async fn client_cases() {
    let file = fixture("client-cases");
    let cases = file["cases"].as_array().unwrap();
    let mut failed = Vec::new();
    for case in cases {
        let name = case["name"].as_str().unwrap();
        if let Some(reason) = case["requires"].as_str().and_then(not_applicable) {
            println!("skipped, not applicable to Rust: {name}: {reason}");
            continue;
        }
        let run = futures_util::FutureExt::catch_unwind(std::panic::AssertUnwindSafe(replay(
            &file, case,
        )));
        if run.await.is_err() {
            failed.push(name.to_owned());
        }
    }
    println!("client cases: {}", cases.len());
    assert_eq!(failed, Vec::<String>::new(), "failed client cases");
}

/// errors.json: each API error code parses with its status, and each API error response, raised
/// through the real client with retries off, keeps its code, status, request ID, Retry-After and
/// details.
#[tokio::test]
async fn error_responses_raise_typed_errors() {
    let entries = fixture("errors");
    let entries = entries.as_array().unwrap();
    let mut failed = Vec::new();
    for entry in entries {
        let code = entry["code"].as_str().unwrap();
        // The generated ErrorCode knows each API code and its status.
        let parsed = calmlens::ErrorCode::parse(code);
        if !code.starts_with("sdk/")
            && (parsed.as_str() != code
                || parsed.http_status().map(|status| status.as_u16())
                    != entry["status"].as_u64().map(|status| status as u16))
        {
            failed.push(format!("{code}: ErrorCode::parse"));
        }
        let mock = MockServerClient::from_builder(
            ServerClient::builder("key", "project-1").max_retries(0),
        )
        .unwrap();
        enqueue(&mock, &entry["response"]);
        let outcome = run(
            &mock.client(),
            entry["operation"].as_str().unwrap(),
            &entry["args"],
            &mut None,
            None,
        )
        .await;
        let kind = entry["kind"].as_str().unwrap();
        let body_text = entry["response"]["bodyText"].as_str();
        let checked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if let Outcome::Failed(error, _) = &outcome {
                check_kind(error, kind, code);
                // A body that isn't a CalmLens error, such as a proxy's page, is kept as text.
                if let Some(text) = body_text {
                    assert_eq!(error.raw_body(), Some(text), "{code}: raw body");
                }
            }
            check(outcome, &json!({"error": entry["expected"]}), code)
        }));
        if checked.is_err() || mock.requests().len() != 1 {
            failed.push(format!("{code} ({kind})"));
        }
    }
    println!("errors: {} cases", entries.len());
    assert_eq!(failed, Vec::<String>::new(), "failed error responses");
}

/// errors.json: the generated error codes are exactly the API's, in order, with their statuses.
#[test]
fn error_codes_match_the_api() {
    let expected: Vec<(String, u16)> = fixture("errors")
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| !e["code"].as_str().unwrap().starts_with("sdk/"))
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

/// surface.json `defaults`: the client defaults the SDK exposes equal JavaScript's; any it does not
/// expose must be observed by the client cases that name them.
#[test]
fn defaults_match_javascript() {
    let surface = fixture("surface");
    let ms = |duration: Duration| json!(duration.as_millis() as u64);
    let exposed: BTreeMap<&str, Value> = BTreeMap::from([
        ("baseUrl", json!(calmlens::DEFAULT_BASE_URL)),
        ("cdnBaseUrl", json!(calmlens::DEFAULT_CDN_BASE_URL)),
        ("timeoutMs", ms(calmlens::DEFAULT_TIMEOUT)),
        (
            "uploadTimeoutMs",
            json!(calmlens::DEFAULT_UPLOAD_TIMEOUT.map(|timeout| timeout.as_millis() as u64)),
        ),
        ("maxRetries", json!(calmlens::DEFAULT_MAX_RETRIES)),
        ("retryBaseDelayMs", ms(calmlens::RETRY_BASE_DELAY)),
        ("retryMaxDelayMs", ms(calmlens::RETRY_MAX_DELAY)),
        ("retryAfterMaxMs", ms(calmlens::RETRY_AFTER_MAX)),
        (
            "maxResponseBytes",
            json!(calmlens::DEFAULT_MAX_RESPONSE_BYTES),
        ),
        (
            "signedUrlExpiresIn",
            json!(calmlens::DEFAULT_SIGNED_URL_EXPIRES_IN),
        ),
        (
            "uploadTokenExpiresInSeconds",
            json!(calmlens::DEFAULT_UPLOAD_TOKEN_SECONDS),
        ),
        (
            "waitForDecisionTimeoutMs",
            ms(calmlens::DEFAULT_DECISION_TIMEOUT),
        ),
        (
            "waitForDecisionFirstIntervalMs",
            ms(calmlens::DECISION_POLL_FIRST_INTERVAL),
        ),
        (
            "waitForDecisionIntervalFactor",
            json!(calmlens::DECISION_POLL_INTERVAL_FACTOR),
        ),
        (
            "waitForDecisionMaxIntervalMs",
            ms(calmlens::DECISION_POLL_MAX_INTERVAL),
        ),
        (
            "ensureLensesBatchSize",
            json!(calmlens::ENSURE_LENSES_MAX_PER_REQUEST),
        ),
        ("partSizeBytes", json!(calmlens::DEFAULT_PART_SIZE_BYTES)),
    ]);
    let cases: BTreeSet<String> = fixture("client-cases")["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| case["name"].as_str().unwrap().to_owned())
        .collect();
    let defaults = surface["defaults"].as_array().unwrap();
    let mut failed = Vec::new();
    for default in defaults {
        let id = default["id"].as_str().unwrap();
        match exposed.get(id) {
            Some(value) if whole_numbers(value.clone()) != default["value"] => {
                failed.push(format!("{id}: {value} is not {}", default["value"]));
            }
            Some(_) => {}
            None => {
                let observed = default["observedBy"].as_array().unwrap();
                if observed.is_empty() {
                    failed.push(format!("{id} is neither exposed nor observed"));
                }
                for case in observed {
                    if !cases.contains(case.as_str().unwrap()) {
                        failed.push(format!("{id}: no client case {case}"));
                    }
                }
            }
        }
    }
    println!("defaults: {} cases", defaults.len());
    assert!(!defaults.is_empty(), "surface.json has no defaults");
    assert_eq!(failed, Vec::<String>::new(), "failed defaults");
}
