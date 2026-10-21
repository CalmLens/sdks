//! Demo mode only: an in-memory library that stands in for CalmLens.
//!
//! The store keeps the demo library's folders, assets and uploaded bytes, and applies the same
//! rules as the API: only empty folders can be deleted, a folder cannot move inside itself,
//! sibling folder names are unique and catalogue IDs (external IDs) are unique. A rule that
//! fails returns the API's error code, so the app explains it exactly as in live mode.
//!
//! Nothing is classified. Each upload takes the outcome the user selected after a short review
//! delay. Search is local keyword matching over names, descriptions, tags and metadata; there
//! is no semantic matching offline. This module does not use the SDK's test mock.
use crate::app::{content_removed, decision, random_hex, Decision};
use crate::library::{NewUpload, DEMO_PROJECT_ID};
use crate::messages::{rejected, Failure};
use axum::http::StatusCode;
use calmlens::models::{
    Asset, AssetClassificationStatus, AssetContentRemovalReason, AssetContentStatus,
    AssetModerationAction, AssetModerationStatus, AssetPage, AssetReviewerAction, AssetSearchMatch,
    AssetSearchResponse, Folder, MetadataItem, ProcessingOptions, SearchMatchField, Visibility,
};
use calmlens::{Bytes, Error, ErrorCode};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// How long a demo upload stays pending before it takes the selected outcome.
pub const DEMO_REVIEW_DELAY: Duration = Duration::from_secs(2);
pub const MAX_DEMO_ASSETS: usize = 40;
pub const MAX_DEMO_FOLDERS: usize = 30;

/// Explicitly selected fake moderation outcomes for demo uploads.
pub const DEMO_OUTCOMES: [(&str, &str); 3] = [
    ("approved", "Approve"),
    ("rejected", "Reject"),
    ("failed", "Processing error"),
];

/// The decision a demo outcome value stands for; anything else is refused.
pub fn demo_outcome(value: &str) -> Option<Decision> {
    match value {
        "approved" => Some(Decision::Approved),
        "rejected" => Some(Decision::Rejected),
        "failed" => Some(Decision::Failed),
        _ => None,
    }
}

/// Search scope for local keyword matching.
const SEARCH_FIELDS: [&str; 4] = ["name", "description", "tags", "metadata"];

struct DemoAsset {
    asset: Asset,
    outcome: Decision,
    submitted_at: Instant,
    file: Option<(Bytes, &'static str)>,
}

#[derive(Default)]
pub struct DemoStore {
    folders: Vec<Folder>,
    assets: Vec<DemoAsset>,
}

/// The API's error for `code`, with the HTTP status the API uses for it.
fn api(code: ErrorCode) -> Failure {
    let status = code.http_status();
    let mut error = Error::new(code, "Demo library");
    if let Some(status) = status {
        error = error.with_status(status);
    }
    Failure::CalmLens(error)
}

impl DemoStore {
    /// Pending demo uploads take their selected outcome once the review delay has passed.
    pub fn settle(&mut self) {
        for entry in &mut self.assets {
            if entry.asset.classification.status == AssetClassificationStatus::Processing
                && entry.submitted_at.elapsed() >= DEMO_REVIEW_DELAY
            {
                let asset = &mut entry.asset;
                asset.classification.status = match entry.outcome {
                    Decision::Failed => AssetClassificationStatus::Failed,
                    _ => AssetClassificationStatus::Completed,
                };
                asset.classification.updated_at = Some(now_ms());
                // Rejected uploads are hidden by the simulated policy; approved ones matched nothing.
                match entry.outcome {
                    Decision::Approved => {
                        asset.classification.moderation.decision = AssetModerationStatus::Approved
                    }
                    Decision::Rejected => {
                        asset.classification.moderation.decision = AssetModerationStatus::Rejected;
                        asset.classification.moderation.action = Some(AssetModerationAction::Hide);
                    }
                    Decision::Failed | Decision::Pending => {}
                }
                if entry.outcome != Decision::Failed {
                    asset.classification.completed_at = Some(now_ms());
                }
            }
        }
    }

    /// Tests only: ends every pending review delay now.
    #[cfg(test)]
    pub fn expire_reviews(&mut self) {
        for entry in &mut self.assets {
            entry.submitted_at = Instant::now() - DEMO_REVIEW_DELAY;
        }
    }

    #[cfg(test)]
    pub fn counts(&self) -> (usize, usize) {
        (self.folders.len(), self.assets.len())
    }

    // ------------------------------------------------------------ folders

    pub fn folders(&self) -> Vec<Folder> {
        self.folders.clone()
    }

    fn folder(&self, id: &str) -> Option<&Folder> {
        self.folders.iter().find(|folder| folder.id == id)
    }

    fn require_folder(&self, id: Option<&str>) -> Result<(), Failure> {
        match id {
            Some(id) if self.folder(id).is_none() => Err(api(ErrorCode::FolderNotFound)),
            _ => Ok(()),
        }
    }

    fn sibling_named(&self, parent: Option<&str>, name: &str, except: Option<&str>) -> bool {
        self.folders.iter().any(|folder| {
            folder.parent_id.as_deref() == parent
                && folder
                    .name
                    .as_deref()
                    .is_some_and(|existing| existing.eq_ignore_ascii_case(name))
                && Some(folder.id.as_str()) != except
        })
    }

    pub fn create_folder(&mut self, name: &str, parent: Option<&str>) -> Result<Folder, Failure> {
        if self.folders.len() >= MAX_DEMO_FOLDERS {
            return Err(rejected(
                StatusCode::CONFLICT,
                format!("The demo library holds at most {MAX_DEMO_FOLDERS} folders."),
            ));
        }
        self.require_folder(parent)?;
        if self.sibling_named(parent, name, None) {
            return Err(api(ErrorCode::DuplicateFolderName));
        }
        let mut folder = Folder::new(
            format!("demo-folder-{}", random_hex(6)),
            name,
            parent.map(str::to_string),
        );
        folder.project_id = Some(DEMO_PROJECT_ID.into());
        folder.created_at = Some(now_ms());
        folder.updated_at = folder.created_at;
        self.folders.push(folder.clone());
        Ok(folder)
    }

    pub fn rename_folder(&mut self, id: &str, name: &str) -> Result<Folder, Failure> {
        let parent = self
            .folder(id)
            .ok_or_else(|| api(ErrorCode::FolderNotFound))?
            .parent_id
            .clone();
        if self.sibling_named(parent.as_deref(), name, Some(id)) {
            return Err(api(ErrorCode::DuplicateFolderName));
        }
        let folder = self.folder_mut(id)?;
        folder.name = Some(name.into());
        folder.updated_at = Some(now_ms());
        Ok(folder.clone())
    }

    pub fn move_folder(&mut self, id: &str, parent: Option<&str>) -> Result<Folder, Failure> {
        let name = self
            .folder(id)
            .ok_or_else(|| api(ErrorCode::FolderNotFound))?
            .name
            .clone()
            .unwrap_or_default();
        // Walk up from the destination: reaching the moved folder would create a cycle.
        let mut cursor = parent.map(str::to_string);
        while let Some(current) = cursor {
            if current == id {
                return Err(api(ErrorCode::FolderParentCycle));
            }
            cursor = self
                .folder(&current)
                .ok_or_else(|| api(ErrorCode::FolderNotFound))?
                .parent_id
                .clone();
        }
        if self.sibling_named(parent, &name, Some(id)) {
            return Err(api(ErrorCode::DuplicateFolderName));
        }
        let folder = self.folder_mut(id)?;
        folder.parent_id = parent.map(str::to_string);
        folder.updated_at = Some(now_ms());
        Ok(folder.clone())
    }

    pub fn delete_folder(&mut self, id: &str) -> Result<(), Failure> {
        self.require_folder(Some(id))?;
        let has_children = self
            .folders
            .iter()
            .any(|folder| folder.parent_id.as_deref() == Some(id))
            || self
                .assets
                .iter()
                .any(|entry| entry.asset.folder_id.as_deref() == Some(id));
        if has_children {
            return Err(api(ErrorCode::FolderNotEmpty));
        }
        self.folders.retain(|folder| folder.id != id);
        Ok(())
    }

    fn folder_mut(&mut self, id: &str) -> Result<&mut Folder, Failure> {
        self.folders
            .iter_mut()
            .find(|folder| folder.id == id)
            .ok_or_else(|| api(ErrorCode::FolderNotFound))
    }

    // ------------------------------------------------------------ assets

    /// Stores an upload. The asset starts pending, like a queued image upload.
    pub fn upload(&mut self, upload: NewUpload) -> Result<Asset, Failure> {
        if self.assets.len() >= MAX_DEMO_ASSETS {
            return Err(rejected(
                StatusCode::CONFLICT,
                format!(
                    "The demo library holds at most {MAX_DEMO_ASSETS} assets. Delete one first."
                ),
            ));
        }
        self.require_folder(upload.folder.as_deref())?;
        if self
            .assets
            .iter()
            .any(|entry| entry.asset.external_id.as_deref() == Some(&upload.external_id))
        {
            return Err(api(ErrorCode::DuplicateExternalId));
        }
        let mut asset = Asset::new(
            format!("demo-asset-{}", random_hex(6)),
            AssetClassificationStatus::Processing,
            AssetModerationStatus::Pending,
        );
        asset.name = Some(upload.name);
        asset.asset_type = Some("image".into());
        asset.project_id = Some(DEMO_PROJECT_ID.into());
        asset.folder_id = upload.folder;
        asset.content.status = AssetContentStatus::Stored;
        asset.content.size_in_bytes = Some(upload.bytes.len() as u64);
        asset.external_id = Some(upload.external_id);
        asset.description = upload.description;
        asset.metadata = Some(upload.metadata);
        asset.tags = Some(Vec::new());
        asset.visibility = Some(Visibility::Private);
        asset.processing_options = Some(ProcessingOptions {
            keep_content_after_processing: Some(true),
            ..Default::default()
        });
        asset.created_at = Some(now_ms());
        asset.updated_at = asset.created_at;
        self.assets.insert(
            0,
            DemoAsset {
                asset: asset.clone(),
                outcome: upload.demo_outcome,
                submitted_at: Instant::now(),
                file: Some((upload.bytes, upload.mime)),
            },
        );
        Ok(asset)
    }

    pub fn list(
        &self,
        folder: Option<&str>,
        status: &str,
        cursor: Option<&str>,
        page_size: u32,
    ) -> AssetPage {
        let mut matching: Vec<&Asset> = self
            .assets
            .iter()
            .map(|entry| &entry.asset)
            .filter(|asset| folder.is_none_or(|id| asset.folder_id.as_deref() == Some(id)))
            .filter(|asset| status.is_empty() || decision(asset).as_str() == status)
            .collect();
        matching.sort_by(|a, b| b.id.cmp(&a.id));
        if let Some(cursor) = cursor {
            matching.retain(|asset| asset.id.as_str() < cursor);
        }
        let start = 0;
        let items: Vec<Asset> = matching
            .iter()
            .skip(start)
            .take(page_size as usize)
            .map(|asset| (*asset).clone())
            .collect();
        let has_more = start + items.len() < matching.len();
        let mut page = AssetPage::new(items, has_more);
        page.next_cursor = if has_more {
            page.items.last().map(|asset| asset.id.clone())
        } else {
            None
        };
        page.page_size = Some(page_size);
        page
    }

    fn entry(&self, id: &str) -> Result<&DemoAsset, Failure> {
        self.assets
            .iter()
            .find(|entry| entry.asset.id == id)
            .ok_or_else(|| api(ErrorCode::AssetNotFound))
    }

    fn entry_mut(&mut self, id: &str) -> Result<&mut DemoAsset, Failure> {
        self.assets
            .iter_mut()
            .find(|entry| entry.asset.id == id)
            .ok_or_else(|| api(ErrorCode::AssetNotFound))
    }

    pub fn retrieve(&self, id: &str) -> Result<Asset, Failure> {
        Ok(self.entry(id)?.asset.clone())
    }

    pub fn update(
        &mut self,
        id: &str,
        description: Option<String>,
        tags: Vec<String>,
        metadata: Vec<MetadataItem>,
    ) -> Result<Asset, Failure> {
        let asset = &mut self.entry_mut(id)?.asset;
        asset.description = description;
        asset.tags = Some(tags);
        asset.metadata = Some(metadata);
        asset.updated_at = Some(now_ms());
        Ok(asset.clone())
    }

    pub fn move_asset(&mut self, id: &str, folder: Option<&str>) -> Result<Asset, Failure> {
        self.require_folder(folder)?;
        let asset = &mut self.entry_mut(id)?.asset;
        asset.folder_id = folder.map(str::to_string);
        Ok(asset.clone())
    }

    /// The record, metadata and report stay; only the stored content goes.
    pub fn delete_content(&mut self, id: &str) -> Result<Asset, Failure> {
        let entry = self.entry_mut(id)?;
        entry.file = None;
        if !content_removed(&entry.asset) {
            entry.asset.content.status = AssetContentStatus::Removed;
            entry.asset.content.removal_reason = Some(AssetContentRemovalReason::Requested);
            entry.asset.content.updated_at = Some(now_ms());
        }
        Ok(entry.asset.clone())
    }

    pub fn delete(&mut self, id: &str) -> Result<(), Failure> {
        self.entry(id)?;
        self.assets.retain(|entry| entry.asset.id != id);
        Ok(())
    }

    /// The bytes kept for an asset, while its file is stored.
    pub fn file(&self, id: &str) -> Option<(Bytes, &'static str)> {
        self.entry(id).ok()?.file.clone()
    }

    /// A simulated portal decision on an asset. Returns whether the asset exists.
    pub fn review(&mut self, id: &str, action: AssetReviewerAction) -> bool {
        match self.entry_mut(id) {
            Ok(entry) => {
                let moderation = &mut entry.asset.classification.moderation;
                moderation.decision = match action {
                    AssetReviewerAction::Rejected => AssetModerationStatus::Rejected,
                    _ => AssetModerationStatus::Approved,
                };
                moderation.reviewer_action = Some(action);
                moderation.reviewed_at = Some(now_ms());
                true
            }
            Err(_) => false,
        }
    }

    /// Simulated search: local, case-insensitive keyword matching over names, descriptions,
    /// tags and metadata values. There is no semantic matching offline, so `semantic` mode finds
    /// nothing and `semanticStatus` is always `disabled`. Like CalmLens, results exclude
    /// rejected, unfinished and removed content.
    pub fn search(&self, query: &str, mode: &str, limit: usize) -> AssetSearchResponse {
        let terms: Vec<String> = query
            .split_whitespace()
            .map(str::to_lowercase)
            .filter(|term| term.len() > 1)
            .collect();
        let mut items = Vec::new();
        if mode != "semantic" && !terms.is_empty() {
            for entry in &self.assets {
                let asset = &entry.asset;
                if decision(asset) != Decision::Approved || content_removed(asset) {
                    continue;
                }
                let mut matched = Vec::new();
                let mut hits = 0;
                for field in SEARCH_FIELDS {
                    let haystack = searchable(field, asset).to_lowercase();
                    let count = terms.iter().filter(|term| haystack.contains(*term)).count();
                    if count > 0 {
                        matched.push(SearchMatchField::from(field));
                        hits += count;
                    }
                }
                if !matched.is_empty() {
                    let mut item = AssetSearchMatch::default();
                    item.asset = asset.clone();
                    item.score = hits as f64 / (terms.len() * SEARCH_FIELDS.len()) as f64;
                    item.matched_fields = matched;
                    items.push(item);
                }
            }
        }
        items.sort_by(|a, b| b.score.total_cmp(&a.score));
        items.truncate(limit);
        let mut response = AssetSearchResponse::default();
        response.query = query.into();
        response.items = items;
        response.semantic_status = "disabled".into();
        response
    }
}

fn searchable(field: &str, asset: &Asset) -> String {
    match field {
        "name" => asset.name.clone().unwrap_or_default(),
        "description" => asset.description.clone().unwrap_or_default(),
        "tags" => asset.tags.clone().unwrap_or_default().join(" "),
        _ => asset
            .metadata
            .iter()
            .flatten()
            .filter_map(|item| item.value.as_str())
            .collect::<Vec<_>>()
            .join(" "),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_millis() as u64)
        .unwrap_or(0)
}
