//! Replays the shared mock behaviour scenarios (packages/sdk-contract/mockScenarios.ts) against
//! `MockServerClient::in_memory`. The format is described in packages/sdk-contract/README.md.
mod common;

use calmlens::{models::*, testing::*};
use common::{input, invoke, typed};
use serde_json::{json, Map, Value};
use std::{collections::HashMap, time::Duration};

/// Follows a dotted path: numeric segments index arrays, `length` is an array's length.
fn at(value: &Value, path: &str) -> Value {
    path.split('.')
        .fold(value.clone(), |current, segment| match current {
            Value::Array(items) if segment == "length" => json!(items.len()),
            Value::Array(items) => segment
                .parse::<usize>()
                .ok()
                .and_then(|index| items.get(index).cloned())
                .unwrap_or(Value::Null),
            Value::Object(map) => map.get(segment).cloned().unwrap_or(Value::Null),
            _ => Value::Null,
        })
}

fn resolve(value: &Value, saved: &HashMap<String, Value>) -> Value {
    match value {
        Value::Object(map) if map.contains_key("$ref") => {
            let reference = map["$ref"].as_str().unwrap();
            let (name, rest) = reference.split_once('.').unwrap();
            at(&saved[name], rest)
        }
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), resolve(item, saved)))
                .collect(),
        ),
        Value::Array(items) => {
            Value::Array(items.iter().map(|item| resolve(item, saved)).collect())
        }
        other => other.clone(),
    }
}

async fn run_step(
    mock: &MockServerClient,
    operation: &str,
    args: Value,
) -> calmlens::Result<Value> {
    match operation {
        "mock.decide" => {
            let decision: AssetModerationDecision = typed(args["outcome"].clone());
            let asset = mock.decide(args["assetId"].as_str().unwrap(), decision)?;
            Ok(serde_json::to_value(asset).unwrap())
        }
        "mock.enqueueEvent" => {
            let mut event = args.clone();
            event["id"] = json!("");
            Ok(serde_json::to_value(mock.enqueue_event(typed(event))).unwrap())
        }
        "cdn.serve" => {
            let response = mock.cdn().serve(input(args)?).await?;
            let status = response.status().as_u16();
            let json = response
                .headers()
                .get("content-type")
                .is_some_and(|value| value == "application/json");
            let body = response.text().await?;
            let code = if json {
                serde_json::from_str::<Value>(&body).unwrap()["code"].clone()
            } else {
                Value::Null
            };
            Ok(json!({"status": status, "code": code, "body": body}))
        }
        "assets.waitForDecision" => {
            let timeout = Duration::from_millis(args["timeoutMs"].as_u64().unwrap());
            let request = WaitForDecision::new(args["assetId"].as_str().unwrap()).timeout(timeout);
            Ok(serde_json::to_value(mock.assets().wait_for_decision(request).await?).unwrap())
        }
        _ => invoke(mock, operation, args).await,
    }
}

async fn check_step(
    mock: &MockServerClient,
    scenario: &str,
    step: &Value,
    saved: &mut HashMap<String, Value>,
) {
    let operation = step["operation"].as_str().unwrap();
    let label = format!("{scenario}: {operation} {}", step["args"]);
    let args = resolve(step.get("args").unwrap_or(&json!({})), saved);
    let empty = Value::Object(Map::new());
    let expect = step.get("expect").unwrap_or(&empty);
    let outcome = run_step(mock, operation, args).await;
    if let Some(wanted) = expect.get("error") {
        let error = outcome.expect_err(&label);
        assert_eq!(
            json!({"code": error.code().as_str(), "status": error.status()}),
            *wanted,
            "{label}"
        );
        return;
    }
    let result = outcome.unwrap_or_else(|error| panic!("{label}: {error:?}"));
    if let Some(Value::Object(cdn)) = expect.get("cdn") {
        for (key, wanted) in cdn {
            assert_eq!(result[key], *wanted, "{label}: cdn {key}");
        }
    }
    if let Some(Value::Object(paths)) = expect.get("result") {
        for (path, raw) in paths {
            let actual = at(&result, path);
            if let Some(member) = raw.get("$contains") {
                let member = resolve(member, saved);
                let items = actual
                    .as_array()
                    .unwrap_or_else(|| panic!("{label}: {path} is not an array"));
                assert!(
                    items.contains(&member),
                    "{label}: {path} {actual} lacks {member}"
                );
            } else {
                assert_eq!(actual, resolve(raw, saved), "{label}: {path}");
            }
        }
    }
    if let Some(name) = step["save"].as_str() {
        saved.insert(name.to_owned(), result);
    }
}

fn outcome(value: Option<&Value>, default: MockOutcome) -> MockOutcome {
    match value.and_then(Value::as_str) {
        None => default,
        Some("pending") => MockOutcome::Pending,
        Some("allowed") => MockOutcome::Allowed,
        Some("age-restricted") => MockOutcome::AgeRestricted,
        Some("blocked") => MockOutcome::Blocked,
        Some("purged") => MockOutcome::Purged,
        Some("failed") => MockOutcome::Failed,
        Some(other) => panic!("unknown outcome {other}"),
    }
}

#[tokio::test]
async fn mock_replays_every_shared_scenario() {
    let file: Value =
        serde_json::from_str(include_str!("../testdata/mock-scenarios.json")).unwrap();
    let scenarios = file["scenarios"].as_array().unwrap();
    assert_eq!(scenarios.len(), 14);
    for scenario in scenarios {
        let name = scenario["name"].as_str().unwrap();
        let options = &scenario["mock"];
        let grants: Vec<MockApiKeyGrant> =
            typed(options.get("apiKeyGrants").cloned().unwrap_or(json!([])));
        let mock = MockServerClient::in_memory(
            MockOptions::new()
                .project_id("project-1")
                .api_key(create_mock_api_key(&grants))
                .queued_outcome(outcome(options.get("queuedOutcome"), MockOutcome::Pending))
                .analyzed_outcome(outcome(
                    options.get("analyzedOutcome"),
                    MockOutcome::Allowed,
                )),
        )
        .unwrap();
        let started = std::time::Instant::now();
        let mut saved = HashMap::new();
        for step in scenario["steps"].as_array().unwrap() {
            check_step(&mock, name, step, &mut saved).await;
        }
        // Mock waits take no real time.
        assert!(started.elapsed() < Duration::from_secs(5), "{name}");
    }
}

#[tokio::test]
async fn mock_options_set_the_base_urls() {
    let mock = MockServerClient::in_memory(
        MockOptions::new()
            .api_base_url("http://localhost:8787/api/v1")
            .cdn_base_url("http://localhost:8788/cdn/v1"),
    )
    .unwrap();
    let asset = mock
        .assets()
        .create(SubmitAsset::text("hello"))
        .await
        .unwrap();
    let response = mock
        .cdn()
        .serve(CdnRequest {
            asset_identifier: asset.id.clone(),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 403);
    let urls: Vec<_> = mock
        .requests()
        .into_iter()
        .map(|request| request.url)
        .collect();
    assert!(
        urls[0].starts_with("http://localhost:8787/api/v1/projects/mock-project/assets?"),
        "{urls:?}"
    );
    assert!(
        urls[1].starts_with(&format!(
            "http://localhost:8788/cdn/v1/assets/mock-project/{}/",
            asset.id
        )),
        "{urls:?}"
    );
}
