"""The API's types: result objects and the dicts that options take.

Every method returns a :class:`~calmlens.CalmLensObject` (or a :class:`~calmlens.ListObject` page)
read through typed snake_case attributes, such as ``asset.classification.moderation.decision``.
Fields added by newer API versions stay readable, and ``to_dict()`` returns the API's JSON.
Enum-like result values (``status``, ``type``, ``visibility``, ...) are typed as the known literals
*or* ``str``: values this SDK version doesn't list never fail decoding or type checking. Compare
them against the literals below, and treat unknown values as "not allowed".

Options are keyword arguments in snake_case. A dict option, such as ``processing_options``, is a
``...Params`` ``TypedDict`` with snake_case keys, and takes the closed literal sets the API
accepts. Transform options keep the CDN's names, and metadata values are sent as given.
"""
from collections.abc import Mapping
from typing import Any, BinaryIO, Dict, List, Literal, Optional, TypedDict, Union

from ._object import CalmLensObject, ListObject
from .qualifiers import ModerationQualifier

class ViewerClaims(TypedDict, total=False):
    """Optional customer assertions for CDN delivery.

    ``region`` is the viewer's ISO 3166-1 alpha-2 country, such as ``DE``. ``ageConfirmed`` is
    your platform's confirmation that the viewer passed its age check, and defaults to false.
    Viewer claims are assertions from your application; CalmLens doesn't verify them. Default claims (no region, age
    not confirmed) are left out of URLs so default URLs stay cacheable.
    """
    region: str
    age_confirmed: bool


__all__ = [
    "ModerationQualifier", "ModerationContextItem", "ModerationContext", "IMAGE_TRANSFORM_COLOUR_KEYS",
    "AssetBatchOperation", "BatchAssetsResponse",
    "PolicyRuleSnapshot", "CategoryPolicySettingsSnapshot", "CategoryPolicySource", "CategoryPolicyDefaultSource", "CategoryPolicyRuleSource", "RegionalDecision",
    "ViewerClaims", "CategoryPolicyScore", "AgeRange", "Asset", "AssetClassificationFailureReason", "AssetContent",
    "AssetContentRemovalReason", "AssetContentStatus", "Actor", "ActorType", "ReviewActor", "AssetReview",
    "AssetModeration", "AssetPendingReview", "DecisionPolicy", "DecisionPolicyPreset", "ModerationRaw", "AssetModerationDecision",
    "AssetModerationStatus", "AssetPage", "AssetTimelinePage", "AssetTimelineSegment", "AssetClassification", "ClassificationProgress",
    "AssetUpload", "AssetClassificationStatus", "AssetSearchMatch", "AssetSearchMatchField", "AssetSearchResponse", "AssetType",
    "BinaryData", "BoundingBox", "CategoryResult", "CdnResource", "CdnTransform", "Checksums",
    "ClassificationCategories", "ClassificationCategory", "Content", "DetectedFace", "DetectedPerson", "EvaluatedCategoryResult",
    "EvaluatedFaceDetectionResult", "EvaluatedPersonDetectionResult", "EvaluatedQualifierResult", "Event", "EventAsset", "EventAssetContent",
    "EventAssetModeration", "EventAssetClassification", "EventAssetUpload", "EventFact", "EventFactKey", "EventFactValue",
    "EventSeverity", "EventType", "KnownEventType", "KnownPolicyPresetId", "ModerationSource", "EventsPage",
    "ExtractedText", "FaceDetectionFeatureOptions", "FaceDetectionResult", "FileMetadata", "FileMetadataLocation", "Folder",
    "FolderPage", "AssetRendered", "AssetRenderedKind", "AssetHls", "AssetHlsRendition", "StreamingFeatureOptions",
    "AssetPreview", "AssetModerationTimeline", "AssetInfo", "AssetInfoContent", "AssetAvailability", "ImageTransformBorder",
    "ImageTransformGravityPoint", "ImageTransformOptions", "ImageTransformTrim", "ImageTransformTrimBorder", "InlineExtractedText", "Lens",
    "LensDefinition", "LensType", "Likelihood", "MediaClassificationSegment", "MediaSegmentSource", "MetadataItem",
    "ModerationAction", "NotEvaluatedCategoryResult", "FeatureNotEvaluatedReason", "NotEvaluatedFeatureResult", "NotEvaluatedQualifierResult", "NotEvaluatedReason",
    "OcrFeatureOptions", "PartContent", "PartialCategoryResult", "PersonDetectionFeatureOptions", "PersonDetectionResult", "ProcessingFeatures",
    "ProcessingOptions", "QualifierResult", "QualifierResults", "SafetyHold", "SafetyHoldReason", "SearchMode",
    "SemanticStatus", "ServeInit", "SignedAssetUrl", "StoredExtractedText", "SignedUploadToken", "Visibility",
    "WebhookEventPayload", "TextRegion", "DetectedQrCode", "DetectedLink", "EvaluatedLinkDetectionResult", "LinkDetectionResult",
    "ProvenanceSignal", "EvaluatedAiGeneratedDetectionResult", "AiGeneratedDetectionResult", "LinkDetectionFeatureOptions", "AiGeneratedDetectionFeatureOptions", "LinkSafetyVerdict",
    "LinkSafetyAction", "LinkSafetyEvidence", "CheckedLink", "EvaluatedLinkSafetyResult", "LinkSafetyResult", "OffPlatformLinkSettings",
    "LinkSafetySettings", "LinkSafetyDecision", "HashMatch", "HashListAction", "HashList", "HashListEntry",
    "HashListPage", "HashListEntryPage", "PolicyPresetId", "CategoryPolicySettings", "CategorySettings", "PolicySettings",
    "PolicyPresetMode", "PolicyPreset", "Policy", "PolicyPage", "LensPage", "EvaluatedOcrResult",
    "OcrResult", "UploadPreset", "UploadPresetAccess", "UploadPresetPage", "UploadPresetDefinition", "EnsureUploadPresetsResponse",
    "OptOutJurisdiction", "RemoteUrlRule", "HumanReviewSettings", "HumanReviewSettingsInput", "PublicProjectSettings", "PublicProjectSettingsInput",
    "ProjectSettingsResource", "MetadataFieldType", "MetadataFieldIcon", "MetadataField", "MetadataFieldDefinition", "MetadataFieldsResource",
    "AiGeneratedDetectionFeatureParams", "CategoryPolicySettingsParams", "CategorySettingsParams", "FaceDetectionFeatureParams", "LinkDetectionFeatureParams", "LinkSafetySettingsParams",
    "MetadataItemParams", "ModerationContextItemParams", "ModerationContextParams", "OcrFeatureParams", "OffPlatformLinkSettingsParams", "PersonDetectionFeatureParams",
    "PolicyRuleSnapshotParams", "PolicySettingsParams", "ProcessingFeaturesParams", "ProcessingParams", "RemoteUrlRuleParams", "StreamingFeatureParams",
]

# ---- Enum-like values -----------------------------------------------------------------------

#: Where an asset is in the pipeline (``classification.status``): ``queued`` while it waits for its
#: content (a multipart upload still receiving parts) or its turn, ``processing``, then
#: ``completed`` or ``failed``. The asset is settled once it is ``completed`` or ``failed``. New
#: statuses may be added.
AssetClassificationStatus = Union[Literal["queued", "processing", "completed", "failed"], str]
#: The moderation decision in force, which also decides delivery (``classification.moderation.decision``):
#: ``pending``, then ``allowed``, ``limited`` (delivered like ``allowed``, but marked so your app can
#: reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it
#: lower or collapsing it), ``age-restricted`` (delivered only through signed URLs or API keys),
#: ``blocked`` (not delivered, content kept) or ``purged`` (not delivered, content deleted). New
#: statuses may be added; never treat an unknown one as allowed.
AssetModerationStatus = Union[Literal["pending", "allowed", "limited", "age-restricted", "blocked", "purged"], str]
#: A reviewer's decision (``classification.moderation.manualReviews[].decision``). New values may be added.
AssetModerationDecision = Union[Literal["allowed", "limited", "age-restricted", "blocked", "purged"], str]
#: Whether CalmLens holds the content (``content.status``). New statuses may be added.
AssetContentStatus = Union[Literal["temporary", "stored", "removed"], str]
#: Why the content was removed (``content.removalReason``). New reasons may be added.
AssetContentRemovalReason = Union[Literal["policy", "retention", "requested", "parent-removed", "disposed"], str]
#: Why processing failed (``classification.failureReason``), while ``classification.status`` is
#: ``failed``. New reasons may be added.
AssetClassificationFailureReason = Union[Literal["file-too-large", "duration-limit", "resolution-limit",
                                                 "unsupported-format", "undecodable-content", "multiple-tracks",
                                                 "type-mismatch", "free-uploads-exhausted", "media-limit",
                                                 "uploads-paused", "too-many-items", "processing-error"], str]
#: Known asset types. New types may be added.
AssetType = Union[Literal["image", "video", "audio", "plaintext-document", "multimedia-document", "website",
                          "file"], str]
#: Who can read retained content from the CDN (request values; responses may add others).
Visibility = Literal["public", "private"]
#: What a moderation policy does with content that crosses its threshold.
ModerationAction = Literal["allow", "limit", "age-restrict", "block", "purge"]
#: Why an asset is under a safety hold. New reasons may be added.
SafetyHoldReason = Union[Literal["suspected-illegal-content"], str]
#: Moderation categories in ``report.categories``. New categories may be added.
ClassificationCategory = Union[Literal["sexual", "violence", "self-harm", "harassment", "hate",
                                       "criminal-activity", "personal-information", "profanity"], str]
#: How likely content matches a category or label. New values may be added.
Likelihood = Union[Literal["very-unlikely", "unlikely", "possible", "likely", "very-likely"], str]
#: Why a category, qualifier or feature was not evaluated: ``not-supported`` (this processing
#: path cannot assess it) or ``unavailable`` (assessment produced no usable result).
NotEvaluatedReason = Union[Literal["not-supported", "unavailable"], str]
#: Why a processing feature has no findings of its own: ``not-supported``, ``unavailable``, or
#: ``in-children`` for a document or website, whose images are each a child asset with its own
#: result (list them with ``assets.list_children``).
FeatureNotEvaluatedReason = Union[Literal["not-supported", "unavailable", "in-children"], str]
#: Where a media segment's scores came from. New sources may be added.
MediaSegmentSource = Union[Literal["frame", "speech", "frame-text", "clip"], str]
#: Asset type a lens applies to (request values).
LensType = Literal["image", "video", "audio", "document", "website"]
#: A resource beneath an asset's CDN URL: ``original`` (the exact upload; under a signed URL only
#: when it was signed with ``original=True``), ``rendered`` (the displayable file: an image in the
#: best format the client accepts, a PDF, or browser-safe video or audio), ``preview`` (a still
#: image that stands for the asset), ``placeholder`` (a small blurred PNG made from the preview,
#: served publicly for every asset whatever its visibility or moderation status), ``hls`` (the HLS
#: master playlist of audio or video at ``hls/index.m3u8``, once ``content.hls.status`` is ``ready``; its
#: playlists and segments are the other files beneath ``hls/``), ``embed`` (an HTML page that shows
#: the asset, for an iframe) or ``info`` (the asset's display info, see :class:`AssetInfo`). Lenses
#: and transforms apply to ``preview``, and to ``rendered`` when it is an image; the CDN refuses them
#: on rendered PDFs, video and audio with ``transform/invalid``, and the SDK refuses them on every
#: other resource.
CdnResource = Literal["original", "rendered", "preview", "placeholder", "hls", "embed", "info"]
#: How ``assets.search`` matches.
SearchMode = Literal["keyword", "semantic", "hybrid"]
#: Fields a search result matched on. New fields may be added.
AssetSearchMatchField = Union[Literal["name", "id", "externalId", "description", "tags", "type", "content.format",
                                      "content.extension", "classification.moderation.decision", "visual", "transcript"], str]
#: The built-in policy presets this SDK version knows (request values).
KnownPolicyPresetId = Literal["general-community", "children-platform", "education-support", "wholesome-community"]
#: A built-in policy preset. New presets may be added.
PolicyPresetId = Union[KnownPolicyPresetId, str]
#: What decided an automated moderation status (``classification.moderation.source``). New
#: sources may be added.
ModerationSource = Union[Literal["policy", "hash-list", "mandatory-rule", "children", "link-safety"], str]
#: State of the project's semantic search index. New values may be added.
SemanticStatus = Union[Literal["disabled", "ready", "indexing", "unavailable"], str]
#: The event types this SDK version knows (request values, such as ``events.list`` ``types``).
KnownEventType = Literal["asset.uploaded", "asset.classified", "asset.region-restricted", "asset.allowed",
                         "asset.limited", "asset.age-restricted", "asset.blocked", "asset.purged", "asset.failed",
                         "asset.progress-updated", "asset.deleted", "asset.content-removed", "asset.retried",
                         "asset.rerun-requested", "asset.review-requested", "asset.review-completed", "asset.hash-matched", "asset.link-flagged",
                         "usage.free-uploads-exhausted", "usage.uploads-paused", "upload-preset.daily-limit-reached",
                         "project.member-joined", "project.member-removed", "project.member-left",
                         "project.member-role-changed", "project.invitation-sent", "project.transferred",
                         "api-key.created", "api-key.revoked", "api-key.deleted", "connector.disabled"]
#: Event types. New types may be added; ignore ones you don't handle.
EventType = Union[KnownEventType, str]
#: Default severity of an event type. New values may be added.
EventSeverity = Union[Literal["low", "high"], str]
#: Registered fact keys (kebab-case) across event types, plus ``test`` on test sends. Webhook,
#: Slack and email deliveries and the public events feed leave out facts that hold personal or
#: account data (names, email addresses, the organisation's ID).
EventFactKey = Union[Literal[
    "asset-name", "asset-type", "file-format", "parent-asset", "flagged-categories", "moderation-status",
    "automated-status", "region", "rule", "status", "note", "previous-status", "failure-reason",
    "completed-sections", "total-sections", "batch-id", "review-reason", "uncertain-categories", "child-asset",
    "child-status", "review-id", "decision", "applied-to-asset", "reviewer-name", "hash-list-id",
    "hash-list-name", "distance", "match-action", "link-verdict", "link-url", "link-final-url", "link-status",
    "limit", "used", "organisation-id", "reason", "resumes-at", "preset-id", "preset-name", "daily-limit",
    "member-user-id", "member-name", "role", "previous-role", "invitee-email", "previous-organisation-id",
    "previous-organisation-name", "organisation-name", "method", "api-keys-revoked", "connectors-paused",
    "key-id", "key-name", "created-by-name", "revoked-by-name", "deleted-by-name", "connector-id",
    "connector-name", "connector-type", "consecutive-failures", "last-error", "test",
], str]
#: A registered fact value: text, an integer count, a time in epoch milliseconds (such as
#: ``resumes-at``), a boolean, a list of values (such as ``flagged-categories``) or ``None``.
EventFactValue = Any

#: What a hash list's matches do (request values): ``flag`` reports matches, ``block`` also blocks
#: close matches. Responses may add others.
HashListAction = Literal["flag", "block"]

#: Raw bytes accepted by ``Content.data``: bytes-like objects or a binary file object.
BinaryData = Union[bytes, bytearray, memoryview, BinaryIO]


# ---- Upload payloads --------------------------------------------------------------------------


class _ContentRequired(TypedDict):
    type: str


class Content(_ContentRequired, total=False):
    """One payload: exactly one of ``plainText``, ``base64`` or ``data``.

    ``type`` is the file's MIME type (required on the first request). ``data`` is
    bytes-like or a binary file object, which is streamed; ``sizeInBytes`` is computed for
    bytes and seekable files and is required for other streams. ``partNumber`` and
    ``isFinal`` apply to multipart parts.
    """
    plain_text: str
    base64: str
    data: BinaryData
    size_in_bytes: int
    part_number: int
    is_final: bool


class PartContent(TypedDict, total=False):
    """A multipart continuation part (``type`` is taken from the first request)."""
    type: str
    plain_text: str
    base64: str
    data: BinaryData
    size_in_bytes: int
    part_number: int
    is_final: bool


class MetadataItem(CalmLensObject):
    """A custom metadata item. ``value`` is any JSON value you choose, so it is untyped."""
    id: str
    value: Any


class MetadataItemParams(TypedDict):
    """A custom metadata item. ``value`` is any JSON value you choose, so it is untyped."""
    id: str
    value: Any


class ModerationContextItem(CalmLensObject):
    """An earlier post in the conversation. ``authorId`` is your label for who wrote it."""
    text: str
    author_id: Optional[str]


class _ModerationContextItemParamsRequired(TypedDict):
    text: str


class ModerationContextItemParams(_ModerationContextItemParamsRequired, total=False):
    """An earlier post in the conversation. ``authorId`` is your label for who wrote it."""
    author_id: str


class ModerationContext(CalmLensObject):
    """Earlier posts in the conversation, oldest first."""
    items: list[ModerationContextItem]


class ModerationContextParams(TypedDict):
    """Earlier posts in the conversation, oldest first."""
    items: list[ModerationContextItemParams]


class OcrFeatureOptions(CalmLensObject):
    """Extract image text onto the image asset and add a text moderation pass to its report."""
    enabled: bool


class OcrFeatureParams(TypedDict):
    """Extract image text onto the image asset and add a text moderation pass to its report."""
    enabled: bool


class PersonDetectionFeatureOptions(CalmLensObject):
    """Preview. Locate people in images; results never change the moderation decision."""
    enabled: bool


class PersonDetectionFeatureParams(TypedDict):
    """Preview. Locate people in images; results never change the moderation decision."""
    enabled: bool


class FaceDetectionFeatureOptions(CalmLensObject):
    """Preview. Locate faces in images, optionally estimating an age range for each."""
    enabled: bool
    age_estimation: Optional[bool]


class _FaceDetectionFeatureParamsRequired(TypedDict):
    enabled: bool


class FaceDetectionFeatureParams(_FaceDetectionFeatureParamsRequired, total=False):
    """Preview. Locate faces in images, optionally estimating an age range for each."""
    age_estimation: bool


class LinkDetectionFeatureOptions(CalmLensObject):
    """Find web links in images, in QR codes and in OCR text."""
    enabled: bool


class LinkDetectionFeatureParams(TypedDict):
    """Find web links in images, in QR codes and in OCR text."""
    enabled: bool


class AiGeneratedDetectionFeatureOptions(CalmLensObject):
    """Preview. Read AI provenance metadata (C2PA, IPTC, generator settings) from image files."""
    enabled: bool


class AiGeneratedDetectionFeatureParams(TypedDict):
    """Preview. Read AI provenance metadata (C2PA, IPTC, generator settings) from image files."""
    enabled: bool


class StreamingFeatureOptions(CalmLensObject):
    """Preview. Prepare an adaptive stream (HLS) of audio or video once it is decided and made
    browser-safe, served at the ``hls`` resource and played by the ``embed`` resource. Needs
    ``retainContent``. Billed per started minute of media; ``enabled: False`` turns it
    off for an upload in a project that streams by default."""
    #: Whether to prepare the stream. Left out, the project's streaming setting decides.
    enabled: bool


class StreamingFeatureParams(TypedDict):
    """Preview. Prepare an adaptive stream (HLS) of audio or video once it is decided and made
    browser-safe, served at the ``hls`` resource and played by the ``embed`` resource. Needs
    ``retainContent``. Billed per started minute of media; ``enabled: False`` turns it
    off for an upload in a project that streams by default."""
    #: Whether to prepare the stream. Left out, the project's streaming setting decides.
    enabled: bool


class ProcessingFeatures(CalmLensObject):
    """Optional analyses to run on an asset, keyed by feature. ``linkDetection`` runs unless
    its ``enabled`` is false; every other feature is off unless its ``enabled`` is true.
    Unknown features are rejected."""
    ocr: Optional[OcrFeatureOptions]
    person_detection: Optional[PersonDetectionFeatureOptions]
    face_detection: Optional[FaceDetectionFeatureOptions]
    link_detection: Optional[LinkDetectionFeatureOptions]
    ai_generated_detection: Optional[AiGeneratedDetectionFeatureOptions]
    streaming: Optional[StreamingFeatureOptions]


class ProcessingFeaturesParams(TypedDict, total=False):
    """Optional analyses to run on an asset, keyed by feature. ``linkDetection`` runs unless
    its ``enabled`` is false; every other feature is off unless its ``enabled`` is true.
    Unknown features are rejected."""
    ocr: Optional[OcrFeatureParams]
    person_detection: Optional[PersonDetectionFeatureParams]
    face_detection: Optional[FaceDetectionFeatureParams]
    link_detection: Optional[LinkDetectionFeatureParams]
    ai_generated_detection: Optional[AiGeneratedDetectionFeatureParams]
    streaming: Optional[StreamingFeatureParams]


class ProcessingOptions(CalmLensObject):
    """``processingOptions`` for an upload."""
    retain_content: Optional[bool]
    #: Overrides the project's ``storeSensitiveMetadata`` setting for this upload. When false,
    #: embedded image metadata (EXIF, XMP and IPTC) is removed from the file before it is stored,
    #: and ``content.metadata`` leaves out the creator and location. When true, the image is stored as
    #: uploaded.
    store_sensitive_metadata: Optional[bool]
    features: Optional[ProcessingFeatures]


class ProcessingParams(TypedDict, total=False):
    """``processingOptions`` for an upload."""
    retain_content: Optional[bool]
    #: Overrides the project's ``storeSensitiveMetadata`` setting for this upload. When false,
    #: embedded image metadata (EXIF, XMP and IPTC) is removed from the file before it is stored,
    #: and ``content.metadata`` leaves out the creator and location. When true, the image is stored as
    #: uploaded.
    store_sensitive_metadata: Optional[bool]
    features: Optional[ProcessingFeaturesParams]


# ---- Classification report --------------------------------------------------------------------


class EvaluatedQualifierResult(CalmLensObject):
    status: Literal["evaluated"]
    #: Confidence that *some* of the content is this qualifier.
    some_score: float
    likelihood: Likelihood
    #: Confidence that the content is *only* this qualifier; never above ``someScore``.
    all_score: Optional[float]


class NotEvaluatedQualifierResult(CalmLensObject):
    status: Literal["not-evaluated"]
    reason: NotEvaluatedReason


#: A qualifier result; narrow on ``result["status"]``.
QualifierResult = Union[EvaluatedQualifierResult, NotEvaluatedQualifierResult]
#: Qualifier results keyed by qualifier; only assessed qualifiers are present.
QualifierResults = Dict[ModerationQualifier, QualifierResult]


class EvaluatedCategoryResult(CalmLensObject):
    status: Literal["evaluated"]
    likelihood: Likelihood
    score: float
    qualifiers: Optional[QualifierResults]


class PartialCategoryResult(CalmLensObject):
    """Some of the content (for example a media segment) could not be assessed."""
    status: Literal["partial"]
    likelihood: Likelihood
    score: float
    qualifiers: Optional[QualifierResults]


class NotEvaluatedCategoryResult(CalmLensObject):
    status: Literal["not-evaluated"]
    reason: NotEvaluatedReason
    qualifiers: Optional[QualifierResults]


#: A category result; narrow on ``result["status"]`` before reading ``score``.
CategoryResult = Union[EvaluatedCategoryResult, PartialCategoryResult, NotEvaluatedCategoryResult]
#: Category results keyed by category. Every known category is present.
ClassificationCategories = Dict[ClassificationCategory, CategoryResult]


class MediaClassificationSegment(CalmLensObject):
    source: MediaSegmentSource
    start_seconds: float
    end_seconds: float
    categories: ClassificationCategories


#: One stretch of an audio or video asset's findings: its source, times and scores.
AssetTimelineSegment = MediaClassificationSegment


class BoundingBox(CalmLensObject):
    """Position and size as fractions of the image width and height, from 0 to 1."""
    left: float
    top: float
    width: float
    height: float


class AgeRange(CalmLensObject):
    """Estimated age range in years. Estimates can be off by several years."""
    low: int
    high: int


class DetectedPerson(CalmLensObject):
    box: BoundingBox
    confidence: float


class DetectedFace(CalmLensObject):
    box: BoundingBox
    confidence: float
    age_range: Optional[AgeRange]


class NotEvaluatedFeatureResult(CalmLensObject):
    status: Literal["not-evaluated"]
    reason: FeatureNotEvaluatedReason


class EvaluatedPersonDetectionResult(CalmLensObject):
    status: Literal["evaluated"]
    people: list[DetectedPerson]


class EvaluatedFaceDetectionResult(CalmLensObject):
    status: Literal["evaluated"]
    faces: list[DetectedFace]


class TextRegion(CalmLensObject):
    """Where OCR found text in the image."""
    box: BoundingBox
    #: Whether the region is personal information, such as an email address, phone number or card
    #: number, rather than a paragraph of text.
    personal_information: bool


class EvaluatedOcrResult(CalmLensObject):
    status: Literal["evaluated"]
    #: Where OCR found text, and personal information within it. The text itself is ``content.extractedText``.
    text_regions: list[TextRegion]


#: What OCR found in an image; narrow on ``result["status"]`` before reading ``textRegions``.
OcrResult = Union[EvaluatedOcrResult, NotEvaluatedFeatureResult]


class DetectedQrCode(CalmLensObject):
    """A decoded QR code."""
    #: The text the QR code holds, such as a URL.
    value: str
    box: BoundingBox


class DetectedLink(CalmLensObject):
    """A web link found in the image."""
    #: The link, with ``https://`` added when the image left it out.
    url: str
    #: ``qr-code`` or ``text`` (the text OCR extracted). New sources may be added.
    source: Union[Literal["qr-code", "text"], str]


class EvaluatedLinkDetectionResult(CalmLensObject):
    status: Literal["evaluated"]
    qr_codes: list[DetectedQrCode]
    links: list[DetectedLink]


class ProvenanceSignal(CalmLensObject):
    """Provenance metadata found in the image file."""
    #: ``c2pa``, ``iptc-digital-source-type`` or ``generator-metadata``. New kinds may be added.
    kind: Union[Literal["c2pa", "iptc-digital-source-type", "generator-metadata"], str]
    #: What it says, such as the digital source type or the generator's name.
    value: str


class EvaluatedAiGeneratedDetectionResult(CalmLensObject):
    status: Literal["evaluated"]
    #: ``ai-generated``, ``ai-edited`` or ``unknown`` when the file carries no AI provenance
    #: (which doesn't mean a person made it: re-saved images lose their metadata).
    provenance: Union[Literal["ai-generated", "ai-edited", "unknown"], str]
    signals: list[ProvenanceSignal]


#: Person detection result; narrow on ``result["status"]`` before reading ``people``.
PersonDetectionResult = Union[EvaluatedPersonDetectionResult, NotEvaluatedFeatureResult]
#: Face detection result; narrow on ``result["status"]`` before reading ``faces``.
FaceDetectionResult = Union[EvaluatedFaceDetectionResult, NotEvaluatedFeatureResult]
#: Link detection result; narrow on ``result["status"]`` before reading ``qrCodes`` and ``links``.
LinkDetectionResult = Union[EvaluatedLinkDetectionResult, NotEvaluatedFeatureResult]
#: AI provenance result; narrow on ``result["status"]`` before reading ``provenance``.
AiGeneratedDetectionResult = Union[EvaluatedAiGeneratedDetectionResult, NotEvaluatedFeatureResult]


# ---- Link safety (preview) ------------------------------------------------------------------

#: Preview. What a link's destination is: ``safe`` when every reputation check passed, ``adult`` or
#: ``gambling`` from its domain's content categories, ``phishing`` or ``malware`` from a threat list
#: or the domain's security risks, and ``unresolved`` when a short link or redirect chain could not
#: be followed or a check failed. Every address on a link's way is checked, and the most severe
#: verdict is the link's. New verdicts may be added.
LinkSafetyVerdict = Union[Literal["safe", "adult", "gambling", "phishing", "malware", "unresolved"], str]
#: Preview. What a link does to its asset under the policy's link-safety settings. Purging content
#: over a link is never offered. New actions may be added.
LinkSafetyAction = Union[Literal["allow", "limit", "age-restrict", "block"], str]


class LinkSafetyEvidence(CalmLensObject):
    """Preview. One reputation check of a link, every address it redirects through and its
    destination."""
    #: ``domain-categories`` (the domain categories of every address on the way) or
    #: ``threat-lists`` (a threat-list lookup of every URL on the way). New checks may be added.
    check: Union[Literal["domain-categories", "threat-lists"], str]
    #: ``checked``, or ``failed`` when the check could not answer, which makes the link
    #: ``unresolved``. New statuses may be added.
    status: Union[Literal["checked", "failed"], str]
    #: What the check reported for any of the addresses, such as the domains' content categories and
    #: security risks or the threat types listed.
    labels: list[str]


class CheckedLink(CalmLensObject):
    """Preview. A link in the asset and what its destination is."""
    #: The link as found, with ``https://`` added when it was left out.
    url: str
    #: Where the link leads after following its redirects, or ``None`` when a short link or redirect
    #: chain could not be followed.
    final_url: Optional[str]
    #: How many redirects were followed to reach ``finalUrl``.
    redirects: int
    #: ``qr-code`` or ``text``. New sources may be added.
    source: Union[Literal["qr-code", "text"], str]
    verdict: LinkSafetyVerdict
    evidence: list[LinkSafetyEvidence]


class EvaluatedLinkSafetyResult(CalmLensObject):
    status: Literal["evaluated"]
    links: list[CheckedLink]


#: Preview. Link safety result: where each link in the asset leads and its verdict. It runs when the
#: project's policy acts on links, not through ``processingOptions.features``. Narrow on
#: ``result["status"]`` before reading ``links``.
LinkSafetyResult = Union[EvaluatedLinkSafetyResult, NotEvaluatedFeatureResult]


class OffPlatformLinkSettings(CalmLensObject):
    """Preview. Acts on every link whose destination is outside ``allowedDomains``, whatever its
    verdict."""
    #: ``limit``, ``age-restrict`` or ``block``.
    action: LinkSafetyAction
    #: Bare lowercase domains such as ``example.com``. A domain also covers its subdomains.
    allowed_domains: list[str]


class OffPlatformLinkSettingsParams(TypedDict):
    """Preview. Acts on every link whose destination is outside ``allowedDomains``, whatever its
    verdict."""
    #: ``limit``, ``age-restrict`` or ``block``.
    action: LinkSafetyAction
    #: Bare lowercase domains such as ``example.com``. A domain also covers its subdomains.
    allowed_domains: list[str]


class LinkSafetySettings(CalmLensObject):
    """Preview. What happens to assets that link to unsafe destinations. Link checks never change a
    moderation category's score."""
    #: What happens to an asset with a link of each verdict (``phishing``, ``malware``, ``adult``,
    #: ``gambling``, ``unresolved``). A verdict left out is allowed.
    verdict_actions: Dict[str, LinkSafetyAction]
    off_platform_links: Optional[OffPlatformLinkSettings]


class _LinkSafetySettingsParamsRequired(TypedDict):
    #: What happens to an asset with a link of each verdict (``phishing``, ``malware``, ``adult``,
    #: ``gambling``, ``unresolved``). A verdict left out is allowed.
    verdict_actions: Dict[str, LinkSafetyAction]


class LinkSafetySettingsParams(_LinkSafetySettingsParamsRequired, total=False):
    """Preview. What happens to assets that link to unsafe destinations. Link checks never change a
    moderation category's score."""
    off_platform_links: OffPlatformLinkSettingsParams


class LinkSafetyDecision(CalmLensObject):
    """Preview. What the policy's link-safety section made of the asset's links."""
    #: The strongest action the asset's links take under the policy's link-safety settings.
    action: LinkSafetyAction
    #: The links that take that action, with where each leads and its verdict.
    links: list[CheckedLink]
    #: The link-safety settings in force at decision time.
    settings: LinkSafetySettings


class PolicyRuleSnapshot(CalmLensObject):
    when: List[ModerationQualifier]
    action: ModerationAction
    name: Optional[str]
    unless: Optional[List[ModerationQualifier]]


class _PolicyRuleSnapshotParamsRequired(TypedDict):
    when: List[ModerationQualifier]
    action: ModerationAction


class PolicyRuleSnapshotParams(_PolicyRuleSnapshotParamsRequired, total=False):
    name: str
    unless: List[ModerationQualifier]


class CategoryPolicySettingsSnapshot(CalmLensObject):
    #: The category's default action.
    action: ModerationAction
    allowances: List[PolicyRuleSnapshot]
    restrictions: List[PolicyRuleSnapshot]


class CategoryPolicyDefaultSource(CalmLensObject):
    """The category's ``default`` action, or a policy score ``below-threshold``."""
    kind: Literal["default", "below-threshold"]


class CategoryPolicyRuleSource(CalmLensObject):
    """The ``allowance`` or ``restriction`` rules that decided the category's action."""
    kind: Literal["allowance", "restriction"]
    #: Indexes into the category's ``settings["allowances"]`` or ``settings["restrictions"]`` of the
    #: deciding rules, the decisive one first. Several allowances list every rule that covers the
    #: content together.
    indexes: List[int]
    #: The evidence that triggered the rules, from 0 to 1: a restriction's same-content presence,
    #: or the allowances' coverage. A rule with ``unless`` qualifiers, or several ``when``
    #: qualifiers, is assessed as a whole, so its qualifiers can be missing from ``raw``.
    condition_score: float


#: What decided a category's action; narrow on ``source["kind"]``.
CategoryPolicySource = Union[CategoryPolicyDefaultSource, CategoryPolicyRuleSource]


class RegionalDecision(CalmLensObject):
    region: Union[Literal["DE", "AT", "FR", "GB", "EU", "AU", "BR"], str]
    #: The status in force in the region, stricter than ``moderation["decision"]``: ``limited``,
    #: ``age-restricted``, ``blocked`` or ``purged``.
    status: Union[Literal["limited", "age-restricted", "blocked", "purged"], str]
    #: The mandatory rule that sets it.
    rule: str
    category: Optional[ClassificationCategory]


class CategoryPolicyScore(CalmLensObject):
    score: float
    action: ModerationAction
    source: Optional[CategoryPolicySource]
    settings: Optional[CategoryPolicySettingsSnapshot]


# ---- Assets -----------------------------------------------------------------------------------

class Checksums(CalmLensObject):
    md5: Optional[str]
    sha1: Optional[str]
    sha256: Optional[str]
    sha384: Optional[str]
    sha512: Optional[str]


#: What the rendered resource serves: an ``image`` (images, and a website's screenshot), a ``pdf``
#: (PDFs, and documents and presentations converted to PDF), or browser-safe ``video`` or ``audio``.
AssetRenderedKind = Literal["image", "pdf", "video", "audio"]


class AssetHlsRendition(CalmLensObject):
    """One rendition of the adaptive (HLS) stream, as its master playlist lists it."""
    #: ``video`` for a picture size (video renditions carry no sound; they play with the ``audio``
    #: rendition), or ``audio``.
    kind: Literal["video", "audio"]
    #: Picture width and height in pixels; ``None`` for audio.
    width: Optional[int]
    height: Optional[int]
    #: Peak bit rate in bits per second, counting the audio a video rendition plays with.
    bandwidth: int
    #: The rendition's codecs as RFC 6381 names, such as ``avc1.64001f``.
    codecs: str


class AssetHls(CalmLensObject):
    """Preview. The adaptive stream of audio or video: HLS with fragmented MP4 (CMAF) segments,
    served at the ``hls`` resource (``/hls/index.m3u8``) and played by the ``embed`` resource."""
    #: ``preparing`` until the stream is saved, ``ready`` once ``renditions`` lists it,
    #: ``unavailable`` when it won't be prepared: see ``reason``.
    status: Literal["preparing", "ready", "unavailable"]
    #: Why an ``unavailable`` stream isn't prepared; ``None`` otherwise.
    reason: Optional[Literal["allowance-used", "billing-required", "spend-limit", "processing-failed", "content-not-kept"]]
    #: Every rendition, video from the largest down, then audio; empty until the stream is ready.
    renditions: list[AssetHlsRendition]


class AssetRendered(CalmLensObject):
    """The displayable file of the asset, served at the ``rendered`` resource."""
    kind: AssetRenderedKind
    #: MIME type of the rendered file. An image is served in the best format the client accepts,
    #: such as AVIF or WebP, unless a transform sets one.
    format: str
    #: Width in pixels of the full view, for images and video, before any transform; ``None`` when
    #: unknown or for PDFs and audio.
    width: Optional[int]
    height: Optional[int]
    #: Audio only, once processing has measured them: up to 512 loudness peaks from 0 to 1, evenly
    #: spaced over the audio, for drawing a waveform.
    peaks: Optional[list[float]]


class AssetPreview(CalmLensObject):
    """A still image for the asset, served at the ``preview`` resource: the image itself, a
    document's first page or slide, a website's first screen, a video's poster frame or an audio
    waveform."""
    #: Width in pixels of the source still image, before the preview is sized or transformed.
    width: Optional[int]
    height: Optional[int]
    #: ThumbHash placeholder you can render while any view of the asset loads (also served as a PNG
    #: at the ``placeholder`` resource).
    thumbhash: Optional[str]
    #: Average color of the source still image.
    average_color: Optional[str]


class SafetyHold(CalmLensObject):
    placed_at: int
    reason: SafetyHoldReason
    disposed_at: Optional[int]


class InlineExtractedText(CalmLensObject):
    """Small extracted text stored on the asset."""
    type: Literal["string"]
    content: str


class StoredExtractedText(CalmLensObject):
    """Larger extracted text stored separately."""
    type: Literal["document"]
    id: str


#: Extracted text; narrow on ``extracted["type"]``.
ExtractedText = Union[InlineExtractedText, StoredExtractedText]


class FileMetadataLocation(CalmLensObject):
    """A GPS position in decimal degrees."""
    latitude: float
    longitude: float


class FileMetadata(CalmLensObject):
    """Descriptive metadata embedded in an uploaded image. Each text field is ``None`` when the
    file doesn't record it."""
    #: When the picture was taken, as the file records it: an ISO 8601 date and time, such as
    #: ``2026-05-01T12:30:00+01:00``. It includes the UTC offset only when the file records one;
    #: without it, the time is the camera's local time.
    captured_at: Optional[str]
    #: Camera manufacturer, such as ``Canon``.
    camera_make: Optional[str]
    #: Camera or phone model, such as ``EOS R5``.
    camera_model: Optional[str]
    lens_model: Optional[str]
    #: Software that created or last edited the file.
    software: Optional[str]
    #: Creator or artist the file names. Sensitive: recorded only when ``storeSensitiveMetadata``
    #: is on.
    creator: Optional[str]
    #: Copyright notice the file declares.
    copyright: Optional[str]
    #: IPTC digital source type the file declares, such as ``digitalCapture`` for a camera photo or
    #: ``trainedAlgorithmicMedia`` for generated media. Files can declare any value, so treat it as
    #: a claim.
    digital_source_type: Optional[str]
    #: Whether the uploaded file embedded GPS coordinates, whatever ``storeSensitiveMetadata`` is
    #: set to.
    contains_location: bool
    #: Where the picture was taken, from its GPS coordinates. Sensitive: recorded only when
    #: ``storeSensitiveMetadata`` is on.
    location: Optional[FileMetadataLocation]


class AssetUpload(CalmLensObject):
    """Receiving content, including multipart progress."""
    status: Literal["uploading", "completed"]
    updated_at: Optional[int]
    parts_received: Optional[int]


class ReviewActor(CalmLensObject):
    """Who made a reviewer's decision: a ``user`` (a person, or an assistant's key acting for one)
    or an ``api-key``."""
    type: Union[Literal["user", "api-key"], str]
    #: The user's or API key's ID; ``None`` when it was not recorded.
    id: Optional[str]


class AssetReview(CalmLensObject):
    id: str
    decision: AssetModerationDecision
    note: Optional[str]
    decided_by: ReviewActor
    reviewed_at: int
    #: Whether the decision was applied to the asset. ``False`` for a review queue decision
    #: recorded without changing the asset's status.
    applied: bool


class HashMatch(CalmLensObject):
    """An entry in the project's hash lists that the image matched."""
    #: Where the matching hash came from. New sources may be added.
    source: Union[Literal["hash-list"], str]
    hash_list_id: str
    hash_list_entry_id: str
    #: Number of bits that differ between the hashes, 0 to 256. 0 is the same picture.
    distance: int
    #: ``block`` when the match is close enough for a block list to block, otherwise ``flag``.
    action: Union[HashListAction, str]


class AssetModerationTimeline(CalmLensObject):
    """Summary of an audio or video asset's findings timeline."""
    #: How many segments the timeline holds; page through them with ``assets.list_timeline``.
    segment_count: int


class ModerationRaw(CalmLensObject):
    """The scores and hash matches behind a moderation decision."""
    categories: ClassificationCategories
    #: The hash list entries the image matched; empty when it matched none.
    hash_matches: List[HashMatch]


class DecisionPolicyPreset(CalmLensObject):
    """The built-in preset release a decision's policy used."""
    id: PolicyPresetId
    version: int


class DecisionPolicy(CalmLensObject):
    """The policy that made a decision: its ID, its revision then and the preset release it used."""
    id: str
    revision: int
    #: ``None`` for a policy not made from a preset.
    preset: Optional[DecisionPolicyPreset]


class AssetPendingReview(CalmLensObject):
    """A review the human review queue is waiting for."""
    #: When the asset joined the queue, in Unix milliseconds.
    requested_at: int
    #: ``sampled`` or ``uncertain``.
    reason: Literal["sampled", "uncertain"]
    #: The categories that made the decision uncertain; empty for a sampled decision.
    uncertain_categories: List[ClassificationCategory]


class AssetModeration(CalmLensObject):
    manual_reviews: List[AssetReview]
    decision: Optional[AssetModerationDecision]
    #: The status automated moderation decided; ``None`` before a decision. Manual reviews can
    #: change ``decision`` without changing this, so the two differ when a reviewer overrode it.
    automated_status: Optional[AssetModerationDecision]
    #: The policy that made the automated decision, as it was then; ``None`` before a decision.
    policy: Optional[DecisionPolicy]
    #: The review the human review queue is waiting for, set with the automated decision that
    #: joined the queue; ``None`` when no review is waiting. Hold content until it is ``None``.
    pending_review: Optional[AssetPendingReview]
    #: What decided ``automatedStatus``, such as ``policy`` or ``hash-list``; ``None`` before a decision.
    source: Optional[ModerationSource]
    #: The mandatory rule that decided, when ``source`` is ``mandatory-rule``; otherwise ``None``.
    rule: Optional[str]
    #: Whether every question a complete explanation needs was answered; ``None`` before a decision.
    explanation_complete: Optional[bool]
    #: The policy's score and action for each category; ``None`` before a decision.
    categories: Optional[Dict[ClassificationCategory, CategoryPolicyScore]]
    flagged_categories: List[ClassificationCategory]
    regions: List[RegionalDecision]
    #: The scores behind the decision; ``None`` before a decision.
    raw: Optional[ModerationRaw]
    #: For audio and video, a summary of the findings timeline; ``None`` for other assets, before
    #: there are findings and while a safety or copyright hold withholds the content.
    timeline: Optional[AssetModerationTimeline]
    #: Present only when link safety is enabled; ``None`` before a link decision.
    link_safety: Optional[LinkSafetyDecision]


class ClassificationProgress(CalmLensObject):
    """How far long audio or video, analysed in sections, has got."""
    completed_sections: int
    total_sections: int


class AssetClassification(CalmLensObject):
    status: AssetClassificationStatus
    #: Why processing failed, while ``status`` is ``failed``; otherwise ``None``.
    failure_reason: Optional[AssetClassificationFailureReason]
    updated_at: Optional[int]
    completed_at: Optional[int]
    #: Sections analysed so far while long audio or video is processing; otherwise ``None``.
    progress: Optional[ClassificationProgress]
    #: Whether the results came from one of the project's test inputs rather than analysing the
    #: content. Never use test results, such as age ranges, for real decisions.
    test_input: bool
    moderation: AssetModeration
    #: What OCR found in an image; ``None`` until it has run or when it wasn't requested.
    ocr: Optional[OcrResult]
    #: Preview. The people person detection found; ``None`` until it has run or when it wasn't requested.
    person_detection: Optional[PersonDetectionResult]
    #: Preview. The faces face detection found; ``None`` until it has run or when it wasn't requested.
    face_detection: Optional[FaceDetectionResult]
    #: The QR codes and web links link detection found; ``None`` until it has run or when it is off.
    link_detection: Optional[LinkDetectionResult]
    #: Present only when link safety is enabled; ``None`` when no link check ran.
    link_safety: Optional[LinkSafetyResult]
    ai_generated_detection: Optional[AiGeneratedDetectionResult]


class AssetContent(CalmLensObject):
    """Content state: whether CalmLens holds the source, preview, extracted text and file
    metadata (``temporary`` until processing finishes, ``stored`` or ``removed``) and its
    properties."""
    status: AssetContentStatus
    removal_reason: Optional[AssetContentRemovalReason]
    #: When the content status last changed, in milliseconds since the Unix epoch.
    updated_at: Optional[int]
    safety_hold: Optional[SafetyHold]
    #: MIME type of the content.
    format: Optional[str]
    extension: Optional[str]
    size_in_bytes: Optional[int]
    checksums: Optional[Checksums]
    #: Width in pixels of the uploaded image or video; ``None`` when unknown, for other types and
    #: while the asset is held.
    width: Optional[int]
    height: Optional[int]
    #: Length in seconds of audio and video once analysed; otherwise ``None``.
    duration_seconds: Optional[float]
    #: Number of pages or slides of a document or presentation, when known.
    page_count: Optional[int]
    #: PDQ perceptual hash of an image asset, as 64 hexadecimal characters; ``None`` while held.
    perceptual_hash: Optional[str]
    #: How much detail ``perceptualHash`` captured, from 0 to 100. Hashes below 50 come from flat or
    #: featureless images and match unrelated pictures, so leave them out of comparisons.
    perceptual_hash_quality: Optional[int]
    #: Metadata embedded in an uploaded image, such as its capture time, camera and software.
    #: Read-only and separate from the asset's own ``metadata``; ``None`` when the image declares
    #: none, for other asset types, once the content is removed and while the asset is held.
    metadata: Optional[FileMetadata]
    extracted_text: Optional[ExtractedText]
    #: The displayable file, served at the ``rendered`` resource: an image, a PDF, or browser-safe
    #: video or audio. ``None`` when the asset has none, once the content is removed and while the
    #: asset is held.
    rendered: Optional[AssetRendered]
    #: Preview. The adaptive (HLS) stream of video or audio asked for, served at the ``hls`` resource
    #: and played by the ``embed`` page once its ``status`` is ``ready``. ``None`` when none was asked
    #: for, once the content is removed, while the asset is held and while it is blocked with no
    #: stream prepared.
    hls: Optional[AssetHls]
    #: A still image for the asset, served at the ``preview`` resource (and its blurred placeholder
    #: at ``placeholder``). ``None`` when the asset has none, once the content is removed and while
    #: the asset is held.
    preview: Optional[AssetPreview]


class Asset(CalmLensObject):
    id: str
    project_id: str
    name: str
    type: AssetType
    created_at: int
    upload: AssetUpload
    classification: AssetClassification
    content: AssetContent
    #: For a child extracted from a document, the pages of the parent it shows, numbered from 1;
    #: empty when its page isn't known or it has no parent document.
    parent_pages: list[int]
    #: The asset's custom metadata items; empty when it has none.
    metadata: list[MetadataItem]
    #: The asset's tags; empty when it has none.
    tags: list[str]
    visibility: Union[Visibility, str]
    parent_id: Optional[str]
    folder_id: Optional[str]
    upload_preset_id: Optional[str]
    updated_at: Optional[int]
    description: Optional[str]
    external_id: Optional[str]
    external_url: Optional[str]
    #: Your label for who wrote the content, or ``None`` when none was given.
    author_id: Optional[str]
    #: The earlier posts CalmLens used, or ``None`` when none were given or the content is removed.
    context: Optional[ModerationContext]


class AssetPage(ListObject[Asset]):
    items: list[Asset]
    has_more: bool
    next_cursor: str | None


class AssetTimelinePage(ListObject[MediaClassificationSegment]):
    """One page of an audio or video asset's findings timeline, in time order."""
    items: list[AssetTimelineSegment]
    has_more: bool
    next_cursor: str | None


class AssetSearchMatch(CalmLensObject):
    asset: Asset
    score: float
    matched_fields: list[AssetSearchMatchField]


class AssetSearchResponse(CalmLensObject):
    query: str
    items: list[AssetSearchMatch]
    semantic_status: SemanticStatus


class SignedAssetUrl(CalmLensObject):
    """A signed asset URL, or a resource URL beneath its grant."""
    url: str
    #: When the grant expires, in milliseconds since the Unix epoch.
    expires_at: int


#: Whether the viewer an asset URL's claims describe can see the asset now. New values may be added.
AssetAvailability = Union[Literal["available", "age-restricted", "unavailable"], str]


class AssetInfoContent(CalmLensObject):
    """The display fields of an asset's content, named as on :class:`Asset`."""
    format: Optional[str]
    width: Optional[int]
    height: Optional[int]
    duration_seconds: Optional[float]
    page_count: Optional[int]
    rendered: Optional[AssetRendered]
    preview: Optional[AssetPreview]
    hls: Optional[AssetHls]


class AssetInfo(CalmLensObject):
    """What ``cdn.get_asset_info`` returns: the asset URL's ``info`` resource, an allowlist of the
    asset's public fields (no moderation, metadata, names, tags or extracted text) and whether the
    viewer can see it now."""
    id: str
    project_id: str
    type: AssetType
    content: AssetInfoContent
    availability: AssetAvailability
    #: A website asset's page.
    external_url: Optional[str]


# ---- Folders ----------------------------------------------------------------------------------


class Folder(CalmLensObject):
    id: str
    project_id: str
    name: str
    created_at: int
    parent_id: Optional[str]
    updated_at: Optional[int]


# ---- Hash lists -------------------------------------------------------------------------------


class HashList(CalmLensObject):
    """A list of perceptual hashes that image uploads are compared with."""
    id: str
    project_id: str
    name: str
    action: Union[HashListAction, str]
    created_at: int
    description: Optional[str]
    updated_at: Optional[int]


class HashListEntry(CalmLensObject):
    id: str
    project_id: str
    hash_list_id: str
    #: PDQ hash of the listed image, as 64 hexadecimal characters.
    hash: str
    #: PDQ quality of the hash from 0 to 100, or ``None`` when it was added without one. Entries
    #: below 50 are never matched.
    quality: Optional[int]
    created_at: int
    label: Optional[str]
    #: The asset the hash was taken from, when it was added by ``assetId``.
    asset_id: Optional[str]


class HashListPage(ListObject[HashList]):
    """One page of the project's hash lists, newest first unless ``sort`` says otherwise."""
    items: List[HashList]
    has_more: bool
    next_cursor: Optional[str]


class HashListEntryPage(ListObject[HashListEntry]):
    items: List[HashListEntry]
    has_more: bool
    next_cursor: Optional[str]


# ---- Policies ---------------------------------------------------------------------------------


class CategoryPolicySettings(CalmLensObject):
    """What a policy does with one category: ``action`` when its policy score reaches 0.5,
    ``allowances`` that let covered content through or act on it more softly, and
    ``restrictions``, which outweigh allowances."""
    action: ModerationAction
    allowances: List[PolicyRuleSnapshot]
    restrictions: List[PolicyRuleSnapshot]


class CategoryPolicySettingsParams(TypedDict):
    """What a policy does with one category: ``action`` when its policy score reaches 0.5,
    ``allowances`` that let covered content through or act on it more softly, and
    ``restrictions``, which outweigh allowances."""
    action: ModerationAction
    allowances: List[PolicyRuleSnapshotParams]
    restrictions: List[PolicyRuleSnapshotParams]


class CategorySettings(CalmLensObject):
    """A policy's settings for every category. ``to_dict()`` and ``settings["self-harm"]`` use the
    API's category names."""
    sexual: CategoryPolicySettings
    violence: CategoryPolicySettings
    self_harm: CategoryPolicySettings
    harassment: CategoryPolicySettings
    hate: CategoryPolicySettings
    criminal_activity: CategoryPolicySettings
    personal_information: CategoryPolicySettings
    profanity: CategoryPolicySettings


#: A policy's settings for every category, keyed by the API's category names; each one is required.
CategorySettingsParams = TypedDict("CategorySettingsParams", {
    "sexual": CategoryPolicySettingsParams, "violence": CategoryPolicySettingsParams,
    "self-harm": CategoryPolicySettingsParams, "harassment": CategoryPolicySettingsParams,
    "hate": CategoryPolicySettingsParams, "criminal-activity": CategoryPolicySettingsParams,
    "personal-information": CategoryPolicySettingsParams, "profanity": CategoryPolicySettingsParams})


class PolicySettings(CalmLensObject):
    """What a policy does with each category, its allowances and restrictions."""
    #: Settings for every category (``sexual``, ``violence``, ...).
    category_settings: CategorySettings
    link_safety: Optional[LinkSafetySettings]


class _PolicySettingsParamsRequired(TypedDict):
    #: Settings for every category (``sexual``, ``violence``, ...).
    category_settings: CategorySettingsParams


class PolicySettingsParams(_PolicySettingsParamsRequired, total=False):
    """What a policy does with each category, its allowances and restrictions."""
    link_safety: LinkSafetySettingsParams


#: How a policy relates to its preset: ``live`` follows every preset release (the organisation's
#: own preset policy with automatic updates on), ``pinned`` is the organisation's own preset policy
#: kept at one release, and ``copy`` is a policy made from a preset. New modes may be added.
PolicyPresetMode = Union[Literal["live", "pinned", "copy"], str]


class PolicyPreset(CalmLensObject):
    """Where a policy started from a built-in preset."""
    id: PolicyPresetId
    #: The preset release the policy is pinned to. ``policies.reset`` restores this version's settings.
    version: int
    #: The newest release of the preset. A ``pinned`` or ``copy`` policy on an older one can move to
    #: it with ``policies.upgrade``.
    latest_version: int
    mode: PolicyPresetMode


class Policy(CalmLensObject):
    """A moderation policy. Policies belong to the organisation and its projects share them."""
    id: str
    name: str
    description: str
    settings: PolicySettings
    #: Changes with every saved change. Send it with each change; a policy changed since is refused
    #: with ``policy/revision-conflict``.
    revision: int
    preset: Optional[PolicyPreset]
    #: Projects this policy moderates, as their default policy or through an upload preset.
    project_ids: List[str]
    created_at: int
    updated_at: Optional[int]


class PolicyPage(ListObject[Policy]):
    """One page of the organisation's policies, oldest first unless ``sort`` says otherwise."""
    items: List[Policy]
    has_more: bool
    next_cursor: Optional[str]


# ---- Lenses and CDN transforms ----------------------------------------------------------------

# <generated: image-transform-options>
# Generated by packages/sdk-contract/generate.ts from IMAGE_TRANSFORM_OPTIONS_SCHEMA; do not edit.

class ImageTransformBorder(TypedDict, total=False):
    """A border drawn around the image."""
    #: The border colour.
    color: str
    #: The border width in pixels.
    width: float


class _ImageTransformGravityPointRequired(TypedDict):
    #: How `x` and `y` place the point.
    mode: Literal["remainder", "box-center"]


class ImageTransformGravityPoint(_ImageTransformGravityPointRequired, total=False):
    #: The horizontal position, 0 to 1.
    x: float
    #: The vertical position, 0 to 1.
    y: float


class ImageTransformTrimBorder(TypedDict, total=False):
    #: The border colour to trim.
    color: str
    #: How far colours may differ.
    tolerance: float
    #: Pixels of border to keep.
    keep: float


class ImageTransformTrim(TypedDict, total=False):
    #: Pixels to trim from the top.
    top: float
    #: Pixels to trim from the bottom.
    bottom: float
    #: Pixels to trim from the left.
    left: float
    #: Pixels to trim from the right.
    right: float
    #: The width to keep.
    width: float
    #: The height to keep.
    height: float
    #: Trims a uniform border: `true`, or how to detect it.
    border: Union[bool, ImageTransformTrimBorder]


class ImageTransformOptions(TypedDict, total=False):
    """Image transform options, applied in one pass."""
    #: The output format. Leave it out to serve the best format the browser accepts.
    format: Literal["jpg", "png", "webp", "avif", "gif"]
    #: The width in pixels, 1 to 10,000 after `dpr`. With a size and no `fit`, the image scales down.
    width: int
    #: The height in pixels, 1 to 10,000 after `dpr`.
    height: int
    #: The pixel density, 1 to 3: multiplies the width, height and border width.
    dpr: float
    #: `false` serves the first frame of an animated GIF or WebP.
    anim: bool
    #: The background colour, such as `#ffffff`, for padding and transparency.
    background: str
    #: The blur radius.
    blur: float
    #: A border drawn around the image.
    border: ImageTransformBorder
    #: The brightness factor.
    brightness: float
    #: The contrast factor.
    contrast: float
    #: The quality: 1 to 100, or a level. Lossy output defaults to `high`.
    quality: Union[int, Literal["low", "medium", "high"]]
    #: How the image fits the `width` and `height`.
    fit: Literal["scale-down", "contain", "pad", "squeeze", "cover", "crop"]
    #: Flips the image horizontally (`h`), vertically (`v`) or both (`hv`).
    flip: Literal["h", "v", "hv"]
    #: The gamma.
    gamma: float
    #: `foreground` removes the background.
    segment: Literal["foreground"]
    #: Where to keep when cropping: a side, `face`, `auto`, or a point.
    gravity: Union[Literal["face", "left", "right", "top", "bottom", "center", "auto", "entropy"], ImageTransformGravityPoint]
    #: The clockwise rotation in degrees.
    rotate: Literal[0, 90, 180, 270]
    #: The saturation factor.
    saturation: float
    #: The sharpen amount.
    sharpen: float
    #: Trims the edges: `border` trims a detected border, or give edges and sizes.
    trim: Union[Literal["border"], ImageTransformTrim]


#: Options that hold colours, written as hex without ``#`` in a selector.
IMAGE_TRANSFORM_COLOUR_KEYS = frozenset({"background", "border.color", "trim.border.color"})
# </generated: image-transform-options>


#: A CDN transform, applied in one pass: comma-separated options such as
#: ``"width=1024,fit=cover"``, or structured options such as ``{"width": 1024, "fit": "cover"}``,
#: which the SDK serializes to the same selector. With a lens, its options replace the lens's.
CdnTransform = Union[str, ImageTransformOptions]


class Lens(CalmLensObject):
    """A named image transform the CDN applies at ``/@<identifier>``. The CDN serves files made
    with its current definition."""
    id: str
    identifier: str
    name: str
    type: Union[LensType, str]
    active: bool
    created_at: int
    project_id: Optional[str]
    description: Optional[str]
    transform: Optional[ImageTransformOptions]
    updated_at: Optional[int]


class LensPage(ListObject[Lens]):
    """One page of the project's lenses, newest first unless ``sort`` says otherwise."""
    items: List[Lens]
    has_more: bool
    next_cursor: Optional[str]


# ---- Events -----------------------------------------------------------------------------------


class EventFact(CalmLensObject):
    key: EventFactKey
    value: EventFactValue
    #: A stable link that opens the fact's item in the CalmLens portal.
    url: Optional[str]


class EventAssetUpload(CalmLensObject):
    status: Literal["uploading", "completed"]


class EventAssetModeration(CalmLensObject):
    decision: Optional[AssetModerationDecision]


class EventAssetClassification(CalmLensObject):
    status: AssetClassificationStatus
    #: Whether the results came from one of the project's test inputs rather than analysing the
    #: content. Never use test results, such as age ranges, for real decisions.
    test_input: bool
    moderation: EventAssetModeration


class EventAssetContent(CalmLensObject):
    status: AssetContentStatus


class EventAsset(CalmLensObject):
    """Snapshot of an asset's processing, moderation and content status when the event was
    created."""
    id: str
    upload: EventAssetUpload
    classification: EventAssetClassification
    content: EventAssetContent
    external_id: Optional[str]
    upload_preset_id: Optional[str]


#: Who caused an event: a ``user`` (a person in the portal, or an assistant acting for one), an
#: ``api-key``, ``automated`` moderation or CalmLens itself (``system``). New types may be added.
ActorType = Union[Literal["user", "api-key", "automated", "system"], str]


class Actor(CalmLensObject):
    """Who caused an event."""
    type: ActorType
    #: The user's or API key's ID; ``None`` for ``automated`` and ``system``, and when the ID was
    #: not recorded.
    id: Optional[str]


class Event(CalmLensObject):
    """An event as ``events.list`` returns it and a webhook delivers it."""
    id: str
    project_id: str
    actor: Actor
    type: EventType
    severity: EventSeverity
    title: str
    facts: list[EventFact]
    created_at: int
    description: Optional[str]
    asset_id: Optional[str]
    #: Increases with each event about the same asset; ``None`` for events not about an asset.
    #: Deliveries can arrive out of order: see :func:`~calmlens.webhooks.is_newer_asset_event`.
    asset_sequence: Optional[int]
    asset: Optional[EventAsset]


class WebhookEventPayload(CalmLensObject):
    """The JSON body of a webhook delivery: the event in the shape ``events.list`` returns it.
    ``type`` is a string so event types added later still parse; a received body may carry
    fields this SDK doesn't know."""
    id: str
    project_id: str
    type: str
    created_at: int
    actor: Optional[Actor]
    severity: Optional[str]
    title: Optional[str]
    description: Optional[str]
    asset_id: Optional[str]
    asset_sequence: Optional[int]
    asset: Optional[EventAsset]
    facts: Optional[list[EventFact]]


class EventsPage(ListObject[Event]):
    items: list[Event]
    #: Pass as ``cursor`` for the next request. Unlike other lists it is never ``None``: keep it to
    #: receive later events.
    next_cursor: str
    has_more: bool
    #: Event types this feed never includes, because the API key lacks the permission to see them.
    #: Give the key that permission to receive them.
    excluded_types: list[EventType]


# ---- Request options --------------------------------------------------------------------------


class SignedUploadToken(CalmLensObject):
    token: str
    expires_at: int


#: What ``assets.batch`` does to every asset: ``delete`` deletes it with its child assets and stored
#: content; ``remove-content`` removes its stored content and keeps the record.
AssetBatchOperation = Literal["delete", "remove-content"]


class BatchAssetsResponse(CalmLensObject):
    """``assets.batch`` returns once the operation is queued: ``{"batchId", "status": "queued",
    "assetCount"}``. The ``asset.deleted`` and ``asset.content-removed`` events it causes carry a
    ``batch-id`` fact naming ``batchId``."""
    batch_id: str
    #: ``queued``; new statuses may be added.
    status: Union[Literal["queued"], str]
    #: How many assets the batch covers.
    asset_count: int


class _LensDefinitionRequired(TypedDict):
    identifier: str
    name: str
    type: LensType


class LensDefinition(_LensDefinitionRequired, total=False):
    """A lens definition for ``ensure_lens``, ``ensure_lenses`` and ``lenses.create``."""
    description: Optional[str]
    #: Whether the CDN serves the lens. Defaults to true.
    active: bool
    transform: Optional[ImageTransformOptions]


# ---- Configuration: upload presets, project settings, metadata fields -----------------------

#: Who can upload through a preset from a browser: ``token`` needs an upload token signed by your
#: server, ``anyone`` accepts the preset ID alone.
UploadPresetAccess = Literal["token", "anyone"]


class UploadPreset(CalmLensObject):
    """An upload preset: the rules for uploads made from browsers and apps."""
    id: str
    project_id: str
    #: Identifies the preset within its project, for ``upload_presets.ensure``.
    key: str
    #: Counts changes to the preset, starting at 1. Send it back with a change, so a change made
    #: since you read it isn't overwritten.
    revision: int
    name: str
    access: Union[UploadPresetAccess, str]
    enabled: bool
    visibility: Union[Visibility, str]
    #: Whether browser uploads see the moderation decision for their own upload.
    reveal_decision: bool
    created_at: int
    updated_at: Optional[int]
    created_by_user_id: Optional[str]
    #: MIME types the preset accepts, such as ``image/*``; ``None`` accepts any supported type.
    allowed_content_types: Optional[List[str]]
    #: Largest upload the preset accepts, in bytes; ``None`` uses the standard upload limits.
    max_size_in_bytes: Optional[int]
    folder_id: Optional[str]
    #: Moderation policy for uploads through the preset; ``None`` uses the project's policy.
    policy_id: Optional[str]
    processing_options: Optional[ProcessingOptions]
    #: Most uploads the preset accepts from each client (IP address) per UTC day.
    daily_upload_limit: Optional[int]
    #: Sites allowed to upload from the browser; ``None`` allows any site.
    allowed_origins: Optional[List[str]]


class UploadPresetPage(ListObject[UploadPreset]):
    """One page of the project's upload presets, oldest first unless ``sort`` says otherwise."""
    items: List[UploadPreset]
    has_more: bool
    next_cursor: Optional[str]


class _UploadPresetDefinitionRequired(TypedDict):
    key: str
    name: str


class UploadPresetDefinition(_UploadPresetDefinitionRequired, total=False):
    """One preset's whole definition, by ``key``. Fields left out take their defaults."""
    #: The ``revision`` you read, or 0 for a preset that must not exist yet. A preset changed since
    #: is refused with ``upload-preset/revision-conflict``. Omit it to create or replace the preset
    #: whatever its revision.
    revision: int
    #: Defaults to ``token``.
    access: UploadPresetAccess
    #: Defaults to True.
    enabled: bool
    allowed_content_types: Optional[List[str]]
    max_size_in_bytes: Optional[int]
    folder_id: Optional[str]
    policy_id: Optional[str]
    #: Defaults to ``private``.
    visibility: Visibility
    processing_options: Optional[ProcessingParams]
    #: Defaults to False.
    reveal_decision: bool
    #: Required when ``access`` is ``anyone``.
    daily_upload_limit: Optional[int]
    allowed_origins: Optional[List[str]]


class EnsureUploadPresetsResponse(CalmLensObject):
    """The stored presets, in the order they were sent."""
    upload_presets: List[UploadPreset]


#: Optional standards a project can choose not to serve.
OptOutJurisdiction = Literal["EU"]


class RemoteUrlRule(CalmLensObject):
    """Which domains a project accepts when content is submitted by URL. A domain also covers its
    subdomains."""
    #: ``allow`` accepts only the listed domains; ``deny`` accepts every domain except them.
    mode: Literal["allow", "deny"]
    domains: List[str]


class RemoteUrlRuleParams(TypedDict):
    """Which domains a project accepts when content is submitted by URL. A domain also covers its
    subdomains."""
    #: ``allow`` accepts only the listed domains; ``deny`` accepts every domain except them.
    mode: Literal["allow", "deny"]
    domains: List[str]


class HumanReviewSettings(CalmLensObject):
    """Which automated decisions are sampled into the human review queue."""
    allowed_sample_percent: float
    restricted_sample_percent: float
    #: Queues decisions whose policy score lies less than this many percentage points from the
    #: policy threshold. 0 turns it off.
    uncertainty_margin_percent: float
    #: Queues decisions whose report has evidence that couldn't be assessed.
    review_missing_evidence: bool


class HumanReviewSettingsInput(TypedDict, total=False):
    """Human review settings to save. Those left out default to 0 and False."""
    allowed_sample_percent: float
    restricted_sample_percent: float
    uncertainty_margin_percent: float
    review_missing_evidence: bool


class PublicProjectSettings(CalmLensObject):
    """A project's settings, with defaults filled in. Its policy and metadata fields have their own
    methods."""
    opt_out_jurisdictions: List[Union[OptOutJurisdiction, str]]
    #: When True, the CDN refuses to serve assets whose moderation is still pending.
    retain_content: bool
    block_unmoderated_assets: bool
    #: When True, uploaded images keep their embedded metadata (EXIF, XMP and IPTC).
    store_sensitive_metadata: bool
    #: Preview. Prepare an adaptive stream (HLS) of every audio and video upload that keeps its
    #: content. Billed per started minute of media.
    streaming_enabled: bool
    #: Index audio speech and video frames and transcripts for AI search. Billed per indexed media
    #: unit.
    ai_media_search_enabled: bool
    link_checking_enabled: bool
    #: ``None`` accepts every public domain.
    remote_url_rule: Optional[RemoteUrlRule]
    #: Lowers how many websites the project can submit per minute; ``None`` uses the platform limit.
    website_submissions_per_minute: Optional[int]
    human_review: HumanReviewSettings


class PublicProjectSettingsInput(TypedDict, total=False):
    """The complete settings to save. Settings left out return to their defaults: no opted-out
    jurisdictions, ``retainContent`` and ``blockUnmoderatedAssets`` True, the other switches False, and the rest ``None``
    or no human review."""
    opt_out_jurisdictions: List[OptOutJurisdiction]
    retain_content: bool
    block_unmoderated_assets: bool
    store_sensitive_metadata: bool
    streaming_enabled: bool
    ai_media_search_enabled: bool
    link_checking_enabled: bool
    remote_url_rule: Optional[RemoteUrlRuleParams]
    website_submissions_per_minute: Optional[int]
    human_review: HumanReviewSettingsInput


class ProjectSettingsResource(CalmLensObject):
    """A project's settings and the revision to send back with a change."""
    project_id: str
    #: Counts changes to the project's settings and metadata fields, starting at 1.
    revision: int
    settings: PublicProjectSettings


MetadataFieldType = Literal["string", "number", "boolean", "date", "url"]
MetadataFieldIcon = Literal["tag", "hash", "user", "folder", "layers", "photo", "link"]


class MetadataField(CalmLensObject):
    """A metadata field the portal shows and filters by."""
    id: str
    title: str
    type: Union[MetadataFieldType, str]
    icon: Union[MetadataFieldIcon, str]
    color: str
    description: Optional[str]


class _MetadataFieldDefinitionRequired(TypedDict):
    id: str
    title: str
    type: MetadataFieldType
    icon: MetadataFieldIcon
    #: A hex colour such as ``#2563eb``.
    color: str


class MetadataFieldDefinition(_MetadataFieldDefinitionRequired, total=False):
    """A metadata field to create or replace, by ``id``."""
    description: str


class MetadataFieldsResource(CalmLensObject):
    """A project's metadata fields in display order, and the revision to send back with a change."""
    project_id: str
    #: The revision the fields share with the project's settings.
    revision: int
    fields: List[MetadataField]


class ServeInit(TypedDict, total=False):
    method: Literal["GET", "HEAD"]
    headers: Mapping[str, str]


class FolderPage(ListObject[Folder]):
    items: List[Folder]
    #: Folders above the listed or requested folders, for showing their paths.
    ancestors: List[Folder]
    has_more: bool
    next_cursor: Optional[str]
