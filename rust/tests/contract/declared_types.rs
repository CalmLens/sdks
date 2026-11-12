//! Replays `testdata/types.json` (packages/sdk-contract/README.md, "Declared types"): walks each
//! operation's declared options and result types, as `calmlens::models::describe` exposes them
//! under `strict-contract`, alongside the API's JSON Schema and fails with every mismatch.
//!
//! Rust conventions the walk applies:
//! - Options: outside a PATCH an option may be non-nullable where the API allows `null`, which
//!   means the same as leaving it out; a PATCH's options must match nullability exactly. A field is
//!   optional when it is `Option<T>` or `Patch<T>`, or is left out of the
//!   request by `skip_serializing_if`; it can send `null` when it is `Patch<T>`, or an `Option<T>`
//!   always serialized. Options types without a serde `Serialize` derive build their request by
//!   hand and never send `null` for an `Option<T>`.
//! - Results: `Option<T>` is both "may be missing" and "may be null", so a property is declared
//!   `Option<T>` exactly when it is not required or allows `null`.
//! - A struct may declare a `oneOf`/`anyOf` of objects as one type with the union of their fields
//!   (a property is required when every branch requires it), and a `string_enum!` may declare a
//!   union of string constants and enums as the union of their values.
//! - `string_enum!` types accept unknown values as `Unknown(String)`; their listed variants must
//!   equal the schema's values.
use super::common::fixture;
use calmlens::models::describe::{Described, Field, Shape};
use calmlens::ServerClient;
use serde_json::{Map, Value};
use std::{collections::BTreeSet, future::Future};

/// Rust fields with no schema property, as `(type, field, reason)`.
const SDK_FIELDS: &[(&str, &str, &str)] = &[
    (
        "SubmitAsset",
        "content",
        "Upload payload: the README leaves upload payload fields out of options.",
    ),
    (
        "SubmitAsset",
        "part",
        "Upload payload: the first part of a multipart upload.",
    ),
    (
        "SubmitAsset",
        "url",
        "Upload payload: a remote URL the API fetches the content from.",
    ),
    (
        "SubmitAsset",
        "total_size_in_bytes",
        "Upload payload: the total size of a multipart upload.",
    ),
    (
        "UploadPart",
        "part",
        "Upload payload: the part's bytes, sent as the request body.",
    ),
];

/// Fields the API hides behind a disabled feature switch (`packages/shared/src/SharedConstants.ts`),
/// so they are not in `types.json` yet, as `(type, field, switch)`.
const SWITCHED_FIELDS: &[(&str, &str, &str)] = &[
    ("AssetClassification", "link_safety", "ENABLE_LINK_SAFETY"),
    ("AssetModeration", "link_safety", "ENABLE_LINK_SAFETY"),
    ("PolicySettings", "link_safety", "ENABLE_LINK_SAFETY"),
    (
        "AssetClassification",
        "ai_generated_detection",
        "ENABLE_AI_GENERATED_DETECTION",
    ),
    (
        "ProcessingFeatures",
        "ai_generated_detection",
        "ENABLE_AI_GENERATED_DETECTION",
    ),
];

/// Enum values the API hides behind a disabled feature switch, as `(enum, value, switch)`.
const SWITCHED_VALUES: &[(&str, &str, &str)] = &[
    ("EventType", "appeal.submitted", "ENABLE_APPEALS"),
    ("EventType", "appeal.resolved", "ENABLE_APPEALS"),
    ("EventType", "asset.link-flagged", "ENABLE_LINK_SAFETY"),
    ("ModerationSource", "link-safety", "ENABLE_LINK_SAFETY"),
];

/// SDK types the walk does not compare with the schema, as `(type, reason)`.
const NATIVE_TYPES: &[(&str, &str)] = &[(
    "EventAsset",
    "An event's asset snapshot is kept as the JSON it was delivered with, read through typed \
         accessors, because `webhooks.json` requires a delivery to round-trip exactly, including \
         the fields a snapshot leaves out and values this SDK version does not know.",
)];

/// Operations whose Rust method returns a model although `types.json` has no result for it, as
/// `(operation, reason)`.
const SDK_RESULTS: &[(&str, &str)] = &[(
    "ensureLenses",
    "Returns the ensured lenses in request order, which the SDK reads from the response and its \
     cache of lenses it has already ensured.",
)];

struct Declared {
    options: Option<Shape>,
    result: Shape,
}

fn op<O: Described, R: Described, F: Future<Output = calmlens::Result<R>>>(
    _call: impl FnOnce(O) -> F,
) -> Declared {
    Declared {
        options: Some(O::shape()),
        result: R::shape(),
    }
}

fn op0<R: Described, F: Future<Output = calmlens::Result<R>>>(
    _call: impl FnOnce() -> F,
) -> Declared {
    Declared {
        options: None,
        result: R::shape(),
    }
}

/// The declared options and result of the Rust method named `name` (`names.rust`).
#[rustfmt::skip]
fn declared(client: &ServerClient, name: &str) -> Option<Declared> {
    let c = client;
    Some(match name {
        "folders().list" => op(|o| async move { c.folders().list(o).await }),
        "folders().retrieve" => op(|o| async move { c.folders().retrieve(o).await }),
        "folders().create" => op(|o| async move { c.folders().create(o).await }),
        "folders().update" => op(|o| async move { c.folders().update(o).await }),
        "folders().delete" => op(|o| async move { c.folders().delete(o).await }),
        "folders().move_folder" => op(|o| async move { c.folders().move_folder(o).await }),
        "assets().create" => op(|o| async move { c.assets().create(o).await }),
        "assets().upload_part" => op(|o| async move { c.assets().upload_part(o).await }),
        "assets().list" => op(|o| async move { c.assets().list(o).await }),
        "assets().search" => op(|o| async move { c.assets().search(o).await }),
        "assets().retrieve" => op(|o| async move { c.assets().retrieve(o).await }),
        "assets().list_children" => op(|o| async move { c.assets().list_children(o).await }),
        "assets().list_timeline" => op(|o| async move { c.assets().list_timeline(o).await }),
        "assets().update" => op(|o| async move { c.assets().update(o).await }),
        "assets().remove_content" => op(|o| async move { c.assets().remove_content(o).await }),
        "assets().delete" => op(|o| async move { c.assets().delete(o).await }),
        "assets().move_asset" => op(|o| async move { c.assets().move_asset(o).await }),
        "assets().retry" => op(|o| async move { c.assets().retry(o).await }),
        "assets().explain" => op(|o| async move { c.assets().explain(o).await }),
        "assets().decide" => op(|o| async move { c.assets().decide(o).await }),
        "assets().batch" => op(|o| async move { c.assets().batch(o).await }),
        "cdn().sign_asset_url" => op(|o| async move { c.cdn().sign_asset_url(o).await }),
        "ensure_lenses" => op(|o| async move { c.ensure_lenses(o).await }),
        "lenses().list" => op(|o| async move { c.lenses().list(o).await }),
        "lenses().create" => op(|o| async move { c.lenses().create(o).await }),
        "lenses().retrieve" => op(|o| async move { c.lenses().retrieve(o).await }),
        "lenses().update" => op(|o| async move { c.lenses().update(o).await }),
        "lenses().delete" => op(|o| async move { c.lenses().delete(o).await }),
        "events().list" => op(|o| async move { c.events().list(o).await }),
        "hash_lists().list" => op(|o| async move { c.hash_lists().list(o).await }),
        "hash_lists().retrieve" => op(|o| async move { c.hash_lists().retrieve(o).await }),
        "hash_lists().create" => op(|o| async move { c.hash_lists().create(o).await }),
        "hash_lists().update" => op(|o| async move { c.hash_lists().update(o).await }),
        "hash_lists().delete" => op(|o| async move { c.hash_lists().delete(o).await }),
        "hash_lists().list_entries" => op(|o| async move { c.hash_lists().list_entries(o).await }),
        "hash_lists().add_entry" => op(|o| async move { c.hash_lists().add_entry(o).await }),
        "hash_lists().remove_entry" => op(|o| async move { c.hash_lists().remove_entry(o).await }),
        "policies().list" => op(|o| async move { c.policies().list(o).await }),
        "policies().retrieve" => op(|o| async move { c.policies().retrieve(o).await }),
        "policies().create" => op(|o| async move { c.policies().create(o).await }),
        "policies().update" => op(|o| async move { c.policies().update(o).await }),
        "policies().reset" => op(|o| async move { c.policies().reset(o).await }),
        "policies().upgrade" => op(|o| async move { c.policies().upgrade(o).await }),
        "policies().set_automatic_updates" => op(|o| async move { c.policies().set_automatic_updates(o).await }),
        "policies().delete" => op(|o| async move { c.policies().delete(o).await }),
        "policies().retrieve_assigned" => op0(|| async move { c.policies().retrieve_assigned().await }),
        "policies().assign" => op(|o| async move { c.policies().assign(o).await }),
        "upload_presets().list" => op(|o| async move { c.upload_presets().list(o).await }),
        "upload_presets().ensure" => op(|o| async move { c.upload_presets().ensure(o).await }),
        "upload_presets().delete" => op(|o| async move { c.upload_presets().delete(o).await }),
        "project_settings().get" => op0(|| async move { c.project_settings().get().await }),
        "project_settings().update" => op(|o| async move { c.project_settings().update(o).await }),
        "metadata_fields().list" => op0(|| async move { c.metadata_fields().list().await }),
        "metadata_fields().ensure" => op(|o| async move { c.metadata_fields().ensure(o).await }),
        "metadata_fields().delete" => op(|o| async move { c.metadata_fields().delete(o).await }),
        _ => return None,
    })
}

/// A serde attribute's items, such as `default` or `rename = "type"`.
fn serde_items(attrs: &[&str]) -> Vec<(String, Option<String>)> {
    let mut items = Vec::new();
    for attr in attrs {
        let Some(inner) = attr
            .strip_prefix("serde")
            .map(str::trim)
            .and_then(|rest| rest.strip_prefix('('))
            .and_then(|rest| rest.strip_suffix(')'))
        else {
            continue;
        };
        let (mut item, mut quoted) = (String::new(), false);
        for ch in inner.chars().chain([',']) {
            match ch {
                '"' => {
                    quoted = !quoted;
                    item.push(ch);
                }
                ',' if !quoted => {
                    let text = std::mem::take(&mut item);
                    let text = text.trim();
                    if text.is_empty() {
                        continue;
                    }
                    items.push(match text.split_once('=') {
                        Some((key, value)) => (
                            key.trim().to_owned(),
                            Some(value.trim().trim_matches('"').to_owned()),
                        ),
                        None => (text.to_owned(), None),
                    });
                }
                _ => item.push(ch),
            }
        }
    }
    items
}

fn serde_has(attrs: &[&str], key: &str) -> bool {
    serde_items(attrs).iter().any(|(name, _)| name == key)
}

fn serde_value(attrs: &[&str], key: &str) -> Option<String> {
    serde_items(attrs)
        .into_iter()
        .find(|(name, _)| name == key)
        .and_then(|(_, value)| value)
}

/// `name` (snake_case field or PascalCase variant) under a serde `rename_all` rule.
fn renamed(name: &str, rule: Option<&str>) -> String {
    let words: Vec<String> = if name.contains('_') || name.chars().all(|c| !c.is_uppercase()) {
        name.split('_').map(str::to_lowercase).collect()
    } else {
        let mut words = Vec::new();
        for ch in name.chars() {
            if ch.is_uppercase() || words.is_empty() {
                words.push(String::new());
            }
            words.last_mut().unwrap().push(ch.to_ascii_lowercase());
        }
        words
    };
    match rule {
        Some("camelCase") => words
            .iter()
            .enumerate()
            .map(|(index, word)| {
                if index == 0 {
                    word.clone()
                } else {
                    let mut chars = word.chars();
                    chars
                        .next()
                        .map(|first| first.to_uppercase().chain(chars).collect())
                        .unwrap_or_default()
                }
            })
            .collect(),
        Some("kebab-case") => words.join("-"),
        Some("snake_case") => words.join("_"),
        Some("lowercase") => words.concat(),
        _ => name.to_owned(),
    }
}

/// A declared field as it appears on the wire.
struct WireField {
    rust: String,
    wire: String,
    skippable: bool,
    /// Whether decoding fills the field in when the response leaves it out.
    defaulted: bool,
    shape: Shape,
}

/// The wire fields of a struct: renamed, without skipped and flattened catch-all fields.
fn wire_fields(attrs: &[&str], fields: Vec<Field>) -> Vec<WireField> {
    let rule = serde_value(attrs, "rename_all");
    let mut wire = Vec::new();
    for field in fields {
        if serde_has(field.attrs, "skip") {
            continue;
        }
        let shape = (field.shape)();
        if serde_has(field.attrs, "flatten") {
            if let Shape::Struct { attrs, fields, .. } = shape {
                wire.extend(wire_fields(attrs, fields()));
            }
            continue;
        }
        wire.push(WireField {
            wire: serde_value(field.attrs, "rename")
                .unwrap_or_else(|| renamed(field.name, rule.as_deref())),
            rust: field.name.to_owned(),
            skippable: serde_has(field.attrs, "skip_serializing_if"),
            defaulted: serde_has(field.attrs, "default"),
            shape,
        });
    }
    wire
}

fn derives_serialize(attrs: &[&str]) -> bool {
    attrs.iter().any(|attr| {
        attr.starts_with("derive")
            && attr
                .split(|c: char| !c.is_alphanumeric())
                .any(|word| word == "Serialize")
    })
}

/// The values of a unit-only serde enum, else `None`.
fn unit_values(attrs: &[&str], variants: &[Field]) -> Option<Vec<String>> {
    let rule = serde_value(attrs, "rename_all");
    variants
        .iter()
        .map(|variant| {
            matches!((variant.shape)(), Shape::Unit).then(|| {
                serde_value(variant.attrs, "rename")
                    .unwrap_or_else(|| renamed(variant.name, rule.as_deref()))
            })
        })
        .collect()
}

fn describe(shape: &Shape) -> String {
    match shape {
        Shape::Unit => "()".into(),
        Shape::String => "String".into(),
        Shape::Bool => "bool".into(),
        Shape::Integer => "an integer".into(),
        Shape::Number => "f64".into(),
        Shape::Json => "Value".into(),
        Shape::Native(name) | Shape::Enum { name, .. } => (*name).into(),
        Shape::Struct { name, .. } | Shape::Union { name, .. } => (*name).into(),
        Shape::Option(inner) => format!("Option<{}>", describe(inner)),
        Shape::Patch(inner) => format!("Patch<{}>", describe(inner)),
        Shape::List(inner) => format!("Vec<{}>", describe(inner)),
        Shape::Map(key, value) => format!("HashMap<{}, {}>", describe(key), describe(value)),
    }
}

struct Walk<'a> {
    definitions: &'a Map<String, Value>,
    operation: &'a str,
    part: &'static str,
    /// Whether the operation is a PATCH, where an option's nullability must match exactly.
    patch: bool,
    problems: Vec<String>,
    refs: Vec<String>,
    /// The operation's `clientOptions`: the SDK's own options, which the schema leaves out.
    client_options: Vec<String>,
}

impl Walk<'_> {
    fn problem(&mut self, path: &str, problem: impl std::fmt::Display) {
        self.problems.push(format!(
            "{} {} $.{path}: {problem}",
            self.operation, self.part
        ));
    }

    /// Whether `shape` matches `schema` with no problem, without reporting.
    fn matches(&mut self, path: &str, schema: &Value, shape: &Shape) -> bool {
        let problems = std::mem::take(&mut self.problems);
        self.compare(path, schema, shape);
        let matched = self.problems.is_empty();
        self.problems = problems;
        matched
    }

    /// The schema behind `$ref`, or `None` for a reference already being walked.
    fn enter(&mut self, schema: &Value) -> Option<(Value, Option<String>)> {
        let Some(reference) = schema.get("$ref").and_then(Value::as_str) else {
            return Some((schema.clone(), None));
        };
        let name = reference
            .strip_prefix("#/definitions/")
            .unwrap_or_else(|| panic!("unexpected $ref {reference}"));
        if self.refs.iter().any(|entered| entered == name) {
            return None;
        }
        let target = self
            .definitions
            .get(name)
            .unwrap_or_else(|| panic!("unknown definition {name}"));
        self.refs.push(name.to_owned());
        match self.enter(target) {
            Some((resolved, _)) => Some((resolved, Some(name.to_owned()))),
            None => {
                self.refs.pop();
                None
            }
        }
    }

    /// `schema`'s non-null branches and whether it allows `null`.
    fn branches(&mut self, schema: &Value) -> Option<(Vec<Value>, bool)> {
        let (schema, entered) = self.enter(schema)?;
        let mut nullable = false;
        let mut branches = Vec::new();
        let union = schema
            .get("anyOf")
            .or_else(|| schema.get("oneOf"))
            .and_then(Value::as_array);
        if let Some(union) = union {
            for branch in union {
                match self.branches(branch) {
                    Some((inner, null)) => {
                        nullable |= null;
                        branches.extend(inner);
                    }
                    // A recursive branch: keep the reference so a walk can stop on it.
                    None => branches.push(branch.clone()),
                }
            }
        } else if let Some(types) = schema.get("type").and_then(Value::as_array) {
            for kind in types {
                if kind == "null" {
                    nullable = true;
                } else {
                    let mut branch = schema.clone();
                    branch["type"] = kind.clone();
                    branches.push(branch);
                }
            }
        } else if schema.get("type").and_then(Value::as_str) == Some("null") {
            nullable = true;
        } else {
            nullable |= schema.as_object().is_some_and(|object| {
                !object.contains_key("type")
                    && !object.contains_key("enum")
                    && !object.contains_key("const")
                    && !object.contains_key("allOf")
            });
            branches.push(schema.clone());
        }
        if entered.is_some() {
            self.refs.pop();
        }
        Some((branches, nullable))
    }

    /// Compares a schema with the declared shape, ignoring whether it allows `null`.
    fn compare(&mut self, path: &str, schema: &Value, shape: &Shape) {
        let shape = match shape {
            Shape::Option(inner) | Shape::Patch(inner) => inner,
            other => other,
        };
        let Some((schema, entered)) = self.enter(schema) else {
            return;
        };
        let Some((branches, _)) = self.branches(&schema) else {
            if entered.is_some() {
                self.refs.pop();
            }
            return;
        };
        match branches.as_slice() {
            [] => self.problem(path, "the schema allows only null"),
            [branch] => self.compare_one(path, branch, shape),
            _ => self.compare_union(path, &branches, shape),
        }
        if entered.is_some() {
            self.refs.pop();
        }
    }

    fn compare_union(&mut self, path: &str, branches: &[Value], shape: &Shape) {
        if branches
            .iter()
            .all(|branch| self.matches(path, branch, shape))
        {
            return;
        }
        let kinds: BTreeSet<&str> = branches
            .iter()
            .filter_map(|branch| branch.get("type").and_then(Value::as_str))
            .collect();
        if self.part == "options"
            && matches!(shape, Shape::Bool)
            && branches.len() == 2
            && kinds == BTreeSet::from(["boolean", "string"])
        {
            // Multipart form fields: the API also reads "true" and "false" strings there, and
            // the SDK always sends JSON booleans.
            return;
        }
        match shape {
            Shape::Json => {}
            Shape::List(item) if branches.iter().all(|branch| branch["type"] == "array") => {
                let items: Vec<Value> = branches
                    .iter()
                    .map(|branch| branch["items"].clone())
                    .collect();
                self.compare(
                    &format!("{path}[]"),
                    &serde_json::json!({ "anyOf": items }),
                    item,
                );
            }
            Shape::Union {
                attrs, variants, ..
            } if unit_values(attrs, &variants()).is_none() => {
                let variants = variants();
                for (index, branch) in branches.iter().enumerate() {
                    if !variants
                        .iter()
                        .any(|variant| self.matches(path, branch, &(variant.shape)()))
                    {
                        self.problem(
                            path,
                            format!(
                                "no variant of {} declares union branch {index}",
                                describe(shape)
                            ),
                        );
                    }
                }
                for variant in &variants {
                    let variant_shape = (variant.shape)();
                    if !branches
                        .iter()
                        .any(|branch| self.matches(path, branch, &variant_shape))
                    {
                        self.problem(
                            path,
                            format!("variant {} matches no union branch", variant.name),
                        );
                    }
                }
            }
            Shape::Struct { .. } => match self.merge_objects(branches) {
                Some(merged) => self.compare_one(path, &merged, shape),
                None => self.problem(
                    path,
                    format!(
                        "declared {} for a union of non-object branches",
                        describe(shape)
                    ),
                ),
            },
            Shape::Enum { .. } | Shape::Union { .. } => match merge_values(branches) {
                Some(values) => {
                    let merged = serde_json::json!({ "type": "string", "enum": values });
                    self.compare_one(path, &merged, shape);
                }
                None => self.problem(
                    path,
                    format!(
                        "declared {} for a union of non-string branches",
                        describe(shape)
                    ),
                ),
            },
            _ => self.problem(
                path,
                format!(
                    "declared {} for a union of {} branches",
                    describe(shape),
                    branches.len()
                ),
            ),
        }
    }

    /// One object with every branch's properties, required where every branch requires them.
    fn merge_objects(&mut self, branches: &[Value]) -> Option<Value> {
        let mut resolved = Vec::new();
        for branch in branches {
            let (branch, entered) = self.enter(branch)?;
            if entered.is_some() {
                self.refs.pop();
            }
            if branch.get("type").and_then(Value::as_str) != Some("object") {
                return None;
            }
            resolved.push(branch);
        }
        let mut variants: Vec<(String, Vec<Value>)> = Vec::new();
        for branch in &resolved {
            for (name, property) in branch["properties"].as_object().into_iter().flatten() {
                match variants.iter_mut().find(|(known, _)| known == name) {
                    Some((_, schemas)) if !schemas.contains(property) => {
                        schemas.push(property.clone())
                    }
                    Some(_) => {}
                    None => variants.push((name.clone(), vec![property.clone()])),
                }
            }
        }
        let order: Vec<String> = variants.iter().map(|(name, _)| name.clone()).collect();
        let mut properties = Map::new();
        for (name, mut schemas) in variants {
            let merged = if schemas.len() == 1 {
                schemas.pop().unwrap()
            } else if let Some(values) = merge_values(&schemas) {
                serde_json::json!({ "type": "string", "enum": values })
            } else {
                serde_json::json!({ "anyOf": schemas })
            };
            properties.insert(name, merged);
        }
        let required: Vec<&String> = order
            .iter()
            .filter(|name| {
                resolved.iter().all(|branch| {
                    branch["required"]
                        .as_array()
                        .is_some_and(|required| required.iter().any(|item| item == *name))
                })
            })
            .collect();
        Some(serde_json::json!({
            "type": "object",
            "properties": properties,
            "required": required,
        }))
    }

    fn compare_one(&mut self, path: &str, schema: &Value, shape: &Shape) {
        if let Some(parts) = schema.get("allOf") {
            self.problem(
                path,
                format!("allOf is not supported by this runner: {parts}"),
            );
            return;
        }
        if schema.get("$ref").is_some() {
            return self.compare(path, schema, shape);
        }
        let values: Option<Vec<String>> = match (schema.get("enum"), schema.get("const")) {
            (Some(values), _) => Some(
                values
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|value| {
                        value
                            .as_str()
                            .map(str::to_owned)
                            .unwrap_or(value.to_string())
                    })
                    .collect(),
            ),
            (None, Some(value)) => Some(vec![value
                .as_str()
                .map(str::to_owned)
                .unwrap_or(value.to_string())]),
            _ => None,
        };
        let kind = schema.get("type").and_then(Value::as_str);
        match (kind, shape) {
            (_, Shape::Json) => {}
            (_, Shape::Native(name)) if NATIVE_TYPES.iter().any(|(listed, _)| listed == name) => {}
            // A record of open values accepts any declared object.
            (Some("object"), Shape::Struct { .. } | Shape::Native(_))
                if schema.get("additionalProperties") == Some(&serde_json::json!({}))
                    && schema
                        .get("properties")
                        .and_then(Value::as_object)
                        .is_none_or(Map::is_empty) => {}
            (None, _) if values.is_none() => self.problem(
                path,
                format!("an open value is declared as {}", describe(shape)),
            ),
            (
                _,
                Shape::Enum {
                    name,
                    values: declared,
                },
            ) => {
                let declared = declared
                    .iter()
                    .filter(|value| {
                        !SWITCHED_VALUES
                            .iter()
                            .any(|(owner, switched, _)| owner == name && switched == *value)
                    })
                    .map(|value| (*value).to_owned())
                    .collect();
                self.compare_values(path, values.as_deref(), declared)
            }
            (
                _,
                Shape::Union {
                    attrs, variants, ..
                },
            ) if unit_values(attrs, &variants()).is_some() => {
                let declared = unit_values(attrs, &variants()).unwrap();
                self.compare_values(path, values.as_deref(), declared)
            }
            (Some("string"), Shape::String) => {
                if let Some(values) = values {
                    self.problem(
                        path,
                        format!("declared String for the values {}", values.join(", ")),
                    );
                }
            }
            (Some("boolean"), Shape::Bool) | (Some("number"), Shape::Number) => {}
            (Some("integer"), Shape::Integer | Shape::Number) => {}
            (Some("array"), Shape::List(item)) => match schema.get("items") {
                Some(items) => self.compare(&format!("{path}[]"), items, item),
                None => self.problem(path, "the array schema has no items"),
            },
            (Some("object"), Shape::Map(key, value)) => {
                if let Some(properties) = schema
                    .get("properties")
                    .and_then(Value::as_object)
                    .filter(|properties| !properties.is_empty())
                {
                    // An object with one property per value of an enum, declared as a map keyed
                    // by that enum.
                    let names: Vec<Value> = properties
                        .keys()
                        .map(|name| Value::from(name.as_str()))
                        .collect();
                    self.compare(
                        &format!("{path}<key>"),
                        &serde_json::json!({ "type": "string", "enum": names }),
                        key,
                    );
                    if !matches!(**key, Shape::Enum { .. }) {
                        self.problem(
                            path,
                            format!("declared {} for an object with properties", describe(shape)),
                        );
                    }
                    for (name, property) in properties {
                        self.compare(&format!("{path}.{name}"), property, value);
                    }
                    return;
                }
                let names = schema
                    .get("propertyNames")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "type": "string" }));
                self.compare(&format!("{path}<key>"), &names, key);
                match schema.get("additionalProperties") {
                    Some(Value::Bool(false)) | None => self.problem(
                        path,
                        format!(
                            "declared {} for an object without additionalProperties",
                            describe(shape)
                        ),
                    ),
                    Some(Value::Bool(true)) => {
                        self.compare(&format!("{path}{{}}"), &serde_json::json!({}), value)
                    }
                    Some(values) => self.compare(&format!("{path}{{}}"), values, value),
                }
            }
            (
                Some("object"),
                Shape::Struct {
                    name,
                    attrs,
                    fields,
                },
            ) => self.compare_fields(path, schema, name, attrs, fields(), false),
            (_, Shape::Union { .. }) => self.problem(
                path,
                format!("declared union {} for a single schema", describe(shape)),
            ),
            (kind, shape) => self.problem(
                path,
                format!(
                    "schema type {} is declared as {}",
                    kind.unwrap_or("(none)"),
                    describe(shape)
                ),
            ),
        }
    }

    fn compare_values(&mut self, path: &str, schema: Option<&[String]>, declared: Vec<String>) {
        let Some(schema) = schema else {
            self.problem(path, "declared an enum for a schema without enum values");
            return;
        };
        let schema: BTreeSet<&String> = schema.iter().collect();
        let declared: BTreeSet<&String> = declared.iter().collect();
        for missing in schema.difference(&declared) {
            self.problem(path, format!("enum value {missing:?} is not declared"));
        }
        for extra in declared.difference(&schema) {
            self.problem(
                path,
                format!("declared enum value {extra:?} is not in the schema"),
            );
        }
    }

    /// Compares an object schema's properties with a struct's fields.
    fn compare_fields(
        &mut self,
        path: &str,
        schema: &Value,
        name: &str,
        attrs: &[&str],
        fields: Vec<Field>,
        top: bool,
    ) {
        let options = self.part == "options";
        let empty = Map::new();
        let properties = schema
            .get("properties")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        let required: BTreeSet<&str> = schema
            .get("required")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        let builds_request = !derives_serialize(attrs);
        let fields = wire_fields(attrs, fields);
        let join = |key: &str| {
            if path.is_empty() {
                key.to_owned()
            } else {
                format!("{path}.{key}")
            }
        };
        for (key, property) in properties {
            let at = join(key);
            let location = property["location"].as_str();
            let property = if top { &property["schema"] } else { property };
            let Some(field) = fields.iter().find(|field| &field.wire == key) else {
                self.problem(&at, format!("{name} has no field for this property"));
                continue;
            };
            let is_required = required.contains(key.as_str());
            let Some((_, nullable)) = self.branches(property) else {
                continue;
            };
            let (optional, can_be_null) = match (&field.shape, options) {
                (Shape::Json, _) => (field.skippable, true),
                (Shape::Patch(_), _) => (true, true),
                (Shape::Option(_), false) => (true, true),
                (Shape::Option(_), true) => {
                    let sends_null = !field.skippable && !builds_request;
                    (!sends_null, sends_null)
                }
                (_, true) => (field.skippable, false),
                (_, false) => (false, false),
            };
            let declared = describe(&field.shape);
            if options {
                if is_required && optional {
                    self.problem(
                        &at,
                        format!(
                            "required, but {name}.{} is optional ({declared})",
                            field.rust
                        ),
                    );
                }
                if !is_required && !optional {
                    self.problem(
                        &at,
                        format!(
                            "optional, but {name}.{} is required ({declared})",
                            field.rust
                        ),
                    );
                }
                // Outside a PATCH, null means the same as leaving the option out, so an option
                // may be non-nullable where the API allows null. A query or path parameter has
                // no `null` on the wire.
                let in_url = matches!(location, Some("query" | "params"));
                if nullable && !can_be_null && !in_url && self.patch {
                    self.problem(
                        &at,
                        format!(
                            "nullable, but {name}.{} cannot send null ({declared})",
                            field.rust
                        ),
                    );
                }
                if !nullable && can_be_null && !matches!(field.shape, Shape::Json) {
                    self.problem(
                        &at,
                        format!(
                            "not nullable, but {name}.{} can send null ({declared})",
                            field.rust
                        ),
                    );
                }
            } else {
                let expected = !is_required || nullable;
                if expected && !optional && !matches!(field.shape, Shape::Json) {
                    let why = if nullable { "nullable" } else { "not required" };
                    self.problem(
                        &at,
                        format!(
                            "{why}, but {name}.{} is not an Option ({declared})",
                            field.rust
                        ),
                    );
                }
                if !expected && optional {
                    self.problem(
                        &at,
                        format!(
                            "required and not nullable, but {name}.{} is {declared}",
                            field.rust
                        ),
                    );
                }
                // A response missing a required field fails to decode, rather than holding an
                // empty value; lists and maps may still default to empty.
                let collection = matches!(field.shape, Shape::List(_) | Shape::Map(..));
                if is_required && !optional && field.defaulted && !collection {
                    self.problem(
                        &at,
                        format!(
                            "required, but {name}.{} decodes as empty when missing (serde default)",
                            field.rust
                        ),
                    );
                }
            }
            self.compare(&at, property, &field.shape);
        }
        for field in &fields {
            if properties.contains_key(&field.wire) {
                continue;
            }
            // The README leaves `projectId` and `wait` out of options; `clientOptions` are the
            // SDK's own options.
            if top
                && (["projectId", "wait"].contains(&field.wire.as_str())
                    || self.client_options.contains(&field.wire))
            {
                continue;
            }
            if SDK_FIELDS
                .iter()
                .any(|(owner, rust, _)| *owner == name && *rust == field.rust)
                || SWITCHED_FIELDS
                    .iter()
                    .any(|(owner, rust, _)| *owner == name && *rust == field.rust)
            {
                continue;
            }
            self.problem(
                &join(&field.wire),
                format!("{name}.{} is not in the schema", field.rust),
            );
        }
    }
}

fn schema_strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

/// The string values of branches that are all string enums or constants.
fn merge_values(branches: &[Value]) -> Option<Vec<Value>> {
    let mut values = Vec::new();
    for branch in branches {
        let listed = match (branch.get("enum"), branch.get("const")) {
            (Some(Value::Array(listed)), _) => listed.clone(),
            (None, Some(value)) => vec![value.clone()],
            _ => return None,
        };
        for value in listed {
            if !value.is_string() {
                return None;
            }
            if !values.contains(&value) {
                values.push(value);
            }
        }
    }
    Some(values)
}

#[test]
fn declared_types_match_the_api_schema() {
    let types = fixture("types");
    let definitions = types["definitions"].as_object().unwrap();
    let client = ServerClient::new("key", "project").unwrap();
    let mut problems = Vec::new();
    for operation in types["operations"].as_array().unwrap() {
        let id = operation["id"].as_str().unwrap();
        let rust = operation["names"]["rust"].as_str().unwrap();
        let Some(declared) = declared(&client, rust) else {
            problems.push(format!("{id}: no Rust method is mapped for {rust}"));
            continue;
        };
        let walk = |part: &'static str| Walk {
            definitions,
            operation: id,
            part,
            patch: operation["method"] == "PATCH",
            problems: Vec::new(),
            refs: Vec::new(),
            client_options: schema_strings(&operation["options"]["clientOptions"]),
        };
        let mut options = walk("options");
        let schema = &operation["options"];
        match &declared.options {
            Some(Shape::Struct {
                name,
                attrs,
                fields,
            }) => options.compare_fields("", schema, name, attrs, fields(), true),
            Some(shape) => {
                options.problem("", format!("options are declared as {}", describe(shape)))
            }
            None => {
                if schema["properties"]
                    .as_object()
                    .is_some_and(|p| !p.is_empty())
                {
                    options.problem("", "the method takes no options");
                }
            }
        }
        problems.extend(options.problems);
        let mut result = walk("result");
        match (&operation["result"], &declared.result) {
            (Value::Null, Shape::Unit) => {}
            (Value::Null, _) if SDK_RESULTS.iter().any(|(listed, _)| *listed == id) => {}
            (Value::Null, shape) => result.problem(
                "",
                format!("no result, but the method returns {}", describe(shape)),
            ),
            (_, Shape::Unit) => result.problem("", "the method returns no model"),
            (schema, shape) => {
                if let Some((_, true)) = result.branches(schema) {
                    if !matches!(shape, Shape::Option(_)) {
                        result.problem("", "nullable, but the result is not an Option");
                    }
                }
                result.compare("", schema, shape)
            }
        }
        problems.extend(result.problems);
    }
    let mapped: BTreeSet<&str> = types["operations"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|operation| operation["names"]["rust"].as_str())
        .collect();
    assert!(!mapped.is_empty());
    assert!(
        problems.is_empty(),
        "{} declared-type mismatches:\n{}",
        problems.len(),
        problems.join("\n")
    );
}
