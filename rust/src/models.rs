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

/// The HTTP response a result came from, for [`Asset::last_response`] and the other results'
/// `last_response()`: quote its `request_id` to support.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct LastResponse {
    /// The HTTP status.
    pub status: http::StatusCode,
    /// The `X-Request-Id` header.
    pub request_id: Option<String>,
    /// The `Idempotency-Key` the request carried, such as an upload's.
    pub idempotency_key: Option<String>,
    /// The response headers.
    pub headers: http::HeaderMap,
}

/// Where a result keeps its [`LastResponse`]. It never affects equality or the JSON form.
#[derive(Clone, Default)]
pub(crate) struct ResponseSlot(Option<std::sync::Arc<LastResponse>>);
impl PartialEq for ResponseSlot {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}
impl fmt::Debug for ResponseSlot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(if self.0.is_some() { "Some(..)" } else { "None" })
    }
}
#[cfg(feature = "strict-contract")]
impl describe::Described for ResponseSlot {
    fn shape() -> describe::Shape {
        describe::Shape::Native("ResponseSlot")
    }
}

/// A result that can keep the HTTP response it came from.
#[cfg_attr(not(feature = "async"), allow(dead_code))]
pub(crate) trait Responded {
    /// Keeps `response`; results without a `last_response` ignore it.
    fn set_last_response(&mut self, _response: LastResponse) {}
}
impl Responded for () {}
impl Responded for Value {}
impl<T> Responded for Vec<T> {}

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

/// Describes a struct or serde enum for the declared-type contract test; see [`describe`].
#[cfg(feature = "strict-contract")]
macro_rules! described {
    ($(#[$meta:meta])* $vis:vis struct $name:ident {
        $($(#[$fmeta:meta])* $fvis:vis $field:ident : $ty:ty),* $(,)?
    }) => {
        impl crate::models::describe::Described for $name {
            fn shape() -> crate::models::describe::Shape {
                crate::models::describe::Shape::Struct {
                    name: stringify!($name),
                    attrs: &[$(stringify!($meta)),*],
                    fields: || vec![$(crate::models::describe::Field {
                        name: stringify!($field),
                        attrs: &[$(stringify!($fmeta)),*],
                        shape: <$ty as crate::models::describe::Described>::shape,
                    }),*],
                }
            }
        }
    };
    ($(#[$meta:meta])* $vis:vis enum $name:ident {
        $($(#[$vmeta:meta])* $variant:ident $(($ty:ty))?),* $(,)?
    }) => {
        impl crate::models::describe::Described for $name {
            fn shape() -> crate::models::describe::Shape {
                crate::models::describe::Shape::Union {
                    name: stringify!($name),
                    attrs: &[$(stringify!($meta)),*],
                    variants: || vec![$(crate::models::describe::Field {
                        name: stringify!($variant),
                        attrs: &[$(stringify!($vmeta)),*],
                        shape: described!(@payload $($ty)?),
                    }),*],
                }
            }
        }
    };
    (@payload) => { <() as crate::models::describe::Described>::shape };
    (@payload $ty:ty) => { <$ty as crate::models::describe::Described>::shape };
}

#[cfg(feature = "strict-contract")]
#[doc(hidden)]
pub mod describe;

macro_rules! string_enum {
    ($(#[$meta:meta])* $name:ident { $( $(#[$vmeta:meta])* $variant:ident = $value:literal ),* $(,)? }) => {
        $(#[$meta])*
        ///
        /// Values this SDK version does not list arrive as `Unknown`. To act on such a value,
        /// compare [`as_str`](Self::as_str) in a `_` arm rather than matching `Unknown`, which
        /// stops matching once a later version lists the value. Enums compare and hash by their
        /// wire value.
        #[derive(Debug, Clone)]
        #[non_exhaustive]
        pub enum $name {
            $( $(#[$vmeta])* $variant, )*
            /// A value this SDK version does not know.
            #[deprecated(
                note = "match `as_str()` in a `_` arm: a value a later version lists stops arriving as `Unknown`"
            )]
            Unknown(crate::UnknownValue),
        }
        impl $name {
            /// The wire value.
            #[allow(deprecated)]
            pub fn as_str(&self) -> &str {
                match self {
                    $(Self::$variant => $value,)*
                    Self::Unknown(value) => value.as_str(),
                }
            }
        }
        #[allow(dead_code)]
        impl $name {
            /// Whether this is a value this SDK version lists.
            #[allow(deprecated)]
            pub(crate) fn is_known(&self) -> bool {
                !matches!(self, Self::Unknown(_))
            }
        }
        impl PartialEq for $name {
            fn eq(&self, other: &Self) -> bool {
                self.as_str() == other.as_str()
            }
        }
        impl Eq for $name {}
        impl std::hash::Hash for $name {
            fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
                self.as_str().hash(state);
            }
        }
        #[cfg(feature = "strict-contract")]
        impl $name {
            /// Contract-test support: the wire values of the known variants.
            #[doc(hidden)]
            pub const VALUES: &'static [&'static str] = &[$($value),*];
        }
        #[cfg(feature = "strict-contract")]
        impl crate::models::describe::Described for $name {
            fn shape() -> crate::models::describe::Shape {
                crate::models::describe::Shape::Enum {
                    name: stringify!($name),
                    values: Self::VALUES,
                }
            }
        }
        impl From<&str> for $name {
            #[allow(deprecated)]
            fn from(value: &str) -> Self {
                match value {
                    $($value => Self::$variant,)*
                    other => Self::Unknown(crate::UnknownValue::new(other)),
                }
            }
        }
        impl Default for $name {
            /// An empty value, for a model built with `Default`; decoding never produces it.
            #[allow(deprecated)]
            fn default() -> Self {
                Self::Unknown(crate::UnknownValue::default())
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
                #[allow(deprecated)]
                if let Self::Unknown(unknown) = &value {
                    strict::record(stringify!($name), strict::Finding::Value(unknown.as_str().to_owned()));
                }
                Ok(value)
            }
        }
    };
}

string_enum! {
    /// Where an asset is in the pipeline. It is settled once `Completed` or `Failed`.
    AssetClassificationStatus {
        /// Waiting for its content, e.g. a multipart upload still receiving parts, or for its
        /// turn.
        Queued = "queued",
        /// The content is being processed and classified.
        Processing = "processing",
        /// Processing finished.
        Completed = "completed",
        /// Processing failed; the asset can be retried.
        Failed = "failed",
    }
}

string_enum! {
    /// A moderation decision, which decides delivery: the decision in force
    /// ([`AssetModeration::decision`], `None` until there is one, and a reviewer's when there
    /// is one), an automated decision or a reviewer's.
    AssetModerationDecision {
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
        /// `retainContent` was off, so it was removed after processing.
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
    /// Why an asset's processing failed.
    AssetFailureReason {
        /// The file is larger than processing allows.
        FileTooLarge = "file-too-large",
        /// The audio or video is longer than processing allows.
        DurationLimit = "duration-limit",
        /// The video is larger than 4096 × 2160 pixels.
        ResolutionLimit = "resolution-limit",
        /// The file format is not supported.
        UnsupportedFormat = "unsupported-format",
        /// The content could not be decoded.
        UndecodableContent = "undecodable-content",
        /// The audio or video has more than one audio or video track.
        MultipleTracks = "multiple-tracks",
        /// The content does not match the asset's type.
        TypeMismatch = "type-mismatch",
        /// The organisation has used its free uploads, or the upload has more text than free
        /// uploads allow, before billing is set up.
        FreeUploadsExhausted = "free-uploads-exhausted",
        /// The audio or video is longer than the organisation's media limits allow.
        MediaLimit = "media-limit",
        /// Processing stopped because the organisation's usage limits paused uploads.
        UploadsPaused = "uploads-paused",
        /// A document holds more embedded images or audio and video files than can be moderated.
        TooManyItems = "too-many-items",
        /// Processing failed for another reason; retrying may succeed.
        ProcessingError = "processing-error",
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
        /// `asset.region-restricted`.
        AssetRegionRestricted = "asset.region-restricted",
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
        /// `asset.progress-updated`.
        AssetProgressUpdated = "asset.progress-updated",
        /// `asset.deleted`.
        AssetDeleted = "asset.deleted",
        /// `asset.content-removed`.
        AssetContentRemoved = "asset.content-removed",
        /// `asset.retried`.
        AssetRetried = "asset.retried",
        /// `asset.rerun-requested`.
        AssetRerunRequested = "asset.rerun-requested",
        /// `asset.review-requested`.
        AssetReviewRequested = "asset.review-requested",
        /// A queued review completed, including confirmations.
        AssetReviewCompleted = "asset.review-completed",
        /// `asset.hash-matched`.
        AssetHashMatched = "asset.hash-matched",
        /// `asset.link-flagged`.
        AssetLinkFlagged = "asset.link-flagged",
        /// `usage.free-uploads-exhausted`.
        UsageFreeUploadsExhausted = "usage.free-uploads-exhausted",
        /// `usage.uploads-paused`.
        UsageUploadsPaused = "usage.uploads-paused",
        /// `upload-preset.daily-limit-reached`.
        UploadPresetDailyLimitReached = "upload-preset.daily-limit-reached",
        /// `project.member-joined`.
        ProjectMemberJoined = "project.member-joined",
        /// `project.member-removed`.
        ProjectMemberRemoved = "project.member-removed",
        /// `project.member-left`.
        ProjectMemberLeft = "project.member-left",
        /// `project.member-role-changed`.
        ProjectMemberRoleChanged = "project.member-role-changed",
        /// `project.invitation-sent`.
        ProjectInvitationSent = "project.invitation-sent",
        /// `project.transferred`.
        ProjectTransferred = "project.transferred",
        /// `api-key.created`.
        ApiKeyCreated = "api-key.created",
        /// `api-key.revoked`.
        ApiKeyRevoked = "api-key.revoked",
        /// `api-key.deleted`.
        ApiKeyDeleted = "api-key.deleted",
        /// `connector.disabled`.
        ConnectorDisabled = "connector.disabled",
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
        ModerationStatus = "classification.moderation.decision",
        /// The visual content.
        Visual = "visual",
        /// The audio transcript.
        Transcript = "transcript",
    }
}

string_enum! {
    /// A CDN resource beneath an asset URL. Only `Rendered` and `Preview` take a lens or
    /// transform, and the CDN refuses them on rendered PDFs, video and audio with
    /// `transform/invalid`.
    CdnResource {
        /// The asset's original file, exactly as uploaded. Beneath a signed asset URL only when it
        /// was signed with `original`.
        Original = "original",
        /// The asset's displayable file: an image in the best format the client accepts, a PDF,
        /// or browser-safe video or audio, as `content.rendered` describes.
        Rendered = "rendered",
        /// A still image that stands for the asset, as `content.preview` describes: the image
        /// itself, a document's first page or slide, a website's first screen, a video's poster
        /// frame or an audio waveform.
        Preview = "preview",
        /// Preview. The adaptive stream of audio or video, its HLS master playlist (served at
        /// `hls/index.m3u8`, with its playlists and segments beneath `hls/`), once `content.hls`
        /// is set.
        Hls = "hls",
        /// Preview. An HTML page that shows the asset, for an iframe: a player for audio and
        /// video, or the viewer for its type.
        Embed = "embed",
        /// A small blurred PNG made from the preview, public whatever the asset's visibility or
        /// moderation; it needs no age confirmation.
        Placeholder = "placeholder",
        /// The asset's display info as JSON ([`AssetInfo`]), read with
        /// [`CdnClient::get_asset_info`](crate::CdnClient::get_asset_info).
        Info = "info",
    }
}

/// Processing options for an asset.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ProcessingOptions {
    /// Keep the stored content after classification.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retain_content: Option<bool>,
    /// Overrides the project's `storeSensitiveMetadata` setting for this upload. When false,
    /// embedded image metadata (EXIF, XMP and IPTC) is removed from the file before it is stored,
    /// and `metadata` leaves out the creator and location. When true, the image is stored as
    /// uploaded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_sensitive_metadata: Option<bool>,
    /// Optional analyses to run, keyed by feature. Link detection runs unless turned off; every
    /// other feature is off unless enabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub features: Option<ProcessingFeatures>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<ProcessingOptions, _>")]
    pub extra: HashMap<String, Value>,
}
impl ProcessingOptions {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// Keep the stored content after classification.
    pub fn retain_content(mut self, value: bool) -> Self {
        self.retain_content = Some(value);
        self
    }
    /// Overrides the project's `storeSensitiveMetadata` setting for this upload. When false,
    /// embedded image metadata (EXIF, XMP and IPTC) is removed from the file before it is stored,
    /// and `metadata` leaves out the creator and location. When true, the image is stored as
    /// uploaded.
    pub fn store_sensitive_metadata(mut self, value: bool) -> Self {
        self.store_sensitive_metadata = Some(value);
        self
    }
    /// Optional analyses to run, keyed by feature. Link detection runs unless turned off; every
    /// other feature is off unless enabled.
    pub fn features(mut self, value: impl Into<ProcessingFeatures>) -> Self {
        self.features = Some(value.into());
        self
    }
}

/// Optional analyses to run on an asset, keyed by feature. The API rejects unknown features.
/// Results of person and face detection are in [`AssetClassification::face_detection`].
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ProcessingFeatures {
    /// Extract image text onto the image asset and add a text moderation pass to its report.
    /// Applies to images, including those extracted from documents and websites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ocr: Option<FeatureOptions>,
    /// Preview. Locate people in images, including people whose faces are not visible. Results
    /// are informational and never change the moderation decision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub person_detection: Option<FeatureOptions>,
    /// Preview. Locate faces in images and optionally estimate an age range for each. Faces are
    /// not identified. Results are informational and never change the moderation decision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub face_detection: Option<FaceDetectionOptions>,
    /// Find QR codes and web links in images, and moderate QR code text with the image. Runs
    /// unless `enabled` is false. With OCR on, links in the extracted text are listed too.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_detection: Option<FeatureOptions>,
    /// Preview. Read provenance metadata, such as C2PA, that marks an image as AI-generated or
    /// AI-edited. Results are informational and never change the moderation decision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai_generated_detection: Option<FeatureOptions>,
    /// Preview. Prepare an adaptive stream (HLS) of audio or video once it is decided and made
    /// browser-safe, served at [`CdnResource::Hls`] and played by [`CdnResource::Embed`].
    /// Needs `retain_content`, and is billed per started minute of media. Left
    /// out, the project's streaming setting decides; `enabled: false` turns it off for an upload
    /// in a project that streams by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streaming: Option<FeatureOptions>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<ProcessingFeatures, _>")]
    pub extra: HashMap<String, Value>,
}
impl ProcessingFeatures {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// Extract image text onto the image asset and add a text moderation pass to its report.
    /// Applies to images, including those extracted from documents and websites.
    pub fn ocr(mut self, value: impl Into<FeatureOptions>) -> Self {
        self.ocr = Some(value.into());
        self
    }
    /// Preview. Locate people in images, including people whose faces are not visible. Results
    /// are informational and never change the moderation decision.
    pub fn person_detection(mut self, value: impl Into<FeatureOptions>) -> Self {
        self.person_detection = Some(value.into());
        self
    }
    /// Preview. Locate faces in images and optionally estimate an age range for each. Faces are
    /// not identified. Results are informational and never change the moderation decision.
    pub fn face_detection(mut self, value: impl Into<FaceDetectionOptions>) -> Self {
        self.face_detection = Some(value.into());
        self
    }
    /// Find QR codes and web links in images, and moderate QR code text with the image. Runs
    /// unless `enabled` is false. With OCR on, links in the extracted text are listed too.
    pub fn link_detection(mut self, value: impl Into<FeatureOptions>) -> Self {
        self.link_detection = Some(value.into());
        self
    }
    /// Preview. Read provenance metadata, such as C2PA, that marks an image as AI-generated or
    /// AI-edited. Results are informational and never change the moderation decision.
    pub fn ai_generated_detection(mut self, value: impl Into<FeatureOptions>) -> Self {
        self.ai_generated_detection = Some(value.into());
        self
    }
    /// Preview. Prepare an adaptive stream (HLS) of audio or video once it is decided and made
    /// browser-safe, served at [`CdnResource::Hls`] and played by [`CdnResource::Embed`].
    /// Needs `retain_content`, and is billed per started minute of media. Left
    /// out, the project's streaming setting decides; `enabled: false` turns it off for an upload
    /// in a project that streams by default.
    pub fn streaming(mut self, value: impl Into<FeatureOptions>) -> Self {
        self.streaming = Some(value.into());
        self
    }
}

/// Options for a feature that only needs turning on.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct FeatureOptions {
    /// Whether to run the feature.
    pub enabled: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<FeatureOptions, _>")]
    pub extra: HashMap<String, Value>,
}
impl FeatureOptions {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            enabled: Default::default(),
            extra: Default::default(),
        }
    }
}
impl FeatureOptions {
    /// Options with `enabled`; set the rest with the methods below.
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            extra: HashMap::new(),
        }
    }
}
impl FeatureOptions {
    /// Options that turn the feature on.
    pub fn enabled() -> Self {
        Self {
            enabled: true,
            ..Self::blank()
        }
    }
}

/// Face detection options.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
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
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            enabled: Default::default(),
            age_estimation: Default::default(),
            extra: Default::default(),
        }
    }
}
impl FaceDetectionOptions {
    /// Options with `enabled`; set the rest with the methods below.
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            age_estimation: Default::default(),
            extra: HashMap::new(),
        }
    }
    /// Also estimate an age range for each face. Defaults to `false`.
    pub fn age_estimation(mut self, value: bool) -> Self {
        self.age_estimation = Some(value);
        self
    }
}
impl FaceDetectionOptions {
    /// Options that turn face detection on, without age estimation.
    pub fn enabled() -> Self {
        Self {
            enabled: true,
            ..Self::blank()
        }
    }
}

/// The bytes of an upload or multipart part.
///
/// `Text` and `Bytes` are sent as they are and can be retried. `Reader`, `Stream` and
/// `UnsizedStream` are read once while the request is sent, so the whole file never needs to be
/// in memory; the SDK does not retry them. `Reader` and `Stream` need the exact `size`.
///
/// `Bytes`, `Base64` and `File` can be read again, so [`AssetsClient::create`] and
/// [`AssetsClient::classify`] upload them in parts when they are larger than the client's
/// [`part_size_bytes`](crate::ServerClientBuilder::part_size_bytes).
///
/// [`AssetsClient::create`]: crate::AssetsClient::create
/// [`AssetsClient::classify`]: crate::AssetsClient::classify
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
    /// A file on disk with its length, read while it is uploaded. Content larger than one
    /// part is read again part by part, so each part can be retried. Create it with
    /// [`Content::file`].
    #[cfg(feature = "async")]
    File {
        /// The file's path.
        path: std::path::PathBuf,
        /// The file's length in bytes.
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
            Self::File { path, size } => f
                .debug_struct("File")
                .field("path", path)
                .field("size", size)
                .finish(),
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
    /// Streams the file at `path` without reading it into memory. A file larger than the
    /// client's [`part_size_bytes`](crate::ServerClientBuilder::part_size_bytes) is uploaded in
    /// parts, so it must stay unchanged until the upload finishes.
    #[cfg(feature = "async")]
    pub fn file(
        path: impl AsRef<std::path::Path>,
        mime_type: impl Into<String>,
    ) -> std::io::Result<Self> {
        let path = path.as_ref();
        let size = std::fs::File::open(path)?.metadata()?.len();
        Ok(Self::new(
            Payload::File {
                path: path.to_owned(),
                size,
            },
            mime_type,
        ))
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
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
    /// Tags for the asset, such as `["catalogue", "backpacks"]`, which it keeps in `tags`.
    /// Uploads through an upload preset can't set them.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
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
    /// The upload preset to apply: its folder, visibility, file types, size limit, moderation
    /// policy and processing options. `processing_options`, when set, replace the preset's.
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
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            name: Default::default(),
            content: Default::default(),
            part: Default::default(),
            url: Default::default(),
            description: Default::default(),
            processing_options: Default::default(),
            visibility: Default::default(),
            metadata: Default::default(),
            tags: Default::default(),
            author_id: Default::default(),
            context: Default::default(),
            external_id: Default::default(),
            external_url: Default::default(),
            folder_id: Default::default(),
            upload_preset_id: Default::default(),
            total_size_in_bytes: Default::default(),
            idempotency_key: Default::default(),
        }
    }
}
impl SubmitAsset {
    /// The whole file.
    pub fn content(mut self, value: impl Into<Content>) -> Self {
        self.content = Some(value.into());
        self
    }
    /// The first part of a multipart upload; continue with `upload_part`.
    pub fn part(mut self, value: impl Into<Content>) -> Self {
        self.part = Some(value.into());
        self
    }
    /// A URL CalmLens downloads the file from.
    pub fn url(mut self, value: impl Into<String>) -> Self {
        self.url = Some(value.into());
        self
    }
    /// A description.
    pub fn description(mut self, value: impl Into<String>) -> Self {
        self.description = Some(value.into());
        self
    }
    /// Processing options.
    pub fn processing_options(mut self, value: impl Into<ProcessingOptions>) -> Self {
        self.processing_options = Some(value.into());
        self
    }
    /// CDN visibility.
    pub fn visibility(mut self, value: impl Into<Visibility>) -> Self {
        self.visibility = Some(value.into());
        self
    }
    /// Metadata items.
    pub fn metadata(mut self, value: impl Into<Vec<MetadataItem>>) -> Self {
        self.metadata = Some(value.into());
        self
    }
    /// Tags for the asset, such as `["catalogue", "backpacks"]`, which it keeps in `tags`.
    /// Uploads through an upload preset can't set them.
    pub fn tags(mut self, value: impl Into<Vec<String>>) -> Self {
        self.tags = Some(value.into());
        self
    }
    /// Your identifier for who wrote the content. CalmLens only compares it with the author IDs
    /// in `context`, to tell which posts share a speaker.
    pub fn author_id(mut self, value: impl Into<String>) -> Self {
        self.author_id = Some(value.into());
        self
    }
    /// Earlier posts in the conversation, oldest first. The SDK sends only the posts CalmLens
    /// uses; see [`select_moderation_context_items`].
    pub fn context(mut self, value: impl Into<ModerationContext>) -> Self {
        self.context = Some(value.into());
        self
    }
    /// Your ID for the asset, unique within the project.
    pub fn external_id(mut self, value: impl Into<String>) -> Self {
        self.external_id = Some(value.into());
        self
    }
    /// A link to the asset in your system.
    pub fn external_url(mut self, value: impl Into<String>) -> Self {
        self.external_url = Some(value.into());
        self
    }
    /// The folder to put the asset in.
    pub fn folder_id(mut self, value: impl Into<String>) -> Self {
        self.folder_id = Patch::Value(value.into());
        self
    }
    /// Clears `folder_id`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_folder_id(mut self) -> Self {
        self.folder_id = Patch::Null;
        self
    }
    /// The upload preset to apply: its folder, visibility, file types, size limit, moderation
    /// policy and processing options. `processing_options`, when set, replace the preset's.
    pub fn upload_preset_id(mut self, value: impl Into<String>) -> Self {
        self.upload_preset_id = Some(value.into());
        self
    }
    /// For a multipart upload, the size of the whole file; CalmLens then refuses an upload
    /// that could never finish, and parts that overshoot or fall short.
    pub fn total_size_in_bytes(mut self, value: u64) -> Self {
        self.total_size_in_bytes = Some(value);
        self
    }
    /// The `Idempotency-Key` for this upload. The SDK generates one when it is `None`.
    pub fn idempotency_key(mut self, value: impl Into<String>) -> Self {
        self.idempotency_key = Some(value.into());
        self
    }
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
            ..Self::blank()
        }
    }
    /// An asset CalmLens downloads from `url`.
    pub fn from_url(name: impl Into<String>, url: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            url: Some(url.into()),
            ..Self::blank()
        }
    }
    /// The first part of a multipart upload of the file `name`.
    pub fn multipart(name: impl Into<String>, part: Content) -> Self {
        Self {
            name: name.into(),
            part: Some(part),
            ..Self::blank()
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ModerationContext {
    /// The posts, oldest first.
    pub items: Vec<ModerationContextItem>,
}
impl ModerationContext {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            items: Default::default(),
        }
    }
}
impl ModerationContext {}
impl ModerationContext {
    /// Context of `items`, oldest first.
    pub fn new(items: impl IntoIterator<Item = ModerationContextItem>) -> Self {
        Self {
            items: items.into_iter().collect(),
        }
    }
}

/// An earlier post in the conversation.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ModerationContextItem {
    /// The post's text.
    pub text: String,
    /// Your identifier for who wrote the post.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_id: Option<String>,
}
impl ModerationContextItem {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            text: Default::default(),
            author_id: Default::default(),
        }
    }
}
impl ModerationContextItem {}
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct MetadataItem {
    /// The metadata field ID.
    pub id: String,
    /// The value.
    pub value: Value,
}
impl MetadataItem {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            id: Default::default(),
            value: Default::default(),
        }
    }
}
impl MetadataItem {}
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetId {
    /// The asset ID.
    pub asset_id: String,
}
impl AssetId {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            asset_id: Default::default(),
        }
    }
}
impl AssetId {}
impl From<&str> for AssetId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}
impl From<String> for AssetId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}
impl From<&String> for AssetId {
    fn from(value: &String) -> Self {
        Self::new(value)
    }
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct WaitForDecision {
    /// The asset ID.
    pub asset_id: String,
    /// How long to wait for a decision; 60 seconds when `None`.
    pub timeout: Option<std::time::Duration>,
}
impl WaitForDecision {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            asset_id: Default::default(),
            timeout: Default::default(),
        }
    }
}
impl WaitForDecision {}
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct FolderId {
    /// The folder ID.
    pub folder_id: String,
}
impl FolderId {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            folder_id: Default::default(),
        }
    }
}
impl FolderId {}
impl From<&str> for FolderId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}
impl From<String> for FolderId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}
impl From<&String> for FolderId {
    fn from(value: &String) -> Self {
        Self::new(value)
    }
}
impl FolderId {
    /// Identifies folder `folder_id`.
    pub fn new(folder_id: impl Into<String>) -> Self {
        Self {
            folder_id: folder_id.into(),
        }
    }
}

/// Options for listing assets.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ListAssets {
    /// The cursor returned by the previous page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Items per page, 1 to 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// A filter such as `classification.moderation.decision==allowed`, or `folderId==fldr_…`
    /// (`folderId==null` for the project root) for the assets directly in one folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `-createdAt,id`. Newest first by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
}
impl ListAssets {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The cursor returned by the previous page.
    pub fn cursor(mut self, value: impl Into<String>) -> Self {
        self.cursor = Some(value.into());
        self
    }
    /// Items per page, 1 to 100.
    pub fn page_size(mut self, value: u32) -> Self {
        self.page_size = Some(value);
        self
    }
    /// A filter such as `classification.moderation.decision==allowed`, or `folderId==fldr_…`
    /// (`folderId==null` for the project root) for the assets directly in one folder.
    pub fn filter(mut self, value: impl Into<String>) -> Self {
        self.filter = Some(value.into());
        self
    }
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `-createdAt,id`. Newest first by default.
    pub fn sort(mut self, value: impl Into<String>) -> Self {
        self.sort = Some(value.into());
        self
    }
}

/// Options for listing an asset's children.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ListChildren {
    /// The parent asset ID.
    pub asset_id: String,
    /// The cursor returned by the previous page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Items per page, 1 to 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `-createdAt,id`. Newest first by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
}
impl ListChildren {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            asset_id: Default::default(),
            cursor: Default::default(),
            page_size: Default::default(),
            sort: Default::default(),
        }
    }
}
impl ListChildren {
    /// Options with `asset_id`; set the rest with the methods below.
    pub fn new(asset_id: impl Into<String>) -> Self {
        Self {
            asset_id: asset_id.into(),
            cursor: Default::default(),
            page_size: Default::default(),
            sort: Default::default(),
        }
    }
    /// The cursor returned by the previous page.
    pub fn cursor(mut self, value: impl Into<String>) -> Self {
        self.cursor = Some(value.into());
        self
    }
    /// Items per page, 1 to 100.
    pub fn page_size(mut self, value: u32) -> Self {
        self.page_size = Some(value);
        self
    }
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `-createdAt,id`. Newest first by default.
    pub fn sort(mut self, value: impl Into<String>) -> Self {
        self.sort = Some(value.into());
        self
    }
}

/// Options for listing an audio or video asset's findings timeline.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ListTimeline {
    /// The asset ID.
    pub asset_id: String,
    /// The cursor returned by the previous page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Items per page, 1 to 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
}
impl ListTimeline {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            asset_id: Default::default(),
            cursor: Default::default(),
            page_size: Default::default(),
        }
    }
}
impl ListTimeline {
    /// Options with `asset_id`; set the rest with the methods below.
    pub fn new(asset_id: impl Into<String>) -> Self {
        Self {
            asset_id: asset_id.into(),
            cursor: Default::default(),
            page_size: Default::default(),
        }
    }
    /// The cursor returned by the previous page.
    pub fn cursor(mut self, value: impl Into<String>) -> Self {
        self.cursor = Some(value.into());
        self
    }
    /// Items per page, 1 to 100.
    pub fn page_size(mut self, value: u32) -> Self {
        self.page_size = Some(value);
        self
    }
}

/// Changes to an asset. [`Patch::Missing`] fields are left unchanged.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct UpdateAsset {
    /// The asset ID.
    #[serde(skip_serializing)]
    pub asset_id: String,
    /// The new name. An asset always has a name, so it can't be cleared.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The description.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub description: Patch<String>,
    /// The tags.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub tags: Patch<Vec<String>>,
    /// The metadata items.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub metadata: Patch<Vec<MetadataItem>>,
    /// Your ID for the asset.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub external_id: Patch<String>,
    /// A link to the asset in your system.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub external_url: Patch<String>,
    /// CDN visibility.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub visibility: Patch<Visibility>,
}
impl UpdateAsset {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            asset_id: Default::default(),
            name: Default::default(),
            description: Default::default(),
            tags: Default::default(),
            metadata: Default::default(),
            external_id: Default::default(),
            external_url: Default::default(),
            visibility: Default::default(),
        }
    }
}
impl UpdateAsset {
    /// Options with `asset_id`; set the rest with the methods below.
    pub fn new(asset_id: impl Into<String>) -> Self {
        Self {
            asset_id: asset_id.into(),
            name: Default::default(),
            description: Default::default(),
            tags: Default::default(),
            metadata: Default::default(),
            external_id: Default::default(),
            external_url: Default::default(),
            visibility: Default::default(),
        }
    }
    /// The new name. An asset always has a name, so it can't be cleared.
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = Some(value.into());
        self
    }
    /// The description.
    pub fn description(mut self, value: impl Into<String>) -> Self {
        self.description = Patch::Value(value.into());
        self
    }
    /// Clears `description`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_description(mut self) -> Self {
        self.description = Patch::Null;
        self
    }
    /// The tags.
    pub fn tags(mut self, value: impl Into<Vec<String>>) -> Self {
        self.tags = Patch::Value(value.into());
        self
    }
    /// Clears `tags`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_tags(mut self) -> Self {
        self.tags = Patch::Null;
        self
    }
    /// The metadata items.
    pub fn metadata(mut self, value: impl Into<Vec<MetadataItem>>) -> Self {
        self.metadata = Patch::Value(value.into());
        self
    }
    /// Clears `metadata`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_metadata(mut self) -> Self {
        self.metadata = Patch::Null;
        self
    }
    /// Your ID for the asset.
    pub fn external_id(mut self, value: impl Into<String>) -> Self {
        self.external_id = Patch::Value(value.into());
        self
    }
    /// Clears `external_id`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_external_id(mut self) -> Self {
        self.external_id = Patch::Null;
        self
    }
    /// A link to the asset in your system.
    pub fn external_url(mut self, value: impl Into<String>) -> Self {
        self.external_url = Patch::Value(value.into());
        self
    }
    /// Clears `external_url`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_external_url(mut self) -> Self {
        self.external_url = Patch::Null;
        self
    }
    /// CDN visibility.
    pub fn visibility(mut self, value: impl Into<Visibility>) -> Self {
        self.visibility = Patch::Value(value.into());
        self
    }
    /// Clears `visibility`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_visibility(mut self) -> Self {
        self.visibility = Patch::Null;
        self
    }
}

/// Options for [`AssetsClient::explain`](crate::AssetsClient::explain).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ExplainAsset {
    /// The asset ID.
    #[serde(skip_serializing)]
    pub asset_id: String,
    /// Moderates the asset again with the project's current policy instead of explaining the
    /// decision as made.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub rerun: bool,
}
impl ExplainAsset {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            asset_id: Default::default(),
            rerun: Default::default(),
        }
    }
}
impl ExplainAsset {
    /// Options with `asset_id`; set the rest with the methods below.
    pub fn new(asset_id: impl Into<String>) -> Self {
        Self {
            asset_id: asset_id.into(),
            rerun: Default::default(),
        }
    }
    /// Moderates the asset again with the project's current policy instead of explaining the
    /// decision as made.
    pub fn rerun(mut self, value: bool) -> Self {
        self.rerun = value;
        self
    }
}

/// A reviewer's decision for [`AssetsClient::decide`](crate::AssetsClient::decide).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DecideAsset {
    /// The asset ID.
    #[serde(skip_serializing)]
    pub asset_id: String,
    /// The moderation status to set.
    pub decision: AssetModerationDecision,
    /// Why the reviewer made this decision, 1 to 1499 characters after trimming. It is kept in
    /// the asset's review history.
    pub note: String,
    /// Must be `true` to purge: purging permanently deletes the stored content.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub confirm_purge: bool,
}
impl DecideAsset {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            asset_id: Default::default(),
            decision: Default::default(),
            note: Default::default(),
            confirm_purge: Default::default(),
        }
    }
}
impl DecideAsset {
    /// Must be `true` to purge: purging permanently deletes the stored content.
    pub fn confirm_purge(mut self, value: bool) -> Self {
        self.confirm_purge = value;
        self
    }
}
impl DecideAsset {
    /// Records `decision` on asset `asset_id` with `note`. To purge, also set `confirm_purge`.
    pub fn new(
        asset_id: impl Into<String>,
        decision: impl Into<AssetModerationDecision>,
        note: impl Into<String>,
    ) -> Self {
        Self {
            asset_id: asset_id.into(),
            decision: decision.into(),
            note: note.into(),
            confirm_purge: false,
        }
    }
}

/// Moves an asset to a folder, or to the project root with `folder_id: None`.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct MoveAsset {
    /// The asset ID.
    #[serde(skip_serializing)]
    pub asset_id: String,
    /// The destination folder.
    pub folder_id: Option<String>,
}
impl MoveAsset {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            asset_id: Default::default(),
            folder_id: Default::default(),
        }
    }
}
impl MoveAsset {
    /// Options with `asset_id`; set the rest with the methods below.
    pub fn new(asset_id: impl Into<String>) -> Self {
        Self {
            asset_id: asset_id.into(),
            folder_id: Default::default(),
        }
    }
    /// The destination folder.
    pub fn folder_id(mut self, value: impl Into<String>) -> Self {
        self.folder_id = Some(value.into());
        self
    }
}

/// What [`crate::AssetsClient::batch`] does to every asset.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct BatchAssets {
    /// IDs of 1 to 500 assets in the project.
    pub asset_ids: Vec<String>,
    /// What to do to every asset.
    pub operation: AssetBatchOperation,
}
impl BatchAssets {
    /// Options with `asset_ids`, `operation`; set the rest with the methods below.
    pub fn new(
        asset_ids: impl Into<Vec<String>>,
        operation: impl Into<AssetBatchOperation>,
    ) -> Self {
        Self {
            asset_ids: asset_ids.into(),
            operation: operation.into(),
        }
    }
}

string_enum! {
    /// Where a batch operation stands when [`crate::AssetsClient::batch`] returns.
    AssetBatchStatus {
        /// The operation is queued and runs in the background.
        Queued = "queued",
    }
}

/// The response of [`crate::AssetsClient::batch`]: the operation is queued. Follow it in the
/// events feed: each `asset.deleted` or `asset.content-removed` event it records carries a
/// `batch-id` fact naming `batch_id`.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct BatchAssetsResponse {
    /// The operation's ID (`batch_` and 20 base62 characters).
    pub batch_id: String,
    /// `Queued`.
    pub status: AssetBatchStatus,
    /// How many distinct assets the operation covers.
    pub asset_count: u32,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<BatchAssetsResponse, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl BatchAssetsResponse {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for BatchAssetsResponse {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// A later part of a multipart upload.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct UploadPart {
    /// The asset returned when the upload started.
    pub asset_id: String,
    /// The part, with `part_number` set.
    pub part: Content,
    /// Whether the final part waits for the decision (`true`) or returns with the asset
    /// `queued` (`false`), overriding the choice saved when the upload started (`classify`
    /// waits, `create` doesn't).
    #[serde(default)]
    pub wait: Option<bool>,
    /// The `Idempotency-Key` for this part. The SDK generates one when it is `None`.
    #[serde(default)]
    pub idempotency_key: Option<String>,
}
impl UploadPart {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            asset_id: Default::default(),
            part: Default::default(),
            wait: Default::default(),
            idempotency_key: Default::default(),
        }
    }
}
impl UploadPart {
    /// Options with `asset_id`, `part`; set the rest with the methods below.
    pub fn new(asset_id: impl Into<String>, part: impl Into<Content>) -> Self {
        Self {
            asset_id: asset_id.into(),
            part: part.into(),
            wait: Default::default(),
            idempotency_key: Default::default(),
        }
    }
    /// Whether the final part waits for the decision (`true`) or returns with the asset
    /// `queued` (`false`), overriding the choice saved when the upload started (`classify`
    /// waits, `create` doesn't).
    pub fn wait(mut self, value: bool) -> Self {
        self.wait = Some(value);
        self
    }
    /// The `Idempotency-Key` for this part. The SDK generates one when it is `None`.
    pub fn idempotency_key(mut self, value: impl Into<String>) -> Self {
        self.idempotency_key = Some(value.into());
        self
    }
}

/// Options for [`CdnClient::sign_asset_url`](crate::CdnClient::sign_asset_url). Name the asset by
/// exactly one of `asset_id` and `external_id`.
///
/// `resource`, `lens`, `transform` and `viewer_claims` aren't part of the grant: they are appended
/// to the signed URL exactly as [`CdnClient::get_asset_url`](crate::CdnClient::get_asset_url)
/// appends them, and can be changed later without signing again.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct SignAssetUrlOptions {
    /// The project; defaults to the client's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// The asset ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    /// The external ID the asset was uploaded with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
    /// The lifetime in whole seconds, from 1 to
    /// [`MAX_SIGNED_URL_EXPIRES_IN`](crate::MAX_SIGNED_URL_EXPIRES_IN); defaults to
    /// [`DEFAULT_SIGNED_URL_EXPIRES_IN`](crate::DEFAULT_SIGNED_URL_EXPIRES_IN).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u64>,
    /// Grants the original resource, the exact upload, which the URL refuses otherwise with
    /// `signed-url/original-not-granted`. Defaults to false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original: Option<bool>,
    /// A resource to return the URL of, beneath the signed asset URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<CdnResource>,
    /// A lens identifier, for the rendered or preview resource.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lens: Option<String>,
    /// A transform, for the rendered or preview resource: a selector such as `width=320` or
    /// structured options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<CdnTransform>,
    /// The viewer's region and age confirmation, appended to the URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewer_claims: Option<ViewerClaims>,
}
impl SignAssetUrlOptions {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The project; defaults to the client's.
    pub fn project_id(mut self, value: impl Into<String>) -> Self {
        self.project_id = Some(value.into());
        self
    }
    /// The asset ID.
    pub fn asset_id(mut self, value: impl Into<String>) -> Self {
        self.asset_id = Some(value.into());
        self
    }
    /// The external ID the asset was uploaded with.
    pub fn external_id(mut self, value: impl Into<String>) -> Self {
        self.external_id = Some(value.into());
        self
    }
    /// The lifetime in whole seconds, from 1 to
    /// [`MAX_SIGNED_URL_EXPIRES_IN`](crate::MAX_SIGNED_URL_EXPIRES_IN); defaults to
    /// [`DEFAULT_SIGNED_URL_EXPIRES_IN`](crate::DEFAULT_SIGNED_URL_EXPIRES_IN).
    pub fn expires_in(mut self, value: u64) -> Self {
        self.expires_in = Some(value);
        self
    }
    /// Grants the original resource, the exact upload, which the URL refuses otherwise with
    /// `signed-url/original-not-granted`. Defaults to false.
    pub fn original(mut self, value: bool) -> Self {
        self.original = Some(value);
        self
    }
    /// A resource to return the URL of, beneath the signed asset URL.
    pub fn resource(mut self, value: impl Into<CdnResource>) -> Self {
        self.resource = Some(value.into());
        self
    }
    /// A lens identifier, for the rendered or preview resource.
    pub fn lens(mut self, value: impl Into<String>) -> Self {
        self.lens = Some(value.into());
        self
    }
    /// A transform, for the rendered or preview resource: a selector such as `width=320` or
    /// structured options.
    pub fn transform(mut self, value: impl Into<CdnTransform>) -> Self {
        self.transform = Some(value.into());
        self
    }
    /// The viewer's region and age confirmation, appended to the URL.
    pub fn viewer_claims(mut self, value: impl Into<ViewerClaims>) -> Self {
        self.viewer_claims = Some(value.into());
        self
    }
}

/// Options for [`CdnClient::get_asset_info`](crate::CdnClient::get_asset_info).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct GetAssetInfoOptions {
    /// The viewer claims to read the info for; `None` keeps those the URL carries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewer_claims: Option<ViewerClaims>,
}
impl GetAssetInfoOptions {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The viewer claims to read the info for; `None` keeps those the URL carries.
    pub fn viewer_claims(mut self, value: impl Into<ViewerClaims>) -> Self {
        self.viewer_claims = Some(value.into());
        self
    }
}

/// Options for creating a folder.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CreateFolder {
    /// The name, unique among folders with the same parent.
    pub name: String,
    /// The parent folder, or the project root when missing or null.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub parent_id: Patch<String>,
}
impl CreateFolder {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            name: Default::default(),
            parent_id: Default::default(),
        }
    }
}
impl CreateFolder {
    /// Options with `name`; set the rest with the methods below.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            parent_id: Default::default(),
        }
    }
    /// The parent folder, or the project root when missing or null.
    pub fn parent_id(mut self, value: impl Into<String>) -> Self {
        self.parent_id = Patch::Value(value.into());
        self
    }
    /// Clears `parent_id`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_parent_id(mut self) -> Self {
        self.parent_id = Patch::Null;
        self
    }
}

/// Changes to a folder.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct UpdateFolder {
    /// The folder ID.
    #[serde(skip_serializing)]
    pub folder_id: String,
    /// The new name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}
impl UpdateFolder {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            folder_id: Default::default(),
            name: Default::default(),
        }
    }
}
impl UpdateFolder {
    /// Options with `folder_id`; set the rest with the methods below.
    pub fn new(folder_id: impl Into<String>) -> Self {
        Self {
            folder_id: folder_id.into(),
            name: Default::default(),
        }
    }
    /// The new name.
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = Some(value.into());
        self
    }
}

/// Moves a folder under another, or to the project root with `parent_id: None`.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct MoveFolder {
    /// The folder ID.
    #[serde(skip_serializing)]
    pub folder_id: String,
    /// The new parent.
    pub parent_id: Option<String>,
}
impl MoveFolder {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            folder_id: Default::default(),
            parent_id: Default::default(),
        }
    }
}
impl MoveFolder {
    /// Options with `folder_id`; set the rest with the methods below.
    pub fn new(folder_id: impl Into<String>) -> Self {
        Self {
            folder_id: folder_id.into(),
            parent_id: Default::default(),
        }
    }
    /// The new parent.
    pub fn parent_id(mut self, value: impl Into<String>) -> Self {
        self.parent_id = Some(value.into());
        self
    }
}

/// Options for one page of the events feed. A cursor belongs to the filters it was issued with,
/// so pass the same `types` and `asset_id` with each `cursor`; other filters fail with
/// `cursor/invalid`.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ListEvents {
    /// A previous page's `next_cursor`. Without it, the page is empty and its `next_cursor`
    /// marks now.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Events per page, 1 to 100 (the API's default is 50).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// Only events of these types. Sent as one comma-separated value; an empty list sends none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub types: Option<Vec<EventType>>,
    /// Only events about this asset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
}
impl ListEvents {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// A previous page's `next_cursor`. Without it, the page is empty and its `next_cursor`
    /// marks now.
    pub fn cursor(mut self, value: impl Into<String>) -> Self {
        self.cursor = Some(value.into());
        self
    }
    /// Events per page, 1 to 100 (the API's default is 50).
    pub fn page_size(mut self, value: u32) -> Self {
        self.page_size = Some(value);
        self
    }
    /// Only events of these types. Sent as one comma-separated value; an empty list sends none.
    pub fn types(mut self, value: impl Into<Vec<EventType>>) -> Self {
        self.types = Some(value.into());
        self
    }
    /// Only events about this asset.
    pub fn asset_id(mut self, value: impl Into<String>) -> Self {
        self.asset_id = Some(value.into());
        self
    }
}

/// A named lens definition, for [`ServerClient::ensure_lenses`](crate::ServerClient::ensure_lenses)
/// and [`LensesClient::create`](crate::LensesClient::create).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
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
    /// Whether the CDN serves the lens. Defaults to `true`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    /// The image transform options the lens applies.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub transform: Patch<ImageTransformOptions>,
}
impl LensDefinition {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            identifier: Default::default(),
            name: Default::default(),
            description: Default::default(),
            lens_type: Default::default(),
            active: Default::default(),
            transform: Default::default(),
        }
    }
}
impl LensDefinition {
    /// Options with `identifier`, `name`, `lens_type`; set the rest with the methods below.
    pub fn new(
        identifier: impl Into<String>,
        name: impl Into<String>,
        lens_type: impl Into<LensType>,
    ) -> Self {
        Self {
            identifier: identifier.into(),
            name: name.into(),
            lens_type: lens_type.into(),
            description: Default::default(),
            active: Default::default(),
            transform: Default::default(),
        }
    }
    /// A description.
    pub fn description(mut self, value: impl Into<String>) -> Self {
        self.description = Patch::Value(value.into());
        self
    }
    /// Clears `description`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_description(mut self) -> Self {
        self.description = Patch::Null;
        self
    }
    /// Whether the CDN serves the lens. Defaults to `true`.
    pub fn active(mut self, value: bool) -> Self {
        self.active = Some(value);
        self
    }
    /// The image transform options the lens applies.
    pub fn transform(mut self, value: impl Into<ImageTransformOptions>) -> Self {
        self.transform = Patch::Value(value.into());
        self
    }
    /// Clears `transform`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_transform(mut self) -> Self {
        self.transform = Patch::Null;
        self
    }
}

/// Options for one page of the project's lenses.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ListLenses {
    /// The previous page's `next_cursor`; omit for the first page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Lenses per page, 1 to 100 (the API's default is 50).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `createdAt`. Newest first by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
}
impl ListLenses {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The previous page's `next_cursor`; omit for the first page.
    pub fn cursor(mut self, value: impl Into<String>) -> Self {
        self.cursor = Some(value.into());
        self
    }
    /// Lenses per page, 1 to 100 (the API's default is 50).
    pub fn page_size(mut self, value: u32) -> Self {
        self.page_size = Some(value);
        self
    }
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `createdAt`. Newest first by default.
    pub fn sort(mut self, value: impl Into<String>) -> Self {
        self.sort = Some(value.into());
        self
    }
}

/// Identifies a lens.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct LensId {
    /// The lens ID.
    pub lens_id: String,
}
impl LensId {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            lens_id: Default::default(),
        }
    }
}
impl LensId {}
impl From<&str> for LensId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}
impl From<String> for LensId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}
impl From<&String> for LensId {
    fn from(value: &String) -> Self {
        Self::new(value)
    }
}
impl LensId {
    /// Identifies lens `lens_id`.
    pub fn new(lens_id: impl Into<String>) -> Self {
        Self {
            lens_id: lens_id.into(),
        }
    }
}

/// Changes to a lens; `None` and [`Patch::Missing`] fields are left unchanged. Its identifier
/// can't change.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct UpdateLens {
    /// The lens ID.
    #[serde(skip_serializing)]
    pub lens_id: String,
    /// The new display name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The description.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub description: Patch<String>,
    /// The asset type the lens applies to.
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub lens_type: Option<LensType>,
    /// Whether the CDN serves the lens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    /// The image transform options; the CDN serves the new transform from then on.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub transform: Patch<ImageTransformOptions>,
}
impl UpdateLens {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            lens_id: Default::default(),
            name: Default::default(),
            description: Default::default(),
            lens_type: Default::default(),
            active: Default::default(),
            transform: Default::default(),
        }
    }
}
impl UpdateLens {
    /// The new display name.
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = Some(value.into());
        self
    }
    /// The description.
    pub fn description(mut self, value: impl Into<String>) -> Self {
        self.description = Patch::Value(value.into());
        self
    }
    /// Clears `description`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_description(mut self) -> Self {
        self.description = Patch::Null;
        self
    }
    /// The asset type the lens applies to.
    pub fn lens_type(mut self, value: impl Into<LensType>) -> Self {
        self.lens_type = Some(value.into());
        self
    }
    /// Whether the CDN serves the lens.
    pub fn active(mut self, value: bool) -> Self {
        self.active = Some(value);
        self
    }
    /// The image transform options; the CDN serves the new transform from then on.
    pub fn transform(mut self, value: impl Into<ImageTransformOptions>) -> Self {
        self.transform = Patch::Value(value.into());
        self
    }
    /// Clears `transform`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_transform(mut self) -> Self {
        self.transform = Patch::Null;
        self
    }
}
impl UpdateLens {
    /// Changes nothing yet to lens `lens_id`.
    pub fn new(lens_id: impl Into<String>) -> Self {
        Self {
            lens_id: lens_id.into(),
            ..Self::blank()
        }
    }
}

/// A page of the project's lenses.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct LensPage {
    /// The lenses on this page.
    #[serde(default)]
    pub items: Vec<Lens>,
    /// The cursor for the next page, or None.
    #[serde(default)]
    pub next_cursor: Option<String>,
    /// Whether another page follows.
    pub has_more: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<LensPage, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl LensPage {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for LensPage {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// Options for [`ServerClient::ensure_lenses`](crate::ServerClient::ensure_lenses).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct EnsureLenses {
    /// The lenses, returned in the same order.
    pub lenses: Vec<LensDefinition>,
}
impl EnsureLenses {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            lenses: Default::default(),
        }
    }
}
impl EnsureLenses {
    /// Options with `lenses`; set the rest with the methods below.
    pub fn new(lenses: impl Into<Vec<LensDefinition>>) -> Self {
        Self {
            lenses: lenses.into(),
        }
    }
}

/// An asset URL, or a resource beneath it, for
/// [`CdnClient::get_asset_url`](crate::CdnClient::get_asset_url) and
/// [`CdnClient::serve`](crate::CdnClient::serve). Name the asset by exactly one of `asset_id` and
/// `external_id`.
///
/// Without a `resource`, `get_asset_url` returns the asset URL itself, which takes no lens or
/// transform; `serve` fetches the rendered resource. Only the rendered and preview resources take
/// a `lens` or `transform`.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CdnRequest {
    /// The project; defaults to the client's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// The asset ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    /// The external ID the asset was uploaded with, sent as `ext:` and the URL-encoded ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
    /// The resource beneath the asset URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<CdnResource>,
    /// A lens identifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lens: Option<String>,
    /// A transform: a selector such as `width=320` or structured options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<CdnTransform>,
    /// The viewer's region and age confirmation, appended as the `viewerClaims` query, leaving out
    /// the defaults (no region, age not confirmed). They are assertions from your app; CalmLens
    /// doesn't verify them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewer_claims: Option<ViewerClaims>,
    /// The HTTP method and headers [`CdnClient::serve`](crate::CdnClient::serve) sends, e.g.
    /// `HEAD` or a `Range` header.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub init: Option<HttpOptions>,
}
impl CdnRequest {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The project; defaults to the client's.
    pub fn project_id(mut self, value: impl Into<String>) -> Self {
        self.project_id = Some(value.into());
        self
    }
    /// The asset ID.
    pub fn asset_id(mut self, value: impl Into<String>) -> Self {
        self.asset_id = Some(value.into());
        self
    }
    /// The external ID the asset was uploaded with, sent as `ext:` and the URL-encoded ID.
    pub fn external_id(mut self, value: impl Into<String>) -> Self {
        self.external_id = Some(value.into());
        self
    }
    /// A lens identifier.
    pub fn lens(mut self, value: impl Into<String>) -> Self {
        self.lens = Some(value.into());
        self
    }
    /// A transform: a selector such as `width=320` or structured options.
    pub fn transform(mut self, value: impl Into<CdnTransform>) -> Self {
        self.transform = Some(value.into());
        self
    }
    /// The viewer's region and age confirmation, appended as the `viewerClaims` query, leaving out
    /// the defaults (no region, age not confirmed). They are assertions from your app; CalmLens
    /// doesn't verify them.
    pub fn viewer_claims(mut self, value: impl Into<ViewerClaims>) -> Self {
        self.viewer_claims = Some(value.into());
        self
    }
    /// The HTTP method and headers [`CdnClient::serve`](crate::CdnClient::serve) sends, e.g.
    /// `HEAD` or a `Range` header.
    pub fn init(mut self, value: impl Into<HttpOptions>) -> Self {
        self.init = Some(value.into());
        self
    }
}
impl CdnRequest {
    /// A request for the asset with this ID.
    pub fn asset(asset_id: impl Into<String>) -> Self {
        Self {
            asset_id: Some(asset_id.into()),
            ..Self::default()
        }
    }
    /// A request for the asset uploaded with this external ID.
    pub fn external(external_id: impl Into<String>) -> Self {
        Self {
            external_id: Some(external_id.into()),
            ..Self::default()
        }
    }
    /// This request for `resource`.
    pub fn resource(mut self, resource: impl Into<CdnResource>) -> Self {
        self.resource = Some(resource.into());
        self
    }
}

/// HTTP method and headers for a CDN request. The SDK always sends its own API key.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HttpOptions {
    /// The method; defaults to `GET`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// Extra request headers.
    #[serde(default)]
    pub headers: HashMap<String, String>,
}
impl HttpOptions {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The method; defaults to `GET`.
    pub fn method(mut self, value: impl Into<String>) -> Self {
        self.method = Some(value.into());
        self
    }
    /// Extra request headers.
    pub fn headers(mut self, value: impl Into<HashMap<String, String>>) -> Self {
        self.headers = value.into();
        self
    }
}

/// An asset.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Asset {
    /// Effective action and age assurance for the requested viewer country.

    /// The asset ID.
    pub id: String,
    /// The owning project.
    pub project_id: String,
    /// The parent asset, for child assets CalmLens extracts during processing.
    #[serde(default)]
    pub parent_id: Option<String>,
    /// The pages of the parent document a child shows, numbered from 1; empty when its page isn't
    /// known or it has no parent document.
    #[serde(default)]
    pub parent_pages: Vec<u32>,
    /// The folder, or `None` at the project root.
    #[serde(default)]
    pub folder_id: Option<String>,
    /// The upload preset the asset was uploaded through.
    #[serde(default)]
    pub upload_preset_id: Option<String>,
    /// Milliseconds since the Unix epoch.
    pub created_at: u64,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// The asset type (`type` on the wire).
    #[serde(rename = "type")]
    pub asset_type: AssetType,
    /// The name.
    pub name: String,
    /// The description.
    #[serde(default)]
    pub description: Option<String>,
    /// Your ID for the asset.
    #[serde(default)]
    pub external_id: Option<String>,
    /// A link to the asset in your system.
    #[serde(default)]
    pub external_url: Option<String>,
    /// Metadata items; empty when there are none.
    #[serde(default)]
    pub metadata: Vec<MetadataItem>,
    /// Your identifier for who wrote the content.
    #[serde(default)]
    pub author_id: Option<String>,
    /// The earlier posts CalmLens used, oldest first; `None` once the content is removed.
    #[serde(default)]
    pub context: Option<ModerationContext>,
    /// Tags; empty when there are none.
    #[serde(default)]
    pub tags: Vec<String>,
    /// CDN visibility.
    pub visibility: Visibility,
    /// Where the asset is in the pipeline.
    pub upload: AssetUpload,
    /// Classification progress, the moderation status and report.
    pub classification: AssetClassification,
    /// Whether CalmLens holds the content, and its details.
    pub content: AssetContent,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<Asset, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl Asset {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for Asset {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}
impl Asset {
    /// An asset with `id`, classification status `processing` and moderation status `moderation`,
    /// e.g. for a mock response.
    pub fn new(
        id: impl Into<String>,
        processing: AssetClassificationStatus,
        moderation: Option<AssetModerationDecision>,
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
                    decision: moderation,
                    ..AssetModeration::default()
                },
                ..AssetClassification::default()
            },
            ..Self::default()
        }
    }
    /// Whether the asset is settled: its classification status is `completed` (moderation
    /// decided it) or `failed`. A `queued` or `processing` asset is not, even when a reviewer has
    /// already decided it.
    pub fn is_decided(&self) -> bool {
        matches!(
            self.classification.status,
            AssetClassificationStatus::Completed | AssetClassificationStatus::Failed
        )
    }
}

string_enum! {
    /// Whether an asset's content has been received.
    AssetUploadStatus {
        /// Parts of a multipart upload are still being received.
        Uploading = "uploading",
        /// All content was received.
        Completed = "completed",
    }
}

/// Source upload progress.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetUpload {
    /// Classification or upload progress.
    pub status: AssetUploadStatus,
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetClassification {
    /// Classification or upload progress.
    pub status: AssetClassificationStatus,
    /// Why processing failed, while `status` is `failed`; otherwise `None`.
    #[serde(default)]
    pub failure_reason: Option<AssetFailureReason>,
    /// When the state last changed, in milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// When classification completed, in milliseconds since the Unix epoch.
    #[serde(default)]
    pub completed_at: Option<u64>,
    /// How many sections of a long audio or video asset have been analysed; `None` for assets
    /// analysed in one pass.
    #[serde(default)]
    pub progress: Option<AssetClassificationProgress>,
    /// Whether the results came from one of the project's test inputs rather than analysing the
    /// content. Never use test results, such as age ranges, for real decisions.
    pub test_input: bool,
    /// Content-safety findings and the decision in force.
    pub moderation: AssetModeration,
    /// Person detections when requested; `None` until the feature has run.
    #[serde(default)]
    pub person_detection: Option<PersonDetectionResult>,
    /// Face detections when requested; `None` until the feature has run.
    #[serde(default)]
    pub face_detection: Option<FaceDetectionResult>,
    /// Links and QR codes found; `None` until link detection has run.
    #[serde(default)]
    pub link_detection: Option<LinkDetectionResult>,
    /// Preview. Every link found in the asset, where it leads and its verdict. Present when the
    /// project's policy acts on links; it is not requested through
    /// [`ProcessingOptions::features`].
    #[serde(default)]
    pub link_safety: Option<LinkSafetyResult>,
    /// AI-generation provenance when requested.
    #[serde(default)]
    pub ai_generated_detection: Option<AiGeneratedDetectionResult>,
    /// What OCR found in an image when requested; `None` until it has run.
    #[serde(default)]
    pub ocr: Option<OcrResult>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetClassification, _>")]
    pub extra: HashMap<String, Value>,
}

/// How far the analysis of a long audio or video asset, done in sections, has got.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetClassificationProgress {
    /// The sections analysed so far.
    pub completed_sections: u32,
    /// The sections in all.
    pub total_sections: u32,
    /// Fields this SDK version does not know.
    #[serde(
        flatten,
        deserialize_with = "extra_fields::<AssetClassificationProgress, _>"
    )]
    pub extra: HashMap<String, Value>,
}

/// One reviewer decision in an asset's review history.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
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
    /// Who made the decision.
    pub decided_by: ReviewActor,
    /// Review time in milliseconds since the Unix epoch.
    pub reviewed_at: u64,
    /// Whether the decision was applied to the asset. `false` for a review queue decision that
    /// was recorded without changing the asset's status.
    pub applied: bool,
}

string_enum! {
    /// Who made a reviewer's decision.
    ReviewActorType {
        /// A person, or an assistant's key acting for the person who approved it.
        User = "user",
        /// An API key of its own.
        ApiKey = "api-key",
    }
}

/// Who made a reviewer's decision on an asset: a person, or an API key through the API.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ReviewActor {
    /// A `user` (or an assistant acting for one) or an `api-key`.
    #[serde(rename = "type")]
    pub actor_type: ReviewActorType,
    /// The user's or API key's ID; `None` when it was not recorded.
    #[serde(default)]
    pub id: Option<String>,
}

/// The policy that made a decision: its ID, its revision then and the preset release it used.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DecisionPolicy {
    /// The policy's ID.
    pub id: String,
    /// The policy's revision when it made the decision.
    pub revision: u64,
    /// The preset release the policy used; `None` for a policy not made from a preset.
    #[serde(default)]
    pub preset: Option<DecisionPolicyPreset>,
}

/// The built-in preset release a decision's policy used.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DecisionPolicyPreset {
    /// The preset's ID.
    pub id: PolicyPresetId,
    /// The preset release.
    pub version: u64,
}

string_enum! {
    /// Why an asset is waiting for human review.
    PendingReviewReason {
        /// The decision was sampled for review.
        Sampled = "sampled",
        /// The classification was uncertain.
        Uncertain = "uncertain",
    }
}

/// A review the human review queue is waiting for.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetPendingReview {
    /// When the asset joined the queue, in Unix milliseconds.
    pub requested_at: i64,
    /// `sampled` or `uncertain`.
    pub reason: PendingReviewReason,
    /// The categories that made the decision uncertain; empty for a sampled decision.
    #[serde(default)]
    pub uncertain_categories: Vec<ClassificationCategory>,
}

string_enum! {
    /// What determined an asset's automated moderation status.
    ModerationSource {
        /// The moderation policy.
        Policy = "policy",
        /// The rules for content involving children.
        Children = "children",
        /// A hash list match.
        HashList = "hash-list",
        /// A rule every policy applies.
        MandatoryRule = "mandatory-rule",
        /// Preview. The links in the asset.
        LinkSafety = "link-safety",
    }
}

/// Content-safety findings and decision.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetModeration {
    /// Reviews in chronological order.
    #[serde(default)]
    pub manual_reviews: Vec<AssetReview>,
    /// The moderation decision in force, which also decides delivery, with reviewer decisions
    /// taking precedence.
    #[serde(default)]
    pub decision: Option<AssetModerationDecision>,
    /// The status automated moderation decided; `None` before a decision. Manual reviews can
    /// change `status` without changing this, so the two differ when a reviewer overrode the
    /// automated decision.
    #[serde(default)]
    pub automated_status: Option<AssetModerationDecision>,
    /// The policy that made the automated decision, as it was then; `None` until moderation
    /// decides.
    #[serde(default)]
    pub policy: Option<DecisionPolicy>,
    /// The review the human review queue is waiting for, set with the automated decision that
    /// joined the queue; `None` when no review is waiting.
    #[serde(default)]
    pub pending_review: Option<AssetPendingReview>,
    /// What determined the automated status.
    #[serde(default)]
    pub source: Option<ModerationSource>,
    /// Mandatory rule that determined the automated status.
    #[serde(default)]
    pub rule: Option<String>,
    /// Categories acted on by automation.
    #[serde(default)]
    pub flagged_categories: Vec<ClassificationCategory>,
    /// Stricter regional outcomes.
    #[serde(default)]
    pub regions: Vec<RegionalDecision>,
    /// Whether the saved decision has a complete explanation.
    #[serde(default)]
    pub explanation_complete: Option<bool>,
    /// Policy-adjusted category results; `None` until moderation decides.
    #[serde(default)]
    pub categories: Option<HashMap<ClassificationCategory, CategoryPolicyScore>>,
    /// Detection findings before policy evaluation.
    #[serde(default)]
    pub raw: Option<ModerationRaw>,
    /// Summary of an audio or video asset's findings timeline; `None` for other assets and when
    /// there is none. List its segments with
    /// [`AssetsClient::list_timeline`](crate::AssetsClient::list_timeline).
    #[serde(default)]
    pub timeline: Option<AssetModerationTimeline>,
    /// Preview. What the policy's link-safety section made of the asset's links; `None` when
    /// the policy doesn't act on links.
    #[serde(default)]
    pub link_safety: Option<LinkSafetyDecision>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetModeration, _>")]
    pub extra: HashMap<String, Value>,
}

/// Whether CalmLens holds an asset's content, and the content's details.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetContent {
    /// `temporary` until processing finishes, `stored`, or `removed`.
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
    /// Digests of the file as stored: for an image, after embedded metadata is removed unless
    /// `store_sensitive_metadata` is on.
    #[serde(default)]
    pub checksums: Option<Checksums>,
    /// The width in pixels of the uploaded image or video; `None` when unknown, for other types
    /// and while the asset is held.
    #[serde(default)]
    pub width: Option<u32>,
    /// The height in pixels of the uploaded image or video, like `width`.
    #[serde(default)]
    pub height: Option<u32>,
    /// The length in seconds of audio and video once analysed; otherwise `None`.
    #[serde(default)]
    pub duration_seconds: Option<f64>,
    /// The number of pages or slides of a document or presentation, when known.
    #[serde(default)]
    pub page_count: Option<u32>,
    /// The PDQ perceptual hash used to match visually similar images, as 64 hexadecimal
    /// characters, for image assets. Hashes 31 or fewer bits apart are usually the same picture.
    /// `None` while the asset is held.
    #[serde(default)]
    pub perceptual_hash: Option<String>,
    /// How much detail `perceptual_hash` captured, from 0 to 100. Hashes below 50 come from flat
    /// or featureless images and match unrelated pictures, so leave them out of comparisons.
    #[serde(default)]
    pub perceptual_hash_quality: Option<u32>,
    /// Metadata embedded in an uploaded image, such as its capture time, camera and software.
    /// Read-only and separate from the asset's own `metadata`; `None` when the image declares
    /// none, for other asset types, once the content is removed and while the asset is held.
    #[serde(default)]
    pub metadata: Option<FileMetadata>,
    /// Text extracted from the content.
    #[serde(default)]
    pub extracted_text: Option<ExtractedText>,
    /// The displayable file, served at the rendered resource: an image, a PDF, or browser-safe
    /// video or audio. `None` when the asset has none (text, spreadsheets and other files, or
    /// media not yet made browser-safe), once the content is removed and while the asset is held.
    #[serde(default)]
    pub rendered: Option<AssetRendered>,
    /// Preview. The adaptive (HLS) stream of video or audio, once streaming has prepared it from
    /// the rendered file, served at [`CdnResource::Hls`] and played by [`CdnResource::Embed`].
    /// `None` for other assets, until a stream is prepared, once the content is removed and while
    /// the asset is held.
    #[serde(default)]
    pub hls: Option<AssetHls>,
    /// A still image for the asset, served at the preview resource (and its blurred placeholder
    /// at the placeholder resource). `None` when the asset has none (text, spreadsheets and other
    /// files, or a document, video or audio whose still isn't made yet), once the content is
    /// removed and while the asset is held.
    #[serde(default)]
    pub preview: Option<AssetPreview>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetContent, _>")]
    pub extra: HashMap<String, Value>,
}

/// Summary of an audio or video asset's findings timeline.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetModerationTimeline {
    /// How many segments the asset's findings timeline holds.
    pub segment_count: u32,
    /// Fields this SDK version does not know.
    #[serde(
        flatten,
        deserialize_with = "extra_fields::<AssetModerationTimeline, _>"
    )]
    pub extra: HashMap<String, Value>,
}

/// Detection findings before policy evaluation.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ModerationRaw {
    /// Raw category scores and qualifiers.
    #[serde(default)]
    pub categories: HashMap<ClassificationCategory, CategoryResult>,
    /// Matches against project hash lists.
    #[serde(default)]
    pub hash_matches: Vec<HashMatch>,
}

/// How strongly a category meets the policy, from 0 to 1, and what the policy does with it.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CategoryPolicyScore {
    /// The policy score.
    pub score: f64,
    /// `allow`, `limit`, `age-restrict`, `block` or `purge`.
    pub action: FlaggedContentAction,
    /// The rule that decided the category, or that its policy score stayed below 50%.
    #[serde(default)]
    pub source: Option<CategoryPolicySource>,
    /// Settings at decision time, independent of subsequent policy edits.
    #[serde(default)]
    pub settings: Option<CategoryPolicySettingsSnapshot>,
}

string_enum! {
    /// What set a category's action.
    CategoryPolicySourceKind {
        /// The category's default action.
        Default = "default",
        /// The score was below the category's threshold.
        BelowThreshold = "below-threshold",
        /// An allowance rule.
        Allowance = "allowance",
        /// A restriction rule.
        Restriction = "restriction",
    }
}

/// The rule that decided the outcome, or that the policy score stayed below 50%.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CategoryPolicySource {
    /// `allowance`, `restriction`, `default` or `below-threshold`.
    pub kind: CategoryPolicySourceKind,
    /// For an allowance or restriction, the indexes of the deciding rules, the decisive rule
    /// first; `None` for `default` and `below-threshold`.
    #[serde(default)]
    pub indexes: Option<Vec<usize>>,
    /// For an allowance or restriction, the evidence that triggered the rules, from 0 to 1: a
    /// restriction's same-content presence or the allowances' coverage. A rule with `unless`
    /// qualifiers, or several `when` qualifiers, is assessed as a whole, so its qualifiers can be
    /// missing from `raw`. `None` for the other kinds.
    #[serde(default)]
    pub condition_score: Option<f64>,
}

/// A named rule in force when the asset was decided.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PolicyRuleSnapshot {
    /// Saved name.
    #[serde(default)]
    pub name: Option<String>,
    /// Saved when.
    #[serde(default)]
    pub when: Vec<ModerationQualifier>,
    /// Same-instance exclusions.
    #[serde(default)]
    pub unless: Option<Vec<ModerationQualifier>>,
    /// Saved action.
    pub action: FlaggedContentAction,
}

/// Historical category settings for explaining the decision.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CategoryPolicySettingsSnapshot {
    /// Saved default action.
    pub action: FlaggedContentAction,
    /// Saved allowances.
    #[serde(default)]
    pub allowances: Vec<PolicyRuleSnapshot>,
    /// Saved restrictions.
    #[serde(default)]
    pub restrictions: Vec<PolicyRuleSnapshot>,
}

string_enum! {
    /// A region with its own moderation rules.
    ModerationRegion {
        /// Germany.
        De = "DE",
        /// Austria.
        At = "AT",
        /// France.
        Fr = "FR",
        /// The United Kingdom.
        Gb = "GB",
        /// The European Union.
        Eu = "EU",
        /// Australia.
        Au = "AU",
        /// Brazil.
        Br = "BR",
    }
}

string_enum! {
    /// The moderation status a regional rule sets for viewers in its region.
    RegionalDecisionStatus {
        /// Delivered, marked so your app can reduce its reach.
        Limited = "limited",
        /// Delivered only through signed URLs or with an API key.
        AgeRestricted = "age-restricted",
        /// Not delivered; the content is kept.
        Blocked = "blocked",
        /// Not delivered, and the stored content is deleted.
        Purged = "purged",
    }
}

/// A stricter delivery decision in one jurisdiction the project serves.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct RegionalDecision {
    /// Viewer country or rule jurisdiction.
    pub region: ModerationRegion,
    /// The status in force in the region, stricter than the asset's moderation status:
    /// `limited`, `age-restricted`, `blocked` or `purged`.
    pub status: RegionalDecisionStatus,
    /// Stable mandatory rule key.
    pub rule: String,
    /// The category whose findings the rule acted on, when it acts on one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<ClassificationCategory>,
}

/// One category's result.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CategoryResult {
    /// Whether the category was assessed.
    pub status: EvaluationStatus,
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
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<CategoryResult, _>")]
    pub extra: HashMap<String, Value>,
}

string_enum! {
    /// Whether a moderation qualifier was assessed.
    QualifierEvaluationStatus {
        /// Assessed.
        Evaluated = "evaluated",
        /// Not assessed; `reason` says why.
        NotEvaluated = "not-evaluated",
    }
}

/// A qualifier's result.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct QualifierResult {
    /// Confidence that the content is only this qualifier, from 0 to 1; never above `some_score`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all_score: Option<f64>,
    /// Whether the qualifier was assessed.
    pub status: QualifierEvaluationStatus,
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
    /// Why a requested feature did not run.
    FeatureNotEvaluatedReason {
        /// The feature does not apply to this asset, e.g. a text asset.
        NotSupported = "not-supported",
        /// The feature could not run this time.
        Unavailable = "unavailable",
        /// The asset is a document or website whose images are each a child asset with its own
        /// result: list them with `assets().list_children`.
        InChildren = "in-children",
    }
}

/// Results of the features requested in [`ProcessingOptions::features`], keyed by feature.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PersonDetectionResult {
    /// Whether the feature ran.
    pub status: FeatureResultStatus,
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct FaceDetectionResult {
    /// Whether the feature ran.
    pub status: FeatureResultStatus,
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct LinkDetectionResult {
    /// Whether the feature ran.
    pub status: FeatureResultStatus,
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DetectedQrCode {
    /// The decoded value.
    pub value: String,
    /// Where the QR code is (`box` on the wire).
    #[serde(rename = "box")]
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DetectedLink {
    /// The URL.
    pub url: String,
    /// Where it was found.
    pub source: LinkSource,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<DetectedLink, _>")]
    pub extra: HashMap<String, Value>,
}

/// Preview. Link safety's result. `links` is present when `status` is `Evaluated`, and `reason`
/// when it is `NotEvaluated`. Link checks never change a moderation category's score.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct LinkSafetyResult {
    /// Whether the feature ran.
    #[serde(default)]
    pub status: Option<FeatureResultStatus>,
    /// Why the feature did not run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<FeatureNotEvaluatedReason>,
    /// Every link found in the asset and what its destination is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<CheckedLink>>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<LinkSafetyResult, _>")]
    pub extra: HashMap<String, Value>,
}

string_enum! {
    /// Preview. What a link's destination is.
    LinkSafetyVerdict {
        /// Every reputation check passed.
        Safe = "safe",
        /// The domain's content categories mark it as adult.
        Adult = "adult",
        /// The domain's content categories mark it as gambling.
        Gambling = "gambling",
        /// A threat list or the domain's security risks mark it as phishing.
        Phishing = "phishing",
        /// A threat list or the domain's security risks mark it as malware.
        Malware = "malware",
        /// A short link or redirect chain could not be followed, or a check failed.
        Unresolved = "unresolved",
    }
}

string_enum! {
    /// Preview. What happens to an asset over its links. Purging content over a link is never
    /// offered.
    LinkSafetyAction {
        /// Take no action.
        Allow = "allow",
        /// Deliver normally, but mark the asset `limited` so your app can reduce its reach.
        Limit = "limit",
        /// Deliver only through signed URLs or with an API key, so your backend can limit it to
        /// adults.
        AgeRestrict = "age-restrict",
        /// Block delivery while keeping the content.
        Block = "block",
    }
}

string_enum! {
    /// Preview. A reputation check of a link, every address it redirects through and its
    /// destination.
    LinkSafetyCheck {
        /// The content categories and security risks of every domain on the way.
        DomainCategories = "domain-categories",
        /// A threat-list lookup of every URL on the way.
        ThreatLists = "threat-lists",
    }
}

string_enum! {
    /// Preview. Whether a link check answered.
    LinkSafetyCheckStatus {
        /// The check answered.
        Checked = "checked",
        /// The check could not answer, which makes the link `unresolved`.
        Failed = "failed",
    }
}

/// Preview. A link in the asset and what its destination is.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CheckedLink {
    /// The link as found, with `https://` added when it was left out.
    #[serde(default)]
    pub url: String,
    /// Where the link leads after following its redirects; `None` when a short link or
    /// redirect chain could not be followed.
    #[serde(default)]
    pub final_url: Option<String>,
    /// How many redirects were followed to reach `final_url`.
    #[serde(default)]
    pub redirects: u32,
    /// Where it was found.
    #[serde(default)]
    pub source: LinkSource,
    /// What its destination is: the most severe finding of any address on the way.
    #[serde(default)]
    pub verdict: LinkSafetyVerdict,
    /// The reputation checks of the link, its redirects and its destination.
    #[serde(default)]
    pub evidence: Vec<LinkSafetyEvidence>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<CheckedLink, _>")]
    pub extra: HashMap<String, Value>,
}

/// Preview. One reputation check of a link, every address it redirects through and its
/// destination.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct LinkSafetyEvidence {
    /// Which check this is.
    #[serde(default)]
    pub check: LinkSafetyCheck,
    /// Whether the check answered.
    #[serde(default)]
    pub status: LinkSafetyCheckStatus,
    /// What the check reported for any of the addresses, such as the domains' content categories
    /// and security risks or the threat types listed.
    #[serde(default)]
    pub labels: Vec<String>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<LinkSafetyEvidence, _>")]
    pub extra: HashMap<String, Value>,
}

/// Preview. What a policy's link-safety section made of an asset's links.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct LinkSafetyDecision {
    /// The strongest action the asset's links take under the policy's link-safety settings.
    #[serde(default)]
    pub action: LinkSafetyAction,
    /// The links that take that action, with where each leads and its verdict.
    #[serde(default)]
    pub links: Vec<CheckedLink>,
    /// The link-safety settings in force at decision time.
    #[serde(default)]
    pub settings: LinkSafetySettings,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<LinkSafetyDecision, _>")]
    pub extra: HashMap<String, Value>,
}

/// Preview. What happens to assets that link to unsafe destinations. Link checks never change a
/// moderation category's score.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct LinkSafetySettings {
    /// What happens to an asset with a link of each verdict. A verdict left out is allowed;
    /// `safe` is never a key.
    #[serde(default)]
    pub verdict_actions: HashMap<LinkSafetyVerdict, LinkSafetyAction>,
    /// Acts on every link whose destination is outside the allowed domains, whatever its
    /// verdict.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub off_platform_links: Option<OffPlatformLinks>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<LinkSafetySettings, _>")]
    pub extra: HashMap<String, Value>,
}

/// Preview. The action for links that lead outside the allowed domains.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct OffPlatformLinks {
    /// What happens to an asset with such a link; never `Allow`.
    #[serde(default)]
    pub action: LinkSafetyAction,
    /// Bare lowercase domains, such as `example.com`, whose links are on platform. A domain
    /// also covers its subdomains.
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<OffPlatformLinks, _>")]
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AiGeneratedDetectionResult {
    /// Whether the feature ran.
    #[serde(default)]
    pub status: Option<FeatureResultStatus>,
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
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

/// What OCR found in an image. Its text is in `content.extracted_text`.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct OcrResult {
    /// Whether OCR ran.
    pub status: FeatureResultStatus,
    /// Why OCR has no findings, when `status` is `NotEvaluated`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<FeatureNotEvaluatedReason>,
    /// Where OCR found text, and personal information within it, when `status` is `Evaluated`;
    /// empty when the image has no text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_regions: Option<Vec<TextRegion>>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<OcrResult, _>")]
    pub extra: HashMap<String, Value>,
}

/// A region of text found in an image.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct TextRegion {
    /// Where the text is (`box` on the wire).
    #[serde(rename = "box")]
    pub bounding_box: BoundingBox,
    /// Whether the text holds personal information.
    pub personal_information: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<TextRegion, _>")]
    pub extra: HashMap<String, Value>,
}

string_enum! {
    /// Where a hash match came from.
    HashMatchSource {
        /// A hash list.
        HashList = "hash-list",
    }
}

/// A hash list entry an image matched.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HashMatch {
    /// Where the match came from: `hash-list`.
    pub source: HashMatchSource,
    /// The hash list.
    pub hash_list_id: String,
    /// The matched entry.
    pub hash_list_entry_id: String,
    /// The Hamming distance between the hashes; lower is closer.
    pub distance: f64,
    /// What the list does with matches.
    pub action: HashListAction,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<HashMatch, _>")]
    pub extra: HashMap<String, Value>,
}

/// A detected person.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DetectedPerson {
    /// Where the person is (`box` on the wire).
    #[serde(rename = "box")]
    pub bounding_box: BoundingBox,
    /// Detection confidence from 0 to 1.
    pub confidence: f64,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<DetectedPerson, _>")]
    pub extra: HashMap<String, Value>,
}

/// A detected face.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DetectedFace {
    /// Where the face is (`box` on the wire).
    #[serde(rename = "box")]
    pub bounding_box: BoundingBox,
    /// Detection confidence from 0 to 1.
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct BoundingBox {
    /// The left edge.
    pub left: f64,
    /// The top edge.
    pub top: f64,
    /// The width.
    pub width: f64,
    /// The height.
    pub height: f64,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<BoundingBox, _>")]
    pub extra: HashMap<String, Value>,
}

/// An estimated age range in years. Estimates can be off by several years.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AgeRange {
    /// The lowest estimated age.
    pub low: u32,
    /// The highest estimated age.
    pub high: u32,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AgeRange, _>")]
    pub extra: HashMap<String, Value>,
}

/// A time segment's results.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct MediaClassificationSegment {
    /// What the scores come from.
    pub source: MediaSegmentSource,
    /// The segment start.
    pub start_seconds: f64,
    /// The segment end.
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
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
    /// Whether another page follows.
    pub has_more: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetPage, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl AssetPage {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for AssetPage {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}
impl AssetPage {
    /// A page of `items`, with `has_more`, e.g. for a mock response.
    pub fn new(items: Vec<Asset>, has_more: bool) -> Self {
        Self {
            items,
            has_more,
            ..Self::default()
        }
    }
}

/// A page of an audio or video asset's findings timeline, in time order.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetTimelinePage {
    /// The segments on this page.
    #[serde(default)]
    pub items: Vec<MediaClassificationSegment>,
    /// The cursor for the next page, or None.
    #[serde(default)]
    pub next_cursor: Option<String>,
    /// Whether another page follows.
    pub has_more: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetTimelinePage, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl AssetTimelinePage {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for AssetTimelinePage {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// A folder.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Folder {
    /// The folder ID.
    pub id: String,
    /// The name.
    pub name: String,
    /// The parent folder, or `None` at the project root.
    #[serde(default)]
    pub parent_id: Option<String>,
    /// The owning project.
    pub project_id: String,
    /// Milliseconds since the Unix epoch.
    pub created_at: u64,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<Folder, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl Folder {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for Folder {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}
impl Folder {
    /// A folder with `id`, `name` and `parent_id`, e.g. for a mock response.
    pub fn new(id: impl Into<String>, name: impl Into<String>, parent_id: Option<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            parent_id,
            ..Self::default()
        }
    }
}

string_enum! {
    /// The key of an event fact, registered for its event type.
    EventFactKey {
        /// The `asset-name` fact.
        AssetName = "asset-name",
        /// The `asset-type` fact.
        AssetType = "asset-type",
        /// The `file-format` fact.
        FileFormat = "file-format",
        /// The `test` fact.
        Test = "test",
        /// The `parent-asset` fact.
        ParentAsset = "parent-asset",
        /// The `flagged-categories` fact.
        FlaggedCategories = "flagged-categories",
        /// The `moderation-status` fact.
        ModerationStatus = "moderation-status",
        /// The `automated-status` fact.
        AutomatedStatus = "automated-status",
        /// The `region` fact.
        Region = "region",
        /// The `rule` fact.
        Rule = "rule",
        /// The `status` fact.
        Status = "status",
        /// The `reviewer-name` fact.
        ReviewerName = "reviewer-name",
        /// The `note` fact.
        Note = "note",
        /// The `child-asset` fact.
        ChildAsset = "child-asset",
        /// The `child-status` fact.
        ChildStatus = "child-status",
        /// The `previous-status` fact.
        PreviousStatus = "previous-status",
        /// The `failure-reason` fact.
        FailureReason = "failure-reason",
        /// The `completed-sections` fact.
        CompletedSections = "completed-sections",
        /// The `total-sections` fact.
        TotalSections = "total-sections",
        /// The `batch-id` fact.
        BatchId = "batch-id",
        /// The `review-reason` fact.
        ReviewReason = "review-reason",
        /// The `uncertain-categories` fact.
        UncertainCategories = "uncertain-categories",
        /// The `review-id` fact.
        ReviewId = "review-id",
        /// The `decision` fact.
        Decision = "decision",
        /// The `applied-to-asset` fact.
        AppliedToAsset = "applied-to-asset",
        /// The `hash-list-id` fact.
        HashListId = "hash-list-id",
        /// The `hash-list-name` fact.
        HashListName = "hash-list-name",
        /// The `distance` fact.
        Distance = "distance",
        /// The `match-action` fact.
        MatchAction = "match-action",
        /// The `limit` fact.
        Limit = "limit",
        /// The `used` fact.
        Used = "used",
        /// The `organisation-id` fact.
        OrganisationId = "organisation-id",
        /// The `reason` fact.
        Reason = "reason",
        /// The `resumes-at` fact.
        ResumesAt = "resumes-at",
        /// The `preset-id` fact.
        PresetId = "preset-id",
        /// The `preset-name` fact.
        PresetName = "preset-name",
        /// The `daily-limit` fact.
        DailyLimit = "daily-limit",
        /// The `member-user-id` fact.
        MemberUserId = "member-user-id",
        /// The `member-name` fact.
        MemberName = "member-name",
        /// The `role` fact.
        Role = "role",
        /// The `previous-role` fact.
        PreviousRole = "previous-role",
        /// The `invitee-email` fact.
        InviteeEmail = "invitee-email",
        /// The `previous-organisation-id` fact.
        PreviousOrganisationId = "previous-organisation-id",
        /// The `previous-organisation-name` fact.
        PreviousOrganisationName = "previous-organisation-name",
        /// The `organisation-name` fact.
        OrganisationName = "organisation-name",
        /// The `method` fact.
        Method = "method",
        /// The `api-keys-revoked` fact.
        ApiKeysRevoked = "api-keys-revoked",
        /// The `connectors-paused` fact.
        ConnectorsPaused = "connectors-paused",
        /// The `key-id` fact.
        KeyId = "key-id",
        /// The `key-name` fact.
        KeyName = "key-name",
        /// The `created-by-name` fact.
        CreatedByName = "created-by-name",
        /// The `revoked-by-name` fact.
        RevokedByName = "revoked-by-name",
        /// The `deleted-by-name` fact.
        DeletedByName = "deleted-by-name",
        /// The `connector-id` fact.
        ConnectorId = "connector-id",
        /// The `connector-name` fact.
        ConnectorName = "connector-name",
        /// The `connector-type` fact.
        ConnectorType = "connector-type",
        /// The `consecutive-failures` fact.
        ConsecutiveFailures = "consecutive-failures",
        /// The `last-error` fact.
        LastError = "last-error",
    }
}

/// An event fact registered for the event type.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventFact {
    /// The registered fact key, e.g. `reviewer`.
    pub key: EventFactKey,
    /// The value.
    pub value: Value,
    /// A link for the fact.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<EventFact, _>")]
    pub extra: HashMap<String, Value>,
}

string_enum! {
    /// Who caused an event.
    ActorType {
        /// A person in the portal, or an assistant's key acting for the person who approved it.
        User = "user",
        /// An API key of its own.
        ApiKey = "api-key",
        /// Automated moderation.
        Automated = "automated",
        /// CalmLens itself, such as when it pauses uploads.
        System = "system",
    }
}

/// Who caused an event: a `user` (or an assistant acting for one), an `api-key`, `automated`
/// moderation or CalmLens itself (`system`).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Actor {
    /// What kind of actor it is (`type` on the wire).
    #[serde(rename = "type")]
    pub actor_type: ActorType,
    /// The user's or API key's ID. `None` for `automated` and `system`, and when the ID was not
    /// recorded.
    #[serde(default)]
    pub id: Option<String>,
}
impl Actor {
    /// An actor of `actor_type` with `id`, e.g. for a mock event.
    pub fn new(actor_type: impl Into<ActorType>, id: Option<String>) -> Self {
        Self {
            actor_type: actor_type.into(),
            id,
        }
    }
}

/// An event from the events feed.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Event {
    /// The event ID.
    pub id: String,
    /// The event type (`type` on the wire). Every event has one; types this SDK version does
    /// not know arrive as [`EventType::Unknown`].
    #[serde(rename = "type")]
    pub event_type: EventType,
    /// Milliseconds since the Unix epoch. The API always sends it; `0` only in an event built
    /// for a mock, which fills it in.
    pub created_at: u64,
    /// The owning project. The API always sends it; empty only in an event built for a mock,
    /// which fills it in.
    pub project_id: String,
    /// Who caused the event. The API always sends it; the default (an empty actor type) only in
    /// an event built for a mock, which fills it in.
    pub actor: Actor,
    /// The severity.
    pub severity: EventSeverity,
    /// The title.
    pub title: String,
    /// The description.
    #[serde(default)]
    pub description: Option<String>,
    /// The asset the event concerns.
    #[serde(default)]
    pub asset_id: Option<String>,
    /// Increases with each event about the asset; `None` for events not about an asset.
    /// Deliveries can arrive out of order: see [`crate::is_newer_asset_event`].
    #[serde(default)]
    pub asset_sequence: Option<u64>,
    /// Snapshot of the asset's state when the event was created. Retrieve the
    /// asset for its current state.
    #[serde(default)]
    pub asset: Option<EventAsset>,
    /// The event's facts.
    #[serde(default)]
    pub facts: Vec<EventFact>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<Event, _>")]
    pub extra: HashMap<String, Value>,
}
impl Event {
    /// An event with `id` and `event_type`, e.g. for a mock response.
    pub fn new(id: impl Into<String>, event_type: impl Into<EventType>) -> Self {
        Self {
            id: id.into(),
            event_type: event_type.into(),
            ..Self::default()
        }
    }
}

/// The JSON body of a webhook delivery: the event in the same shape as an [`Event`] from the
/// events feed. Read it with [`crate::construct_webhook_event`], which checks the fields' types
/// first; [`json`](Self::json) returns the body as received, including fields this SDK version
/// does not model.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
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
    /// Who caused the event. CalmLens sends it with every delivery; `None` only for a body
    /// without one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<Actor>,
    /// The severity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<EventSeverity>,
    /// The title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The description, or `None` when the event has none.
    #[serde(default)]
    pub description: Option<String>,
    /// The asset the event concerns, or `None`.
    #[serde(default)]
    pub asset_id: Option<String>,
    /// Increases with each event about the asset; `None` for events not about an asset.
    /// Deliveries can arrive out of order: see [`crate::is_newer_asset_event`].
    #[serde(default)]
    pub asset_sequence: Option<u64>,
    /// Snapshot of the asset's state when the event was created, or `None`. Retrieve the asset
    /// for its current state.
    #[serde(default)]
    pub asset: Option<EventAsset>,
    /// The event's facts.
    #[serde(default)]
    pub facts: Vec<EventFact>,
    /// The body this payload was parsed from.
    #[serde(skip)]
    received: Option<Value>,
}
impl WebhookEventPayload {
    /// The delivery body CalmLens sends for `event`, e.g. to test a webhook handler.
    pub fn from_event(event: &Event) -> Self {
        Self {
            id: event.id.clone(),
            event_type: event.event_type.clone(),
            created_at: event.created_at,
            project_id: event.project_id.clone(),
            // An event built without an actor, e.g. for a mock, is delivered without one.
            actor: (event.actor != Actor::default()).then(|| event.actor.clone()),
            // Likewise an event built without a severity or title, which the API always sets.
            severity: (event.severity != EventSeverity::default()).then(|| event.severity.clone()),
            title: (!event.title.is_empty()).then(|| event.title.clone()),
            description: event.description.clone(),
            asset_id: event.asset_id.clone(),
            asset_sequence: event.asset_sequence,
            asset: event.asset.clone(),
            facts: event.facts.clone(),
            received: None,
        }
    }
    /// Whether this is a test send from the portal or API: its facts include `test` with the
    /// value `true`. Handle test sends without acting on the asset they name.
    pub fn is_test(&self) -> bool {
        self.facts
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
    /// `moderation`, content status `content`, a completed upload and results that did not come
    /// from a test input, e.g. for a mock event.
    pub fn new(
        id: impl Into<String>,
        processing: AssetClassificationStatus,
        moderation: Option<AssetModerationDecision>,
        content: AssetContentStatus,
    ) -> Self {
        let value = serde_json::json!({
            "id": id.into(),
            "upload": {"status": "completed"},
            "classification": {
                "status": processing,
                "testInput": false,
                "moderation": {"decision": moderation},
            },
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
    /// Whether the asset's results came from one of the project's test inputs rather than
    /// analysing the content. Never use test results, such as age ranges, for real decisions.
    pub fn test_input(&self) -> Option<bool> {
        self.0
            .get("classification")?
            .as_object()?
            .get("testInput")?
            .as_bool()
    }
    /// The moderation status when the event was created, which also decides delivery.
    pub fn moderation_decision(&self) -> Option<AssetModerationDecision> {
        self.text(&["classification", "moderation", "decision"])
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

/// A page of the events feed.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct EventsPage {
    /// The events, oldest first.
    #[serde(default)]
    pub items: Vec<Event>,
    /// Pass as `cursor` to continue. Unlike other pages it is always set: store it between
    /// polls to receive later events.
    pub next_cursor: String,
    /// Whether more events are available now.
    pub has_more: bool,
    /// Event types this feed never includes, because the API key lacks the permission to see
    /// them. Give the key that permission to receive them.
    #[serde(default)]
    pub excluded_types: Vec<EventType>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<EventsPage, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl EventsPage {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for EventsPage {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}
impl EventsPage {
    /// A page of `items`, e.g. for a mock response.
    pub fn new(items: Vec<Event>, next_cursor: impl Into<String>, has_more: bool) -> Self {
        Self {
            items,
            next_cursor: next_cursor.into(),
            has_more,
            excluded_types: Vec::new(),
            extra: HashMap::new(),
            last_response: ResponseSlot::default(),
        }
    }
}

/// A named image transform the CDN applies to an asset's rendered or preview image, selected
/// with `/@<identifier>`. The CDN serves files made with its current definition.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Lens {
    /// The lens ID.
    pub id: String,
    /// The identifier, used in CDN URLs as `@identifier`.
    pub identifier: String,
    /// The display name.
    pub name: String,
    /// The asset type the lens applies to (`type` on the wire).
    #[serde(rename = "type")]
    pub lens_type: LensType,
    /// Whether the CDN serves the lens.
    pub active: bool,
    /// The owning project; `None` for built-in lenses.
    #[serde(default)]
    pub project_id: Option<String>,
    /// Milliseconds since the Unix epoch.
    pub created_at: u64,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// The description.
    #[serde(default)]
    pub description: Option<String>,
    /// The image transform options the lens applies.
    #[serde(default)]
    pub transform: Option<ImageTransformOptions>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<Lens, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl Lens {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for Lens {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// A signed asset URL, or a resource URL beneath it, from
/// [`CdnClient::sign_asset_url`](crate::CdnClient::sign_asset_url).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct SignedAssetUrl {
    /// The URL.
    pub url: String,
    /// When it expires, in milliseconds since the Unix epoch.
    pub expires_at: u64,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<SignedAssetUrl, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl SignedAssetUrl {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for SignedAssetUrl {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

string_enum! {
    /// Whether the viewer an asset URL's claims describe can see the content now.
    AssetAvailability {
        /// The viewer can see the content.
        Available = "available",
        /// The content needs the viewer's age confirmed ([`ViewerClaims::age_confirmed`]).
        AgeRestricted = "age-restricted",
        /// The viewer can't see the content: it is held, blocked in the viewer's region, not yet
        /// moderated or removed.
        Unavailable = "unavailable",
    }
}

/// An asset's display info, the CDN's info resource: the public asset fields a viewer needs, with
/// the same names as on [`Asset`], and whether this viewer can see it now. It never holds
/// moderation results, metadata, names, tags or extracted text.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetInfo {
    /// The asset ID.
    pub id: String,
    /// The owning project.
    pub project_id: String,
    /// The asset type (`type` on the wire).
    #[serde(rename = "type")]
    pub asset_type: AssetType,
    /// A website's page, which a viewer links to.
    #[serde(default)]
    pub external_url: Option<String>,
    /// The content's display details.
    #[serde(default)]
    pub content: AssetInfoContent,
    /// Whether the viewer the request's claims describe can see the content. The CDN's resources
    /// refuse exactly what it refuses.
    pub availability: AssetAvailability,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetInfo, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl AssetInfo {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for AssetInfo {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// The part of [`AssetContent`] that [`AssetInfo`] carries.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetInfoContent {
    /// The MIME type; it tells a spreadsheet from other documents.
    #[serde(default)]
    pub format: Option<String>,
    /// The width in pixels of an image or video.
    #[serde(default)]
    pub width: Option<u32>,
    /// The height in pixels of an image or video.
    #[serde(default)]
    pub height: Option<u32>,
    /// The length in seconds of audio and video.
    #[serde(default)]
    pub duration_seconds: Option<f64>,
    /// The number of pages or slides of a document or presentation.
    #[serde(default)]
    pub page_count: Option<u32>,
    /// The displayable file, served at [`CdnResource::Rendered`].
    #[serde(default)]
    pub rendered: Option<AssetRendered>,
    /// The still image, served at [`CdnResource::Preview`].
    #[serde(default)]
    pub preview: Option<AssetPreview>,
    /// Preview. The adaptive stream, served at [`CdnResource::Hls`].
    #[serde(default)]
    pub hls: Option<AssetHls>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetInfoContent, _>")]
    pub extra: HashMap<String, Value>,
}

string_enum! {
    /// What the rendered resource serves.
    AssetRenderedKind {
        /// An image: an image asset, or a website's screenshot.
        Image = "image",
        /// A PDF: a PDF, or a document or presentation converted to PDF.
        Pdf = "pdf",
        /// Browser-safe video.
        Video = "video",
        /// Browser-safe audio.
        Audio = "audio",
    }
}

/// The one displayable file of an asset, as the CDN's rendered resource serves it.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetRendered {
    /// What the rendered resource serves.
    pub kind: AssetRenderedKind,
    /// The MIME type of the rendered file. An image is served in the best format the client
    /// accepts, such as AVIF or WebP, unless a transform sets one.
    pub format: String,
    /// The width in pixels of the full view, for images and video, before any transform; `None`
    /// when unknown or for PDFs and audio.
    #[serde(default)]
    pub width: Option<u32>,
    /// The height in pixels of the full view, like `width`.
    #[serde(default)]
    pub height: Option<u32>,
    /// Audio only, once processing has measured them: loudness peaks from 0 to 1, evenly spaced
    /// over the audio, for drawing a waveform.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peaks: Option<Vec<f64>>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetRendered, _>")]
    pub extra: HashMap<String, Value>,
}

string_enum! {
    /// Whether an asset's adaptive stream can be played.
    AssetHlsStatus {
        /// Being prepared.
        Preparing = "preparing",
        /// Ready to play.
        Ready = "ready",
        /// Not available; `reason` says why.
        Unavailable = "unavailable",
    }
}

string_enum! {
    /// Why an asset's adaptive stream is unavailable.
    AssetHlsUnavailableReason {
        /// The plan's streaming allowance is used up.
        AllowanceUsed = "allowance-used",
        /// Streaming needs billing to be set up.
        BillingRequired = "billing-required",
        /// The project's spend limit was reached.
        SpendLimit = "spend-limit",
        /// Preparing the stream failed.
        ProcessingFailed = "processing-failed",
        /// The content is not retained.
        ContentNotKept = "content-not-kept",
    }
}

/// The adaptive (HLS) stream of audio or video asked for, with fragmented MP4 (CMAF) segments,
/// as the CDN's hls resource serves it once it is ready.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetHls {
    /// `preparing` until the stream is saved, `ready` once `renditions` lists it, `unavailable`
    /// when it won't be prepared: see `reason`.
    pub status: AssetHlsStatus,
    /// Why an `unavailable` stream isn't prepared: `allowance-used`, `billing-required`,
    /// `spend-limit`, `processing-failed` or `content-not-kept`. `None` otherwise.
    #[serde(default)]
    pub reason: Option<AssetHlsUnavailableReason>,
    /// Every rendition, video from the largest down, then audio; empty until the stream is ready.
    #[serde(default)]
    pub renditions: Vec<AssetHlsRendition>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetHls, _>")]
    pub extra: HashMap<String, Value>,
}

string_enum! {
    /// What a rendition of the adaptive stream carries.
    AssetHlsRenditionKind {
        /// A picture size. Video renditions carry no sound; they play with the audio rendition.
        Video = "video",
        /// The audio.
        Audio = "audio",
    }
}

/// One rendition of the adaptive stream, as the HLS master playlist lists it.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetHlsRendition {
    /// Whether it is a picture size or the audio.
    pub kind: AssetHlsRenditionKind,
    /// The picture width in pixels; `None` for audio.
    #[serde(default)]
    pub width: Option<u32>,
    /// The picture height in pixels; `None` for audio.
    #[serde(default)]
    pub height: Option<u32>,
    /// The peak bit rate in bits per second, counting the audio a video rendition plays with.
    pub bandwidth: u64,
    /// The rendition's codecs as RFC 6381 names, such as `avc1.64001f`.
    pub codecs: String,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetHlsRendition, _>")]
    pub extra: HashMap<String, Value>,
}

/// A still image for an asset, as the CDN's preview resource serves it: the image itself, a
/// document's first page or slide, a website's first screen, a video's poster frame or an audio
/// waveform.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetPreview {
    /// The width in pixels of the source still image, before the preview is sized or
    /// transformed.
    #[serde(default)]
    pub width: Option<u32>,
    /// The height in pixels of the source still image, like `width`.
    #[serde(default)]
    pub height: Option<u32>,
    /// A ThumbHash placeholder you can render while any view of the asset loads (also served as
    /// a PNG at the placeholder resource).
    #[serde(default)]
    pub thumbhash: Option<String>,
    /// The average colour of the source still image, a placeholder for any view of the asset.
    #[serde(default)]
    pub average_color: Option<String>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetPreview, _>")]
    pub extra: HashMap<String, Value>,
}

/// Digests of an asset's uploaded content.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct SafetyHold {
    /// Why the asset is held.
    pub reason: SafetyHoldReason,
    /// Milliseconds since the Unix epoch.
    pub placed_at: u64,
    /// Milliseconds since the Unix epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disposed_at: Option<u64>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<SafetyHold, _>")]
    pub extra: HashMap<String, Value>,
}

/// Extracted text.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ExtractedText {
    /// `String` (inline `content`) or `Document` (stored separately under `id`).
    #[serde(rename = "type")]
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

/// Descriptive metadata embedded in an uploaded image. Each text field is `None` when the file
/// doesn't record it.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct FileMetadata {
    /// When the picture was taken, as the file records it: an ISO 8601 date and time, such as
    /// `2026-05-01T12:30:00+01:00`. It includes the UTC offset only when the file records one;
    /// without it, the time is the camera's local time.
    #[serde(default)]
    pub captured_at: Option<String>,
    /// The camera manufacturer, such as `Canon`.
    #[serde(default)]
    pub camera_make: Option<String>,
    /// The camera or phone model, such as `EOS R5`.
    #[serde(default)]
    pub camera_model: Option<String>,
    /// The lens model.
    #[serde(default)]
    pub lens_model: Option<String>,
    /// The software that created or last edited the file.
    #[serde(default)]
    pub software: Option<String>,
    /// The creator or artist the file names. Sensitive: recorded only when
    /// `store_sensitive_metadata` is on.
    #[serde(default)]
    pub creator: Option<String>,
    /// The copyright notice the file declares.
    #[serde(default)]
    pub copyright: Option<String>,
    /// The IPTC digital source type the file declares, such as `digitalCapture` for a camera
    /// photo or `trainedAlgorithmicMedia` for generated media. Files can declare any value, so
    /// treat it as a claim.
    #[serde(default)]
    pub digital_source_type: Option<String>,
    /// Whether the uploaded file embedded GPS coordinates, whatever `store_sensitive_metadata` is
    /// set to.
    pub contains_location: bool,
    /// Where the picture was taken, from its GPS coordinates. Sensitive: recorded only when
    /// `store_sensitive_metadata` is on.
    #[serde(default)]
    pub location: Option<FileMetadataLocation>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<FileMetadata, _>")]
    pub extra: HashMap<String, Value>,
}

/// A GPS position in decimal degrees.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct FileMetadataLocation {
    /// The latitude, from -90 to 90.
    pub latitude: f64,
    /// The longitude, from -180 to 180.
    pub longitude: f64,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<FileMetadataLocation, _>")]
    pub extra: HashMap<String, Value>,
}

/// A direct CDN transform, applied in one pass: a selector string or structured
/// [`ImageTransformOptions`]. With a lens, its options replace the lens's.
///
/// `"width=320".into()` and `ImageTransformOptions { .. }.into()` both convert into it.
/// Structured options serialize to a selector such as `fit=cover,width=640`: option keys
/// sorted, nested objects as dotted keys (`border.color`), hex colours without `#` and values
/// percent-encoded, so equal transforms share a URL.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq)]
pub enum CdnTransform {
    /// Comma-separated options, such as `fit=cover,width=1024`.
    Selector(String),
    /// Structured options (boxed, as they are large). At least one is required.
    Options(Box<ImageTransformOptions>),
}
impl CdnTransform {
    /// Whether this is an empty selector string, which means no transform.
    pub fn is_empty(&self) -> bool {
        matches!(self, Self::Selector(value) if value.is_empty())
    }
    /// The selector string the API and CDN accept. Fails with `sdk/invalid-argument` for a
    /// selector containing `/`, `..`, `?` or `#` or starting with `@`, for no options, and for
    /// structured options the CDN would refuse: options it doesn't know (such as keys in
    /// `extra`) or values it refuses, such as a `width` of 0. The error's details list them as
    /// `unknownKeys` and `invalidKeys`.
    pub fn selector(&self) -> crate::Result<String> {
        let options = match self {
            Self::Selector(value) => {
                // A transform is one path segment of options: it must not add a segment, lens,
                // query or fragment.
                if value.contains(['/', '?', '#']) || value.contains("..") || value.starts_with('@')
                {
                    return Err(transform_error(
                        "Transform cannot contain \"/\", \"..\", \"?\" or \"#\", or start with \"@\"",
                    ));
                }
                return Ok(value.clone());
            }
            Self::Options(options) => options,
        };
        let mut pairs = Vec::new();
        let value = serde_json::to_value(options.as_ref())
            .map_err(|cause| transform_error(&cause.to_string()))?;
        // Like the CDN: options in `extra` it doesn't know, and values out of range, are refused.
        crate::contract_checks::assert_transform_options(&value)?;
        match value {
            Value::Object(options) => append_transform_options(&mut pairs, None, &options)?,
            _ => return Err(transform_error("Transform options must be an object")),
        }
        if pairs.is_empty() {
            return Err(transform_error("A transform needs at least one option"));
        }
        Ok(pairs.join(","))
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
impl From<ImageTransformOptions> for CdnTransform {
    fn from(value: ImageTransformOptions) -> Self {
        Self::Options(Box::new(value))
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
            Options(Box<ImageTransformOptions>),
        }
        Ok(match Repr::deserialize(deserializer)? {
            Repr::Selector(value) => Self::Selector(value),
            Repr::Options(options) => Self::Options(options),
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
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
impl GravityPoint {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            mode: Default::default(),
            x: Default::default(),
            y: Default::default(),
        }
    }
}
impl GravityPoint {
    /// Options with `mode`; set the rest with the methods below.
    pub fn new(mode: impl Into<GravityMode>) -> Self {
        Self {
            mode: mode.into(),
            x: Default::default(),
            y: Default::default(),
        }
    }
    /// The horizontal position from 0 to 1.
    pub fn x(mut self, value: f64) -> Self {
        self.x = Some(value);
        self
    }
    /// The vertical position from 0 to 1.
    pub fn y(mut self, value: f64) -> Self {
        self.y = Some(value);
        self
    }
}

/// A border drawn around the image.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ImageBorder {
    /// The colour, e.g. `#fff`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// The width in pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
}
impl ImageBorder {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The colour, e.g. `#fff`.
    pub fn color(mut self, value: impl Into<String>) -> Self {
        self.color = Some(value.into());
        self
    }
    /// The width in pixels.
    pub fn width(mut self, value: f64) -> Self {
        self.width = Some(value);
        self
    }
}

string_enum! {
    /// A named trim mode.
    TrimMode {
        /// Trim a uniform border.
        Border = "border",
    }
}

/// What to trim from the image edges.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
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
impl TrimEdges {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// Pixels from the top.
    pub fn top(mut self, value: f64) -> Self {
        self.top = Some(value);
        self
    }
    /// Pixels from the bottom.
    pub fn bottom(mut self, value: f64) -> Self {
        self.bottom = Some(value);
        self
    }
    /// Pixels from the left.
    pub fn left(mut self, value: f64) -> Self {
        self.left = Some(value);
        self
    }
    /// Pixels from the right.
    pub fn right(mut self, value: f64) -> Self {
        self.right = Some(value);
        self
    }
    /// The width to trim to.
    pub fn width(mut self, value: f64) -> Self {
        self.width = Some(value);
        self
    }
    /// The height to trim to.
    pub fn height(mut self, value: f64) -> Self {
        self.height = Some(value);
        self
    }
    /// Also trim a uniform border.
    pub fn border(mut self, value: impl Into<TrimBorder>) -> Self {
        self.border = Some(value.into());
        self
    }
}

/// Whether and how to trim a uniform border.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TrimBorder {
    /// Trim it (`true`) or not.
    Enabled(bool),
    /// Trim it with these settings.
    Options(TrimBorderOptions),
}

/// How to detect and keep a uniform border.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
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
impl TrimBorderOptions {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The border colour; detected when unset.
    pub fn color(mut self, value: impl Into<String>) -> Self {
        self.color = Some(value.into());
        self
    }
    /// How far colours may differ from it.
    pub fn tolerance(mut self, value: f64) -> Self {
        self.tolerance = Some(value);
        self
    }
    /// Pixels of border to keep.
    pub fn keep(mut self, value: f64) -> Self {
        self.keep = Some(value);
        self
    }
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ClassifyText {
    /// The text; must not be blank.
    pub text: String,
    /// The asset name; defaults to `text`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// A description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// CDN visibility, as for an asset upload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<Visibility>,
    /// Processing options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub processing_options: Option<ProcessingOptions>,
    /// Metadata items.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Vec<MetadataItem>>,
    /// Tags for the asset, such as `["catalogue", "backpacks"]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
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
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            text: Default::default(),
            name: Default::default(),
            description: Default::default(),
            visibility: Default::default(),
            processing_options: Default::default(),
            metadata: Default::default(),
            tags: Default::default(),
            author_id: Default::default(),
            context: Default::default(),
            external_id: Default::default(),
            external_url: Default::default(),
            folder_id: Default::default(),
            upload_preset_id: Default::default(),
            idempotency_key: Default::default(),
        }
    }
}
impl ClassifyText {
    /// The asset name; defaults to `text`.
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = Some(value.into());
        self
    }
    /// A description.
    pub fn description(mut self, value: impl Into<String>) -> Self {
        self.description = Some(value.into());
        self
    }
    /// CDN visibility, as for an asset upload.
    pub fn visibility(mut self, value: impl Into<Visibility>) -> Self {
        self.visibility = Some(value.into());
        self
    }
    /// Processing options.
    pub fn processing_options(mut self, value: impl Into<ProcessingOptions>) -> Self {
        self.processing_options = Some(value.into());
        self
    }
    /// Metadata items.
    pub fn metadata(mut self, value: impl Into<Vec<MetadataItem>>) -> Self {
        self.metadata = Some(value.into());
        self
    }
    /// Tags for the asset, such as `["catalogue", "backpacks"]`.
    pub fn tags(mut self, value: impl Into<Vec<String>>) -> Self {
        self.tags = Some(value.into());
        self
    }
    /// Your identifier for who wrote the text. CalmLens only compares it with the author IDs in
    /// `context`, to tell which posts share a speaker.
    pub fn author_id(mut self, value: impl Into<String>) -> Self {
        self.author_id = Some(value.into());
        self
    }
    /// Earlier posts in the conversation, oldest first. The SDK sends only the posts CalmLens
    /// uses; see [`select_moderation_context_items`].
    pub fn context(mut self, value: impl Into<ModerationContext>) -> Self {
        self.context = Some(value.into());
        self
    }
    /// Your ID for the asset.
    pub fn external_id(mut self, value: impl Into<String>) -> Self {
        self.external_id = Some(value.into());
        self
    }
    /// A link to the asset in your system.
    pub fn external_url(mut self, value: impl Into<String>) -> Self {
        self.external_url = Some(value.into());
        self
    }
    /// The folder.
    pub fn folder_id(mut self, value: impl Into<String>) -> Self {
        self.folder_id = Patch::Value(value.into());
        self
    }
    /// Clears `folder_id`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_folder_id(mut self) -> Self {
        self.folder_id = Patch::Null;
        self
    }
    /// The upload preset to apply.
    pub fn upload_preset_id(mut self, value: impl Into<String>) -> Self {
        self.upload_preset_id = Some(value.into());
        self
    }
    /// The `Idempotency-Key`. The SDK generates one when it is `None`.
    pub fn idempotency_key(mut self, value: impl Into<String>) -> Self {
        self.idempotency_key = Some(value.into());
        self
    }
}
impl ClassifyText {
    /// Moderates `text`.
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Self::blank()
        }
    }
}

/// Options for [`UploadTokensClient::sign`](crate::UploadTokensClient::sign).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct SignUploadToken {
    /// The upload preset the token may upload through.
    pub upload_preset_id: String,
    /// The external ID the uploaded asset gets. Must not be empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
    /// The token's lifetime in seconds, from 1 to 3600. Defaults to 600.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u32>,
}
impl SignUploadToken {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            upload_preset_id: Default::default(),
            external_id: Default::default(),
            expires_in: Default::default(),
        }
    }
}
impl SignUploadToken {
    /// The external ID the uploaded asset gets. Must not be empty.
    pub fn external_id(mut self, value: impl Into<String>) -> Self {
        self.external_id = Some(value.into());
        self
    }
    /// The token's lifetime in seconds, from 1 to 3600. Defaults to 600.
    pub fn expires_in(mut self, value: u32) -> Self {
        self.expires_in = Some(value);
        self
    }
}
impl SignUploadToken {
    /// A token for `upload_preset_id` with the default lifetime.
    pub fn new(upload_preset_id: impl Into<String>) -> Self {
        Self {
            upload_preset_id: upload_preset_id.into(),
            ..Self::blank()
        }
    }
}

/// A signed upload token.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedUploadToken {
    /// The token, to hand to the browser as its bearer token.
    pub token: String,
    /// When the token expires, in milliseconds since the Unix epoch.
    pub expires_at: u64,
}

/// Options for asset search.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct SearchAssets {
    /// The natural-language query.
    pub query: String,
    /// How to match; defaults to `Hybrid`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<SearchMode>,
    /// How many of the best matches to return, 1 to 20 (the API's default is 10).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
}
impl SearchAssets {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            query: Default::default(),
            mode: Default::default(),
            page_size: Default::default(),
        }
    }
}
impl SearchAssets {
    /// Options with `query`; set the rest with the methods below.
    pub fn new(query: impl Into<String>) -> Self {
        Self {
            query: query.into(),
            mode: Default::default(),
            page_size: Default::default(),
        }
    }
    /// How to match; defaults to `Hybrid`.
    pub fn mode(mut self, value: impl Into<SearchMode>) -> Self {
        self.mode = Some(value.into());
        self
    }
    /// How many of the best matches to return, 1 to 20 (the API's default is 10).
    pub fn page_size(mut self, value: u32) -> Self {
        self.page_size = Some(value);
        self
    }
}

/// One search result.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetSearchMatch {
    /// The asset.
    pub asset: Asset,
    /// The relevance score.
    pub score: f64,
    /// The fields that matched.
    #[serde(default)]
    pub matched_fields: Vec<SearchMatchField>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetSearchMatch, _>")]
    pub extra: HashMap<String, Value>,
}

/// Search results.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssetSearchResponse {
    /// The query.
    pub query: String,
    /// The results.
    #[serde(default)]
    pub items: Vec<AssetSearchMatch>,
    /// Whether semantic search is available.
    pub semantic_status: SemanticStatus,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<AssetSearchResponse, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl AssetSearchResponse {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for AssetSearchResponse {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// One page of child folders, with the folders above them.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct FolderPage {
    /// The folders on this page.
    #[serde(default)]
    pub items: Vec<Folder>,
    /// Folders above the listed or requested folders, for showing their paths.
    #[serde(default)]
    pub ancestors: Vec<Folder>,
    /// The cursor for the next page, or None.
    #[serde(default)]
    pub next_cursor: Option<String>,
    /// Whether another page follows.
    pub has_more: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<FolderPage, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl FolderPage {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for FolderPage {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// Options for browsing folders.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ListFolders {
    /// Lists immediate children of this folder; omit for project root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// The previous page's `next_cursor`; omit for the first page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Page size from 1 to 100 (the API's default is 50).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// The sort: one field, `name` (the default) or `createdAt`, descending when prefixed with
    /// `-`, such as `-createdAt`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
    /// Literal folder-name substring.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
}
impl ListFolders {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// Lists immediate children of this folder; omit for project root.
    pub fn parent_id(mut self, value: impl Into<String>) -> Self {
        self.parent_id = Some(value.into());
        self
    }
    /// The previous page's `next_cursor`; omit for the first page.
    pub fn cursor(mut self, value: impl Into<String>) -> Self {
        self.cursor = Some(value.into());
        self
    }
    /// Page size from 1 to 100 (the API's default is 50).
    pub fn page_size(mut self, value: u32) -> Self {
        self.page_size = Some(value);
        self
    }
    /// The sort: one field, `name` (the default) or `createdAt`, descending when prefixed with
    /// `-`, such as `-createdAt`.
    pub fn sort(mut self, value: impl Into<String>) -> Self {
        self.sort = Some(value.into());
        self
    }
    /// Literal folder-name substring.
    pub fn search(mut self, value: impl Into<String>) -> Self {
        self.search = Some(value.into());
        self
    }
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HashList {
    /// The hash list ID.
    pub id: String,
    /// The owning project.
    pub project_id: String,
    /// The name.
    pub name: String,
    /// The description.
    #[serde(default)]
    pub description: Option<String>,
    /// What matches do.
    pub action: HashListAction,
    /// Milliseconds since the Unix epoch.
    pub created_at: u64,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<HashList, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl HashList {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for HashList {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HashListEntry {
    /// The entry ID.
    pub id: String,
    /// The owning project.
    pub project_id: String,
    /// The hash list.
    pub hash_list_id: String,
    /// The PDQ hash: 64 hexadecimal characters.
    pub hash: String,
    /// The hash's quality from 0 to 100, when known.
    #[serde(default)]
    pub quality: Option<i64>,
    /// A label, such as a report reference.
    #[serde(default)]
    pub label: Option<String>,
    /// The asset the hash was taken from.
    #[serde(default)]
    pub asset_id: Option<String>,
    /// Milliseconds since the Unix epoch.
    pub created_at: u64,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<HashListEntry, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl HashListEntry {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for HashListEntry {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// A page of a project's hash lists, newest first.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HashListPage {
    /// The hash lists on this page.
    #[serde(default)]
    pub items: Vec<HashList>,
    /// The cursor for the next page, or None.
    #[serde(default)]
    pub next_cursor: Option<String>,
    /// Whether another page follows.
    pub has_more: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<HashListPage, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl HashListPage {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for HashListPage {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// Options for one page of a project's hash lists.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ListHashLists {
    /// The previous page's `next_cursor`; omit for the first page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Hash lists per page, 1 to 100 (the API's default is 50).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `-createdAt,id`. Newest first by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
}
impl ListHashLists {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The previous page's `next_cursor`; omit for the first page.
    pub fn cursor(mut self, value: impl Into<String>) -> Self {
        self.cursor = Some(value.into());
        self
    }
    /// Hash lists per page, 1 to 100 (the API's default is 50).
    pub fn page_size(mut self, value: u32) -> Self {
        self.page_size = Some(value);
        self
    }
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `-createdAt,id`. Newest first by default.
    pub fn sort(mut self, value: impl Into<String>) -> Self {
        self.sort = Some(value.into());
        self
    }
}

/// A page of hash list entries, newest first.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
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
    /// Whether another page follows.
    pub has_more: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<HashListEntryPage, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl HashListEntryPage {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for HashListEntryPage {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// Identifies a hash list.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HashListId {
    /// The hash list ID.
    pub hash_list_id: String,
}
impl HashListId {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            hash_list_id: Default::default(),
        }
    }
}
impl HashListId {}
impl From<&str> for HashListId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}
impl From<String> for HashListId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}
impl From<&String> for HashListId {
    fn from(value: &String) -> Self {
        Self::new(value)
    }
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HashListEntryId {
    /// The entry ID.
    pub entry_id: String,
}
impl HashListEntryId {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            entry_id: Default::default(),
        }
    }
}
impl HashListEntryId {}
impl From<&str> for HashListEntryId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}
impl From<String> for HashListEntryId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}
impl From<&String> for HashListEntryId {
    fn from(value: &String) -> Self {
        Self::new(value)
    }
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
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CreateHashList {
    /// The name.
    pub name: String,
    /// A description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// What matches do: `Flag` records them, `Block` also blocks close matches.
    pub action: HashListAction,
}
impl CreateHashList {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            name: Default::default(),
            description: Default::default(),
            action: Default::default(),
        }
    }
}
impl CreateHashList {
    /// Options with `name`, `action`; set the rest with the methods below.
    pub fn new(name: impl Into<String>, action: impl Into<HashListAction>) -> Self {
        Self {
            name: name.into(),
            action: action.into(),
            description: Default::default(),
        }
    }
    /// A description.
    pub fn description(mut self, value: impl Into<String>) -> Self {
        self.description = Some(value.into());
        self
    }
}

/// Changes to a hash list. The new action applies to later uploads.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct UpdateHashList {
    /// The hash list ID.
    #[serde(skip_serializing)]
    pub hash_list_id: String,
    /// The new name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The new description; `Patch::Null` clears it.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub description: Patch<String>,
    /// The new action.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<HashListAction>,
}
impl UpdateHashList {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            hash_list_id: Default::default(),
            name: Default::default(),
            description: Default::default(),
            action: Default::default(),
        }
    }
}
impl UpdateHashList {
    /// Options with `hash_list_id`; set the rest with the methods below.
    pub fn new(hash_list_id: impl Into<String>) -> Self {
        Self {
            hash_list_id: hash_list_id.into(),
            name: Default::default(),
            description: Default::default(),
            action: Default::default(),
        }
    }
    /// The new name.
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = Some(value.into());
        self
    }
    /// The new description; `Patch::Null` clears it.
    pub fn description(mut self, value: impl Into<String>) -> Self {
        self.description = Patch::Value(value.into());
        self
    }
    /// Clears `description`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_description(mut self) -> Self {
        self.description = Patch::Null;
        self
    }
    /// The new action.
    pub fn action(mut self, value: impl Into<HashListAction>) -> Self {
        self.action = Some(value.into());
        self
    }
}

/// Options for one page of a hash list's entries.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ListHashListEntries {
    /// The hash list ID.
    pub hash_list_id: String,
    /// The cursor from a previous page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Entries per page, 1 to 100 (the API's default is 50).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `-createdAt,id`. Newest first by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
}
impl ListHashListEntries {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            hash_list_id: Default::default(),
            cursor: Default::default(),
            page_size: Default::default(),
            sort: Default::default(),
        }
    }
}
impl ListHashListEntries {
    /// Options with `hash_list_id`; set the rest with the methods below.
    pub fn new(hash_list_id: impl Into<String>) -> Self {
        Self {
            hash_list_id: hash_list_id.into(),
            cursor: Default::default(),
            page_size: Default::default(),
            sort: Default::default(),
        }
    }
    /// The cursor from a previous page.
    pub fn cursor(mut self, value: impl Into<String>) -> Self {
        self.cursor = Some(value.into());
        self
    }
    /// Entries per page, 1 to 100 (the API's default is 50).
    pub fn page_size(mut self, value: u32) -> Self {
        self.page_size = Some(value);
        self
    }
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `-createdAt,id`. Newest first by default.
    pub fn sort(mut self, value: impl Into<String>) -> Self {
        self.sort = Some(value.into());
        self
    }
}

/// Adds a hash to a hash list: set `hash` (and optionally `quality`), or `asset_id` to use an
/// image asset's perceptual hash.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
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
impl AddHashListEntry {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            hash_list_id: Default::default(),
            hash: Default::default(),
            quality: Default::default(),
            asset_id: Default::default(),
            label: Default::default(),
        }
    }
}
impl AddHashListEntry {
    /// Options with `hash_list_id`; set the rest with the methods below.
    pub fn new(hash_list_id: impl Into<String>) -> Self {
        Self {
            hash_list_id: hash_list_id.into(),
            hash: Default::default(),
            quality: Default::default(),
            asset_id: Default::default(),
            label: Default::default(),
        }
    }
    /// A PDQ hash: 64 hexadecimal characters.
    pub fn hash(mut self, value: impl Into<String>) -> Self {
        self.hash = Some(value.into());
        self
    }
    /// The hash's quality from 0 to 100.
    pub fn quality(mut self, value: i64) -> Self {
        self.quality = Some(value);
        self
    }
    /// An image asset whose perceptual hash to add.
    pub fn asset_id(mut self, value: impl Into<String>) -> Self {
        self.asset_id = Some(value.into());
        self
    }
    /// A label, such as a report reference.
    pub fn label(mut self, value: impl Into<String>) -> Self {
        self.label = Some(value.into());
        self
    }
}

/// Optional customer assertions for CDN delivery. Neither assertion is verified by CalmLens.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ViewerClaims {
    /// Viewer country; otherwise inferred from the connection reaching CalmLens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    /// Your platform's confirmation that the viewer passed its age check. Defaults to false,
    /// including authenticated requests. Your platform confirms the viewer's age; viewer claims are
    /// assertions from your app, and CalmLens doesn't verify them. To control who loads an age-restricted asset, make it private and
    /// sign its URL only for viewers whose age your platform confirmed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub age_confirmed: Option<bool>,
}
impl ViewerClaims {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// Viewer country; otherwise inferred from the connection reaching CalmLens.
    pub fn region(mut self, value: impl Into<String>) -> Self {
        self.region = Some(value.into());
        self
    }
    /// Your platform's confirmation that the viewer passed its age check. Defaults to false,
    /// including authenticated requests. Your platform confirms the viewer's age; viewer claims are
    /// assertions from your app, and CalmLens doesn't verify them. To control who loads an age-restricted asset, make it private and
    /// sign its URL only for viewers whose age your platform confirmed.
    pub fn age_confirmed(mut self, value: bool) -> Self {
        self.age_confirmed = Some(value);
        self
    }
}

string_enum! {
    /// A built-in moderation policy preset.
    PolicyPresetId {
        /// General.
        General = "general-community",
        /// Kids.
        Kids = "children-platform",
        /// Learning and support.
        LearningAndSupport = "education-support",
        /// Teen-safe.
        TeenSafe = "wholesome-community",
    }
}

string_enum! {
    /// How a policy relates to its built-in preset.
    PolicyPresetMode {
        /// The organisation's own preset policy with automatic updates on: it always has the
        /// latest preset settings.
        Live = "live",
        /// The organisation's own preset policy kept at `preset.version`. Only a pinned policy
        /// can switch automatic updates on.
        Pinned = "pinned",
        /// A policy made from the preset.
        Copy = "copy",
    }
}

/// A moderation policy. Policies belong to the organisation and its projects share them; each
/// project moderates with one, and an upload preset can name another for its own uploads.
/// `revision` counts saved changes and guards every change, separately from the preset release in
/// `preset.version`.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Policy {
    /// The policy ID.
    pub id: String,
    /// The display name.
    pub name: String,
    /// What the policy is for.
    pub description: String,
    /// What the policy does with each category, its allowances and restrictions.
    pub settings: PolicySettings,
    /// Changes with every saved change. Send it with each change; a policy changed since is
    /// refused with `policy/revision-conflict`.
    pub revision: u64,
    /// Where the policy started from a built-in preset, or `None`.
    #[serde(default)]
    pub preset: Option<PolicyPresetOrigin>,
    /// Projects this policy moderates, as their policy or through one of their upload presets.
    #[serde(default)]
    pub project_ids: Vec<String>,
    /// Milliseconds since the Unix epoch.
    pub created_at: u64,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<Policy, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl Policy {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for Policy {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// The built-in preset a policy started from.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PolicyPresetOrigin {
    /// The preset.
    pub id: PolicyPresetId,
    /// The preset release the policy is pinned to; resetting restores its settings.
    pub version: u64,
    /// The newest release of the preset. A `Pinned` or `Copy` policy on an older `version` can
    /// be upgraded to it with [`PoliciesClient::upgrade`](crate::PoliciesClient::upgrade).
    pub latest_version: u64,
    /// How the policy relates to the preset.
    pub mode: PolicyPresetMode,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<PolicyPresetOrigin, _>")]
    pub extra: HashMap<String, Value>,
}

/// What a policy does with each moderation category. Settings you send must define every
/// category.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PolicySettings {
    /// Each category's settings.
    #[serde(default)]
    pub category_settings: HashMap<ClassificationCategory, CategoryPolicySettings>,
    /// Preview. What happens to assets that link to unsafe destinations; `None` when off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_safety: Option<LinkSafetySettings>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<PolicySettings, _>")]
    pub extra: HashMap<String, Value>,
}
impl PolicySettings {
    /// These settings with `category` set to `settings`.
    pub fn category(
        mut self,
        category: ClassificationCategory,
        settings: CategoryPolicySettings,
    ) -> Self {
        self.category_settings.insert(category, settings);
        self
    }
}

/// One category's action, allowances and restrictions.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CategoryPolicySettings {
    /// What happens when the category's policy score reaches 0.5 and no rule decides it.
    pub action: FlaggedContentAction,
    /// Contexts that let content through, or act on it more softly, when all of the category's
    /// content is one of their qualifiers.
    #[serde(default)]
    pub allowances: Vec<PolicyRule>,
    /// Conditions that act on at least one matching qualifying instance. They outweigh
    /// allowances.
    #[serde(default)]
    pub restrictions: Vec<PolicyRule>,
    /// Fields this SDK version does not know.
    #[serde(
        flatten,
        deserialize_with = "extra_fields::<CategoryPolicySettings, _>"
    )]
    pub extra: HashMap<String, Value>,
}
impl CategoryPolicySettings {
    /// Settings that take `action`, with no allowances or restrictions.
    pub fn new(action: FlaggedContentAction) -> Self {
        Self {
            action,
            ..Self::default()
        }
    }
}

/// An allowance or restriction: its `when` qualifiers apply to the same instance, excluding
/// instances that also have an `unless` qualifier (restrictions only).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PolicyRule {
    /// A name for the rule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The qualifiers that must all apply.
    #[serde(default)]
    pub when: Vec<ModerationQualifier>,
    /// Qualifiers that exclude an instance (restrictions only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unless: Option<Vec<ModerationQualifier>>,
    /// What happens to matching content.
    pub action: FlaggedContentAction,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<PolicyRule, _>")]
    pub extra: HashMap<String, Value>,
}
impl PolicyRule {
    /// A rule taking `action` when every `when` qualifier applies.
    pub fn new(when: Vec<ModerationQualifier>, action: FlaggedContentAction) -> Self {
        Self {
            when,
            action,
            ..Self::default()
        }
    }
}

/// A page of the organisation's policies.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PolicyPage {
    /// The policies on this page.
    #[serde(default)]
    pub items: Vec<Policy>,
    /// The cursor for the next page, or None.
    #[serde(default)]
    pub next_cursor: Option<String>,
    /// Whether another page follows.
    pub has_more: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<PolicyPage, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl PolicyPage {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for PolicyPage {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// Options for one page of the organisation's policies.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ListPolicies {
    /// The previous page's `next_cursor`; omit for the first page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Policies per page, 1 to 100 (the API's default is 50).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `-createdAt`. Oldest first by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
}
impl ListPolicies {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The previous page's `next_cursor`; omit for the first page.
    pub fn cursor(mut self, value: impl Into<String>) -> Self {
        self.cursor = Some(value.into());
        self
    }
    /// Policies per page, 1 to 100 (the API's default is 50).
    pub fn page_size(mut self, value: u32) -> Self {
        self.page_size = Some(value);
        self
    }
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `-createdAt`. Oldest first by default.
    pub fn sort(mut self, value: impl Into<String>) -> Self {
        self.sort = Some(value.into());
        self
    }
}

/// Identifies a policy.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PolicyId {
    /// The policy ID.
    pub policy_id: String,
}
impl PolicyId {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            policy_id: Default::default(),
        }
    }
}
impl PolicyId {}
impl From<&str> for PolicyId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}
impl From<String> for PolicyId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}
impl From<&String> for PolicyId {
    fn from(value: &String) -> Self {
        Self::new(value)
    }
}
impl PolicyId {
    /// Identifies policy `policy_id`.
    pub fn new(policy_id: impl Into<String>) -> Self {
        Self {
            policy_id: policy_id.into(),
        }
    }
}

/// Creates a policy from `settings` with a `name`, or a copy of the latest release of a built-in
/// preset with `preset_id` (whose name defaults to the preset's).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CreatePolicy {
    /// The display name; required with `settings`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// What the policy is for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The settings, defining every category. Send this or `preset_id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<PolicySettings>,
    /// The built-in preset to copy. Send this or `settings`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset_id: Option<PolicyPresetId>,
}
impl CreatePolicy {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The display name; required with `settings`.
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = Some(value.into());
        self
    }
    /// What the policy is for.
    pub fn description(mut self, value: impl Into<String>) -> Self {
        self.description = Some(value.into());
        self
    }
    /// The settings, defining every category. Send this or `preset_id`.
    pub fn settings(mut self, value: impl Into<PolicySettings>) -> Self {
        self.settings = Some(value.into());
        self
    }
    /// The built-in preset to copy. Send this or `settings`.
    pub fn preset_id(mut self, value: impl Into<PolicyPresetId>) -> Self {
        self.preset_id = Some(value.into());
        self
    }
}
impl CreatePolicy {
    /// A copy of the latest release of `preset`.
    pub fn from_preset(preset: PolicyPresetId) -> Self {
        Self {
            preset_id: Some(preset),
            ..Self::default()
        }
    }
    /// A policy named `name` with `settings`.
    pub fn with_settings(name: impl Into<String>, settings: PolicySettings) -> Self {
        Self {
            name: Some(name.into()),
            settings: Some(settings),
            ..Self::default()
        }
    }
}

/// Changes to a policy's name, description or settings; `None` fields are unchanged.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct UpdatePolicy {
    /// The policy ID.
    #[serde(skip_serializing)]
    pub policy_id: String,
    /// The policy's current revision.
    pub revision: u64,
    /// The new name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The new description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The complete new settings, defining every category.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<PolicySettings>,
}
impl UpdatePolicy {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            policy_id: Default::default(),
            revision: Default::default(),
            name: Default::default(),
            description: Default::default(),
            settings: Default::default(),
        }
    }
}
impl UpdatePolicy {
    /// The new name.
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = Some(value.into());
        self
    }
    /// The new description.
    pub fn description(mut self, value: impl Into<String>) -> Self {
        self.description = Some(value.into());
        self
    }
    /// The complete new settings, defining every category.
    pub fn settings(mut self, value: impl Into<PolicySettings>) -> Self {
        self.settings = Some(value.into());
        self
    }
}
impl UpdatePolicy {
    /// Changes nothing yet to policy `policy_id` at `revision`.
    pub fn new(policy_id: impl Into<String>, revision: u64) -> Self {
        Self {
            policy_id: policy_id.into(),
            revision,
            ..Self::blank()
        }
    }
}

/// Restores the settings of the preset release a `Pinned` or `Copy` policy is pinned to,
/// discarding its edits.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ResetPolicy {
    /// The policy ID.
    #[serde(skip_serializing)]
    pub policy_id: String,
    /// The policy's current revision.
    pub revision: u64,
    /// The pinned `preset.version` you reviewed.
    pub preset_version: u64,
}
impl ResetPolicy {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            policy_id: Default::default(),
            revision: Default::default(),
            preset_version: Default::default(),
        }
    }
}
impl ResetPolicy {
    /// Options with `policy_id`, `revision`, `preset_version`; set the rest with the methods below.
    pub fn new(policy_id: impl Into<String>, revision: u64, preset_version: u64) -> Self {
        Self {
            policy_id: policy_id.into(),
            revision,
            preset_version,
        }
    }
}

/// Moves a `Pinned` or `Copy` policy whose settings are unchanged from its preset release to the
/// latest release of the preset.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct UpgradePolicy {
    /// The policy ID.
    #[serde(skip_serializing)]
    pub policy_id: String,
    /// The policy's current revision.
    pub revision: u64,
    /// The `preset.latest_version` you reviewed.
    pub preset_version: u64,
}
impl UpgradePolicy {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            policy_id: Default::default(),
            revision: Default::default(),
            preset_version: Default::default(),
        }
    }
}
impl UpgradePolicy {
    /// Options with `policy_id`, `revision`, `preset_version`; set the rest with the methods below.
    pub fn new(policy_id: impl Into<String>, revision: u64, preset_version: u64) -> Self {
        Self {
            policy_id: policy_id.into(),
            revision,
            preset_version,
        }
    }
}

/// Switches automatic updates for the organisation's own preset policy. `enabled` turns a
/// `Pinned` policy `Live`, replacing its settings with the latest preset's; `false` pins a `Live`
/// policy at its current preset release.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct SetPolicyAutomaticUpdates {
    /// The policy ID.
    #[serde(skip_serializing)]
    pub policy_id: String,
    /// Whether the policy follows its preset (`Live`).
    pub enabled: bool,
    /// The policy's current revision.
    pub revision: u64,
    /// The policy's `preset.latest_version`.
    pub preset_version: u64,
}
impl SetPolicyAutomaticUpdates {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            policy_id: Default::default(),
            enabled: Default::default(),
            revision: Default::default(),
            preset_version: Default::default(),
        }
    }
}
impl SetPolicyAutomaticUpdates {
    /// Options with `policy_id`, `enabled`, `revision`, `preset_version`; set the rest with the methods below.
    pub fn new(
        policy_id: impl Into<String>,
        enabled: bool,
        revision: u64,
        preset_version: u64,
    ) -> Self {
        Self {
            policy_id: policy_id.into(),
            enabled,
            revision,
            preset_version,
        }
    }
}

/// Chooses the policy the project moderates with.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct AssignPolicy {
    /// One of the organisation's policies.
    pub policy_id: String,
}
impl AssignPolicy {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            policy_id: Default::default(),
        }
    }
}
impl AssignPolicy {}
impl AssignPolicy {
    /// Assigns policy `policy_id`.
    pub fn new(policy_id: impl Into<String>) -> Self {
        Self {
            policy_id: policy_id.into(),
        }
    }
}

string_enum! {
    /// Who can upload through an upload preset from a browser or app.
    UploadPresetAccess {
        /// Needs an upload token signed by your server.
        Token = "token",
        /// Accepts the preset ID alone; the preset needs a daily upload limit.
        Anyone = "anyone",
    }
}

/// The rules for uploads from browsers and apps, addressed by its `key` in deploys that declare
/// presets in code.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct UploadPreset {
    /// The upload preset ID.
    pub id: String,
    /// The owning project.
    pub project_id: String,
    /// Who created the preset, when a person did.
    #[serde(default)]
    pub created_by_user_id: Option<String>,
    /// The key, unique in the project.
    pub key: String,
    /// Counts the preset's changes; send it back to refuse a change made since you read it.
    pub revision: u64,
    /// The display name.
    pub name: String,
    /// Who can upload from a browser or app.
    pub access: UploadPresetAccess,
    /// Whether the preset accepts uploads.
    pub enabled: bool,
    /// MIME types the preset accepts, such as `image/*`; `None` accepts any supported type.
    #[serde(default)]
    pub allowed_content_types: Option<Vec<String>>,
    /// The largest upload the preset accepts, in bytes; `None` uses the standard upload limits.
    #[serde(default)]
    pub max_size_in_bytes: Option<u64>,
    /// The folder uploads go into; `None` uses the project's root.
    #[serde(default)]
    pub folder_id: Option<String>,
    /// The moderation policy for uploads through the preset; `None` uses the project's policy.
    #[serde(default)]
    pub policy_id: Option<String>,
    /// The visibility of uploaded assets.
    pub visibility: Visibility,
    /// Processing options for every upload through the preset.
    #[serde(default)]
    pub processing_options: Option<ProcessingOptions>,
    /// Whether browser uploads see the moderation decision for their own upload.
    pub reveal_decision: bool,
    /// The most uploads the preset accepts from each client (IP address) per UTC day.
    #[serde(default)]
    pub daily_upload_limit: Option<u64>,
    /// Sites allowed to upload from the browser; `None` allows any site.
    #[serde(default)]
    pub allowed_origins: Option<Vec<String>>,
    /// Milliseconds since the Unix epoch.
    pub created_at: u64,
    /// Milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: Option<u64>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<UploadPreset, _>")]
    pub extra: HashMap<String, Value>,
}

/// A page of the project's upload presets.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct UploadPresetPage {
    /// The upload presets on this page.
    #[serde(default)]
    pub items: Vec<UploadPreset>,
    /// The cursor for the next page, or None.
    #[serde(default)]
    pub next_cursor: Option<String>,
    /// Whether another page follows.
    pub has_more: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<UploadPresetPage, _>")]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl UploadPresetPage {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for UploadPresetPage {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// Options for one page of the project's upload presets.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ListUploadPresets {
    /// The previous page's `next_cursor`; omit for the first page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Upload presets per page, 1 to 100 (the API's default is 50).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `-createdAt`. Oldest first by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
}
impl ListUploadPresets {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The previous page's `next_cursor`; omit for the first page.
    pub fn cursor(mut self, value: impl Into<String>) -> Self {
        self.cursor = Some(value.into());
        self
    }
    /// Upload presets per page, 1 to 100 (the API's default is 50).
    pub fn page_size(mut self, value: u32) -> Self {
        self.page_size = Some(value);
        self
    }
    /// The sort: `createdAt` and `id`, comma-separated, each descending when prefixed with `-`,
    /// such as `-createdAt`. Oldest first by default.
    pub fn sort(mut self, value: impl Into<String>) -> Self {
        self.sort = Some(value.into());
        self
    }
}

/// One upload preset's whole definition, by `key`, for
/// [`UploadPresetsClient::ensure`](crate::UploadPresetsClient::ensure). The definition replaces
/// the stored preset, so a field left out (`None` or [`Patch::Missing`]) takes its default rather
/// than keeping its stored value.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct UploadPresetDefinition {
    /// The key, unique in the project: lowercase letters, digits and inner hyphens, at most 64
    /// characters.
    pub key: String,
    /// The `revision` you last read, which refuses a preset changed since with
    /// `upload-preset/revision-conflict`. Send 0 to create it only if no preset has this key;
    /// omit it to create or replace the preset whatever its revision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
    /// The display name.
    pub name: String,
    /// Who can upload from a browser or app. Defaults to `token`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access: Option<UploadPresetAccess>,
    /// Whether the preset accepts uploads. Defaults to `true`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// MIME types the preset accepts, such as `image/*`. Empty or left out accepts any supported
    /// type.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub allowed_content_types: Patch<Vec<String>>,
    /// The largest upload the preset accepts, in bytes. Left out uses the standard upload limits.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub max_size_in_bytes: Patch<u64>,
    /// The folder uploads go into. Left out uses the project's root.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub folder_id: Patch<String>,
    /// The moderation policy for uploads through the preset, one of the organisation's policies.
    /// Left out uses the project's policy.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub policy_id: Patch<String>,
    /// The visibility of uploaded assets. Defaults to `private`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<Visibility>,
    /// Processing options for every upload through the preset.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub processing_options: Patch<ProcessingOptions>,
    /// Whether browser uploads see the moderation decision for their own upload. Defaults to
    /// `false`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reveal_decision: Option<bool>,
    /// The most uploads the preset accepts from each client (IP address) per UTC day. Required
    /// when `access` is `anyone`.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub daily_upload_limit: Patch<u64>,
    /// Sites allowed to upload from the browser. Empty or left out allows any site.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub allowed_origins: Patch<Vec<String>>,
}
impl UploadPresetDefinition {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            key: Default::default(),
            revision: Default::default(),
            name: Default::default(),
            access: Default::default(),
            enabled: Default::default(),
            allowed_content_types: Default::default(),
            max_size_in_bytes: Default::default(),
            folder_id: Default::default(),
            policy_id: Default::default(),
            visibility: Default::default(),
            processing_options: Default::default(),
            reveal_decision: Default::default(),
            daily_upload_limit: Default::default(),
            allowed_origins: Default::default(),
        }
    }
}
impl UploadPresetDefinition {
    /// The `revision` you last read, which refuses a preset changed since with
    /// `upload-preset/revision-conflict`. Send 0 to create it only if no preset has this key;
    /// omit it to create or replace the preset whatever its revision.
    pub fn revision(mut self, value: u64) -> Self {
        self.revision = Some(value);
        self
    }
    /// Who can upload from a browser or app. Defaults to `token`.
    pub fn access(mut self, value: impl Into<UploadPresetAccess>) -> Self {
        self.access = Some(value.into());
        self
    }
    /// Whether the preset accepts uploads. Defaults to `true`.
    pub fn enabled(mut self, value: bool) -> Self {
        self.enabled = Some(value);
        self
    }
    /// MIME types the preset accepts, such as `image/*`. Empty or left out accepts any supported
    /// type.
    pub fn allowed_content_types(mut self, value: impl Into<Vec<String>>) -> Self {
        self.allowed_content_types = Patch::Value(value.into());
        self
    }
    /// Clears `allowed_content_types`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_allowed_content_types(mut self) -> Self {
        self.allowed_content_types = Patch::Null;
        self
    }
    /// The largest upload the preset accepts, in bytes. Left out uses the standard upload limits.
    pub fn max_size_in_bytes(mut self, value: u64) -> Self {
        self.max_size_in_bytes = Patch::Value(value);
        self
    }
    /// Clears `max_size_in_bytes`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_max_size_in_bytes(mut self) -> Self {
        self.max_size_in_bytes = Patch::Null;
        self
    }
    /// The folder uploads go into. Left out uses the project's root.
    pub fn folder_id(mut self, value: impl Into<String>) -> Self {
        self.folder_id = Patch::Value(value.into());
        self
    }
    /// Clears `folder_id`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_folder_id(mut self) -> Self {
        self.folder_id = Patch::Null;
        self
    }
    /// The moderation policy for uploads through the preset, one of the organisation's policies.
    /// Left out uses the project's policy.
    pub fn policy_id(mut self, value: impl Into<String>) -> Self {
        self.policy_id = Patch::Value(value.into());
        self
    }
    /// Clears `policy_id`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_policy_id(mut self) -> Self {
        self.policy_id = Patch::Null;
        self
    }
    /// The visibility of uploaded assets. Defaults to `private`.
    pub fn visibility(mut self, value: impl Into<Visibility>) -> Self {
        self.visibility = Some(value.into());
        self
    }
    /// Processing options for every upload through the preset.
    pub fn processing_options(mut self, value: impl Into<ProcessingOptions>) -> Self {
        self.processing_options = Patch::Value(value.into());
        self
    }
    /// Clears `processing_options`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_processing_options(mut self) -> Self {
        self.processing_options = Patch::Null;
        self
    }
    /// Whether browser uploads see the moderation decision for their own upload. Defaults to
    /// `false`.
    pub fn reveal_decision(mut self, value: bool) -> Self {
        self.reveal_decision = Some(value);
        self
    }
    /// The most uploads the preset accepts from each client (IP address) per UTC day. Required
    /// when `access` is `anyone`.
    pub fn daily_upload_limit(mut self, value: u64) -> Self {
        self.daily_upload_limit = Patch::Value(value);
        self
    }
    /// Clears `daily_upload_limit`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_daily_upload_limit(mut self) -> Self {
        self.daily_upload_limit = Patch::Null;
        self
    }
    /// Sites allowed to upload from the browser. Empty or left out allows any site.
    pub fn allowed_origins(mut self, value: impl Into<Vec<String>>) -> Self {
        self.allowed_origins = Patch::Value(value.into());
        self
    }
    /// Clears `allowed_origins`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_allowed_origins(mut self) -> Self {
        self.allowed_origins = Patch::Null;
        self
    }
}
impl UploadPresetDefinition {
    /// A preset `key` named `name`, with every other field at its default.
    pub fn new(key: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            name: name.into(),
            ..Self::blank()
        }
    }
}

/// Options for [`UploadPresetsClient::ensure`](crate::UploadPresetsClient::ensure).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct EnsureUploadPresets {
    /// The presets, returned in the same order.
    pub upload_presets: Vec<UploadPresetDefinition>,
}
impl EnsureUploadPresets {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            upload_presets: Default::default(),
        }
    }
}
impl EnsureUploadPresets {
    /// Options with `upload_presets`; set the rest with the methods below.
    pub fn new(upload_presets: impl Into<Vec<UploadPresetDefinition>>) -> Self {
        Self {
            upload_presets: upload_presets.into(),
        }
    }
}

/// The stored presets from [`UploadPresetsClient::ensure`](crate::UploadPresetsClient::ensure).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct EnsureUploadPresetsResponse {
    /// The stored presets, in the order they were sent.
    #[serde(default)]
    pub upload_presets: Vec<UploadPreset>,
    /// Fields this SDK version does not know.
    #[serde(
        flatten,
        deserialize_with = "extra_fields::<EnsureUploadPresetsResponse, _>"
    )]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl EnsureUploadPresetsResponse {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for EnsureUploadPresetsResponse {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// Identifies an upload preset.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct UploadPresetId {
    /// The upload preset ID.
    pub upload_preset_id: String,
}
impl UploadPresetId {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            upload_preset_id: Default::default(),
        }
    }
}
impl UploadPresetId {}
impl From<&str> for UploadPresetId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}
impl From<String> for UploadPresetId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}
impl From<&String> for UploadPresetId {
    fn from(value: &String) -> Self {
        Self::new(value)
    }
}
impl UploadPresetId {
    /// Identifies upload preset `upload_preset_id`.
    pub fn new(upload_preset_id: impl Into<String>) -> Self {
        Self {
            upload_preset_id: upload_preset_id.into(),
        }
    }
}

string_enum! {
    /// An optional standard a project can opt out of. Jurisdictions with legal rules always
    /// apply and can't be opted out.
    OptOutJurisdiction {
        /// The European Union's optional standard.
        Eu = "EU",
    }
}

string_enum! {
    /// How a [`RemoteUrlRule`] treats its domains.
    RemoteUrlRuleMode {
        /// Accept only these domains.
        Allow = "allow",
        /// Accept every public domain except these.
        Deny = "deny",
    }
}

/// Restricts the domains a project accepts when content is submitted by URL, including websites.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct RemoteUrlRule {
    /// How the rule treats its domains.
    pub mode: RemoteUrlRuleMode,
    /// The domains, such as `example.com`.
    #[serde(default)]
    pub domains: Vec<String>,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<RemoteUrlRule, _>")]
    pub extra: HashMap<String, Value>,
}
impl RemoteUrlRule {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            mode: Default::default(),
            domains: Default::default(),
            extra: Default::default(),
        }
    }
}
impl RemoteUrlRule {
    /// The domains, such as `example.com`.
    pub fn domains(mut self, value: impl Into<Vec<String>>) -> Self {
        self.domains = value.into();
        self
    }
}
impl RemoteUrlRule {
    /// A rule treating `domains` as `mode` says.
    pub fn new(mode: RemoteUrlRuleMode, domains: Vec<String>) -> Self {
        Self {
            mode,
            domains,
            extra: HashMap::new(),
        }
    }
}

/// Which automated decisions are sampled into the human review queue. The default samples none.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HumanReviewSettings {
    /// The percentage of allowed decisions to sample.
    pub allowed_sample_percent: f64,
    /// The percentage of restricted decisions to sample.
    pub restricted_sample_percent: f64,
    /// Queues decisions whose policy score lies less than this many percentage points from the
    /// policy threshold; 0 turns it off.
    pub uncertainty_margin_percent: f64,
    /// Queues decisions whose report has evidence moderation couldn't assess.
    pub review_missing_evidence: bool,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<HumanReviewSettings, _>")]
    pub extra: HashMap<String, Value>,
}

/// Changes to which automated decisions are sampled into the human review queue. Fields left
/// `None` keep their current values.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct HumanReviewDefinition {
    /// The percentage of allowed decisions to sample.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_sample_percent: Option<f64>,
    /// The percentage of restricted decisions to sample.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restricted_sample_percent: Option<f64>,
    /// Queues decisions whose policy score lies less than this many percentage points from the
    /// policy threshold; 0 turns it off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uncertainty_margin_percent: Option<f64>,
    /// Queues decisions whose report has evidence moderation couldn't assess.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_missing_evidence: Option<bool>,
}
impl HumanReviewDefinition {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// The percentage of allowed decisions to sample.
    pub fn allowed_sample_percent(mut self, value: f64) -> Self {
        self.allowed_sample_percent = Some(value);
        self
    }
    /// The percentage of restricted decisions to sample.
    pub fn restricted_sample_percent(mut self, value: f64) -> Self {
        self.restricted_sample_percent = Some(value);
        self
    }
    /// Queues decisions whose policy score lies less than this many percentage points from the
    /// policy threshold; 0 turns it off.
    pub fn uncertainty_margin_percent(mut self, value: f64) -> Self {
        self.uncertainty_margin_percent = Some(value);
        self
    }
    /// Queues decisions whose report has evidence moderation couldn't assess.
    pub fn review_missing_evidence(mut self, value: bool) -> Self {
        self.review_missing_evidence = Some(value);
        self
    }
}
impl From<HumanReviewSettings> for HumanReviewDefinition {
    /// Every current setting, e.g. to send a project's settings back with changes.
    fn from(settings: HumanReviewSettings) -> Self {
        Self {
            allowed_sample_percent: Some(settings.allowed_sample_percent),
            restricted_sample_percent: Some(settings.restricted_sample_percent),
            uncertainty_margin_percent: Some(settings.uncertainty_margin_percent),
            review_missing_evidence: Some(settings.review_missing_evidence),
        }
    }
}

/// A project's settings, with every default filled in.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ProjectSettings {
    /// Whether new uploads retain their content.
    pub retain_content: bool,
    /// Optional standards this project doesn't serve.
    #[serde(default)]
    pub opt_out_jurisdictions: Vec<OptOutJurisdiction>,
    /// Whether the CDN refuses to serve assets whose moderation is still pending.
    pub block_unmoderated_assets: bool,
    /// Whether uploaded images keep their embedded metadata (EXIF, XMP and IPTC).
    pub store_sensitive_metadata: bool,
    /// Preview. Whether every audio and video upload that keeps its content gets an adaptive
    /// stream (HLS).
    pub streaming_enabled: bool,
    /// Whether audio speech and video frames and transcripts are indexed for AI search.
    pub ai_media_search_enabled: bool,
    /// Enable paid link checks. Off by default.
    pub link_checking_enabled: bool,
    /// The domains accepted when content is submitted by URL; `None` accepts every public domain.
    #[serde(default)]
    pub remote_url_rule: Option<RemoteUrlRule>,
    /// How many websites the project can submit per minute; `None` uses the platform limit.
    #[serde(default)]
    pub website_submissions_per_minute: Option<u32>,
    /// Which automated decisions are sampled into the human review queue.
    pub human_review: HumanReviewSettings,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<ProjectSettings, _>")]
    pub extra: HashMap<String, Value>,
}

/// A project's settings and the revision to send back with a change.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ProjectSettingsResource {
    /// The project.
    pub project_id: String,
    /// Counts changes to the project's settings and metadata fields, which share it.
    pub revision: u64,
    /// The settings.
    pub settings: ProjectSettings,
    /// Fields this SDK version does not know.
    #[serde(
        flatten,
        deserialize_with = "extra_fields::<ProjectSettingsResource, _>"
    )]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl ProjectSettingsResource {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for ProjectSettingsResource {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// A project's complete settings, for
/// [`ProjectSettingsClient::update`](crate::ProjectSettingsClient::update). They replace the
/// stored settings, so a setting left out (`None` or [`Patch::Missing`]) returns to its default.
/// To change one setting, convert the [`ProjectSettings`] you read with `From` and change it.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ProjectSettingsDefinition {
    /// Retention default for new uploads.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retain_content: Option<bool>,
    /// Optional standards this project doesn't serve. Defaults to none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opt_out_jurisdictions: Option<Vec<OptOutJurisdiction>>,
    /// Whether the CDN refuses to serve assets whose moderation is still pending. Defaults to
    /// `true`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_unmoderated_assets: Option<bool>,
    /// Whether uploaded images keep their embedded metadata (EXIF, XMP and IPTC). Defaults to
    /// `false`. An upload's `processing_options.store_sensitive_metadata` overrides it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_sensitive_metadata: Option<bool>,
    /// Preview. Prepare an adaptive stream (HLS) of every audio and video upload that keeps its
    /// content. Billed per started minute of media. Defaults to `false`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streaming_enabled: Option<bool>,
    /// Index audio speech and video frames and transcripts for AI search. Billed per indexed media
    /// unit. Defaults to `false`; images are always searchable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai_media_search_enabled: Option<bool>,
    /// Enable paid link checks. Omitted settings use the default, false.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_checking_enabled: Option<bool>,
    /// The domains accepted when content is submitted by URL. Left out or null accepts every
    /// public domain.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub remote_url_rule: Patch<RemoteUrlRule>,
    /// Lowers how many websites the project can submit per minute. Left out or null uses the
    /// platform limit.
    #[serde(default, skip_serializing_if = "Patch::is_missing")]
    pub website_submissions_per_minute: Patch<u32>,
    /// Which automated decisions are sampled into the human review queue. Defaults to none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub human_review: Option<HumanReviewDefinition>,
    /// Settings this SDK version does not know, kept when settings you read are sent back.
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}
impl ProjectSettingsDefinition {
    /// Options with nothing set; set them with the methods below.
    pub fn new() -> Self {
        Self::default()
    }
    /// Retention default for new uploads.
    pub fn retain_content(mut self, value: bool) -> Self {
        self.retain_content = Some(value);
        self
    }
    /// Optional standards this project doesn't serve. Defaults to none.
    pub fn opt_out_jurisdictions(mut self, value: impl Into<Vec<OptOutJurisdiction>>) -> Self {
        self.opt_out_jurisdictions = Some(value.into());
        self
    }
    /// Whether the CDN refuses to serve assets whose moderation is still pending. Defaults to
    /// `true`.
    pub fn block_unmoderated_assets(mut self, value: bool) -> Self {
        self.block_unmoderated_assets = Some(value);
        self
    }
    /// Whether uploaded images keep their embedded metadata (EXIF, XMP and IPTC). Defaults to
    /// `false`. An upload's `processing_options.store_sensitive_metadata` overrides it.
    pub fn store_sensitive_metadata(mut self, value: bool) -> Self {
        self.store_sensitive_metadata = Some(value);
        self
    }
    /// Preview. Prepare an adaptive stream (HLS) of every audio and video upload that keeps its
    /// content. Billed per started minute of media. Defaults to `false`.
    pub fn streaming_enabled(mut self, value: bool) -> Self {
        self.streaming_enabled = Some(value);
        self
    }
    /// Index audio speech and video frames and transcripts for AI search. Billed per indexed media
    /// unit. Defaults to `false`; images are always searchable.
    pub fn ai_media_search_enabled(mut self, value: bool) -> Self {
        self.ai_media_search_enabled = Some(value);
        self
    }
    /// Enable paid link checks. Omitted settings use the default, false.
    pub fn link_checking_enabled(mut self, value: bool) -> Self {
        self.link_checking_enabled = Some(value);
        self
    }
    /// The domains accepted when content is submitted by URL. Left out or null accepts every
    /// public domain.
    pub fn remote_url_rule(mut self, value: impl Into<RemoteUrlRule>) -> Self {
        self.remote_url_rule = Patch::Value(value.into());
        self
    }
    /// Clears `remote_url_rule`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_remote_url_rule(mut self) -> Self {
        self.remote_url_rule = Patch::Null;
        self
    }
    /// Lowers how many websites the project can submit per minute. Left out or null uses the
    /// platform limit.
    pub fn website_submissions_per_minute(mut self, value: u32) -> Self {
        self.website_submissions_per_minute = Patch::Value(value);
        self
    }
    /// Clears `website_submissions_per_minute`: sends `null`, where leaving it out keeps the current value.
    pub fn clear_website_submissions_per_minute(mut self) -> Self {
        self.website_submissions_per_minute = Patch::Null;
        self
    }
    /// Which automated decisions are sampled into the human review queue. Defaults to none.
    pub fn human_review(mut self, value: impl Into<HumanReviewDefinition>) -> Self {
        self.human_review = Some(value.into());
        self
    }
}
impl From<ProjectSettings> for ProjectSettingsDefinition {
    fn from(settings: ProjectSettings) -> Self {
        Self {
            opt_out_jurisdictions: Some(settings.opt_out_jurisdictions),
            retain_content: Some(settings.retain_content),
            block_unmoderated_assets: Some(settings.block_unmoderated_assets),
            store_sensitive_metadata: Some(settings.store_sensitive_metadata),
            streaming_enabled: Some(settings.streaming_enabled),
            ai_media_search_enabled: Some(settings.ai_media_search_enabled),
            link_checking_enabled: Some(settings.link_checking_enabled),
            remote_url_rule: settings.remote_url_rule.map_or(Patch::Null, Patch::Value),
            website_submissions_per_minute: settings
                .website_submissions_per_minute
                .map_or(Patch::Null, Patch::Value),
            human_review: Some(settings.human_review.into()),
            extra: settings.extra,
        }
    }
}

/// Options for [`ProjectSettingsClient::update`](crate::ProjectSettingsClient::update).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct UpdateProjectSettings {
    /// The `revision` you last read, which refuses settings or metadata fields changed since with
    /// `project-settings/revision-conflict`. Omit it to replace them whatever their revision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
    /// The complete settings.
    pub settings: ProjectSettingsDefinition,
    /// Needed when turning on `ai_media_search_enabled`: the most indexing units you accept for
    /// the project's existing media. A smaller value than the estimate is refused with
    /// `search/estimate-changed`, whose details give the estimate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_indexing_budget_units: Option<f64>,
}
impl UpdateProjectSettings {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            revision: Default::default(),
            settings: Default::default(),
            search_indexing_budget_units: Default::default(),
        }
    }
}
impl UpdateProjectSettings {
    /// The `revision` you last read, which refuses settings or metadata fields changed since with
    /// `project-settings/revision-conflict`. Omit it to replace them whatever their revision.
    pub fn revision(mut self, value: u64) -> Self {
        self.revision = Some(value);
        self
    }
    /// Needed when turning on `ai_media_search_enabled`: the most indexing units you accept for
    /// the project's existing media. A smaller value than the estimate is refused with
    /// `search/estimate-changed`, whose details give the estimate.
    pub fn search_indexing_budget_units(mut self, value: f64) -> Self {
        self.search_indexing_budget_units = Some(value);
        self
    }
}
impl UpdateProjectSettings {
    /// Replaces the project's settings with `settings`, whatever their revision.
    pub fn new(settings: impl Into<ProjectSettingsDefinition>) -> Self {
        Self {
            settings: settings.into(),
            ..Self::blank()
        }
    }
}

string_enum! {
    /// The type of a metadata field's values.
    MetadataFieldType {
        /// Text.
        String = "string",
        /// A number.
        Number = "number",
        /// True or false.
        Boolean = "boolean",
        /// A date.
        Date = "date",
        /// A URL.
        Url = "url",
    }
}

string_enum! {
    /// The icon the portal shows for a metadata field.
    MetadataFieldIcon {
        /// A tag.
        Tag = "tag",
        /// A hash sign.
        Hash = "hash",
        /// A person.
        User = "user",
        /// A folder.
        Folder = "folder",
        /// Stacked layers.
        Layers = "layers",
        /// A photo.
        Photo = "photo",
        /// A link.
        Link = "link",
    }
}

/// A metadata field the portal shows and filters by.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct MetadataField {
    /// The field ID, which assets' metadata values refer to.
    pub id: String,
    /// The display title.
    pub title: String,
    /// A description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The type of the field's values (`type` on the wire).
    #[serde(rename = "type")]
    pub field_type: MetadataFieldType,
    /// The icon the portal shows.
    pub icon: MetadataFieldIcon,
    /// The color the portal shows, as `#rrggbb`.
    pub color: String,
    /// Fields this SDK version does not know.
    #[serde(flatten, deserialize_with = "extra_fields::<MetadataField, _>")]
    pub extra: HashMap<String, Value>,
}
impl MetadataField {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            id: Default::default(),
            title: Default::default(),
            description: Default::default(),
            field_type: Default::default(),
            icon: Default::default(),
            color: Default::default(),
            extra: Default::default(),
        }
    }
}
impl MetadataField {
    /// A description.
    pub fn description(mut self, value: impl Into<String>) -> Self {
        self.description = Some(value.into());
        self
    }
}
impl MetadataField {
    /// A field without a description.
    pub fn new(
        id: impl Into<String>,
        title: impl Into<String>,
        field_type: impl Into<MetadataFieldType>,
        icon: impl Into<MetadataFieldIcon>,
        color: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            field_type: field_type.into(),
            icon: icon.into(),
            color: color.into(),
            ..Self::blank()
        }
    }
}

/// A project's metadata fields and the revision to send back with a change.
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct MetadataFieldsResource {
    /// The project.
    pub project_id: String,
    /// Counts changes to the project's settings and metadata fields, which share it.
    pub revision: u64,
    /// The fields, in display order.
    #[serde(default)]
    pub fields: Vec<MetadataField>,
    /// Fields this SDK version does not know.
    #[serde(
        flatten,
        deserialize_with = "extra_fields::<MetadataFieldsResource, _>"
    )]
    pub extra: HashMap<String, Value>,
    /// The HTTP response this came from, read with `last_response()`.
    #[serde(skip)]
    pub(crate) last_response: ResponseSlot,
}
impl MetadataFieldsResource {
    /// The HTTP response this result came from (status, request ID and headers), or `None`
    /// for one decoded or built by hand.
    pub fn last_response(&self) -> Option<&LastResponse> {
        self.last_response.0.as_deref()
    }
}
impl Responded for MetadataFieldsResource {
    fn set_last_response(&mut self, response: LastResponse) {
        self.last_response = ResponseSlot(Some(std::sync::Arc::new(response)));
    }
}

/// Options for [`MetadataFieldsClient::ensure`](crate::MetadataFieldsClient::ensure).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct EnsureMetadataFields {
    /// The `revision` you last read, which refuses settings or metadata fields changed since with
    /// `project-settings/revision-conflict`. Omit it to change them whatever their revision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
    /// The fields to create or replace by ID; other fields are kept.
    pub fields: Vec<MetadataField>,
}
impl EnsureMetadataFields {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            revision: Default::default(),
            fields: Default::default(),
        }
    }
}
impl EnsureMetadataFields {
    /// Options with `fields`; set the rest with the methods below.
    pub fn new(fields: impl Into<Vec<MetadataField>>) -> Self {
        Self {
            fields: fields.into(),
            revision: Default::default(),
        }
    }
    /// The `revision` you last read, which refuses settings or metadata fields changed since with
    /// `project-settings/revision-conflict`. Omit it to change them whatever their revision.
    pub fn revision(mut self, value: u64) -> Self {
        self.revision = Some(value);
        self
    }
}

/// Options for [`MetadataFieldsClient::delete`](crate::MetadataFieldsClient::delete).
#[cfg_attr(
    feature = "strict-contract",
    macro_rules_attribute::macro_rules_derive(described)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DeleteMetadataField {
    /// The field ID.
    pub field_id: String,
    /// The `revision` you last read, which refuses settings or metadata fields changed since with
    /// `project-settings/revision-conflict`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
}
impl DeleteMetadataField {
    /// Every field empty, for the constructors to fill in.
    #[allow(dead_code)]
    pub(crate) fn blank() -> Self {
        Self {
            field_id: Default::default(),
            revision: Default::default(),
        }
    }
}
impl DeleteMetadataField {
    /// The `revision` you last read, which refuses settings or metadata fields changed since with
    /// `project-settings/revision-conflict`.
    pub fn revision(mut self, value: u64) -> Self {
        self.revision = Some(value);
        self
    }
}
impl DeleteMetadataField {
    /// Deletes field `field_id`, whatever the revision.
    pub fn new(field_id: impl Into<String>) -> Self {
        Self {
            field_id: field_id.into(),
            revision: None,
        }
    }
}
