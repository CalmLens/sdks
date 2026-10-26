//! Invokes SDK operations by their shared contract names with JSON options.
#![allow(dead_code)]
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
        calmlens::Error::new("upload/invalid-payload", cause.to_string()).with_source(cause)
    })
}
fn output<T: Serialize>(result: calmlens::Result<T>) -> calmlens::Result<Value> {
    result.map(|value| serde_json::to_value(value).expect("serializable SDK model"))
}
/// Decodes JSON into a native type, panicking on failure.
pub fn typed<T: DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).unwrap()
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
        "assets.explain" => output(client.assets().explain(input(options)?).await),
        "assets.deleteContent" => output(client.assets().delete_content(input(options)?).await),
        "assets.delete" => output(client.assets().delete(input(options)?).await),
        "assets.move" => output(client.assets().move_asset(input(options)?).await),
        "assets.batch" => output(client.assets().batch(input(options)?).await),
        "assets.listChildren" => output(client.assets().list_children(input(options)?).await),
        "assets.uploadPart" => output(client.assets().upload_part(input(options)?).await),
        "assets.createSignedUrl" => {
            output(client.assets().create_signed_url(input(options)?).await)
        }
        "folders.list" => output(client.folders().list(input(options)?).await),
        "folders.create" => output(client.folders().create(input(options)?).await),
        "folders.retrieve" => output(client.folders().retrieve(input(options)?).await),
        "folders.update" => output(client.folders().update(input(options)?).await),
        "folders.move" => output(client.folders().move_folder(input(options)?).await),
        "folders.delete" => output(client.folders().delete(input(options)?).await),
        "hashLists.list" => output(client.hash_lists().list().await),
        "hashLists.retrieve" => output(client.hash_lists().retrieve(input(options)?).await),
        "hashLists.create" => output(client.hash_lists().create(input(options)?).await),
        "hashLists.update" => output(client.hash_lists().update(input(options)?).await),
        "hashLists.delete" => output(client.hash_lists().delete(input(options)?).await),
        "hashLists.listEntries" => output(client.hash_lists().list_entries(input(options)?).await),
        "hashLists.addEntry" => output(client.hash_lists().add_entry(input(options)?).await),
        "hashLists.removeEntry" => output(client.hash_lists().remove_entry(input(options)?).await),
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
    serde_json::json!({"method": request.method, "path": request.path, "query": query, "body": body})
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
/// default (`null`, `""`, `[]` or `{}`); every field `expected` has must be equal. Returns the
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
                    let empty = match value {
                        Value::Null => true,
                        Value::String(text) => text.is_empty(),
                        Value::Array(items) => items.is_empty(),
                        Value::Object(map) => map.is_empty(),
                        _ => false,
                    };
                    if !expected.contains_key(key) && !empty {
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

/// An error as the fixtures describe it: `{code, status, requestId, retryAfter, details}`, with
/// `null` for what it lacks (no details is `null`).
pub fn error_json(error: &calmlens::Error) -> Value {
    serde_json::json!({
        "code": error.code().as_str(),
        "status": error.status(),
        "requestId": error.request_id(),
        "retryAfter": error.retry_after().map(|delay| delay.as_secs()),
        "details": if error.details().is_empty() {
            Value::Null
        } else {
            Value::Object(error.details().clone())
        },
    })
}
