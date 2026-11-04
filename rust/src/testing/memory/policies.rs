//! Policies in the in-memory API. The project starts on the organisation's own General preset
//! policy, following automatic updates. The mock holds no built-in preset settings: a preset's settings are
//! `{"categorySettings": {}}` at version 1, and uploads are never decided by a policy.
use super::{fail, unknown_route, Backend, Outcome};
use crate::error::ErrorCode;
use serde_json::{json, Map, Value};

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
fn empty_settings() -> Value {
    json!({"categorySettings": {}})
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
    automatic_updates: bool,
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
            empty_settings(),
            Some(("general-community".into(), true)),
        );
        let general = &mut self.policies.stored[general];
        general.automatic_updates = true;
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
            automatic_updates: false,
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
            "automaticUpdates": policy.automatic_updates,
            "preset": policy.preset.as_ref().map(|(id, own)| json!({
                "id": id, "version": 1, "latestVersion": 1, "own": own,
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

    /// `/projects/:id/policies[/...]` and `/projects/:id/policy`, with `route` after the project.
    pub(super) fn policy_route(
        &mut self,
        method: &str,
        route: &[String],
        body: Map<String, Value>,
    ) -> Outcome<Value> {
        let route: Vec<&str> = route.iter().map(String::as_str).collect();
        match (method, route.as_slice()) {
            ("PUT", ["policy"]) => {
                let index =
                    self.find_policy(body.get("policyId").and_then(Value::as_str).unwrap_or(""))?;
                self.policies.project_policy = self.policies.stored[index].id.clone();
                Ok(self.policy_json(index))
            }
            ("GET", ["policies"]) => {
                self.ensure_policies();
                let policies: Vec<Value> = (0..self.policies.stored.len())
                    .map(|index| self.policy_json(index))
                    .collect();
                Ok(json!({"policies": policies, "projectPolicyId": self.policies.project_policy}))
            }
            ("POST", ["policies"]) => self.create_policy(body),
            ("GET", ["policies", id]) => {
                let index = self.find_policy(id)?;
                Ok(self.policy_json(index))
            }
            ("PATCH", ["policies", id]) => {
                let index = self.find_policy(id)?;
                self.update_policy(index, body)
            }
            ("DELETE", ["policies", id]) => {
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
            ("POST", ["policies", id, "preset"]) => {
                let index = self.find_policy(id)?;
                self.apply_policy_preset(index, body)
            }
            ("PUT", ["policies", id, "automatic-updates"]) => {
                let index = self.find_policy(id)?;
                self.set_policy_automatic_updates(index, body)
            }
            _ => Err(unknown_route()),
        }
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
                empty_settings(),
                Some((preset.to_owned(), false)),
            ),
            (Some(settings), None) if name.is_some() => self.new_policy(
                name.unwrap_or_default().to_owned(),
                description(&body),
                settings,
                None,
            ),
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
            // Saving a policy that follows its preset pins it as a copy.
            policy.automatic_updates = false;
        })
    }

    fn apply_policy_preset(&mut self, index: usize, body: Map<String, Value>) -> Outcome<Value> {
        let policy = &self.policies.stored[index];
        if policy.preset.is_none() || policy.automatic_updates {
            return Err(fail(
                ErrorCode::PolicyNoPreset,
                "This policy has no preset baseline",
            ));
        }
        if body.get("presetVersion").and_then(Value::as_u64) != Some(1) {
            return Err(preset_version_conflict());
        }
        // The mock's presets have one release, so an update never has a newer one to apply.
        if body.get("operation").and_then(Value::as_str) == Some("update") {
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
        if !own || policy.automatic_updates == enabled {
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
            policy.automatic_updates = enabled;
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
