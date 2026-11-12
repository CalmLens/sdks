//! The library backend: CalmLens through the SDK's async client in live mode, or the in-memory
//! demo store in demo mode. Handlers call these methods and never see which one answers.
//!
//! The demo store sits behind a `std::sync::Mutex` whose guard lives only inside
//! [`Library::with_store`], a synchronous function, so it is never held across an `.await`.
//! Live calls share one cloned [`ServerClient`] and take no lock at all.
use crate::app::Decision;
use crate::demo::DemoStore;
use crate::messages::Failure;
use calmlens::models::Content;
use calmlens::models::{
    Asset, AssetId, AssetModerationDecision, AssetPage, AssetSearchResponse, CdnResource,
    CreateFolder, Folder, FolderId, ImageTransformOptions, LensDefinition, ListAssets, ListFolders,
    MetadataItem, MoveAsset, MoveFolder, Patch, ProcessingOptions, SearchAssets,
    SignAssetUrlOptions, SubmitAsset, UpdateAsset, UpdateFolder, Visibility,
};
use calmlens::{Bytes, ServerClient};
use std::sync::{Arc, Mutex};

/// The project ID the demo store uses for its folders and assets.
pub const DEMO_PROJECT_ID: &str = "demo-project";

/// Named, versioned CDN transformations: a 320px square thumbnail for the grid and a 1600px web
/// rendition for downloads.
pub const THUMB_LENS: &str = "calmlibrary-thumb";
pub const WEB_LENS: &str = "calmlibrary-web";
pub const SIGNED_URL_SECONDS: u64 = 60;

/// A validated upload, ready to send.
pub struct NewUpload {
    pub name: String,
    pub bytes: Bytes,
    pub mime: &'static str,
    pub folder: Option<String>,
    /// The catalogue ID with the app's prefix; see [`crate::app::catalogue_id`].
    pub external_id: String,
    pub description: Option<String>,
    pub metadata: Vec<MetadataItem>,
    /// Demo mode only: the outcome the user selected. Ignored in live mode.
    pub demo_outcome: Decision,
}

/// How an allowed image is delivered.
pub enum Delivery {
    /// Live: a short-lived signed CDN URL.
    Redirect(String),
    /// Demo: the bytes kept for the asset.
    Content { bytes: Bytes, mime: &'static str },
    /// Demo: the asset has no stored bytes.
    Missing,
}

#[derive(Clone)]
pub enum Library {
    Live(ServerClient),
    Demo(Arc<Mutex<DemoStore>>),
}

impl Library {
    pub fn demo() -> Self {
        Library::Demo(Arc::default())
    }

    /// The demo library with sample folders and images in every state.
    pub fn demo_with_samples() -> Self {
        let store = DemoStore::default();
        let library = Library::Demo(Arc::new(Mutex::new(store)));
        if let Library::Demo(store) = &library {
            store
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .seed_samples();
        }
        library
    }

    pub fn is_demo(&self) -> bool {
        matches!(self, Library::Demo(_))
    }

    /// The project whose assets this library holds.
    pub fn project_id(&self) -> &str {
        match self {
            Library::Live(client) => client.project_id(),
            Library::Demo(_) => DEMO_PROJECT_ID,
        }
    }

    /// Runs `f` on the demo store after settling finished reviews. The guard is dropped before
    /// this synchronous function returns.
    fn with_store<T>(store: &Mutex<DemoStore>, f: impl FnOnce(&mut DemoStore) -> T) -> T {
        let mut guard = store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.settle();
        f(&mut guard)
    }

    /// Tests only: ends every pending demo review now.
    #[cfg(test)]
    pub fn expire_demo_reviews(&self) {
        if let Library::Demo(store) = self {
            Self::with_store(store, DemoStore::expire_reviews);
        }
    }

    /// Tests only: the demo store's folder and asset counts.
    #[cfg(test)]
    pub fn demo_counts(&self) -> (usize, usize) {
        match self {
            Library::Demo(store) => Self::with_store(store, |store| store.counts()),
            Library::Live(_) => (0, 0),
        }
    }

    // ------------------------------------------------------------ folders

    pub async fn folders(&self) -> Result<Vec<Folder>, Failure> {
        match self {
            Library::Live(client) => {
                // Folders are listed one parent at a time; walk the tree to collect them all.
                let mut folders = Vec::new();
                let mut parents = vec![None];
                while let Some(parent_id) = parents.pop() {
                    let mut cursor = None;
                    loop {
                        let page = client
                            .folders()
                            .list({
                                let mut options = ListFolders::new().page_size(100);
                                options.parent_id = parent_id.clone();
                                options.cursor = cursor;
                                options
                            })
                            .await?;
                        parents.extend(page.items.iter().map(|folder| Some(folder.id.clone())));
                        folders.extend(page.items);
                        cursor = page.next_cursor.filter(|_| page.has_more);
                        if cursor.is_none() {
                            break;
                        }
                    }
                }
                Ok(folders)
            }
            Library::Demo(store) => Ok(Self::with_store(store, |store| store.folders())),
        }
    }

    pub async fn create_folder(&self, name: &str, parent: Option<&str>) -> Result<Folder, Failure> {
        match self {
            Library::Live(client) => Ok(client
                .folders()
                .create({
                    let mut options = CreateFolder::new(name);
                    options.parent_id = parent.map_or(Patch::Missing, |id| Patch::Value(id.into()));
                    options
                })
                .await?),
            Library::Demo(store) => {
                Self::with_store(store, |store| store.create_folder(name, parent))
            }
        }
    }

    pub async fn rename_folder(&self, id: &str, name: &str) -> Result<Folder, Failure> {
        match self {
            Library::Live(client) => Ok(client
                .folders()
                .update(UpdateFolder::new(id).name(name))
                .await?),
            Library::Demo(store) => Self::with_store(store, |store| store.rename_folder(id, name)),
        }
    }

    pub async fn move_folder(&self, id: &str, parent: Option<&str>) -> Result<Folder, Failure> {
        match self {
            Library::Live(client) => Ok(client
                .folders()
                .move_folder({
                    let mut options = MoveFolder::new(id);
                    options.parent_id = parent.map(str::to_string);
                    options
                })
                .await?),
            Library::Demo(store) => Self::with_store(store, |store| store.move_folder(id, parent)),
        }
    }

    pub async fn delete_folder(&self, id: &str) -> Result<(), Failure> {
        match self {
            Library::Live(client) => Ok(client.folders().delete(FolderId::new(id)).await?),
            Library::Demo(store) => Self::with_store(store, |store| store.delete_folder(id)),
        }
    }

    // ------------------------------------------------------------ assets

    /// Lists one page of top-level assets, optionally in one folder and with one fixed status.
    pub async fn list(
        &self,
        folder: Option<&str>,
        status: &str,
        cursor: Option<&str>,
        page_size: u32,
    ) -> Result<AssetPage, Failure> {
        match self {
            Library::Live(client) => Ok(client
                .assets()
                .list({
                    let mut options = ListAssets::new()
                        .page_size(page_size)
                        .filter(list_filter(folder, status));
                    options.cursor = cursor.map(str::to_string);
                    options
                })
                .await?),
            Library::Demo(store) => Ok(Self::with_store(store, |store| {
                store.list(folder, status, cursor, page_size)
            })),
        }
    }

    pub async fn search(
        &self,
        query: &str,
        mode: &str,
        page_size: u32,
    ) -> Result<AssetSearchResponse, Failure> {
        match self {
            Library::Live(client) => Ok(client
                .assets()
                .search(SearchAssets::new(query).mode(mode).page_size(page_size))
                .await?),
            Library::Demo(store) => Ok(Self::with_store(store, |store| {
                store.search(query, mode, page_size as usize)
            })),
        }
    }

    pub async fn retrieve(&self, id: &str) -> Result<Asset, Failure> {
        match self {
            Library::Live(client) => Ok(client.assets().retrieve(AssetId::new(id)).await?),
            Library::Demo(store) => Self::with_store(store, |store| store.retrieve(id)),
        }
    }

    /// Uploads one image privately, keeping its content after processing so the library can
    /// deliver it. Images are classified in the background: the asset returns pending.
    pub async fn upload(&self, upload: NewUpload) -> Result<Asset, Failure> {
        match self {
            Library::Live(client) => {
                let options = {
                    let mut options =
                        SubmitAsset::new(upload.name, Content::bytes(upload.bytes, upload.mime))
                            .visibility(Visibility::Private)
                            .external_id(upload.external_id)
                            .metadata(upload.metadata)
                            .processing_options(ProcessingOptions::new().retain_content(true));
                    options.folder_id = upload.folder.map_or(Patch::Missing, Patch::Value);
                    options.description = upload.description;
                    options
                };
                Ok(client.assets().create(options).await?)
            }
            Library::Demo(store) => Self::with_store(store, |store| store.upload(upload)),
        }
    }

    pub async fn update(
        &self,
        id: &str,
        description: Option<String>,
        tags: Vec<String>,
        metadata: Vec<MetadataItem>,
    ) -> Result<Asset, Failure> {
        match self {
            Library::Live(client) => Ok(client
                .assets()
                .update({
                    let mut options = UpdateAsset::new(id).tags(tags).metadata(metadata);
                    options.description = description.map_or(Patch::Null, Patch::Value);
                    options
                })
                .await?),
            Library::Demo(store) => {
                Self::with_store(store, |store| store.update(id, description, tags, metadata))
            }
        }
    }

    pub async fn move_asset(&self, id: &str, folder: Option<&str>) -> Result<Asset, Failure> {
        match self {
            Library::Live(client) => Ok(client
                .assets()
                .move_asset({
                    let mut options = MoveAsset::new(id);
                    options.folder_id = folder.map(str::to_string);
                    options
                })
                .await?),
            Library::Demo(store) => Self::with_store(store, |store| store.move_asset(id, folder)),
        }
    }

    /// Removes the stored file. The record, its metadata and classification results stay.
    pub async fn remove_content(&self, id: &str) -> Result<Asset, Failure> {
        match self {
            Library::Live(client) => Ok(client.assets().remove_content(AssetId::new(id)).await?),
            Library::Demo(store) => Self::with_store(store, |store| store.remove_content(id)),
        }
    }

    /// Deletes the asset record and its content.
    pub async fn delete(&self, id: &str) -> Result<(), Failure> {
        match self {
            Library::Live(client) => Ok(client.assets().delete(AssetId::new(id)).await?),
            Library::Demo(store) => Self::with_store(store, |store| store.delete(id)),
        }
    }

    /// Delivers an asset the caller has already checked is deliverable. Live mode ensures the
    /// lens (idempotent, cached by the client after the first success) and signs a 60-second
    /// asset URL, returning its rendered resource through the lens.
    pub async fn deliver(&self, asset: &Asset, lens: &str) -> Result<Delivery, Failure> {
        match self {
            Library::Live(client) => {
                if let Some(definition) = lens_definitions()
                    .into_iter()
                    .find(|definition| definition.identifier == lens)
                {
                    client.ensure_lens(definition).await?;
                }
                let signed = client
                    .cdn()
                    .sign_asset_url(
                        SignAssetUrlOptions::new()
                            .asset_id(asset.id.clone())
                            .resource(CdnResource::Rendered)
                            .lens(lens)
                            .expires_in(SIGNED_URL_SECONDS),
                    )
                    .await?;
                Ok(Delivery::Redirect(signed.url))
            }
            Library::Demo(store) => Ok(
                match Self::with_store(store, |store| store.file(&asset.id)) {
                    Some((bytes, mime)) => Delivery::Content { bytes, mime },
                    None => Delivery::Missing,
                },
            ),
        }
    }

    /// Demo only: a simulated reviewer blocking an asset. Returns whether the asset exists.
    pub fn simulate_blocking(&self, id: &str) -> bool {
        match self {
            Library::Demo(store) => Self::with_store(store, |store| {
                store.review(id, AssetModerationDecision::Blocked)
            }),
            Library::Live(_) => false,
        }
    }
}

/// Top-level assets only (no derived children), optionally in one folder and with one fixed
/// status from `STATUS_FILTERS`. Any other status lists every status.
pub fn list_filter(folder: Option<&str>, status: &str) -> String {
    let scope = match folder {
        Some(folder) => format!("parentId==null;folderId=={folder}"),
        None => "parentId==null".into(),
    };
    let status = match status {
        "allowed" => "classification.moderation.decision==allowed",
        "limited" => "classification.moderation.decision==limited",
        "age-restricted" => "classification.moderation.decision==age-restricted",
        "blocked" => "classification.moderation.decision==blocked",
        "purged" => "classification.moderation.decision==purged",
        "pending" => "classification.moderation.decision==pending;classification.status!=failed",
        "failed" => "classification.status==failed",
        _ => return scope,
    };
    format!("{scope};{status}")
}

pub fn lens_definitions() -> Vec<LensDefinition> {
    let lens = |identifier: &str, name: &str, fit: &str, width: u32, height: Option<u32>| {
        LensDefinition::new(identifier, name, "image")
            .active(true)
            .transform({
                let options = ImageTransformOptions::new()
                    .fit(fit)
                    .width(width)
                    .format("webp");
                match height {
                    Some(height) => options.height(height),
                    None => options,
                }
            })
    };
    vec![
        lens(THUMB_LENS, "Calmlibrary thumbnail", "cover", 320, Some(320)),
        lens(WEB_LENS, "Calmlibrary web size", "scale-down", 1600, None),
    ]
}
