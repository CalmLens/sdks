//! Policies in the in-memory API. The project starts on the organisation's own General preset
//! policy, following automatic updates (`live`). The mock's presets have one release, version 1,
//! with [`preset_settings`], and uploads are never decided by a policy.
use super::{
    bounded, cursor_ordering, fail, keyset_page, unknown_route, validation, Backend, Outcome,
};
use crate::error::ErrorCode;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// The built-in presets the mock knows, with their display names.
const PRESET_NAMES: [(&str, &str); 4] = [
    ("general-community", "General"),
    ("children-platform", "Kids"),
    ("education-support", "Learning and support"),
    ("wholesome-community", "Teen-safe"),
];
fn preset_name(preset: &str) -> Option<&'static str> {
    PRESET_NAMES
        .iter()
        .find(|(id, _)| *id == preset)
        .map(|(_, name)| *name)
}
/// The categories every policy's settings define, in the API's order.
const CATEGORIES: [&str; 8] = [
    "sexual",
    "violence",
    "self-harm",
    "harassment",
    "hate",
    "criminal-activity",
    "personal-information",
    "profanity",
];

/// The settings of the mock's presets: every category with its default action (`allow` for
/// personal information and profanity, `block` otherwise) and no rules. The mock holds no
/// built-in preset settings.
fn preset_settings() -> Value {
    let categories: Map<String, Value> = CATEGORIES
        .iter()
        .map(|category| {
            let action = match *category {
                "personal-information" | "profanity" => "allow",
                _ => "block",
            };
            (
                (*category).to_owned(),
                json!({"action": action, "allowances": [], "restrictions": []}),
            )
        })
        .collect();
    json!({ "categorySettings": categories })
}

/// Refuses settings the API refuses: every category, each with an `action` and its
/// `allowances` and `restrictions` lists, and no other category.
fn check_settings(settings: &Value) -> Outcome<()> {
    let Some(categories) = settings["categorySettings"].as_object() else {
        return Err(validation("invalid-type", "settings.categorySettings"));
    };
    for category in CATEGORIES {
        let path = format!("settings.categorySettings.{category}");
        let Some(value) = categories.get(category).filter(|value| value.is_object()) else {
            return Err(validation("invalid-type", &path));
        };
        for key in ["allowances", "restrictions"] {
            if !value[key].is_array() {
                return Err(validation("invalid-type", &format!("{path}.{key}")));
            }
        }
        if !value["action"].is_string() {
            return Err(validation("invalid-value", &format!("{path}.action")));
        }
    }
    if let Some(unknown) = categories
        .keys()
        .find(|key| !CATEGORIES.contains(&key.as_str()))
    {
        return Err(validation(
            "unknown-field",
            &format!("settings.categorySettings.{unknown}"),
        ));
    }
    Ok(())
}

/// A stored policy: the API's fields without the derived ones, plus its reset baseline.
#[derive(Clone, Debug)]
struct StoredPolicy {
    id: String,
    name: String,
    description: String,
    settings: Value,
    baseline: Value,
    revision: u64,
    /// Whether the organisation's own preset policy follows its preset (mode `live`).
    follows_preset: bool,
    /// The preset it started from, if any, and whether it is the organisation's own policy for
    /// the preset rather than a copy.
    preset: Option<(String, bool)>,
    created_at: u64,
    updated_at: u64,
}

/// The organisation's policies, oldest first, and the project's policy.
#[derive(Debug, Default)]
pub(super) struct Policies {
    stored: Vec<StoredPolicy>,
    project_policy: String,
}

impl Backend {
    fn ensure_policies(&mut self) {
        if !self.policies.project_policy.is_empty() {
            return;
        }
        let general = self.new_policy(
            "General".into(),
            String::new(),
            preset_settings(),
            Some(("general-community".into(), true)),
        );
        let general = &mut self.policies.stored[general];
        general.follows_preset = true;
        self.policies.project_policy = general.id.clone();
    }
    fn new_policy(
        &mut self,
        name: String,
        description: String,
        settings: Value,
        preset: Option<(String, bool)>,
    ) -> usize {
        let now = self.now();
        self.policies.stored.push(StoredPolicy {
            id: self.create_id("pol"),
            name,
            description,
            baseline: settings.clone(),
            settings,
            revision: 1,
            follows_preset: false,
            preset,
            created_at: now,
            updated_at: now,
        });
        self.policies.stored.len() - 1
    }
    fn policy_json(&self, index: usize) -> Value {
        let policy = &self.policies.stored[index];
        let projects: Vec<&str> = if policy.id == self.policies.project_policy {
            vec![self.options.project_id.as_str()]
        } else {
            vec![]
        };
        json!({
            "id": policy.id,
            "name": policy.name,
            "description": policy.description,
            "settings": policy.settings,
            "revision": policy.revision,
            "preset": policy.preset.as_ref().map(|(id, own)| json!({
                "id": id, "version": 1, "latestVersion": 1,
                "mode": match (own, policy.follows_preset) {
                    (true, true) => "live",
                    (true, false) => "pinned",
                    (false, _) => "copy",
                },
            })),
            "projectIds": projects,
            "createdAt": policy.created_at,
            "updatedAt": policy.updated_at,
        })
    }
    fn find_policy(&mut self, id: &str) -> Outcome<usize> {
        self.ensure_policies();
        self.policies
            .stored
            .iter()
            .position(|policy| policy.id == id)
            .ok_or_else(|| fail(ErrorCode::PolicyNotFound, "Policy not found"))
    }

    /// `/projects/:id/policy`: the project's policy, and assigning it.
    pub(super) fn project_policy_route(
        &mut self,
        method: &str,
        body: Map<String, Value>,
    ) -> Outcome<Value> {
        match method {
            "GET" => {
                self.ensure_policies();
                let id = self.policies.project_policy.clone();
                let index = self.find_policy(&id)?;
                Ok(self.policy_json(index))
            }
            "PUT" => {
                let index =
                    self.find_policy(body.get("policyId").and_then(Value::as_str).unwrap_or(""))?;
                self.policies.project_policy = self.policies.stored[index].id.clone();
                Ok(self.policy_json(index))
            }
            _ => Err(unknown_route()),
        }
    }

    /// `/policies[/...]`, with `route` after `policies`.
    pub(super) fn policy_route(
        &mut self,
        method: &str,
        route: &[String],
        q: &HashMap<String, String>,
        body: Map<String, Value>,
    ) -> Outcome<Value> {
        let route: Vec<&str> = route.iter().map(String::as_str).collect();
        match (method, route.as_slice()) {
            ("GET", []) => self.list_policies(q),
            ("POST", []) => self.create_policy(body),
            ("GET", [id]) => {
                let index = self.find_policy(id)?;
                Ok(self.policy_json(index))
            }
            ("PATCH", [id]) => {
                let index = self.find_policy(id)?;
                self.update_policy(index, body)
            }
            ("DELETE", [id]) => {
                let index = self.find_policy(id)?;
                if self.policies.stored[index].id == self.policies.project_policy {
                    return Err(fail(
                        ErrorCode::PolicyInUse,
                        "Projects or upload presets still use this policy",
                    ));
                }
                self.policies.stored.remove(index);
                Ok(json!({}))
            }
            ("POST", [id, operation @ ("reset" | "upgrade")]) => {
                let index = self.find_policy(id)?;
                self.restore_policy(index, operation == &"upgrade", body)
            }
            ("PUT", [id, "automatic-updates"]) => {
                let index = self.find_policy(id)?;
                self.set_policy_automatic_updates(index, body)
            }
            _ => Err(unknown_route()),
        }
    }

    /// A page of the organisation's policies, oldest first unless `sort` says otherwise.
    fn list_policies(&mut self, q: &HashMap<String, String>) -> Outcome<Value> {
        self.ensure_policies();
        let size = bounded(q.get("pageSize"), 50, 1, 100, "pageSize")?;
        let ordering = cursor_ordering(q, ("createdAt", true))?;
        let policies: Vec<Value> = (0..self.policies.stored.len())
            .map(|index| self.policy_json(index))
            .collect();
        let scope = json!(["policies", self.options.project_id]).to_string();
        keyset_page(
            policies.iter().collect(),
            &ordering,
            q.get("cursor"),
            &scope,
            size,
        )
    }

    fn create_policy(&mut self, body: Map<String, Value>) -> Outcome<Value> {
        self.ensure_policies();
        let name = body
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty());
        let preset = body.get("presetId").and_then(Value::as_str);
        let settings = body.get("settings").cloned();
        let index = match (settings, preset) {
            (None, Some(preset)) if preset_name(preset).is_some() => self.new_policy(
                name.unwrap_or(preset_name(preset).unwrap_or_default())
                    .to_owned(),
                description(&body),
                preset_settings(),
                Some((preset.to_owned(), false)),
            ),
            (Some(settings), None) if name.is_some() => {
                check_settings(&settings)?;
                self.new_policy(
                    name.unwrap_or_default().to_owned(),
                    description(&body),
                    settings,
                    None,
                )
            }
            _ => {
                return Err(fail(
                    ErrorCode::InvalidValue,
                    "Send settings with a name, or presetId",
                ))
            }
        };
        Ok(self.policy_json(index))
    }

    /// Saves `change` under the next revision, once `revision` is the current one.
    fn save_policy(
        &mut self,
        index: usize,
        revision: Option<&Value>,
        change: impl FnOnce(&mut StoredPolicy),
    ) -> Outcome<Value> {
        let now = self.now();
        let policy = &mut self.policies.stored[index];
        if revision.and_then(Value::as_u64) != Some(policy.revision) {
            return Err(revision_conflict());
        }
        change(policy);
        policy.revision += 1;
        policy.updated_at = now;
        Ok(self.policy_json(index))
    }

    fn update_policy(&mut self, index: usize, body: Map<String, Value>) -> Outcome<Value> {
        if let Some(settings) = body.get("settings") {
            check_settings(settings)?;
        }
        self.save_policy(index, body.get("revision"), |policy| {
            if let Some(name) = body.get("name").and_then(Value::as_str) {
                policy.name = name.trim().to_owned();
            }
            if let Some(description) = body.get("description").and_then(Value::as_str) {
                policy.description = description.to_owned();
            }
            if let Some(settings) = body.get("settings") {
                policy.settings = settings.clone();
            }
            // Saving a `live` policy pins it.
            policy.follows_preset = false;
        })
    }

    /// Resets a `pinned` or `copy` policy to its preset release, or upgrades it to the latest.
    fn restore_policy(
        &mut self,
        index: usize,
        upgrade: bool,
        body: Map<String, Value>,
    ) -> Outcome<Value> {
        let policy = &self.policies.stored[index];
        if policy.preset.is_none() || policy.follows_preset {
            return Err(fail(
                ErrorCode::PolicyNoPreset,
                "This policy has no preset baseline",
            ));
        }
        if body.get("presetVersion").and_then(Value::as_u64) != Some(1) {
            return Err(preset_version_conflict());
        }
        // The mock's presets have one release, so an upgrade never has a newer one to apply.
        if upgrade {
            return Err(fail(
                ErrorCode::PolicyPresetUpdateUnavailable,
                "Only an unchanged copy of an older preset version can be updated",
            ));
        }
        self.save_policy(index, body.get("revision"), |policy| {
            policy.settings = policy.baseline.clone();
        })
    }

    fn set_policy_automatic_updates(
        &mut self,
        index: usize,
        body: Map<String, Value>,
    ) -> Outcome<Value> {
        let enabled = body.get("enabled") == Some(&Value::Bool(true));
        let policy = &self.policies.stored[index];
        let own = matches!(policy.preset, Some((_, true)));
        if !own || policy.follows_preset == enabled {
            return Err(fail(
                ErrorCode::PolicyAutomaticUpdatesUnavailable,
                "Automatic updates are unavailable for this policy",
            ));
        }
        if body.get("revision").and_then(Value::as_u64) != Some(policy.revision) {
            return Err(revision_conflict());
        }
        if body.get("presetVersion").and_then(Value::as_u64) != Some(1) {
            return Err(preset_version_conflict());
        }
        self.save_policy(index, body.get("revision"), |policy| {
            policy.follows_preset = enabled;
            if enabled {
                let preset = policy
                    .preset
                    .as_ref()
                    .map(|(id, _)| id.as_str())
                    .unwrap_or_default();
                policy.name = preset_name(preset).unwrap_or_default().to_owned();
                policy.description = String::new();
                policy.settings = policy.baseline.clone();
            }
        })
    }
}

fn description(body: &Map<String, Value>) -> String {
    body.get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}
fn revision_conflict() -> super::Failure {
    fail(
        ErrorCode::PolicyRevisionConflict,
        "The policy changed. Retrieve it again and retry with its current revision.",
    )
}
fn preset_version_conflict() -> super::Failure {
    fail(
        ErrorCode::PolicyPresetVersionConflict,
        "The preset changed. Review the latest differences and retry with its version.",
    )
}
