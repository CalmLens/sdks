//! Everything the app tells the user comes from this file: a fixed set of notices for
//! redirect-after-submit, and fixed explanations for the CalmLens error codes the library
//! expects. Raw error text from the API, the SDK or the URL is never shown; it is logged to
//! stderr with the response's request ID instead.
use axum::http::StatusCode;
use calmlens::ErrorCode;

/// Why a request could not be completed.
#[derive(Debug)]
pub enum Failure {
    /// Input the app refused before calling CalmLens. The message is fixed app text.
    Rejected(StatusCode, String),
    /// A CalmLens request failed.
    CalmLens(calmlens::Error),
}

impl From<calmlens::Error> for Failure {
    fn from(error: calmlens::Error) -> Self {
        Failure::CalmLens(error)
    }
}

pub fn rejected(status: StatusCode, message: impl Into<String>) -> Failure {
    Failure::Rejected(status, message.into())
}

/// A notice shown after a successful form submission. Redirects carry only its identifier,
/// such as `?notice=folder-created`; any other value is ignored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Notice {
    FolderCreated,
    FolderRenamed,
    FolderMoved,
    FolderDeleted,
    Uploaded,
    DetailsSaved,
    AssetMoved,
    FileRemoved,
    AssetDeleted,
    ReviewSimulated,
}

impl Notice {
    pub const ALL: [Notice; 10] = [
        Notice::FolderCreated,
        Notice::FolderRenamed,
        Notice::FolderMoved,
        Notice::FolderDeleted,
        Notice::Uploaded,
        Notice::DetailsSaved,
        Notice::AssetMoved,
        Notice::FileRemoved,
        Notice::AssetDeleted,
        Notice::ReviewSimulated,
    ];

    /// The identifier used in the `notice` query parameter.
    pub fn id(self) -> &'static str {
        match self {
            Notice::FolderCreated => "folder-created",
            Notice::FolderRenamed => "folder-renamed",
            Notice::FolderMoved => "folder-moved",
            Notice::FolderDeleted => "folder-deleted",
            Notice::Uploaded => "uploaded",
            Notice::DetailsSaved => "details-saved",
            Notice::AssetMoved => "asset-moved",
            Notice::FileRemoved => "file-removed",
            Notice::AssetDeleted => "asset-deleted",
            Notice::ReviewSimulated => "review-simulated",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Notice::FolderCreated => "Folder created.",
            Notice::FolderRenamed => "Folder renamed.",
            Notice::FolderMoved => "Folder moved.",
            Notice::FolderDeleted => "Folder deleted.",
            Notice::Uploaded => "Uploaded privately. The image appears once it has been checked.",
            Notice::DetailsSaved => "Details saved.",
            Notice::AssetMoved => "Asset moved.",
            Notice::FileRemoved => {
                "File removed. The record, its details and moderation report remain."
            }
            Notice::AssetDeleted => "Asset deleted.",
            Notice::ReviewSimulated => {
                "A simulated reviewer blocked the image. It is no longer delivered."
            }
        }
    }

    pub fn parse(id: &str) -> Option<Notice> {
        Notice::ALL.into_iter().find(|notice| notice.id() == id)
    }
}

/// Fixed explanations for the error codes the library expects. Other codes get a generic
/// message and are logged.
pub fn explain(code: &ErrorCode) -> Option<&'static str> {
    Some(match code {
        ErrorCode::FolderNotEmpty => {
            "Only empty folders can be deleted. Move or delete its assets and subfolders first."
        }
        ErrorCode::FolderParentCycle => {
            "A folder cannot move inside itself or one of its subfolders."
        }
        ErrorCode::DuplicateFolderName => "A folder with that name already exists there.",
        ErrorCode::FolderNotFound => "That folder no longer exists.",
        ErrorCode::DuplicateExternalId => "Another asset already uses that catalogue ID.",
        ErrorCode::AssetNotFound => "That asset no longer exists.",
        _ => return None,
    })
}

pub const GENERIC_FAILURE: &str =
    "CalmLens could not complete the request. Nothing was changed. Please try again.";
pub const LIBRARY_UNAVAILABLE: &str =
    "CalmLens could not load the library. Nothing is shown until it can be checked. Please try again.";

/// Logs a failed CalmLens call to stderr with its code, status and request ID.
pub fn log_error(context: &str, error: &calmlens::Error) {
    eprintln!(
        "Calmlibrary: {context} failed: code={} status={} request_id={} message={:?}",
        error.code(),
        error
            .status()
            .map_or_else(|| "-".to_string(), |status| status.to_string()),
        error.request_id().unwrap_or("-"),
        error.message()
    );
}
