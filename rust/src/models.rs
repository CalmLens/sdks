//! Typed request options and response models.
//!
//! Rust fields are snake_case; the wire JSON is camelCase. Response models are
//! `#[non_exhaustive]` and keep fields this SDK version does not know in `extra`, and enums
//! keep values it does not know in an `Unknown` variant, so new API fields and values never
//! fail decoding. Only metadata values, event fact values and the options of transform types
//! this SDK does not know use JSON values.
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, fmt};

/// A field in an update: leave it unchanged, clear it, or set it.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Patch<T> {
    /// Leaves the field unchanged (omitted from the request).
    #[default]
    Missing,
    /// Clears the field (sent as `null`).
    Null,
    /// Replaces the field.
    Value(T),
}
impl<T> Patch<T> {
    /// Whether the field is left unchanged.
    pub fn is_missing(&self) -> bool {
        matches!(self, Self::Missing)
    }
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Patch<T> {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        Ok(Option::<T>::deserialize(deserializer)?.map_or(Self::Null, Self::Value))
    }
}
impl<T> From<T> for Patch<T> {
    fn from(value: T) -> Self {
        Self::Value(value)
    }
}

/// Reads a model's `extra` map: the fields `T` does not type.
#[cfg_attr(
    not(feature = "strict-contract"),
    allow(clippy::extra_unused_type_parameters)
)]
fn extra_fields<'de, T, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<HashMap<String, Value>, D::Error> {
    let extra = HashMap::<String, Value>::deserialize(deserializer)?;
    #[cfg(feature = "strict-contract")]
    for key in extra.keys() {
        let name = std::any::type_name::<T>()
            .rsplit("::")
            .next()
            .unwrap_or_default();
        strict::record(name, strict::Finding::Field(key.clone()));
    }
    Ok(extra)
}

/// Contract-test support, not part of the public API: records what decoding kept untyped, an
/// `extra` field or an `Unknown` enum value, so a fixture of a full model can check that every
/// field and value it holds has a typed home.
#[cfg(feature = "strict-contract")]
#[doc(hidden)]
pub mod strict {
    use std::cell::RefCell;

    /// What a model kept untyped.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum Finding {
        /// A wire field the model has no field for, kept in its `extra` map.
        Field(String),
        /// A wire value the enum has no variant for, kept as `Unknown`.
        Value(String),
    }

    thread_local! {
        static FINDINGS: RefCell<Option<Vec<(&'static str, Finding)>>> = const { RefCell::new(None) };
    }

    /// Starts recording on this thread, discarding anything recorded before.
    pub fn start() {
        FINDINGS.with(|findings| *findings.borrow_mut() = Some(Vec::new()));
    }

    /// Stops recording and returns each type with what it kept untyped since [`start`].
    pub fn finish() -> Vec<(&'static str, Finding)> {
        FINDINGS.with(|findings| findings.borrow_mut().take().unwrap_or_default())
    }

    pub(crate) fn record(model: &'static str, finding: Finding) {
        FINDINGS.with(|findings| {
            if let Some(findings) = findings.borrow_mut().as_mut() {
                findings.push((model, finding));
            }
        });
    }
}

macro_rules! string_enum {
    ($(#[$meta:meta])* $name:ident { $( $(#[$vmeta:meta])* $variant:ident = $value:literal ),* $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
        #[non_exhaustive]
        pub enum $name {
            $( $(#[$vmeta])* $variant, )*
            /// A value this SDK version does not know.
            Unknown(String),
        }
        impl $name {
            /// The wire value.
            pub fn as_str(&self) -> &str {
                match self {
                    $(Self::$variant => $value,)*
                    Self::Unknown(value) => value,
                }
            }
        }
        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                match value {
                    $($value => Self::$variant,)*
                    other => Self::Unknown(other.to_owned()),
                }
            }
        }
        impl Default for $name {
            /// An empty `Unknown` value, used only when the API omits a required field.
            fn default() -> Self {
                Self::Unknown(String::new())
            }
        }
        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self::from(value.as_str())
            }
        }
        impl PartialEq<&str> for $name {
            fn eq(&self, other: &&str) -> bool {
                self.as_str() == *other
            }
        }
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }
        impl Serialize for $name {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(self.as_str())
            }
        }
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let value = Self::from(String::deserialize(deserializer)?.as_str());
                #[cfg(feature = "strict-contract")]
                if let Self::Unknown(unknown) = &value {
                    strict::record(stringify!($name), strict::Finding::Value(unknown.clone()));
                }
                Ok(value)
            }
        }
    };
}

string_enum! {
    /// Where an asset is in the pipeline.
    AssetClassificationStatus {
        /// The content is still arriving, e.g. a multipart upload receiving parts.
        Pending = "pending",
        /// The content is being processed and classified.
        Processing = "processing",
        /// Processing finished.
        Completed = "completed",
        /// Processing failed; the asset can be retried.
        Failed = "failed",
    }
}

string_enum! {
    /// The moderation decision in force, which also decides delivery: `pending` until
    /// classification decides, then a reviewer's decision when there is one, else the policy's.
    AssetModerationStatus {
        /// Waiting for classification or review; not delivered.
        Pending = "pending",
        /// Delivered according to the asset's visibility.
        Allowed = "allowed",
        /// Delivered like `allowed`, but marked so your app can reduce its reach, such as
        /// keeping it out of recommendations, trending and notifications, ranking it lower or
        /// collapsing it.
        Limited = "limited",
        /// Delivered only through signed URLs or with an API key, like a private asset.
        AgeRestricted = "age-restricted",
        /// Not delivered; the content is kept.
        Blocked = "blocked",
        /// Not delivered, and the stored content is deleted.
        Purged = "purged",
    }
}

string_enum! {
    /// A reviewer's decision on an asset.
    AssetModerationDecision {
        /// Deliver the asset according to its visibility.
        Allowed = "allowed",
        /// Deliver the asset like `allowed`, marked so your app can reduce its reach.
        Limited = "limited",
        /// Deliver the asset only through signed URLs or with an API key.
        AgeRestricted = "age-restricted",
        /// Stop delivering the asset and keep its content.
        Blocked = "blocked",
        /// Stop delivering the asset and delete its stored content.
        Purged = "purged",
    }
}

string_enum! {
    /// Whether CalmLens holds an asset's content (source, preview and extracted text).
    AssetContentStatus {
        /// Held only until processing finishes.
        Temporary = "temporary",
        /// Retained.
        Stored = "stored",
        /// Deleted; [`AssetContent::removal_reason`] says why.
        Removed = "removed",
    }
}

string_enum! {
    /// Why an asset's content was removed.
    AssetContentRemovalReason {
        /// The moderation policy purged it.
        Policy = "policy",
        /// `keepContentAfterProcessing` was off, so it was removed after processing.
        Retention = "retention",
        /// Removed through the API or portal.
        Requested = "requested",
        /// Removed with its parent asset's content.
        ParentRemoved = "parent-removed",
        /// Disposed of after a safety hold.
        Disposed = "disposed",
    }
}

string_enum! {
    /// Whether the CDN serves an asset without a signed URL.
    Visibility {
        /// Served to anyone with the URL once its moderation status is `allowed`.
        Public = "public",
        /// Served only through signed URLs or with an API key.
        Private = "private",
    }
}

string_enum! {
    /// The kind of content an asset holds, detected from its MIME type.
    AssetType {
        /// An image.
        Image = "image",
        /// A video.
        Video = "video",
        /// An audio file.
        Audio = "audio",
        /// A plain-text document.
        PlaintextDocument = "plaintext-document",
        /// A document with text and embedded media, such as a PDF.
        MultimediaDocument = "multimedia-document",
        /// A captured website.
        Website = "website",
        /// Any other file.
        File = "file",
    }
}

string_enum! {
    /// What happens to content that crosses a moderation threshold.
    FlaggedContentAction {
        /// Take no action.
        Allow = "allow",
        /// Deliver normally, but mark the asset `limited` so your app can reduce its reach.
        Limit = "limit",
        /// Deliver only through signed URLs or with an API key, so your backend can limit it to
        /// adults.
        AgeRestrict = "age-restrict",
        /// Block delivery while keeping the content.
        Block = "block",
        /// Delete the content.
        Purge = "purge",
    }
}

string_enum! {
    /// Why an asset is under a safety hold.
    SafetyHoldReason {
        /// The content is suspected to be illegal.
        SuspectedIllegalContent = "suspected-illegal-content",
    }
}

string_enum! {
    /// Where extracted text is stored.
    ExtractedTextType {
        /// Inline, in [`ExtractedText::content`].
        String = "string",
        /// In a separate document, identified by [`ExtractedText::id`].
        Document = "document",
    }
}

string_enum! {
    /// Whether a moderation category or qualifier was assessed.
    EvaluationStatus {
        /// Fully assessed.
        Evaluated = "evaluated",
        /// Assessed from part of the content, e.g. some video frames.
        Partial = "partial",
        /// Not assessed; `reason` says why.
        NotEvaluated = "not-evaluated",
    }
}

string_enum! {
    /// Why a moderation category or qualifier was not assessed.
    NotEvaluatedReason {
        /// This kind of content cannot be assessed for it.
        NotSupported = "not-supported",
        /// Assessment was attempted but produced no usable result.
        Unavailable = "unavailable",
    }
}

string_enum! {
    /// How likely a category, qualifier or label applies.
    Likelihood {
        /// Very unlikely.
        VeryUnlikely = "very-unlikely",
        /// Unlikely.
        Unlikely = "unlikely",
        /// Possible.
        Possible = "possible",
        /// Likely.
        Likely = "likely",
        /// Very likely.
        VeryLikely = "very-likely",
    }
}

string_enum! {
    /// A moderation policy category, the key of [`AssetModeration::categories`].
    ClassificationCategory {
        /// Private personal information (Preview).
        PersonalInformation = "personal-information",
        /// Profanity.
        Profanity = "profanity",
        /// Sexual content.
        Sexual = "sexual",
        /// Violence.
        Violence = "violence",
        /// Self-harm.
        SelfHarm = "self-harm",
        /// Harassment and bullying.
        Harassment = "harassment",
        /// Hate and identity abuse.
        Hate = "hate",
        /// Criminal and dangerous activity.
        CriminalActivity = "criminal-activity",
    }
}

// The moderation qualifiers, generated from the shared registry.
include!("qualifiers.rs");

string_enum! {
    /// What a media segment's scores come from.
    MediaSegmentSource {
        /// A sampled video frame.
        Frame = "frame",
        /// Transcribed speech.
        Speech = "speech",
        /// Text read from a frame.
        FrameText = "frame-text",
        /// A video clip.
        Clip = "clip",
    }
}

string_enum! {
    /// An event type.
    EventType {
        /// `asset.uploaded`.
        AssetUploaded = "asset.uploaded",
        /// `asset.classified`.
        AssetClassified = "asset.classified",
        /// `asset.allowed`.
        AssetAllowed = "asset.allowed",
        /// `asset.limited`.
        AssetLimited = "asset.limited",
        /// `asset.age-restricted`.
        AssetAgeRestricted = "asset.age-restricted",
        /// `asset.blocked`.
        AssetBlocked = "asset.blocked",
        /// `asset.purged`.
        AssetPurged = "asset.purged",
        /// `asset.failed`.
        AssetFailed = "asset.failed",
        /// `asset.deleted`.
        AssetDeleted = "asset.deleted",
        /// `asset.content-removed`.
        AssetContentRemoved = "asset.content-removed",
        /// `asset.retried`.
        AssetRetried = "asset.retried",
        /// `asset.review-requested`.
        AssetReviewRequested = "asset.review-requested",
        /// `usage.limit-reached`.
        UsageLimitReached = "usage.limit-reached",
        /// `usage.spend-limit-reached`.
        UsageSpendLimitReached = "usage.spend-limit-reached",
        /// `upload-preset.daily-limit-reached`.
        UploadPresetDailyLimitReached = "upload-preset.daily-limit-reached",
        /// `project.member-joined`.
        ProjectMemberJoined = "project.member-joined",
        /// `project.member-removed`.
        ProjectMemberRemoved = "project.member-removed",
        /// `project.member-role-changed`.
        ProjectMemberRoleChanged = "project.member-role-changed",
        /// `project.invitation-sent`.
        ProjectInvitationSent = "project.invitation-sent",
        /// `api-key.created`.
        ApiKeyCreated = "api-key.created",
        /// `api-key.revoked`.
        ApiKeyRevoked = "api-key.revoked",
        /// `connector.failing`.
        ConnectorFailing = "connector.failing",
        /// `appeal.submitted`.
        AppealSubmitted = "appeal.submitted",
        /// `appeal.resolved`.
        AppealResolved = "appeal.resolved",
    }
}

string_enum! {
    /// An event's severity.
    EventSeverity {
        /// Informational.
        Low = "low",
        /// Needs attention.
        High = "high",
    }
}

string_enum! {
    /// The asset type a lens applies to.
    LensType {
        /// Images.
        Image = "image",
        /// Videos.
        Video = "video",
        /// Audio.
        Audio = "audio",
        /// Documents.
        Document = "document",
        /// Websites.
        Website = "website",
    }
}

string_enum! {
    /// How asset search matches the query.
    SearchMode {
        /// Keyword and semantic matching combined (the default).
        Hybrid = "hybrid",
        /// Keyword matching only.
        Keyword = "keyword",
        /// Semantic matching only.
        Semantic = "semantic",
    }
}

string_enum! {
    /// Whether semantic search is available for the project.
    SemanticStatus {
        /// Semantic search is turned off.
        Disabled = "disabled",
        /// The semantic index is ready.
        Ready = "ready",
        /// The semantic index is still being built.
        Indexing = "indexing",
        /// Semantic search could not run this time.
        Unavailable = "unavailable",
    }
}

string_enum! {
    /// A field a search result matched on.
    SearchMatchField {
        /// The name.
        Name = "name",
        /// The asset ID.
        Id = "id",
        /// Your ID for the asset.
        ExternalId = "externalId",
        /// The description.
        Description = "description",
        /// The tags.
        Tags = "tags",
        /// The asset type.
        Type = "type",
        /// The content format.
        ContentFormat = "content.format",
        /// The content's file extension.
        ContentExtension = "content.extension",
        /// The moderation status.
        ModerationStatus = "classification.moderation.status",
        /// The visual content.
        Visual = "visual",
        /// The audio transcript.
        Transcript = "transcript",
    }
}

string_enum! {
    /// A sort direction.
    SortDirection {
        /// Ascending.
        Asc = "ASC",
        /// Descending.
        Desc = "DESC",
    }
}

string_enum! {
    /// Which CDN resource of an asset to serve or sign.
    CdnResource {
        /// The asset's original file. It takes no lens or transform.
        Original = "original",
        /// The asset rendered through a lens or transform, or its default rendition (the default).
        Rendered = "rendered",
        /// A small blurred PNG, public for public assets whatever their moderation status. Only
        /// for CDN URLs, without a lens, transform or `age_confirmed`.
        Placeholder = "placeholder",
    }
}

string_enum! {
    /// Which CDN resource of an asset a signed URL serves. Placeholders need no signature.
    SignedUrlResource {
        /// The asset's original file. It takes no lens or transform.
        Original = "original",
        /// The asset rendered through a lens or transform, or its default rendition (the default).
        Rendered = "rendered",
    }
}

/// What happens to flagged content for one asset, overriding the project's moderation action.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlaggedContentPolicy {
    /// The action.
    pub action: FlaggedContentAction,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<FlaggedContentPolicy, _>")]
    pub extra: HashMap<String, Value>,
}
impl FlaggedContentPolicy {
    /// A policy applying `action`.
    pub fn new(action: FlaggedContentAction) -> Self {
        Self {
            action,
            extra: HashMap::new(),
        }
    }
}

/// Processing options for an asset.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingOptions {
    /// Keep the stored content after classification.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_content_after_processing: Option<bool>,
    /// Overrides the project's moderation action for this asset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flagged_content_policy: Option<FlaggedContentPolicy>,
    /// Optional analyses to run, keyed by feature. Every feature is off unless enabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub features: Option<ProcessingFeatures>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<ProcessingOptions, _>")]
    pub extra: HashMap<String, Value>,
}

/// Optional analyses to run on an asset, keyed by feature. The API rejects unknown features.
/// Results of person and face detection are in [`AssetClassification::face_detection`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingFeatures {
    /// Extract image text into a child asset and classify it as text. Applies to images,
    /// including those extracted from documents and websites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ocr: Option<FeatureOptions>,
    /// Beta. Locate people in images, including people whose faces are not visible. Results
    /// are informational and never change the moderation decision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub person_detection: Option<FeatureOptions>,
    /// Beta. Locate faces in images and optionally estimate an age range for each. Faces are
    /// not identified. Results are informational and never change the moderation decision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub face_detection: Option<FaceDetectionOptions>,
    /// Beta. Find links in image text and QR codes. Results are informational and never change
    /// the moderation decision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_detection: Option<FeatureOptions>,
    /// Beta. Read provenance metadata, such as C2PA, that marks an image as AI-generated or
    /// AI-edited. Results are informational and never change the moderation decision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai_generated_detection: Option<FeatureOptions>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<ProcessingFeatures, _>")]
    pub extra: HashMap<String, Value>,
}

/// Options for a feature that only needs turning on.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureOptions {
    /// Whether to run the feature.
    pub enabled: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<FeatureOptions, _>")]
    pub extra: HashMap<String, Value>,
}
impl FeatureOptions {
    /// Options that turn the feature on.
    pub fn enabled() -> Self {
        Self {
            enabled: true,
            ..Self::default()
        }
    }
}

/// Face detection options.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceDetectionOptions {
    /// Whether to run face detection.
    pub enabled: bool,
    /// Also estimate an age range for each face. Defaults to `false`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub age_estimation: Option<bool>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<FaceDetectionOptions, _>")]
    pub extra: HashMap<String, Value>,
}
impl FaceDetectionOptions {
    /// Options that turn face detection on, without age estimation.
    pub fn enabled() -> Self {
        Self {
            enabled: true,
            ..Self::default()
        }
    }
}

/// The bytes of an upload or multipart part.
///
/// `Text` and `Bytes` are sent as they are and can be retried. `Reader`, `Stream` and
/// `UnsizedStream` are read once while the request is sent, so the whole file never needs to be
/// in memory; the SDK does not retry them. `Reader` and `Stream` need the exact `size`.
#[non_exhaustive]
pub enum Payload {
    /// UTF-8 text.
    Text(String),
    /// Bytes. Cloning [`Bytes`] does not copy them.
    Bytes(Bytes),
    /// Base64 bytes, optionally as a `data:` URL. Split multipart files before encoding parts.
    Base64(String),
    /// A blocking reader with its exact length, read on Tokio's blocking thread pool.
    #[cfg(feature = "async")]
    Reader {
        /// The source, e.g. a [`std::fs::File`].
        reader: Box<dyn std::io::Read + Send + 'static>,
        /// The exact number of bytes the reader yields.
        size: u64,
    },
    /// An async byte stream with its exact length.
    #[cfg(feature = "async")]
    Stream {
        /// The chunks.
        stream: crate::ByteStream,
        /// The exact total number of bytes.
        size: u64,
    },
    /// An async byte stream whose length is not known in advance. It is sent with chunked
    /// transfer encoding and no `sizeInBytes`, unless the content declares `size_in_bytes`.
    #[cfg(feature = "async")]
    UnsizedStream(crate::ByteStream),
}
impl Default for Payload {
    fn default() -> Self {
        Self::Bytes(Bytes::new())
    }
}
impl fmt::Debug for Payload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Text(text) => f.debug_struct("Text").field("len", &text.len()).finish(),
            Self::Bytes(bytes) => f.debug_struct("Bytes").field("len", &bytes.len()).finish(),
            Self::Base64(text) => f.debug_struct("Base64").field("len", &text.len()).finish(),
            #[cfg(feature = "async")]
            Self::Reader { size, .. } => f.debug_struct("Reader").field("size", size).finish(),
            #[cfg(feature = "async")]
            Self::Stream { size, .. } => f.debug_struct("Stream").field("size", size).finish(),
            #[cfg(feature = "async")]
            Self::UnsizedStream(_) => f.debug_struct("UnsizedStream").finish_non_exhaustive(),
        }
    }
}

/// Upload content (`content`) or a multipart part (`part`): a concrete MIME type and the bytes.
#[derive(Debug, Default)]
pub struct Content {
    /// The file's MIME type, such as `image/png` (`type` on the wire). A multipart part sent
    /// with [`AssetsClient::upload_part`](crate::AssetsClient::upload_part) may leave it empty.
    pub mime_type: String,
    /// The bytes.
    pub payload: Payload,
    /// Optional declared byte length. Uploads reject a value that differs from the payload size.
    pub size_in_bytes: Option<u64>,
    /// The multipart part number, starting at 1. Only for parts.
    pub part_number: Option<u32>,
    /// Whether this is the last multipart part. Only for parts.
    pub is_final: Option<bool>,
}

impl Content {
    /// `text/plain` content.
    pub fn text(text: impl Into<String>) -> Self {
        Self::new(Payload::Text(text.into()), "text/plain")
    }
    /// Binary content. Pass a `Vec<u8>`, `Bytes` or `&'static [u8]` to avoid a copy.
    pub fn bytes(bytes: impl Into<Bytes>, mime_type: impl Into<String>) -> Self {
        Self::new(Payload::Bytes(bytes.into()), mime_type)
    }
    /// Content read from `reader`, which yields exactly `size` bytes, while it is uploaded.
    #[cfg(feature = "async")]
    pub fn reader(
        reader: impl std::io::Read + Send + 'static,
        size: u64,
        mime_type: impl Into<String>,
    ) -> Self {
        Self::new(
            Payload::Reader {
                reader: Box::new(reader),
                size,
            },
            mime_type,
        )
    }
    /// Content streamed from `stream`, which yields exactly `size` bytes, while it is uploaded.
    #[cfg(feature = "async")]
    pub fn stream<S, E>(stream: S, size: u64, mime_type: impl Into<String>) -> Self
    where
        S: futures_util::Stream<Item = std::result::Result<Bytes, E>> + Send + 'static,
        E: Into<Box<dyn std::error::Error + Send + Sync>> + 'static,
    {
        use futures_util::TryStreamExt;
        Self::new(
            Payload::Stream {
                stream: Box::pin(stream.map_err(Into::into)),
                size,
            },
            mime_type,
        )
    }
    /// Content streamed from `stream`, whose length is not known in advance, while it is
    /// uploaded. Set [`size_in_bytes`](Self::size_in_bytes) when you know it.
    #[cfg(feature = "async")]
    pub fn unsized_stream<S, E>(stream: S, mime_type: impl Into<String>) -> Self
    where
        S: futures_util::Stream<Item = std::result::Result<Bytes, E>> + Send + 'static,
        E: Into<Box<dyn std::error::Error + Send + Sync>> + 'static,
    {
        use futures_util::TryStreamExt;
        Self::new(
            Payload::UnsizedStream(Box::pin(stream.map_err(Into::into))),
            mime_type,
        )
    }
    /// Streams the file at `path` without reading it into memory.
    #[cfg(feature = "async")]
    pub fn file(
        path: impl AsRef<std::path::Path>,
        mime_type: impl Into<String>,
    ) -> std::io::Result<Self> {
        let file = std::fs::File::open(path)?;
        let size = file.metadata()?.len();
        Ok(Self::reader(file, size, mime_type))
    }
    fn new(payload: Payload, mime_type: impl Into<String>) -> Self {
        Self {
            mime_type: mime_type.into(),
            payload,
            size_in_bytes: None,
            part_number: None,
            is_final: None,
        }
    }
    /// Marks the content as multipart part `part_number`, the last part when `is_final`.
    pub fn part(mut self, part_number: u32, is_final: bool) -> Self {
        self.part_number = Some(part_number);
        self.is_final = Some(is_final);
        self
    }
}

/// Reads the JSON request shape `{type, plainText | base64 | bytes, partNumber?, isFinal?}`.
impl<'de> Deserialize<'de> for Content {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Wire {
            #[serde(default, rename = "type")]
            mime_type: String,
            plain_text: Option<String>,
            base64: Option<String>,
            bytes: Option<Vec<u8>>,
            size_in_bytes: Option<u64>,
            part_number: Option<u32>,
            is_final: Option<bool>,
        }
        use serde::de::Error;
        let wire = Wire::deserialize(deserializer)?;
        let payload = match (wire.plain_text, wire.base64, wire.bytes) {
            (Some(text), None, None) => Payload::Text(text),
            (None, Some(base64), None) => Payload::Base64(base64),
            (None, None, Some(bytes)) => Payload::Bytes(bytes.into()),
            _ => {
                return Err(D::Error::custom(
                    "Supply exactly one payload representation",
                ))
            }
        };
        if let (Some(size), Payload::Text(_) | Payload::Bytes(_)) = (wire.size_in_bytes, &payload) {
            let length = match &payload {
                Payload::Text(text) => text.len(),
                Payload::Bytes(bytes) => bytes.len(),
                _ => 0,
            };
            if size != length as u64 {
                return Err(D::Error::custom(
                    "sizeInBytes must match the payload byte length",
                ));
            }
        }
        Ok(Self {
            mime_type: wire.mime_type,
            payload,
            size_in_bytes: wire.size_in_bytes,
            part_number: wire.part_number,
            is_final: wire.is_final,
        })
    }
}

/// Options for [`AssetsClient::create`](crate::AssetsClient::create) and
/// [`classify`](crate::AssetsClient::classify). Supply exactly one of `content`, `part` (the
/// first part of a multipart upload) or `url`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitAsset {
    /// The asset name, such as a file name.
    pub name: String,
    /// The whole file.
    #[serde(default)]
    pub content: Option<Content>,
    /// The first part of a multipart upload; continue with `upload_part`.
    #[serde(default)]
    pub part: Option<Content>,
    /// A URL CalmLens downloads the file from.
    #[serde(default)]
    pub url: Option<String>,
    /// A description.
    #[serde(default)]
    pub description: Option<String>,
    /// Processing options.
    #[serde(default)]
    pub processing_options: Option<ProcessingOptions>,
    /// CDN visibility.
    #[serde(default)]
    pub visibility: Option<Visibility>,
    /// Metadata items.
    #[serde(default)]
    pub metadata: Option<Vec<MetadataItem>>,
    /// Your identifier for who wrote the content. CalmLens only compares it with the author IDs
    /// in `context`, to tell which posts share a speaker.
    #[serde(default)]
    pub author_id: Option<String>,
    /// Earlier posts in the conversation, oldest first. The SDK sends only the posts CalmLens
    /// uses; see [`select_moderation_context_items`].
    #[serde(default)]
    pub context: Option<ModerationContext>,
    /// Your ID for the asset, unique within the project.
    #[serde(default)]
    pub external_id: Option<String>,
    /// A link to the asset in your system.
    #[serde(default)]
    pub external_url: Option<String>,
    /// The folder to put the asset in.
    #[serde(default)]
    pub folder_id: Patch<String>,
    /// The upload preset to apply: its folder, visibility, file types and size limit.
    #[serde(default)]
    pub upload_preset_id: Option<String>,
    /// For a multipart upload, the size of the whole file; CalmLens then refuses an upload
    /// that could never finish, and parts that overshoot or fall short.
    #[serde(default)]
    pub total_size_in_bytes: Option<u64>,
    /// The `Idempotency-Key` for this upload. The SDK generates one when it is `None`.
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

impl SubmitAsset {
    /// Text named `text`.
    pub fn text(text: impl Into<String>) -> Self {
        Self::new("text", Content::text(text))
    }
    /// An asset named `name` with `content`.
    pub fn new(name: impl Into<String>, content: Content) -> Self {
        Self {
            name: name.into(),
            content: Some(content),
            ..Self::default()
        }
    }
    /// An asset CalmLens downloads from `url`.
    pub fn from_url(name: impl Into<String>, url: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            url: Some(url.into()),
            ..Self::default()
        }
    }
    /// The first part of a multipart upload of the file `name`.
    pub fn multipart(name: impl Into<String>, part: Content) -> Self {
        Self {
            name: name.into(),
            part: Some(part),
            ..Self::default()
        }
    }
}

/// The most recent earlier posts CalmLens uses.
pub const MODERATION_CONTEXT_USED_ITEMS: usize = 5;
/// The most characters (Unicode code points) of earlier posts CalmLens uses. The newest post
/// always fits, since no post may be longer.
pub const MODERATION_CONTEXT_USED_CHARACTERS: usize = 2_000;

/// Earlier posts in a conversation, oldest first, that CalmLens reads to understand the content
/// it moderates.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationContext {
    /// The posts, oldest first.
    pub items: Vec<ModerationContextItem>,
}
impl ModerationContext {
    /// Context of `items`, oldest first.
    pub fn new(items: impl IntoIterator<Item = ModerationContextItem>) -> Self {
        Self {
            items: items.into_iter().collect(),
        }
    }
}

/// An earlier post in the conversation.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationContextItem {
    /// The post's text.
    pub text: String,
    /// Your identifier for who wrote the post.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_id: Option<String>,
}
impl ModerationContextItem {
    /// A post with `text` and no author.
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            author_id: None,
        }
    }
    /// Sets who wrote the post.
    pub fn author_id(mut self, author_id: impl Into<String>) -> Self {
        self.author_id = Some(author_id.into());
        self
    }
}

/// The earlier posts CalmLens uses: the most recent ones, newest first, while at most
/// [`MODERATION_CONTEXT_USED_ITEMS`] posts and [`MODERATION_CONTEXT_USED_CHARACTERS`]
/// characters allow, returned oldest first. Characters are Unicode code points. The newest post
/// is always kept, so an over-long one is left for the API to reject.
pub fn select_moderation_context_items(
    items: &[ModerationContextItem],
) -> Vec<ModerationContextItem> {
    let mut kept = 0;
    let mut characters = 0;
    for item in items.iter().rev() {
        if kept == MODERATION_CONTEXT_USED_ITEMS {
            break;
        }
        let length = item.text.chars().count();
        if kept > 0 && characters + length > MODERATION_CONTEXT_USED_CHARACTERS {
            break;
        }
        kept += 1;
        characters += length;
    }
    items[items.len() - kept..].to_vec()
}

/// A metadata item.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataItem {
    /// The metadata field ID.
    pub id: String,
    /// The value.
    pub value: Value,
}
impl MetadataItem {
    /// A metadata item.
    pub fn new(id: impl Into<String>, value: impl Into<Value>) -> Self {
        Self {
            id: id.into(),
            value: value.into(),
        }
    }
}

/// Identifies an asset.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetId {
    /// The asset ID.
    pub asset_id: String,
}
impl AssetId {
    /// Identifies asset `asset_id`.
    pub fn new(asset_id: impl Into<String>) -> Self {
        Self {
            asset_id: asset_id.into(),
        }
    }
}

/// Options for [`AssetsClient::wait_for_decision`](crate::AssetsClient::wait_for_decision).
#[derive(Debug, Clone, Default)]
pub struct WaitForDecision {
    /// The asset ID.
    pub asset_id: String,
    /// How long to wait for a decision; 60 seconds when `None`.
    pub timeout: Option<std::time::Duration>,
}
impl WaitForDecision {
    /// Waits for asset `asset_id` with the default 60-second timeout.
    pub fn new(asset_id: impl Into<String>) -> Self {
        Self {
            asset_id: asset_id.into(),
            timeout: None,
        }
    }
    /// Sets how long to wait for a decision.
    pub fn timeout(mut self, timeout: std::time::Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }
}

/// Identifies a folder.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderId {
    /// The folder ID.
    pub folder_id: String,
}
impl FolderId {
    /// Identifies folder `folder_id`.
    pub fn new(folder_id: impl Into<String>) -> Self {
        Self {
            folder_id: folder_id.into(),
        }
    }
}

/// A sort order.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    /// The field, e.g. `createdAt`.
    pub field: String,
    /// The direction.
    pub direction: SortDirection,
}

/// Options for listing assets.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAssets {
    /// The cursor returned by the previous page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Items per page, 1 to 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// A filter such as `classification.moderation.status==allowed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    /// Sort orders.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ordering: Option<Vec<Order>>,
    /// Lists only the assets directly in this folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
}

/// Options for listing an asset's children.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListChildren {
    /// The parent asset ID.
    pub asset_id: String,
    /// The cursor returned by the previous page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Items per page, 1 to 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// A filter such as `classification.moderation.status==allowed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    /// Sort orders.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ordering: Option<Vec<Order>>,
}

/// Changes to an asset. [`Patch::Missing`] fields are left unchanged.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAsset {
    /// The asset ID.
    #[serde(skip_serializing)]
    pub asset_id: String,
    /// The name.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub name: Patch<String>,
    /// The description.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub description: Patch<String>,
    /// The tags.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub tags: Patch<Vec<String>>,
    /// The metadata items.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub metadata: Patch<Vec<MetadataItem>>,
    /// The folder.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub folder_id: Patch<String>,
    /// Your ID for the asset.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub external_id: Patch<String>,
    /// A link to the asset in your system.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub external_url: Patch<String>,
    /// CDN visibility.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub visibility: Patch<Visibility>,
    /// Processing options.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub processing_options: Patch<ProcessingOptions>,
}

/// Options for [`AssetsClient::explain`](crate::AssetsClient::explain).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainAsset {
    /// The asset ID.
    #[serde(skip_serializing)]
    pub asset_id: String,
    /// Moderates the asset again with the project's current policy instead of explaining the
    /// decision as made.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub rerun: bool,
}

/// Moves an asset to a folder, or to the project root with `folder_id: None`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveAsset {
    /// The asset ID.
    #[serde(skip_serializing)]
    pub asset_id: String,
    /// The destination folder.
    pub folder_id: Option<String>,
}

/// What [`crate::AssetsClient::batch`] does to every asset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetBatchOperation {
    /// Deletes each asset with its child assets and stored content.
    Delete,
    /// Removes each asset's stored content and keeps the record, metadata and report.
    RemoveContent,
}
impl AssetBatchOperation {
    /// The wire value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Delete => "delete",
            Self::RemoveContent => "remove-content",
        }
    }
}
impl fmt::Display for AssetBatchOperation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Deletes up to 500 assets, or removes their stored content, in one request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAssets {
    /// IDs of 1 to 500 assets in the project.
    pub asset_ids: Vec<String>,
    /// What to do to every asset.
    pub operation: AssetBatchOperation,
}

/// The response of [`crate::AssetsClient::batch`]: the operation is queued.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct BatchAssetsResponse {
    /// Always `true`: the operation is queued.
    pub queued: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<BatchAssetsResponse, _>")]
    pub extra: HashMap<String, Value>,
}

/// A later part of a multipart upload.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadPart {
    /// The asset returned when the upload started.
    pub asset_id: String,
    /// The part, with `part_number` set.
    pub part: Content,
    /// Overrides the `queue` choice saved when the upload started, for the final part.
    #[serde(default)]
    pub queue: Option<bool>,
    /// The `Idempotency-Key` for this part. The SDK generates one when it is `None`.
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

/// Options for a signed asset URL.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedUrlOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Optional customer assertions for this CDN request.
    pub viewer_claims: Option<ViewerClaims>,
    /// The asset ID.
    #[serde(skip_serializing)]
    pub asset_id: String,
    /// `rendered` (the API's default) or `original`, which takes no lens or transform.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<SignedUrlResource>,
    /// A lens identifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lens: Option<String>,
    /// A transform: a selector string or structured steps, sent as a selector string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<CdnTransform>,
    /// Lifetime in seconds; defaults to 900.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_in_seconds: Option<u64>,
}

/// Options for creating a folder.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolder {
    /// The name, unique among folders with the same parent.
    pub name: String,
    /// The parent folder, or the project root when missing or null.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub parent_id: Patch<String>,
}

/// Changes to a folder.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFolder {
    /// The folder ID.
    #[serde(skip_serializing)]
    pub folder_id: String,
    /// The new name.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub name: Patch<String>,
}

/// Moves a folder under another, or to the project root with `parent_id: None`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveFolder {
    /// The folder ID.
    #[serde(skip_serializing)]
    pub folder_id: String,
    /// The new parent.
    pub parent_id: Option<String>,
}

/// Options for one page of the events feed.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListEvents {
    /// The cursor from a previous page. Without it, the feed starts from now.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
    /// The page size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

/// A named lens definition.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LensDefinition {
    /// The lens identifier used in CDN URLs as `@identifier`.
    pub identifier: String,
    /// The display name.
    pub name: String,
    /// A description.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub description: Patch<String>,
    /// The asset type the lens applies to.
    #[serde(rename = "type")]
    pub lens_type: LensType,
    /// Whether the lens is active.
    pub active: bool,
    /// The definition version; bump it to change an existing lens.
    pub version: u32,
    /// The transforms.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub transforms: Patch<Vec<Transform>>,
}

/// Options for [`ServerClient::ensure_lenses`](crate::ServerClient::ensure_lenses).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureLenses {
    /// The lenses, returned in the same order.
    pub lenses: Vec<LensDefinition>,
}

/// A CDN request for an asset's rendered, original or placeholder resource.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdnRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Optional customer assertions for this CDN request.
    pub viewer_claims: Option<ViewerClaims>,
    /// The asset ID or external ID.
    pub asset_identifier: String,
    /// `rendered` (default), `original` or `placeholder`. Only `rendered` takes a lens or transform.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<CdnResource>,
    /// A lens identifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lens: Option<String>,
    /// A transform: a selector such as `width=320` or structured steps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<CdnTransform>,
    /// The HTTP method and headers, e.g. `HEAD` or a `Range` header.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub init: Option<HttpOptions>,
}

/// HTTP method and headers for a CDN request. The SDK always sends its own API key.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpOptions {
    /// The method; defaults to `GET`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// Extra request headers.
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

/// An asset.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Asset {
    /// Effective action and age assurance for the requested viewer country.

    /// The asset ID.
    pub id: String,
    /// The owning project.
    #[serde(default)]
    pub project_id: Option<String>,
    /// The user who created the asset.
    #[serde(default)]
    pub user_id: Option<String>,
    /// The parent asset, for child assets CalmLens extracts during processing.
    #[serde(default)]
    pub parent_id: Option<String>,
    /// The folder, or `None` at the project root.
    #[serde(default)]
    pub folder_id: Option<String>,
    /// The upload preset the asset was uploaded through.
    #[serde(default)]
    pub upload_preset_id: Option<String>,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub created_at: Option<u64>,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// The asset type (`type` on the wire).
    #[serde(default, rename = "type")]
    pub asset_type: Option<AssetType>,
    /// The name.
    #[serde(default)]
    pub name: Option<String>,
    /// The description.
    #[serde(default)]
    pub description: Option<String>,
    /// Your ID for the asset.
    #[serde(default)]
    pub external_id: Option<String>,
    /// A link to the asset in your system.
    #[serde(default)]
    pub external_url: Option<String>,
    /// Metadata items.
    #[serde(default)]
    pub metadata: Option<Vec<MetadataItem>>,
    /// Your identifier for who wrote the content.
    #[serde(default)]
    pub author_id: Option<String>,
    /// The earlier posts CalmLens used, oldest first; `None` once the content is removed.
    #[serde(default)]
    pub context: Option<ModerationContext>,
    /// Tags.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// Processing options.
    #[serde(default)]
    pub processing_options: Option<ProcessingOptions>,
    /// CDN visibility.
    #[serde(default)]
    pub visibility: Option<Visibility>,
    /// Where the asset is in the pipeline.
    #[serde(default)]
    pub upload: AssetUpload,
    /// Classification progress, the moderation status and report.
    #[serde(default)]
    pub classification: AssetClassification,
    /// Whether CalmLens holds the content, and its details.
    #[serde(default)]
    pub content: AssetContent,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<Asset, _>")]
    pub extra: HashMap<String, Value>,
}
impl Asset {
    /// An asset with `id`, classification status `processing` and moderation status `moderation`,
    /// e.g. for a mock response.
    pub fn new(
        id: impl Into<String>,
        processing: AssetClassificationStatus,
        moderation: AssetModerationStatus,
    ) -> Self {
        Self {
            id: id.into(),
            upload: AssetUpload {
                status: "completed".into(),
                ..AssetUpload::default()
            },
            classification: AssetClassification {
                status: processing,
                moderation: AssetModeration {
                    status: moderation,
                    ..AssetModeration::default()
                },
                ..AssetClassification::default()
            },
            ..Self::default()
        }
    }
    /// Whether moderation has finished: the moderation status is no longer `pending`, or
    /// processing failed.
    pub fn is_decided(&self) -> bool {
        self.classification.moderation.status != AssetModerationStatus::Pending
            || self.classification.status == AssetClassificationStatus::Failed
    }
}

/// Source upload progress.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetUpload {
    /// Classification or upload progress.
    #[serde(default)]
    pub status: String,
    /// When the state last changed, in milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// Number of multipart parts received; absent for other uploads.
    #[serde(default)]
    pub parts_received: Option<u32>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetUpload, _>")]
    pub extra: HashMap<String, Value>,
}

/// Classification progress and capability results.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetClassification {
    /// Classification or upload progress.
    #[serde(default)]
    pub status: AssetClassificationStatus,
    /// When the state last changed, in milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// When classification completed, in milliseconds since the Unix epoch.
    #[serde(default)]
    pub completed_at: Option<u64>,
    /// Content-safety findings and the decision in force.
    #[serde(default)]
    pub moderation: AssetModeration,
    /// Person detections when requested.
    #[serde(default)]
    pub person_detection: Option<PersonDetectionResult>,
    /// Face detections when requested.
    #[serde(default)]
    pub face_detection: Option<FaceDetectionResult>,
    /// Links and QR codes found when requested.
    #[serde(default)]
    pub link_detection: Option<LinkDetectionResult>,
    /// AI-generation provenance when requested.
    #[serde(default)]
    pub ai_generated_detection: Option<AiGeneratedDetectionResult>,
    /// Text regions found in the image, which image transforms can redact.
    #[serde(default)]
    pub text_regions: Option<Vec<TextRegion>>,
    /// Detected content labels.
    #[serde(default)]
    pub labels: Option<Vec<ClassificationLabel>>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetClassification, _>")]
    pub extra: HashMap<String, Value>,
}

/// One reviewer decision in an asset's review history.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetReview {
    /// Unique identifier for this review.
    pub id: String,
    /// The reviewer’s decision.
    pub decision: AssetModerationDecision,
    /// The reviewer’s explanation; required for an override.
    pub note: Option<String>,
    /// The reviewing user, or none for an API key.
    pub reviewer_user_id: Option<String>,
    /// The reviewing user's name, when known.
    #[serde(default)]
    pub reviewer_name: Option<String>,
    /// The reviewing user's email address, when known.
    #[serde(default)]
    pub reviewer_email: Option<String>,
    /// Review time in milliseconds since the Unix epoch.
    pub reviewed_at: u64,
    /// Whether this review changed the asset's moderation status.
    pub applied_to_asset: bool,
}

/// Content-safety findings and decision.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetModeration {
    /// Category outcomes supplied by an authenticated test input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_category_actions: Option<HashMap<ClassificationCategory, String>>,
    /// Regional restrictions supplied by an authenticated test input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_regional_actions: Option<Vec<TestRegionalAction>>,
    /// Reviews in chronological order.
    #[serde(default)]
    pub manual_reviews: Vec<AssetReview>,
    /// The moderation decision in force, which also decides delivery, with reviewer decisions
    /// taking precedence.
    #[serde(default)]
    pub status: AssetModerationStatus,
    /// Content-safety category scores and qualifiers.
    #[serde(default)]
    pub categories: HashMap<ClassificationCategory, CategoryResult>,
    /// The highest category score.
    #[serde(default)]
    pub score: Option<f64>,
    /// Timed moderation evidence from audio or video.
    #[serde(default)]
    pub timeline: Option<MediaClassificationReport>,
    /// The saved policy assessment and settings snapshot.
    #[serde(default)]
    pub policy: Option<ReportPolicy>,
    /// Hash list entries the image matched.
    #[serde(default)]
    pub hash_matches: Option<Vec<HashMatch>>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetModeration, _>")]
    pub extra: HashMap<String, Value>,
}

/// A regional restriction supplied by an authenticated test input.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct TestRegionalAction {
    /// The jurisdiction receiving the restriction.
    pub region: String,
    /// The delivery restriction.
    pub action: String,
}

/// Whether CalmLens holds an asset's content, and the content's details.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetContent {
    /// Whether this is a synthetic back-office safety exercise asset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub safety_test: Option<bool>,
    /// `temporary` until processing finishes, `stored`, or `removed`.
    #[serde(default)]
    pub status: AssetContentStatus,
    /// Why the content was removed; `None` while it is held.
    #[serde(default)]
    pub removal_reason: Option<AssetContentRemovalReason>,
    /// When the content status last changed, in milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// A safety hold restricting access.
    #[serde(default)]
    pub safety_hold: Option<SafetyHold>,
    /// The MIME type.
    #[serde(default)]
    pub format: Option<String>,
    /// The file extension.
    #[serde(default)]
    pub extension: Option<String>,
    /// The uploaded size in bytes.
    #[serde(default)]
    pub size_in_bytes: Option<u64>,
    /// Digests of the uploaded content.
    #[serde(default)]
    pub checksums: Option<Checksums>,
    /// The picture served at the rendered resource, `None` when the asset has none.
    #[serde(default)]
    pub image: Option<AssetImage>,
    /// Text extracted from the content.
    #[serde(default)]
    pub extracted_text: Option<ExtractedText>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetContent, _>")]
    pub extra: HashMap<String, Value>,
}

/// Each assessed category's policy score and action, and the highest policy score.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ReportPolicy {
    /// The highest category policy score.
    #[serde(default)]
    pub score: f64,
    /// Policy results by category.
    #[serde(default)]
    pub categories: HashMap<ClassificationCategory, CategoryPolicyScore>,
    /// `decision` when questions that could not change any action were skipped (every action is
    /// final, but a category's policy score and the rule credited with its action can differ from a
    /// complete report); `full` when every question was answered. See
    /// [`AssetsClient::explain`](crate::AssetsClient::explain).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<String>,
    /// The final automatic asset decision.
    #[serde(default)]
    pub decision: Option<ReportPolicyDecision>,
}

/// How strongly a category meets the policy, from 0 to 1, and what the policy does with it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CategoryPolicyScore {
    /// The policy score.
    #[serde(default)]
    pub score: f64,
    /// `allow`, `limit`, `age-restrict`, `block` or `purge`.
    #[serde(default)]
    pub action: String,
    /// The rule that decided the category, or that its policy score stayed below 50%.
    #[serde(default)]
    pub source: Option<CategoryPolicySource>,
    /// Settings at decision time, independent of subsequent policy edits.
    #[serde(default)]
    pub settings: Option<CategoryPolicySettingsSnapshot>,
}

/// The rule that decided the outcome, or that the policy score stayed below 50%.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CategoryPolicySource {
    /// Saved kind.
    #[serde(default)]
    pub kind: String,
    /// Saved index.
    #[serde(default)]
    pub index: Option<usize>,
    /// Indexes of allowances contributing combined coverage.
    #[serde(default)]
    pub indexes: Option<Vec<usize>>,
}

/// A named rule in force when the asset was decided.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PolicyRuleSnapshot {
    /// Saved name.
    #[serde(default)]
    pub name: Option<String>,
    /// Saved when.
    #[serde(default)]
    pub when: Vec<String>,
    /// Fixed all tag: selected qualifiers apply to the same instance.
    #[serde(default)]
    pub r#match: Option<String>,
    /// Same-instance exclusions.
    #[serde(default)]
    pub unless: Option<Vec<String>>,
    /// Saved action.
    #[serde(default)]
    pub action: String,
}

/// Historical category settings for explaining the decision.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CategoryPolicySettingsSnapshot {
    /// Saved category action.
    #[serde(default)]
    pub category_action: String,
    /// Saved allowances.
    #[serde(default)]
    pub allowances: Vec<PolicyRuleSnapshot>,
    /// Saved restrictions.
    #[serde(default)]
    pub restrictions: Vec<PolicyRuleSnapshot>,
}

/// The final automatic action, its source and flagged categories.
/// A recorded regional decision.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct RegionalDecision {
    /// Viewer country or rule jurisdiction.
    pub region: String,
    /// Regional moderation action.
    pub action: String,
    /// Stable mandatory rule key.
    pub rule: String,
    /// Category matched by the rule; absent for explicit test regional outcomes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<ClassificationCategory>,
}

/// The automatic moderation decision and stricter regional outcomes.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ReportPolicyDecision {
    /// Mandatory rule responsible for the action, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
    /// Stricter outcomes in opted-in jurisdictions.
    #[serde(default)]
    pub regions: Vec<RegionalDecision>,
    /// Saved source, such as `policy`, `lens` or `hash-list`.
    #[serde(default)]
    pub source: String,
    /// Saved action.
    #[serde(default)]
    pub action: Option<String>,
    /// Saved flagged categories.
    #[serde(default)]
    pub flagged_categories: Vec<ClassificationCategory>,
}

/// One category's result.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CategoryResult {
    /// Whether the category was assessed.
    #[serde(default)]
    pub status: Option<EvaluationStatus>,
    /// The score from 0 to 1, unless `status` is `NotEvaluated`.
    #[serde(default)]
    pub score: Option<f64>,
    /// The likelihood, unless `status` is `NotEvaluated`.
    #[serde(default)]
    pub likelihood: Option<Likelihood>,
    /// Why the category was not assessed.
    #[serde(default)]
    pub reason: Option<NotEvaluatedReason>,
    /// Qualifier results.
    #[serde(default)]
    pub qualifiers: Option<HashMap<ModerationQualifier, QualifierResult>>,
    /// Direct condition evidence, keyed by opaque condition identifiers.
    #[serde(default)]
    pub policy_conditions: Option<HashMap<String, PolicyConditionResult>>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<CategoryResult, _>")]
    pub extra: HashMap<String, Value>,
}

/// Direct assessment of a same-instance or combined-coverage policy condition.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PolicyConditionResult {
    /// Whether the condition was assessed.
    #[serde(default)]
    pub status: Option<EvaluationStatus>,
    /// Assessed score, absent when unassessed.
    #[serde(default)]
    pub score: Option<f64>,
    /// Why the condition was not assessed.
    #[serde(default)]
    pub reason: Option<NotEvaluatedReason>,
}

/// A qualifier's result.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct QualifierResult {
    /// Confidence that the content is only this qualifier, from 0 to 1; never above `some_score`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all_score: Option<f64>,
    /// Whether the qualifier was assessed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<EvaluationStatus>,
    /// Confidence that some of the content is this qualifier, from 0 to 1, when evaluated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub some_score: Option<f64>,
    /// The likelihood, when evaluated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub likelihood: Option<Likelihood>,
    /// Why the qualifier was not assessed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<NotEvaluatedReason>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<QualifierResult, _>")]
    pub extra: HashMap<String, Value>,
}

string_enum! {
    /// Whether a feature produced a result.
    FeatureResultStatus {
        /// The feature ran; its results are present.
        Evaluated = "evaluated",
        /// The feature did not run; `reason` says why.
        NotEvaluated = "not-evaluated",
    }
}

string_enum! {
    /// How mature a feature is. Beta results may change shape.
    FeatureStage {
        /// Beta.
        Beta = "beta",
        /// Generally available.
        Ga = "ga",
    }
}

string_enum! {
    /// Why a requested feature did not run.
    FeatureNotEvaluatedReason {
        /// The feature does not apply to this asset, e.g. a text asset.
        NotSupported = "not-supported",
        /// The feature could not run this time.
        Unavailable = "unavailable",
    }
}

/// Results of the features requested in [`ProcessingOptions::features`], keyed by feature.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ProcessingFeatureResults {
    /// Person detection results.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub person_detection: Option<PersonDetectionResult>,
    /// Face detection results.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub face_detection: Option<FaceDetectionResult>,
    /// Fields this SDK version does not know.
    #[serde(
        flatten,
        deserialize_with = "extra_fields::<ProcessingFeatureResults, _>"
    )]
    pub extra: HashMap<String, Value>,
}

/// Person detection's result. `people` is present when `status` is `Evaluated`, and `reason`
/// when it is `NotEvaluated`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PersonDetectionResult {
    /// Whether the feature ran.
    #[serde(default)]
    pub status: Option<FeatureResultStatus>,
    /// The feature's stage.
    #[serde(default)]
    pub stage: Option<FeatureStage>,
    /// Why the feature did not run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<FeatureNotEvaluatedReason>,
    /// The people found.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub people: Option<Vec<DetectedPerson>>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<PersonDetectionResult, _>")]
    pub extra: HashMap<String, Value>,
}

/// Face detection's result. `faces` is present when `status` is `Evaluated`, and `reason`
/// when it is `NotEvaluated`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct FaceDetectionResult {
    /// Whether the feature ran.
    #[serde(default)]
    pub status: Option<FeatureResultStatus>,
    /// The feature's stage.
    #[serde(default)]
    pub stage: Option<FeatureStage>,
    /// Why the feature did not run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<FeatureNotEvaluatedReason>,
    /// The faces found.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub faces: Option<Vec<DetectedFace>>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<FaceDetectionResult, _>")]
    pub extra: HashMap<String, Value>,
}

/// Link detection's result. `qr_codes` and `links` are present when `status` is `Evaluated`,
/// and `reason` when it is `NotEvaluated`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct LinkDetectionResult {
    /// Whether the feature ran.
    #[serde(default)]
    pub status: Option<FeatureResultStatus>,
    /// The feature's stage.
    #[serde(default)]
    pub stage: Option<FeatureStage>,
    /// Why the feature did not run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<FeatureNotEvaluatedReason>,
    /// The QR codes found.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qr_codes: Option<Vec<DetectedQrCode>>,
    /// The links found in QR codes and text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<DetectedLink>>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<LinkDetectionResult, _>")]
    pub extra: HashMap<String, Value>,
}

/// A detected QR code.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DetectedQrCode {
    /// The decoded value.
    #[serde(default)]
    pub value: String,
    /// Where the QR code is (`box` on the wire).
    #[serde(default, rename = "box")]
    pub bounding_box: BoundingBox,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<DetectedQrCode, _>")]
    pub extra: HashMap<String, Value>,
}

string_enum! {
    /// Where a detected link was found.
    LinkSource {
        /// In a QR code.
        QrCode = "qr-code",
        /// In the image's text.
        Text = "text",
    }
}

/// A detected link.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DetectedLink {
    /// The URL.
    #[serde(default)]
    pub url: String,
    /// Where it was found.
    #[serde(default)]
    pub source: LinkSource,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<DetectedLink, _>")]
    pub extra: HashMap<String, Value>,
}

string_enum! {
    /// What provenance metadata says about how an image was made.
    AiProvenance {
        /// Generated by AI.
        AiGenerated = "ai-generated",
        /// Edited with AI.
        AiEdited = "ai-edited",
        /// No provenance metadata says either way.
        Undetermined = "unknown",
    }
}

string_enum! {
    /// The kind of provenance metadata a signal came from.
    AiSignalKind {
        /// A C2PA manifest.
        C2pa = "c2pa",
        /// An IPTC digital source type.
        IptcDigitalSourceType = "iptc-digital-source-type",
        /// Metadata naming a generator.
        GeneratorMetadata = "generator-metadata",
    }
}

/// AI-generation detection's result. `provenance` and `signals` are present when `status` is
/// `Evaluated`, and `reason` when it is `NotEvaluated`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AiGeneratedDetectionResult {
    /// Whether the feature ran.
    #[serde(default)]
    pub status: Option<FeatureResultStatus>,
    /// The feature's stage.
    #[serde(default)]
    pub stage: Option<FeatureStage>,
    /// Why the feature did not run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<FeatureNotEvaluatedReason>,
    /// What the metadata says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<AiProvenance>,
    /// The metadata found.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signals: Option<Vec<AiGeneratedSignal>>,
    /// Fields this SDK version does not know.
    #[serde(
        flatten,
        deserialize_with = "extra_fields::<AiGeneratedDetectionResult, _>"
    )]
    pub extra: HashMap<String, Value>,
}

/// One piece of provenance metadata.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AiGeneratedSignal {
    /// The kind of metadata.
    #[serde(default)]
    pub kind: AiSignalKind,
    /// Its value.
    #[serde(default)]
    pub value: String,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AiGeneratedSignal, _>")]
    pub extra: HashMap<String, Value>,
}

/// A region of text found in an image.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct TextRegion {
    /// Where the text is (`box` on the wire).
    #[serde(default, rename = "box")]
    pub bounding_box: BoundingBox,
    /// Whether the text holds personal information.
    #[serde(default)]
    pub personal_information: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<TextRegion, _>")]
    pub extra: HashMap<String, Value>,
}

/// A hash list entry an image matched.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HashMatch {
    /// Where the match came from: `hash-list`.
    #[serde(default)]
    pub source: String,
    /// The hash list.
    #[serde(default)]
    pub list_id: String,
    /// The matched entry.
    #[serde(default)]
    pub entry_id: String,
    /// The Hamming distance between the hashes; lower is closer.
    #[serde(default)]
    pub distance: f64,
    /// What the list does with matches.
    #[serde(default)]
    pub action: HashListAction,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<HashMatch, _>")]
    pub extra: HashMap<String, Value>,
}

/// A detected person.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DetectedPerson {
    /// Where the person is (`box` on the wire).
    #[serde(default, rename = "box")]
    pub bounding_box: BoundingBox,
    /// Detection confidence from 0 to 1.
    #[serde(default)]
    pub confidence: f64,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<DetectedPerson, _>")]
    pub extra: HashMap<String, Value>,
}

/// A detected face.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DetectedFace {
    /// Where the face is (`box` on the wire).
    #[serde(default, rename = "box")]
    pub bounding_box: BoundingBox,
    /// Detection confidence from 0 to 1.
    #[serde(default)]
    pub confidence: f64,
    /// The estimated age range, when age estimation was requested.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub age_range: Option<AgeRange>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<DetectedFace, _>")]
    pub extra: HashMap<String, Value>,
}

/// Position and size as fractions of the image width and height, from 0 to 1. `left` and
/// `top` can be slightly negative when the subject extends past the edge.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct BoundingBox {
    /// The left edge.
    #[serde(default)]
    pub left: f64,
    /// The top edge.
    #[serde(default)]
    pub top: f64,
    /// The width.
    #[serde(default)]
    pub width: f64,
    /// The height.
    #[serde(default)]
    pub height: f64,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<BoundingBox, _>")]
    pub extra: HashMap<String, Value>,
}

/// An estimated age range in years. Estimates can be off by several years.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AgeRange {
    /// The lowest estimated age.
    #[serde(default)]
    pub low: u32,
    /// The highest estimated age.
    #[serde(default)]
    pub high: u32,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AgeRange, _>")]
    pub extra: HashMap<String, Value>,
}

/// A classification label.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ClassificationLabel {
    /// The label.
    #[serde(default)]
    pub description: String,
    /// The score.
    #[serde(default)]
    pub score: f64,
    /// The topicality score.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topicality_score: Option<f64>,
    /// The likelihood.
    #[serde(default)]
    pub likelihood: Likelihood,
    /// A knowledge base ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub knowledge_base_id: Option<String>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<ClassificationLabel, _>")]
    pub extra: HashMap<String, Value>,
}

/// Audio and video moderation results.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct MediaClassificationReport {
    /// The media duration.
    #[serde(default)]
    pub duration_seconds: f64,
    /// The interval between sampled frames.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_interval_seconds: Option<f64>,
    /// The number of sampled frames.
    #[serde(default)]
    pub sampled_frames: u32,
    /// Whether the audio was transcribed.
    #[serde(default)]
    pub audio_transcribed: bool,
    /// Results by time segment.
    #[serde(default)]
    pub segments: Vec<MediaClassificationSegment>,
    /// Fields this SDK version does not know.
    #[serde(
        flatten,
        deserialize_with = "extra_fields::<MediaClassificationReport, _>"
    )]
    pub extra: HashMap<String, Value>,
}

/// A time segment's results.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct MediaClassificationSegment {
    /// What the scores come from.
    #[serde(default)]
    pub source: MediaSegmentSource,
    /// The segment start.
    #[serde(default)]
    pub start_seconds: f64,
    /// The segment end.
    #[serde(default)]
    pub end_seconds: f64,
    /// Results by category.
    #[serde(default)]
    pub categories: HashMap<ClassificationCategory, CategoryResult>,
    /// Fields this SDK version does not know.
    #[serde(
        flatten,
        deserialize_with = "extra_fields::<MediaClassificationSegment, _>"
    )]
    pub extra: HashMap<String, Value>,
}

/// A page of assets.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetPage {
    /// The assets on this page.
    #[serde(default)]
    pub items: Vec<Asset>,
    /// The cursor for the next page, or None.
    #[serde(default)]
    pub next_cursor: Option<String>,
    /// The page size.
    #[serde(default)]
    pub page_size: Option<u32>,
    /// Whether another page follows.
    #[serde(default)]
    pub has_more: Option<bool>,
    /// The sort orders applied.
    #[serde(default)]
    pub ordering: Option<Vec<Order>>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetPage, _>")]
    pub extra: HashMap<String, Value>,
}
impl AssetPage {
    /// A page of `items`, with `has_more`, e.g. for a mock response.
    pub fn new(items: Vec<Asset>, has_more: bool) -> Self {
        Self {
            items,
            has_more: Some(has_more),
            ..Self::default()
        }
    }
}

/// A folder.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Folder {
    /// The folder ID.
    pub id: String,
    /// The name.
    #[serde(default)]
    pub name: Option<String>,
    /// The parent folder, or `None` at the project root.
    #[serde(default)]
    pub parent_id: Option<String>,
    /// The owning project.
    #[serde(default)]
    pub project_id: Option<String>,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub created_at: Option<u64>,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<Folder, _>")]
    pub extra: HashMap<String, Value>,
}
impl Folder {
    /// A folder with `id`, `name` and `parent_id`, e.g. for a mock response.
    pub fn new(id: impl Into<String>, name: impl Into<String>, parent_id: Option<String>) -> Self {
        Self {
            id: id.into(),
            name: Some(name.into()),
            parent_id,
            ..Self::default()
        }
    }
}

/// An event fact registered for the event type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventFact {
    /// The registered fact key, e.g. `reviewer`.
    pub key: String,
    /// The value.
    pub value: Value,
    /// A link for the fact.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<EventFact, _>")]
    pub extra: HashMap<String, Value>,
}

/// An event from the events feed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Event {
    /// The event ID.
    pub id: String,
    /// The event type (`type` on the wire).
    #[serde(default, rename = "type")]
    pub event_type: Option<EventType>,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub created_at: Option<u64>,
    /// The owning project.
    #[serde(default)]
    pub project_id: Option<String>,
    /// The user the event concerns.
    #[serde(default)]
    pub user_id: Option<String>,
    /// The severity.
    #[serde(default)]
    pub severity: Option<EventSeverity>,
    /// The title.
    #[serde(default)]
    pub title: Option<String>,
    /// The description.
    #[serde(default)]
    pub description: Option<String>,
    /// The asset the event concerns.
    #[serde(default)]
    pub asset_id: Option<String>,
    /// Snapshot of the asset's state when the event was created. Retrieve the
    /// asset for its current state.
    #[serde(default)]
    pub asset: Option<EventAsset>,
    /// The event's facts.
    #[serde(default)]
    pub facts: Vec<EventFact>,
    /// Whether the event notifies.
    #[serde(default)]
    pub notify: Option<bool>,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub read_at: Option<u64>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<Event, _>")]
    pub extra: HashMap<String, Value>,
}
impl Event {
    /// An event with `id` and `event_type`, e.g. for a mock response.
    pub fn new(id: impl Into<String>, event_type: impl Into<EventType>) -> Self {
        Self {
            id: id.into(),
            event_type: Some(event_type.into()),
            ..Self::default()
        }
    }
}

/// The JSON body of a webhook delivery. Read it with [`crate::construct_webhook_event`], which
/// checks the fields' types first; [`json`](Self::json) returns the body as received,
/// including fields this SDK version does not model.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct WebhookEventPayload {
    /// The event ID; deduplicate deliveries with it.
    pub id: String,
    /// The event type (`type` on the wire).
    #[serde(rename = "type")]
    pub event_type: EventType,
    /// Milliseconds since the Unix epoch.
    pub created_at: u64,
    /// The owning project.
    pub project_id: String,
    /// The event fields.
    pub data: WebhookEventData,
    /// The body this payload was parsed from.
    #[serde(skip)]
    received: Option<Value>,
}
impl WebhookEventPayload {
    /// The delivery body CalmLens sends for `event`, e.g. to test a webhook handler.
    pub fn from_event(event: &Event) -> Self {
        Self {
            id: event.id.clone(),
            event_type: event.event_type.clone().unwrap_or_default(),
            created_at: event.created_at.unwrap_or_default(),
            project_id: event.project_id.clone().unwrap_or_default(),
            data: WebhookEventData {
                severity: event.severity.clone(),
                title: event.title.clone(),
                description: event.description.clone(),
                asset_id: event.asset_id.clone(),
                asset: event.asset.clone(),
                facts: event.facts.clone(),
            },
            received: None,
        }
    }
    /// Whether this is a test send from the portal or API: its facts include `test` with the
    /// value `true`. Handle test sends without acting on the asset they name.
    pub fn is_test(&self) -> bool {
        self.data
            .facts
            .iter()
            .any(|fact| fact.key == "test" && fact.value == Value::Bool(true))
    }
    /// The delivery as JSON: the body exactly as received for a parsed delivery (unknown fields
    /// included), otherwise this payload serialized.
    pub fn json(&self) -> Value {
        self.received
            .clone()
            .unwrap_or_else(|| serde_json::to_value(self).unwrap_or(Value::Null))
    }
    pub(crate) fn received(mut self, body: Value) -> Self {
        self.received = Some(body);
        self
    }
}

/// Snapshot of an asset's state when an event was created, holding the fields CalmLens sent
/// (fields this SDK version does not know included). Read them with the accessors, or
/// [`get`](Self::get) for any other field; retrieve the asset for its current state.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EventAsset(serde_json::Map<String, Value>);
impl EventAsset {
    /// A snapshot of asset `id` with classification status `processing`, moderation status
    /// `moderation`, content status `content` and a completed upload, e.g. for a mock event.
    pub fn new(
        id: impl Into<String>,
        processing: AssetClassificationStatus,
        moderation: AssetModerationStatus,
        content: AssetContentStatus,
    ) -> Self {
        let value = serde_json::json!({
            "id": id.into(),
            "upload": {"status": "completed"},
            "classification": {"status": processing, "moderation": {"status": moderation}},
            "content": {"status": content},
        });
        match value {
            Value::Object(map) => Self(map),
            _ => Self::default(),
        }
    }
    /// The snapshot's fields.
    pub fn from_json(fields: serde_json::Map<String, Value>) -> Self {
        Self(fields)
    }
    /// The asset ID.
    pub fn id(&self) -> &str {
        self.text(&["id"]).unwrap_or_default()
    }
    /// Your ID for the asset, if you set one.
    pub fn external_id(&self) -> Option<&str> {
        self.text(&["externalId"])
    }
    /// The upload preset used to create the asset, if any.
    pub fn upload_preset_id(&self) -> Option<&str> {
        self.text(&["uploadPresetId"])
    }
    /// The upload status, such as `completed`.
    pub fn upload_status(&self) -> Option<&str> {
        self.text(&["upload", "status"])
    }
    /// The classification status when the event was created.
    pub fn classification_status(&self) -> Option<AssetClassificationStatus> {
        self.text(&["classification", "status"]).map(Into::into)
    }
    /// The moderation status when the event was created, which also decides delivery.
    pub fn moderation_status(&self) -> Option<AssetModerationStatus> {
        self.text(&["classification", "moderation", "status"])
            .map(Into::into)
    }
    /// Whether CalmLens held the content when the event was created.
    pub fn content_status(&self) -> Option<AssetContentStatus> {
        self.text(&["content", "status"]).map(Into::into)
    }
    /// A top-level field of the snapshot.
    pub fn get(&self, field: &str) -> Option<&Value> {
        self.0.get(field)
    }
    /// The snapshot's fields.
    pub fn as_json(&self) -> &serde_json::Map<String, Value> {
        &self.0
    }
    fn text(&self, path: &[&str]) -> Option<&str> {
        let (last, parents) = path.split_last()?;
        let mut object = &self.0;
        for parent in parents {
            object = object.get(*parent)?.as_object()?;
        }
        object.get(*last)?.as_str()
    }
}

/// The event fields of a webhook delivery; the events feed has the same fields at the top level.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct WebhookEventData {
    /// The severity.
    #[serde(default)]
    pub severity: Option<EventSeverity>,
    /// The title.
    #[serde(default)]
    pub title: Option<String>,
    /// The description.
    #[serde(default)]
    pub description: Option<String>,
    /// The asset the event concerns.
    #[serde(default)]
    pub asset_id: Option<String>,
    /// Snapshot of the asset's state when the event was created. Retrieve the asset for its
    /// current state.
    #[serde(default)]
    pub asset: Option<EventAsset>,
    /// The event's facts.
    #[serde(default)]
    pub facts: Vec<EventFact>,
}

/// A page of the events feed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct EventsPage {
    /// The events.
    #[serde(default)]
    pub events: Vec<Event>,
    /// Pass as `after` to continue; store it between polls.
    #[serde(default)]
    pub cursor: String,
    /// Whether more events are available now.
    #[serde(default)]
    pub has_more: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<EventsPage, _>")]
    pub extra: HashMap<String, Value>,
}
impl EventsPage {
    /// A page of `events`, e.g. for a mock response.
    pub fn new(events: Vec<Event>, cursor: impl Into<String>, has_more: bool) -> Self {
        Self {
            events,
            cursor: cursor.into(),
            has_more,
            extra: HashMap::new(),
        }
    }
}

/// A lens.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Lens {
    /// The lens ID.
    #[serde(default)]
    pub id: Option<String>,
    /// The identifier.
    pub identifier: String,
    /// The display name.
    #[serde(default)]
    pub name: Option<String>,
    /// The asset type the lens applies to (`type` on the wire).
    #[serde(default, rename = "type")]
    pub lens_type: Option<LensType>,
    /// Whether the lens is active.
    #[serde(default)]
    pub active: Option<bool>,
    /// The definition version.
    #[serde(default)]
    pub version: Option<u32>,
    /// The owning project.
    #[serde(default)]
    pub project_id: Option<String>,
    /// The user who created the lens.
    #[serde(default)]
    pub user_id: Option<String>,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub created_at: Option<u64>,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// The description.
    #[serde(default)]
    pub description: Option<String>,
    /// The transforms.
    #[serde(default)]
    pub transforms: Option<Vec<Transform>>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<Lens, _>")]
    pub extra: HashMap<String, Value>,
}

/// A signed URL.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct SignedUrl {
    /// The URL.
    pub url: String,
    /// When it expires, in milliseconds since the Unix epoch.
    #[serde(default)]
    pub expires_at: Option<u64>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<SignedUrl, _>")]
    pub extra: HashMap<String, Value>,
}

/// The picture CalmLens can show for an asset: the original for image assets, or a generated
/// image for documents and websites. It remains after the content is removed, so check the content
/// `status` before loading it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetImage {
    /// The width in pixels: the original's for image assets (a converted HEIC is served smaller at
    /// the same aspect ratio), and the generated image's for documents and websites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// The height in pixels, like `width`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// A ThumbHash placeholder to render while the image loads; `None` once it is removed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbhash: Option<String>,
    /// The average colour; `None` once the image is removed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub average_color: Option<String>,
    /// The perceptual hash, for matching similar image assets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perceptual_hash: Option<String>,
    /// The perceptual hash's quality from 0 to 100; low values match less reliably.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perceptual_hash_quality: Option<i64>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetImage, _>")]
    pub extra: HashMap<String, Value>,
}

/// Digests of an asset's uploaded content.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Checksums {
    /// The MD5 digest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub md5: Option<String>,
    /// The SHA-1 digest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha1: Option<String>,
    /// The SHA-256 digest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    /// The SHA-384 digest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha384: Option<String>,
    /// The SHA-512 digest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha512: Option<String>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<Checksums, _>")]
    pub extra: HashMap<String, Value>,
}

/// A safety hold.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct SafetyHold {
    /// Why the asset is held.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<SafetyHoldReason>,
    /// Milliseconds since the Unix epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placed_at: Option<u64>,
    /// Milliseconds since the Unix epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disposed_at: Option<u64>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<SafetyHold, _>")]
    pub extra: HashMap<String, Value>,
}

/// Extracted text.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ExtractedText {
    /// `String` (inline `content`) or `Document` (stored separately under `id`).
    #[serde(default, rename = "type")]
    pub extraction_type: ExtractedTextType,
    /// The text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// The document ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<ExtractedText, _>")]
    pub extra: HashMap<String, Value>,
}

/// A lens transform step. Build image transforms with [`Transform::image`].
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum Transform {
    /// An `imageTransform` (boxed, as the options are large).
    Image(Box<ImageTransformOptions>),
    /// A transform type this SDK version does not know, or options it cannot read, kept as
    /// received. The CDN only accepts `imageTransform`.
    Unknown {
        /// The transform type (`type` on the wire).
        transform_type: String,
        /// The options, kept as received.
        options: Value,
    },
}
impl Transform {
    /// An image transform.
    pub fn image(options: ImageTransformOptions) -> Self {
        Self::Image(Box::new(options))
    }
    /// The transform type, e.g. `imageTransform`.
    pub fn transform_type(&self) -> &str {
        match self {
            Self::Image(_) => "imageTransform",
            Self::Unknown { transform_type, .. } => transform_type,
        }
    }
    fn options_value(&self) -> std::result::Result<Value, serde_json::Error> {
        match self {
            Self::Image(options) => serde_json::to_value(options.as_ref()),
            Self::Unknown { options, .. } => Ok(options.clone()),
        }
    }
}
impl Serialize for Transform {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let options = self.options_value().map_err(serde::ser::Error::custom)?;
        let mut state = serializer.serialize_struct("Transform", 2)?;
        state.serialize_field("type", self.transform_type())?;
        state.serialize_field("options", &options)?;
        state.end()
    }
}
impl<'de> Deserialize<'de> for Transform {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Repr {
            #[serde(rename = "type")]
            transform_type: String,
            #[serde(default)]
            options: Value,
        }
        let repr = Repr::deserialize(deserializer)?;
        if repr.transform_type == "imageTransform" {
            let options = match &repr.options {
                Value::Null => Some(ImageTransformOptions::default()),
                value => ImageTransformOptions::deserialize(value).ok(),
            };
            if let Some(options) = options {
                return Ok(Self::image(options));
            }
        }
        #[cfg(feature = "strict-contract")]
        strict::record(
            "Transform",
            strict::Finding::Value(repr.transform_type.clone()),
        );
        Ok(Self::Unknown {
            transform_type: repr.transform_type,
            options: repr.options,
        })
    }
}

/// A direct CDN transform: a selector string or one or more structured [`Transform`] steps.
///
/// `"width=320".into()`, `Transform::image(..).into()` and a `Vec<Transform>` all convert into
/// it. Structured steps serialize to a selector with one path segment per step, such as
/// `fit=cover,width=640/format=webp`: option keys sorted, nested objects as dotted keys
/// (`border.color`), hex colours without `#` and values percent-encoded, so equal transforms
/// share a URL.
#[derive(Debug, Clone, PartialEq)]
pub enum CdnTransform {
    /// A selector string with one step per path segment, such as `fit=cover,width=1024/blur=12`.
    Selector(String),
    /// Structured steps, applied in order. At least one is required.
    Steps(Vec<Transform>),
}
impl CdnTransform {
    /// Whether this is an empty selector string, which means no transform.
    pub fn is_empty(&self) -> bool {
        matches!(self, Self::Selector(value) if value.is_empty())
    }
    /// The selector string the API and CDN accept. Fails with `sdk/invalid-argument` for
    /// no steps, a type other than `imageTransform`, options that aren't an object, a step
    /// with no options, option names that aren't camelCase letters and digits, or option
    /// values that are arrays.
    pub fn selector(&self) -> crate::Result<String> {
        let steps = match self {
            Self::Selector(value) => return Ok(value.clone()),
            Self::Steps(steps) => steps,
        };
        if steps.is_empty() {
            return Err(transform_error("Transform needs at least one step"));
        }
        let mut selectors = Vec::with_capacity(steps.len());
        for step in steps {
            if step.transform_type() != "imageTransform" {
                return Err(transform_error("Transform type must be \"imageTransform\""));
            }
            let mut pairs = Vec::new();
            let options = step
                .options_value()
                .map_err(|cause| transform_error(&cause.to_string()))?;
            match &options {
                Value::Null => {}
                Value::Object(options) => append_transform_options(&mut pairs, None, options)?,
                _ => return Err(transform_error("Transform options must be an object")),
            }
            if pairs.is_empty() {
                return Err(transform_error("Transform steps need at least one option"));
            }
            selectors.push(pairs.join(","));
        }
        Ok(selectors.join("/"))
    }
}
impl From<&str> for CdnTransform {
    fn from(value: &str) -> Self {
        Self::Selector(value.into())
    }
}
impl From<String> for CdnTransform {
    fn from(value: String) -> Self {
        Self::Selector(value)
    }
}
impl From<Transform> for CdnTransform {
    fn from(value: Transform) -> Self {
        Self::Steps(vec![value])
    }
}
impl From<Vec<Transform>> for CdnTransform {
    fn from(value: Vec<Transform>) -> Self {
        Self::Steps(value)
    }
}
impl Serialize for CdnTransform {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let selector = self.selector().map_err(serde::ser::Error::custom)?;
        serializer.serialize_str(&selector)
    }
}
impl<'de> Deserialize<'de> for CdnTransform {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Selector(String),
            Step(Transform),
            Steps(Vec<Transform>),
        }
        Ok(match Repr::deserialize(deserializer)? {
            Repr::Selector(value) => Self::Selector(value),
            Repr::Step(step) => Self::Steps(vec![step]),
            Repr::Steps(steps) => Self::Steps(steps),
        })
    }
}

fn transform_error(message: &str) -> crate::Error {
    crate::Error::new(crate::ErrorCode::InvalidArgument, message)
}
/// Options that hold colours, written as hex without `#` in a selector.
// <generated: image-transform-colours>
// Generated by packages/sdk-contract/generate.ts from IMAGE_TRANSFORM_OPTIONS_SCHEMA; do not edit.
/// Options that hold colours, written as hex without `#` in a selector.
const TRANSFORM_COLOUR_KEYS: &[&str] = &["background", "border.color", "trim.border.color"];
// </generated: image-transform-colours>

/// Whether `name` is a transform option name: a lower-case letter, then letters and digits.
fn is_transform_option_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes.next().is_some_and(|b| b.is_ascii_lowercase()) && bytes.all(|b| b.is_ascii_alphanumeric())
}

/// A colour option's hex value without `#`, in lower case, or `None` if it is not `#` and 3, 4,
/// 6 or 8 hex digits.
fn hex_colour(value: &str) -> Option<String> {
    let digits = value.strip_prefix('#')?;
    (matches!(digits.len(), 3 | 4 | 6 | 8) && digits.bytes().all(|b| b.is_ascii_hexdigit()))
        .then(|| digits.to_ascii_lowercase())
}

/// Appends `key=value` pairs, keys sorted at every level.
fn append_transform_options(
    pairs: &mut Vec<String>,
    parent: Option<&str>,
    options: &serde_json::Map<String, Value>,
) -> crate::Result<()> {
    let mut keys: Vec<&String> = options.keys().collect();
    // Option names are ASCII, so byte order is JavaScript's UTF-16 order.
    keys.sort();
    for key in keys {
        let full = match parent {
            Some(parent) => format!("{parent}.{key}"),
            None => key.clone(),
        };
        if !is_transform_option_name(key) {
            return Err(transform_error(&format!(
                "Transform option \"{full}\" is not a valid name"
            )));
        }
        let text = match &options[key] {
            Value::Null => continue,
            Value::Object(child) => {
                append_transform_options(pairs, Some(&full), child)?;
                continue;
            }
            Value::String(value) if TRANSFORM_COLOUR_KEYS.contains(&full.as_str()) => {
                hex_colour(value).unwrap_or_else(|| value.clone())
            }
            Value::String(value) => value.clone(),
            Value::Bool(value) => value.to_string(),
            Value::Number(value) => js_number(value),
            Value::Array(_) => {
                return Err(transform_error(&format!(
                    "Transform option \"{full}\" must be a string, number, boolean or object"
                )))
            }
        };
        pairs.push(format!("{full}={}", encode_transform_component(&text)));
    }
    Ok(())
}
/// Percent-encodes everything except RFC 3986 unreserved characters (`A-Z a-z 0-9 - . _ ~`).
fn encode_transform_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}
/// Formats a number as JavaScript's `String(number)` does.
fn js_number(value: &serde_json::Number) -> String {
    let float = match value.as_f64() {
        Some(float) if value.is_f64() => float,
        _ => return value.to_string(),
    };
    if float == 0.0 {
        return "0".into();
    }
    // `{:e}` gives the shortest round-trip digits, e.g. `1.5e0`.
    let exp_form = format!("{:e}", float.abs());
    let (mantissa, exponent) = exp_form.split_once('e').unwrap_or((&exp_form, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let (k, n) = (digits.len() as i32, exponent + 1);
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let sign = if n - 1 < 0 { '-' } else { '+' };
        let rest = if k > 1 {
            format!("{}.{}", &digits[..1], &digits[1..])
        } else {
            digits.clone()
        };
        format!("{rest}e{sign}{}", (n - 1).abs())
    };
    if float < 0.0 {
        format!("-{body}")
    } else {
        body
    }
}

/// An image quality: a number from 1 to 100 or a level.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ImageQuality {
    /// A number from 1 to 100.
    Value(u32),
    /// A level, such as `High`.
    Level(ImageQualityLevel),
}
impl From<u32> for ImageQuality {
    fn from(value: u32) -> Self {
        Self::Value(value)
    }
}
impl From<ImageQualityLevel> for ImageQuality {
    fn from(value: ImageQualityLevel) -> Self {
        Self::Level(value)
    }
}

/// Where to crop from: a named position or a point.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Gravity {
    /// A named position, such as `Face`.
    Position(GravityPosition),
    /// A point.
    Point(GravityPoint),
}
impl From<GravityPosition> for Gravity {
    fn from(value: GravityPosition) -> Self {
        Self::Position(value)
    }
}

/// A crop gravity point.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GravityPoint {
    /// How `x` and `y` are interpreted.
    pub mode: GravityMode,
    /// The horizontal position from 0 to 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    /// The vertical position from 0 to 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
}

/// A border drawn around the image.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBorder {
    /// The colour, e.g. `#fff`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// The width in pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
}

/// Regions found when the image was processed, blurred before any other option applies.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageRedaction {
    /// Blur text regions. Text regions need OCR on the upload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<bool>,
    /// Blur regions holding personal information.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub personal_information: Option<bool>,
}

string_enum! {
    /// A named trim mode.
    TrimMode {
        /// Trim a uniform border.
        Border = "border",
    }
}

/// What to trim from the image edges.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Trim {
    /// A named mode, such as `Border`.
    Mode(TrimMode),
    /// Pixels to trim from each edge, or the size to trim to.
    Edges(TrimEdges),
}
impl From<TrimMode> for Trim {
    fn from(value: TrimMode) -> Self {
        Self::Mode(value)
    }
}
impl From<TrimEdges> for Trim {
    fn from(value: TrimEdges) -> Self {
        Self::Edges(value)
    }
}

/// Pixels to trim from each edge.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimEdges {
    /// Pixels from the top.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<f64>,
    /// Pixels from the bottom.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<f64>,
    /// Pixels from the left.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<f64>,
    /// Pixels from the right.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<f64>,
    /// The width to trim to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    /// The height to trim to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    /// Also trim a uniform border.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<TrimBorder>,
}

/// Whether and how to trim a uniform border.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TrimBorder {
    /// Trim it (`true`) or not.
    Enabled(bool),
    /// Trim it with these settings.
    Options(TrimBorderOptions),
}

/// How to detect and keep a uniform border.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimBorderOptions {
    /// The border colour; detected when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// How far colours may differ from it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tolerance: Option<f64>,
    /// Pixels of border to keep.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep: Option<f64>,
}

// <generated: image-transform-options>
// Generated by packages/sdk-contract/generate.ts from IMAGE_TRANSFORM_OPTIONS_SCHEMA; do not edit.
string_enum! {
    /// The output format. Leave it out to serve the best format the browser accepts.
    ImageFormat {
        /// JPEG.
        Jpg = "jpg",
        /// PNG.
        Png = "png",
        /// WebP.
        Webp = "webp",
        /// AVIF.
        Avif = "avif",
        /// GIF.
        Gif = "gif",
    }
}

string_enum! {
    /// A named image quality.
    ImageQualityLevel {
        /// Low quality, the smallest files.
        Low = "low",
        /// Medium quality.
        Medium = "medium",
        /// High quality.
        High = "high",
    }
}

string_enum! {
    /// How the image fits the `width` and `height`.
    ImageFit {
        /// Shrink to fit, never enlarge.
        ScaleDown = "scale-down",
        /// Fit inside the box, keeping the aspect ratio.
        Contain = "contain",
        /// Fit inside the box and pad to fill it with `background`.
        Pad = "pad",
        /// Stretch to fill the box.
        Squeeze = "squeeze",
        /// Fill the box, cropping the overflow.
        Cover = "cover",
        /// Crop to the box without enlarging.
        Crop = "crop",
    }
}

string_enum! {
    /// Flips the image horizontally (`h`), vertically (`v`) or both (`hv`).
    ImageFlip {
        /// Horizontally.
        H = "h",
        /// Vertically.
        V = "v",
        /// Both.
        Hv = "hv",
    }
}

string_enum! {
    /// `foreground` removes the background.
    ImageSegment {
        /// Keep the foreground and remove the background.
        Foreground = "foreground",
    }
}

string_enum! {
    /// A named crop position.
    GravityPosition {
        /// Centre on detected faces.
        Face = "face",
        /// The left edge.
        Left = "left",
        /// The right edge.
        Right = "right",
        /// The top edge.
        Top = "top",
        /// The bottom edge.
        Bottom = "bottom",
        /// The centre.
        Center = "center",
        /// Chosen automatically.
        Auto = "auto",
        /// The most detailed area.
        Entropy = "entropy",
    }
}

string_enum! {
    /// How `x` and `y` place the point.
    GravityMode {
        /// `x` and `y` are fractions of the space left over after resizing.
        Remainder = "remainder",
        /// `x` and `y` are the centre of the crop box, as fractions of the image.
        BoxCenter = "box-center",
    }
}

/// Image transform options; set only what you need.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTransformOptions {
    /// The output format. Leave it out to serve the best format the browser accepts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ImageFormat>,
    /// The width in pixels, 1 to 10,000 after `dpr`. With a size and no `fit`, the image scales down.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// The height in pixels, 1 to 10,000 after `dpr`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// The pixel density, 1 to 3: multiplies the width, height and border width.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dpr: Option<f64>,
    /// `false` serves the first frame of an animated GIF or WebP.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anim: Option<bool>,
    /// The background colour, such as `#ffffff`, for padding and transparency.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    /// The blur radius.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blur: Option<f64>,
    /// Blurs regions found when the image was processed, before any other option applies. Text regions need OCR on the upload. An image without such regions is served unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redact: Option<ImageRedaction>,
    /// A border drawn around the image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<ImageBorder>,
    /// The brightness factor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brightness: Option<f64>,
    /// The contrast factor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contrast: Option<f64>,
    /// The quality: 1 to 100, or a level. Lossy output defaults to `high`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality: Option<ImageQuality>,
    /// How the image fits the `width` and `height`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit: Option<ImageFit>,
    /// Flips the image horizontally (`h`), vertically (`v`) or both (`hv`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flip: Option<ImageFlip>,
    /// The gamma.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gamma: Option<f64>,
    /// `foreground` removes the background.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment: Option<ImageSegment>,
    /// Where to keep when cropping: a side, `face`, `auto`, or a point.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gravity: Option<Gravity>,
    /// The clockwise rotation in degrees.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotate: Option<u32>,
    /// The saturation factor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saturation: Option<f64>,
    /// The sharpen amount.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sharpen: Option<f64>,
    /// Trims the edges: `border` trims a detected border, or give edges and sizes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trim: Option<Trim>,
    /// Options this SDK version does not know, as received in a lens.
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}
// </generated: image-transform-options>

/// Options for [`TextClient::classify`](crate::TextClient::classify).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifyText {
    /// The text; must not be blank.
    pub text: String,
    /// The asset name; defaults to `text`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// A description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Processing options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub processing_options: Option<ProcessingOptions>,
    /// Metadata items.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Vec<MetadataItem>>,
    /// Your identifier for who wrote the text. CalmLens only compares it with the author IDs in
    /// `context`, to tell which posts share a speaker.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_id: Option<String>,
    /// Earlier posts in the conversation, oldest first. The SDK sends only the posts CalmLens
    /// uses; see [`select_moderation_context_items`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<ModerationContext>,
    /// Your ID for the asset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
    /// A link to the asset in your system.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_url: Option<String>,
    /// The folder.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub folder_id: Patch<String>,
    /// The upload preset to apply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload_preset_id: Option<String>,
    /// The `Idempotency-Key`. The SDK generates one when it is `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
}
impl ClassifyText {
    /// Moderates `text`.
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Self::default()
        }
    }
}

/// Options for [`UploadTokensClient::sign`](crate::UploadTokensClient::sign).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignUploadToken {
    /// The upload preset the token may upload through.
    pub upload_preset_id: String,
    /// The external ID the uploaded asset gets. Must not be empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
    /// The token's lifetime, from 1 to 3600 seconds. Defaults to 600.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_in_seconds: Option<u32>,
}
impl SignUploadToken {
    /// A token for `upload_preset_id` with the default lifetime.
    pub fn new(upload_preset_id: impl Into<String>) -> Self {
        Self {
            upload_preset_id: upload_preset_id.into(),
            ..Self::default()
        }
    }
}

/// A signed upload token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedUploadToken {
    /// The token, to hand to the browser as its bearer token.
    pub token: String,
    /// When the token expires, in milliseconds since the Unix epoch.
    pub expires_at: u64,
}

/// Options for asset search.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAssets {
    /// The natural-language query.
    pub query: String,
    /// How to match; defaults to `Hybrid`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<SearchMode>,
    /// The maximum number of results.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

/// One search result.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetSearchMatch {
    /// The asset.
    pub asset: Asset,
    /// The relevance score.
    #[serde(default)]
    pub score: f64,
    /// The fields that matched.
    #[serde(default)]
    pub matched_fields: Vec<SearchMatchField>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetSearchMatch, _>")]
    pub extra: HashMap<String, Value>,
}

/// Search results.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetSearchResponse {
    /// The query.
    #[serde(default)]
    pub query: String,
    /// The results.
    #[serde(default)]
    pub items: Vec<AssetSearchMatch>,
    /// Whether semantic search is available.
    #[serde(default)]
    pub semantic_status: SemanticStatus,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetSearchResponse, _>")]
    pub extra: HashMap<String, Value>,
}

/// One page of child folders.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPage {
    /// Child folders on this page.
    pub folders: Vec<Folder>,
    /// Visible folders needed to reveal the selected paths.
    pub ancestors: Vec<Folder>,
    /// Whether another page is available.
    pub has_more: bool,
}

/// Options for browsing folders.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFolders {
    /// Lists immediate children of this folder; omit for project root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Zero-based page number.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_index: Option<u32>,
    /// Page size from 1 to 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// Literal folder-name substring.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    /// Search the accessible tree instead of only the current parent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_all: Option<bool>,
    /// Only resolve selected paths without listing children.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolve_only: Option<bool>,
    /// Selected folder IDs whose paths should be resolved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
    /// Sort by name or createdAt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
    /// ASC or DESC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
}

string_enum! {
    /// What a hash list does with an image upload that matches one of its entries.
    HashListAction {
        /// Record the match.
        Flag = "flag",
        /// Record the match and block close matches.
        Block = "block",
    }
}

/// A hash list: PDQ hashes of images the project never wants again.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HashList {
    /// The hash list ID.
    pub id: String,
    /// The owning project.
    #[serde(default)]
    pub project_id: String,
    /// The name.
    #[serde(default)]
    pub name: String,
    /// The description.
    #[serde(default)]
    pub description: Option<String>,
    /// What matches do.
    #[serde(default)]
    pub action: HashListAction,
    /// The user who created the list, or `None` for an API key.
    #[serde(default)]
    pub created_by_user_id: Option<String>,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub created_at: u64,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<HashList, _>")]
    pub extra: HashMap<String, Value>,
}
impl HashList {
    /// A hash list with `id`, `name` and `action`, e.g. for a mock response.
    pub fn new(id: impl Into<String>, name: impl Into<String>, action: HashListAction) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            action,
            ..Self::default()
        }
    }
}

/// One hash in a hash list.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HashListEntry {
    /// The entry ID.
    pub id: String,
    /// The owning project.
    #[serde(default)]
    pub project_id: String,
    /// The hash list.
    #[serde(default)]
    pub hash_list_id: String,
    /// The PDQ hash: 64 hexadecimal characters.
    #[serde(default)]
    pub hash: String,
    /// The hash's quality from 0 to 100, when known.
    #[serde(default)]
    pub quality: Option<i64>,
    /// A label, such as a report reference.
    #[serde(default)]
    pub label: Option<String>,
    /// The asset the hash was taken from.
    #[serde(default)]
    pub source_asset_id: Option<String>,
    /// The user who added the entry, or `None` for an API key.
    #[serde(default)]
    pub created_by_user_id: Option<String>,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub created_at: u64,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<HashListEntry, _>")]
    pub extra: HashMap<String, Value>,
}

/// Every hash list in a project.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HashListList {
    /// The hash lists.
    #[serde(default)]
    pub items: Vec<HashList>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<HashListList, _>")]
    pub extra: HashMap<String, Value>,
}

/// A page of hash list entries, newest first.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HashListEntryPage {
    /// The entries on this page.
    #[serde(default)]
    pub items: Vec<HashListEntry>,
    /// The cursor for the next page, or None.
    #[serde(default)]
    pub next_cursor: Option<String>,
    /// The page size.
    #[serde(default)]
    pub page_size: Option<u32>,
    /// Whether another page follows.
    #[serde(default)]
    pub has_more: Option<bool>,
    /// The sort orders applied.
    #[serde(default)]
    pub ordering: Option<Vec<Order>>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<HashListEntryPage, _>")]
    pub extra: HashMap<String, Value>,
}

/// Identifies a hash list.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HashListId {
    /// The hash list ID.
    pub hash_list_id: String,
}
impl HashListId {
    /// Identifies hash list `hash_list_id`.
    pub fn new(hash_list_id: impl Into<String>) -> Self {
        Self {
            hash_list_id: hash_list_id.into(),
        }
    }
}

/// Identifies a hash list entry.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HashListEntryId {
    /// The entry ID.
    pub entry_id: String,
}
impl HashListEntryId {
    /// Identifies entry `entry_id`.
    pub fn new(entry_id: impl Into<String>) -> Self {
        Self {
            entry_id: entry_id.into(),
        }
    }
}

/// Options for creating a hash list.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHashList {
    /// The name.
    pub name: String,
    /// A description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// What matches do: `Flag` records them, `Block` also blocks close matches.
    pub action: HashListAction,
}

/// Changes to a hash list. The new action applies to later uploads.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHashList {
    /// The hash list ID.
    #[serde(skip_serializing)]
    pub hash_list_id: String,
    /// The new name.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub name: Patch<String>,
    /// The new description; `Patch::Null` clears it.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub description: Patch<String>,
    /// The new action.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub action: Patch<HashListAction>,
}

/// Options for one page of a hash list's entries.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListHashListEntries {
    /// The hash list ID.
    pub hash_list_id: String,
    /// The cursor from a previous page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// The page size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
}

/// Adds a hash to a hash list: set `hash` (and optionally `quality`), or `asset_id` to use an
/// image asset's perceptual hash.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddHashListEntry {
    /// The hash list ID.
    #[serde(skip_serializing)]
    pub hash_list_id: String,
    /// A PDQ hash: 64 hexadecimal characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    /// The hash's quality from 0 to 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality: Option<i64>,
    /// An image asset whose perceptual hash to add.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    /// A label, such as a report reference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Optional customer assertions for CDN delivery. Neither assertion is verified by CalmLens.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerClaims {
    /// Viewer country; otherwise inferred from the connection reaching CalmLens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    /// Defaults to false, including authenticated requests.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub age_confirmed: Option<bool>,
}
