//! Upload presets, project settings and metadata fields in the in-memory API. An API-key upload
//! naming a preset takes its settings and keeps to its limits; otherwise the mock keeps these
//! definitions only: it doesn't check that a preset's folder and policy exist when saving it, or
//! apply the settings to assets.
use super::Backend;
use super::{bounded, cursor_ordering, fail, keyset_page, text, validation, Outcome};
use crate::error::ErrorCode;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

/// The project's configuration. Settings and metadata fields share one revision.
#[derive(Debug)]
pub(super) struct Configuration {
    /// The upload presets, oldest first.
    presets: Vec<Value>,
    revision: u64,
    /// The settings the last update sent; those it left out hold their defaults.
    settings: Map<String, Value>,
    /// The metadata fields, in display order.
    fields: Vec<Value>,
}
impl Default for Configuration {
    fn default() -> Self {
        Self {
            presets: Vec::new(),
            revision: 1,
            settings: Map::new(),
            fields: Vec::new(),
        }
    }
}

/// A preset's list field as the API stores it: without repeats, and `null` when empty.
fn unique_list(value: Option<&Value>) -> Value {
    let Some(items) = value
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
    else {
        return Value::Null;
    };
    let mut seen = HashSet::new();
    Value::Array(
        items
            .iter()
            .filter(|item| seen.insert(item.to_string()))
            .cloned()
            .collect(),
    )
}

/// A definition's whole set of stored values: fields left out take their defaults. Refuses what
/// the API refuses before saving anything.
fn preset_values(definition: &Value, index: usize) -> Outcome<Map<String, Value>> {
    for key in ["key", "name"] {
        if text(&definition[key]).is_empty() {
            return Err(validation(
                "invalid-type",
                &format!("uploadPresets.{index}.{key}"),
            ));
        }
    }
    let or = |key: &str, default: Value| match &definition[key] {
        Value::Null => default,
        value => value.clone(),
    };
    let values = json!({
        "key": definition["key"],
        "name": definition["name"],
        "access": or("access", "token".into()),
        "enabled": or("enabled", true.into()),
        "allowedContentTypes": unique_list(definition.get("allowedContentTypes")),
        "maxSizeInBytes": definition["maxSizeInBytes"],
        "folderId": definition["folderId"],
        "policyId": definition["policyId"],
        "visibility": or("visibility", "private".into()),
        "processingOptions": definition["processingOptions"],
        "revealDecision": or("revealDecision", false.into()),
        "dailyUploadLimit": definition["dailyUploadLimit"],
        "allowedOrigins": unique_list(definition.get("allowedOrigins")),
    });
    if values["access"] == "anyone" && values["dailyUploadLimit"].as_u64().unwrap_or(0) == 0 {
        return Err(fail(
            ErrorCode::UploadPresetDailyLimitRequired,
            "A preset that anyone can upload to needs a daily upload limit.",
        ));
    }
    let Value::Object(values) = values else {
        unreachable!("the values are an object");
    };
    Ok(values)
}

/// Whether an upload named `name` of type `content_type` matches an allowed type: a type, a
/// wildcard such as `image/*`, or a file extension such as `.pdf`.
fn allows_type(allowed: &Value, name: &str, content_type: &str) -> bool {
    let (name, content_type) = (name.to_lowercase(), content_type.to_lowercase());
    allowed.as_array().into_iter().flatten().any(|pattern| {
        let pattern = text(pattern).trim().to_lowercase();
        if pattern == "*" || pattern == "*/*" {
            true
        } else if let Some(prefix) = pattern.strip_suffix('*').filter(|p| p.ends_with('/')) {
            content_type.starts_with(prefix)
        } else if pattern.starts_with('.') {
            name.ends_with(&pattern)
        } else {
            content_type == pattern
        }
    })
}

impl Backend {
    /// An API-key upload through a preset, as the API applies it: the preset gives the folder and
    /// visibility, which the upload can't change, and the processing options unless the upload
    /// sets its own, and refuses types and sizes it doesn't accept. `content_type` and `size` are
    /// `None` for an upload without content of its own.
    pub(super) fn apply_upload_preset(
        &self,
        options: &mut Map<String, Value>,
        content_type: Option<&str>,
        size: Option<u64>,
    ) -> Outcome<()> {
        let Some(id) = options.get("uploadPresetId").and_then(Value::as_str) else {
            return Ok(());
        };
        let preset = self
            .configuration
            .presets
            .iter()
            .find(|preset| preset["id"] == id)
            .ok_or_else(|| fail(ErrorCode::UploadPresetNotFound, "Upload preset not found"))?;
        if preset["enabled"] != true {
            return Err(fail(
                ErrorCode::UploadPresetDisabled,
                "This upload preset is disabled",
            ));
        }
        let differs = |field: &str| {
            options
                .get(field)
                .is_some_and(|sent| !sent.is_null() && *sent != preset[field])
        };
        let not_allowed = ["folderId", "visibility"]
            .into_iter()
            .filter(|field| !preset[*field].is_null())
            .find(|field| differs(field));
        if let Some(field) = not_allowed {
            let mut failure = fail(
                ErrorCode::UploadPresetFieldNotAllowed,
                "This upload preset sets this field",
            );
            failure.details = json!({ "field": field });
            return Err(failure);
        }
        let allowed = &preset["allowedContentTypes"];
        if let Some(content_type) = content_type {
            let name = options.get("name").map_or("", text);
            if !allowed.is_null() && !allows_type(allowed, name, content_type) {
                let mut failure = fail(
                    ErrorCode::UnsupportedUploadType,
                    "This upload preset doesn't accept this type of file",
                );
                failure.details = json!({
                    "source": "preset", "contentType": content_type,
                    "allowedContentTypes": allowed,
                });
                return Err(failure);
            }
        }
        if let Some(limit) = preset["maxSizeInBytes"].as_u64() {
            if size.is_some_and(|size| size > limit) {
                let mut failure = fail(
                    ErrorCode::UploadTooLarge,
                    "The upload is larger than this upload preset accepts",
                );
                failure.details = json!({ "limitBytes": limit, "source": "preset" });
                return Err(failure);
            }
        }
        if !preset["folderId"].is_null() {
            options.insert("folderId".into(), preset["folderId"].clone());
        }
        options.insert("visibility".into(), preset["visibility"].clone());
        let own_options = options
            .get("processingOptions")
            .is_some_and(|processing| !processing.is_null());
        if !own_options && !preset["processingOptions"].is_null() {
            options.insert(
                "processingOptions".into(),
                preset["processingOptions"].clone(),
            );
        }
        Ok(())
    }

    /// A page of the project's upload presets, oldest first unless `sort` says otherwise.
    pub(super) fn list_upload_presets(&self, q: &HashMap<String, String>) -> Outcome<Value> {
        let size = bounded(q.get("pageSize"), 50, 1, 100, "pageSize")?;
        let ordering = cursor_ordering(q, ("createdAt", true))?;
        let scope = json!(["upload-presets", self.options.project_id]).to_string();
        keyset_page(
            self.configuration.presets.iter().collect(),
            &ordering,
            q.get("cursor"),
            &scope,
            size,
        )
    }

    /// Like the API: every preset's revision and settings are checked before any is saved.
    pub(super) fn ensure_upload_presets(
        &mut self,
        body: &Map<String, Value>,
        now: u64,
    ) -> Outcome<Value> {
        let definitions = body
            .get("uploadPresets")
            .and_then(Value::as_array)
            .filter(|definitions| !definitions.is_empty())
            .ok_or_else(|| validation("too-small", "uploadPresets"))?;
        let mut plans = Vec::with_capacity(definitions.len());
        for (index, definition) in definitions.iter().enumerate() {
            let values = preset_values(definition, index)?;
            let existing = self
                .configuration
                .presets
                .iter()
                .find(|preset| preset["key"] == values["key"])
                .cloned();
            let revision = existing
                .as_ref()
                .map_or(0, |preset| preset["revision"].as_u64().unwrap_or_default());
            if let Some(sent) = definition.get("revision") {
                if sent.as_u64() != Some(revision) {
                    let mut failure = fail(
                        ErrorCode::UploadPresetRevisionConflict,
                        "The upload preset changed, or was created or deleted, since you read it. Retrieve it again and retry with its current revision.",
                    );
                    failure.details = json!({ "key": values["key"], "revision": revision });
                    return Err(failure);
                }
            }
            plans.push((existing, values, revision));
        }
        let mut saved = Vec::with_capacity(plans.len());
        for (existing, values, revision) in plans {
            if let Some(existing) = &existing {
                if values.iter().all(|(key, value)| existing[key] == *value) {
                    saved.push(existing.clone());
                    continue;
                }
            }
            let mut preset = values;
            let id = existing
                .as_ref()
                .map_or_else(|| self.create_id("preset").into(), |old| old["id"].clone());
            let created_at = existing
                .as_ref()
                .map_or_else(|| now.into(), |old| old["createdAt"].clone());
            preset.insert("id".into(), id);
            preset.insert("projectId".into(), self.options.project_id.clone().into());
            preset.insert("createdByUserId".into(), Value::Null);
            preset.insert("revision".into(), (revision + 1).into());
            preset.insert("createdAt".into(), created_at);
            preset.insert("updatedAt".into(), now.into());
            let preset = Value::Object(preset);
            let presets = &mut self.configuration.presets;
            match presets.iter_mut().find(|old| old["key"] == preset["key"]) {
                Some(old) => *old = preset.clone(),
                None => presets.push(preset.clone()),
            }
            saved.push(preset);
        }
        Ok(json!({ "uploadPresets": saved }))
    }

    pub(super) fn delete_upload_preset(&mut self, id: &str) -> Outcome<Value> {
        let presets = &mut self.configuration.presets;
        let Some(index) = presets.iter().position(|preset| preset["id"] == id) else {
            return Err(fail(
                ErrorCode::UploadPresetNotFound,
                "Upload preset not found",
            ));
        };
        presets.remove(index);
        Ok(json!({}))
    }

    /// The settings with every default filled in.
    fn full_settings(&self) -> Value {
        let mut settings = json!({
            "optOutJurisdictions": [],
            "blockUnmoderatedAssets": true,
            "storeSensitiveMetadata": false,
            "streamingEnabled": false,
            "aiMediaSearchEnabled": false,
            "remoteUrlRule": null,
            "websiteSubmissionsPerMinute": null,
            "humanReview": {
                "allowedSamplePercent": 0,
                "restrictedSamplePercent": 0,
                "uncertaintyMarginPercent": 0,
                "reviewMissingEvidence": false,
            },
        });
        for (key, value) in &self.configuration.settings {
            if key == "humanReview" {
                for (key, value) in value.as_object().into_iter().flatten() {
                    settings["humanReview"][key] = value.clone();
                }
            } else {
                settings[key] = value.clone();
            }
        }
        settings
    }

    pub(super) fn project_settings_json(&self) -> Value {
        json!({
            "projectId": self.options.project_id,
            "revision": self.configuration.revision,
            "settings": self.full_settings(),
        })
    }

    fn check_settings_revision(&self, sent: Option<u64>) -> Outcome<()> {
        if sent.is_some_and(|sent| sent != self.configuration.revision) {
            return Err(fail(
                ErrorCode::ProjectSettingsRevisionConflict,
                "The project's settings or metadata fields changed since you read them. Retrieve them again and retry with the current revision.",
            ));
        }
        Ok(())
    }

    /// Replaces the settings: those left out return to their defaults. A real change moves the
    /// revision.
    pub(super) fn update_project_settings(&mut self, body: &Map<String, Value>) -> Outcome<Value> {
        self.check_settings_revision(body.get("revision").and_then(Value::as_u64))?;
        let settings = body
            .get("settings")
            .and_then(Value::as_object)
            .ok_or_else(|| validation("invalid-type", "settings"))?;
        let before = self.full_settings();
        let previous = std::mem::replace(&mut self.configuration.settings, settings.clone());
        if self.full_settings() == before {
            self.configuration.settings = previous;
        } else {
            self.configuration.revision += 1;
        }
        Ok(self.project_settings_json())
    }

    pub(super) fn metadata_fields_json(&self) -> Value {
        json!({
            "projectId": self.options.project_id,
            "revision": self.configuration.revision,
            "fields": self.configuration.fields,
        })
    }

    /// Creates or replaces fields by ID, keeping the others in order.
    pub(super) fn ensure_metadata_fields(&mut self, body: &Map<String, Value>) -> Outcome<Value> {
        self.check_settings_revision(body.get("revision").and_then(Value::as_u64))?;
        let fields = body
            .get("fields")
            .and_then(Value::as_array)
            .filter(|fields| !fields.is_empty())
            .ok_or_else(|| validation("too-small", "fields"))?;
        let current = &self.configuration.fields;
        let replaced = current.iter().map(|field| {
            fields
                .iter()
                .find(|sent| sent["id"] == field["id"])
                .unwrap_or(field)
        });
        let added = fields
            .iter()
            .filter(|sent| !current.iter().any(|field| field["id"] == sent["id"]));
        let merged: Vec<Value> = replaced.chain(added).cloned().collect();
        if merged != self.configuration.fields {
            self.configuration.fields = merged;
            self.configuration.revision += 1;
        }
        Ok(self.metadata_fields_json())
    }

    pub(super) fn delete_metadata_field(
        &mut self,
        id: &str,
        q: &HashMap<String, String>,
    ) -> Outcome<Value> {
        let Some(index) = self
            .configuration
            .fields
            .iter()
            .position(|field| field["id"] == id)
        else {
            let mut failure = fail(
                ErrorCode::MetadataFieldNotFound,
                "The project has no metadata field with this ID.",
            );
            failure.details = json!({ "fieldId": id });
            return Err(failure);
        };
        let sent = q
            .get("revision")
            .map(|revision| {
                revision
                    .parse()
                    .map_err(|_| validation("invalid-type", "revision"))
            })
            .transpose()?;
        self.check_settings_revision(sent)?;
        self.configuration.fields.remove(index);
        self.configuration.revision += 1;
        Ok(self.metadata_fields_json())
    }
}
