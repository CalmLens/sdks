//! Invokes SDK operations by their shared contract names with JSON options.
#![allow(dead_code)]
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

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
