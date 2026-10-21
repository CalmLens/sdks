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
    Asset, AssetId, AssetPage, AssetReviewerAction, AssetSearchResponse, CreateFolder, Folder,
    FolderId, ImageTransformOptions, LensDefinition, ListAssets, ListFolders, MetadataItem,
    MoveAsset, MoveFolder, Patch, ProcessingOptions, SearchAssets, SignedUrlOptions, SubmitAsset,
    Transform, UpdateAsset, UpdateFolder, Visibility,
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

/// How an approved image is delivered.
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
                    for page_index in 0.. {
                        let page = client
                            .folders()
                            .list(ListFolders {
                                parent_id: parent_id.clone(),
                                page_index: Some(page_index),
                                page_size: Some(100),
                                ..Default::default()
                            })
                            .await?;
                        parents.extend(page.folders.iter().map(|folder| Some(folder.id.clone())));
                        folders.extend(page.folders);
                        if !page.has_more {
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
                .create(CreateFolder {
                    name: name.into(),
                    parent_id: parent.map_or(Patch::Missing, |id| Patch::Value(id.into())),
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
                .update(UpdateFolder {
                    folder_id: id.into(),
                    name: Patch::Value(name.into()),
                })
                .await?),
            Library::Demo(store) => Self::with_store(store, |store| store.rename_folder(id, name)),
        }
    }

    pub async fn move_folder(&self, id: &str, parent: Option<&str>) -> Result<Folder, Failure> {
        match self {
            Library::Live(client) => Ok(client
                .folders()
                .move_folder(MoveFolder {
                    folder_id: id.into(),
                    parent_id: parent.map(str::to_string),
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
                .list(ListAssets {
                    cursor: cursor.map(str::to_string),
                    page_size: Some(page_size),
                    filter: Some(list_filter(status)),
                    folder_id: folder.map(str::to_string),
                    ..Default::default()
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
        limit: u32,
    ) -> Result<AssetSearchResponse, Failure> {
        match self {
            Library::Live(client) => Ok(client
                .assets()
                .search(SearchAssets {
                    query: query.into(),
                    mode: Some(mode.into()),
                    limit: Some(limit),
                })
                .await?),
            Library::Demo(store) => Ok(Self::with_store(store, |store| {
                store.search(query, mode, limit as usize)
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
                let options = SubmitAsset {
                    visibility: Some(Visibility::Private),
                    folder_id: upload.folder.map_or(Patch::Missing, Patch::Value),
                    external_id: Some(upload.external_id),
                    description: upload.description,
                    metadata: Some(upload.metadata),
                    processing_options: Some(ProcessingOptions {
                        keep_content_after_processing: Some(true),
                        ..Default::default()
                    }),
                    ..SubmitAsset::new(upload.name, Content::bytes(upload.bytes, upload.mime))
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
                .update(UpdateAsset {
                    asset_id: id.into(),
                    description: description.map_or(Patch::Null, Patch::Value),
                    tags: Patch::Value(tags),
                    metadata: Patch::Value(metadata),
                    ..Default::default()
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
                .move_asset(MoveAsset {
                    asset_id: id.into(),
                    folder_id: folder.map(str::to_string),
                })
                .await?),
            Library::Demo(store) => Self::with_store(store, |store| store.move_asset(id, folder)),
        }
    }

    /// Removes the stored file. The record, its metadata and moderation report stay.
    pub async fn delete_content(&self, id: &str) -> Result<Asset, Failure> {
        match self {
            Library::Live(client) => Ok(client.assets().delete_content(AssetId::new(id)).await?),
            Library::Demo(store) => Self::with_store(store, |store| store.delete_content(id)),
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
    /// URL through it.
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
                    .assets()
                    .create_signed_url(SignedUrlOptions {
                        asset_id: asset.id.clone(),
                        resource: Some("content".into()),
                        lens: Some(lens.into()),
                        expires_in_seconds: Some(SIGNED_URL_SECONDS),
                        ..Default::default()
                    })
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

    /// Demo only: a simulated portal rejection. Returns whether the asset exists.
    pub fn simulate_rejection(&self, id: &str) -> bool {
        match self {
            Library::Demo(store) => Self::with_store(store, |store| {
                store.review(id, AssetReviewerAction::Rejected)
            }),
            Library::Live(_) => false,
        }
    }
}

/// Top-level assets only (no derived children), optionally with one fixed status from
/// `STATUS_FILTERS`. Any other value lists every status.
pub fn list_filter(status: &str) -> String {
    let status = match status {
        "approved" => "moderation.status==approved",
        "rejected" => "moderation.status==rejected",
        "pending" => "moderation.status==pending;processing.status!=failed",
        "failed" => "processing.status==failed",
        _ => return "parentId==null".into(),
    };
    format!("parentId==null;{status}")
}

pub fn lens_definitions() -> Vec<LensDefinition> {
    let lens =
        |identifier: &str, name: &str, fit: &str, width: u32, height: Option<u32>| LensDefinition {
            identifier: identifier.into(),
            name: name.into(),
            lens_type: "image".into(),
            active: true,
            version: 1,
            description: Patch::Missing,
            transforms: Patch::Value(vec![Transform::image(ImageTransformOptions {
                fit: Some(fit.into()),
                width: Some(width),
                height,
                format: Some("webp".into()),
                ..Default::default()
            })]),
        };
    vec![
        lens(THUMB_LENS, "Calmlibrary thumbnail", "cover", 320, Some(320)),
        lens(WEB_LENS, "Calmlibrary web size", "scale-down", 1600, None),
    ]
}
