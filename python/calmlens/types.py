"""Wire types: ``TypedDict``s that keep the API's camelCase JSON field names.

Responses are plain dicts, so fields added by newer API versions stay readable with
``.get()``. Enum-like response values (``status``, ``type``, ``visibility``, ...) are typed
as the known literals *or* ``str``: values this SDK version doesn't list never fail decoding
or type checking. Compare them against the literals below, and treat unknown values as "not
allowed". Request options use the closed literal sets the API accepts.
"""
from collections.abc import Mapping
from typing import Any, BinaryIO, Dict, List, Literal, Optional, TypedDict, Union

from .qualifiers import ModerationQualifier

__all__ = [
    "PolicyRuleSnapshot", "CategoryPolicySettingsSnapshot", "CategoryPolicySource", "ReportPolicyDecision", "CategoryPolicyScore", "ReportPolicy",
    "AgeRange", "Asset", "AssetContent", "AssetContentRemovalReason", "AssetContentStatus", "AssetIdOptions",
    "AssetReview", "AssetModeration", "AssetModerationDecision", "AssetModerationStatus", "AssetPage", "AssetClassification", "AssetUpload",
    "AssetClassificationStatus", "AssetSearchMatch", "AssetSearchMatchField",
    "AssetSearchResponse", "AssetType", "AssetUrlOptions", "BinaryData", "BoundingBox",
    "CategoryResult", "CdnResource", "CdnTransform", "Checksums", "ClassificationCategories",
    "ClassificationCategory", "ClassificationLabel", "Content", "CreateFolderOptions",
    "DetectedFace", "DetectedPerson", "EnsureLensesOptions",
    "EvaluatedCategoryResult", "EvaluatedFaceDetectionResult", "EvaluatedPersonDetectionResult",
    "EvaluatedPolicyConditionResult", "PolicyConditionResult", "EvaluatedQualifierResult", "Event", "EventAsset", "EventAssetContent", "EventAssetModeration",
    "EventAssetClassification", "EventAssetUpload", "EventFact", "EventFactKey", "EventFactValue",
    "EventSeverity", "EventType", "EventsPage", "ExplainAssetOptions", "ExtractedText", "FaceDetectionFeatureOptions",
    "FaceDetectionResult", "FlaggedContentPolicy", "Folder", "FolderPage", "ListFoldersOptions", "FolderIdOptions", "AssetImage", "ImageTransform",
    "ImageTransformBorder", "ImageTransformGravityPoint", "ImageTransformOptions", "ImageTransformTrim",
    "ImageTransformTrimBorder", "InlineExtractedText", "Lens", "LensDefinition", "LensTransform", "LensType",
    "Likelihood", "ListAssetsOptions", "ListChildrenOptions", "ListEventsOptions", "MediaClassificationReport",
    "MediaClassificationSegment", "MediaSegmentSource", "MetadataItem", "ClassifyTextOptions", "ModerationAction",
    "ModerationQualifier", "MoveAssetOptions", "MoveFolderOptions", "NotEvaluatedCategoryResult",
    "NotEvaluatedFeatureResult", "NotEvaluatedQualifierResult", "NotEvaluatedReason", "OcrFeatureOptions",
    "Ordering", "PartContent", "PartialCategoryResult", "PersonDetectionFeatureOptions", "PersonDetectionResult",
    "ProcessingFeatureResults", "ProcessingFeatureStage", "ProcessingFeatures", "ProcessingOptions",
    "QualifierResult", "QualifierResults", "SafetyHold", "SafetyHoldReason", "SearchAssetsOptions", "SearchMode",
    "SemanticStatus", "ServeInit", "ServeOptions", "SignedUrl", "SignedUrlOptions", "StoredExtractedText",
    "SignedUploadToken", "SignUploadTokenOptions", "SubmitAssetOptions", "UpdateAssetOptions",
    "UpdateFolderOptions", "UploadPartOptions", "Visibility", "WaitForDecisionOptions",
    "WebhookEventData", "WebhookEventPayload",
    "ImageTransformRedaction", "TextRegion", "DetectedQrCode", "DetectedLink", "EvaluatedLinkDetectionResult",
    "LinkDetectionResult", "ProvenanceSignal", "EvaluatedAiGeneratedDetectionResult", "AiGeneratedDetectionResult",
    "LinkDetectionFeatureOptions", "AiGeneratedDetectionFeatureOptions", "HashMatch", "HashListAction", "HashList",
    "HashListEntry", "HashListList", "HashListEntryPage", "HashListIdOptions", "HashListEntryIdOptions",
    "CreateHashListOptions", "UpdateHashListOptions", "ListHashListEntriesOptions", "AddHashListEntryOptions",
]

# ---- Enum-like values -----------------------------------------------------------------------

#: Where an asset is in the pipeline (``classification.status``). New statuses may be added.
AssetClassificationStatus = Union[Literal["pending", "processing", "completed", "failed"], str]
#: The moderation decision in force, which also decides delivery (``classification.moderation.status``):
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
#: Known asset types. New types may be added.
AssetType = Union[Literal["image", "video", "audio", "plaintext-document", "multimedia-document", "website",
                          "file"], str]
#: Who can read retained content from the CDN (request values; responses may add others).
Visibility = Literal["public", "private"]
#: What happens to content that crosses a policy threshold (request values for
#: ``processingOptions.flaggedContentPolicy``).
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
#: Where a media segment's scores came from. New sources may be added.
MediaSegmentSource = Union[Literal["frame", "speech", "frame-text", "clip"], str]
#: How mature a processing feature is. Beta results may change shape.
ProcessingFeatureStage = Union[Literal["beta", "ga"], str]
#: Asset type a lens applies to (request values).
LensType = Literal["image", "video", "audio", "document", "website"]
#: Which CDN resource of an asset to address. ``rendered`` (the default) is the asset rendered through
#: a lens or transform; ``original`` is the original file and takes no lens or transform.
#: ``placeholder`` is a small blurred PNG, public for public assets whatever their moderation status;
#: it takes no lens, transform or ``allowAgeRestricted``.
CdnResource = Literal["original", "rendered", "placeholder"]
#: How ``assets.search`` matches.
SearchMode = Literal["keyword", "semantic", "hybrid"]
#: Fields a search result matched on. New fields may be added.
AssetSearchMatchField = Union[Literal["name", "id", "externalId", "description", "tags", "type", "content.format",
                                      "content.extension", "classification.moderation.status", "visual", "transcript"], str]
#: State of the project's semantic search index. New values may be added.
SemanticStatus = Union[Literal["disabled", "ready", "indexing", "unavailable"], str]
#: Event types. New types may be added; ignore ones you don't handle.
EventType = Union[Literal["asset.uploaded", "asset.classified", "asset.allowed", "asset.limited",
                          "asset.age-restricted", "asset.blocked", "asset.purged", "asset.failed", "asset.deleted", "asset.content-removed",
                          "asset.retried", "usage.limit-reached", "usage.spend-limit-reached",
                          "upload-preset.daily-limit-reached", "project.member-joined",
                          "project.member-removed", "project.member-role-changed",
                          "project.invitation-sent", "api-key.created", "api-key.revoked",
                          "connector.failing"], str]
#: Default severity of an event type. New values may be added.
EventSeverity = Union[Literal["low", "high"], str]
#: Registered fact keys (kebab-case) across event types, plus ``test`` on test sends. Webhook,
#: Slack and email deliveries and the public events feed leave out facts that hold personal or
#: account data (names, email addresses, the organisation's ID).
EventFactKey = Union[Literal[
    "asset-name", "asset-type", "file-format", "decided-by", "moderation-status", "flagged-categories",
    "reviewer-user-id", "reviewer-name", "note", "previous-status", "limit", "used", "organisation-id",
    "member-user-id", "member-name", "role", "invited-by-user-id", "connector-id", "connector-name",
    "connector-type", "consecutive-failures", "last-error", "resumes-on", "reason", "preset-id", "preset-name",
    "daily-limit", "left", "removed-by-user-id", "previous-role", "changed-by-user-id", "key-id",
    "key-name", "action", "created-by-user-id", "revoked-by-user-id", "test",
], str]
#: A registered fact value: text, an integer count, a boolean, a list of values (such as
#: ``flagged-categories``) or ``None``.
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
    plainText: str
    base64: str
    data: BinaryData
    sizeInBytes: int
    partNumber: int
    isFinal: bool


class PartContent(TypedDict, total=False):
    """A multipart continuation part (``type`` is taken from the first request)."""
    type: str
    plainText: str
    base64: str
    data: BinaryData
    sizeInBytes: int
    partNumber: int
    isFinal: bool


class MetadataItem(TypedDict):
    """A custom metadata item. ``value`` is any JSON value you choose, so it is untyped."""
    id: str
    value: Any


class _ModerationContextItemRequired(TypedDict):
    text: str


class ModerationContextItem(_ModerationContextItemRequired, total=False):
    """An earlier post in the conversation. ``authorId`` is your label for who wrote it."""
    authorId: str


class ModerationContext(TypedDict):
    """Earlier posts in the conversation, oldest first."""
    items: list[ModerationContextItem]


class FlaggedContentPolicy(TypedDict):
    """Overrides the project moderation action for one asset: ``allow`` takes no action,
    ``limit`` delivers normally but marks the asset so your app can reduce its reach,
    ``age-restrict`` delivers only through signed URLs or API keys, ``block`` stops delivery
    while retaining content and ``purge`` deletes content."""
    action: ModerationAction


class OcrFeatureOptions(TypedDict):
    """Extract image text into a child asset and classify it as text."""
    enabled: bool


class PersonDetectionFeatureOptions(TypedDict):
    """Beta. Locate people in images; results never change the moderation decision."""
    enabled: bool


class _FaceDetectionFeatureRequired(TypedDict):
    enabled: bool


class FaceDetectionFeatureOptions(_FaceDetectionFeatureRequired, total=False):
    """Beta. Locate faces in images, optionally estimating an age range for each."""
    ageEstimation: bool


class LinkDetectionFeatureOptions(TypedDict):
    """Beta. Find web links in images, in QR codes and in OCR text."""
    enabled: bool


class AiGeneratedDetectionFeatureOptions(TypedDict):
    """Beta. Read AI provenance metadata (C2PA, IPTC, generator settings) from image files."""
    enabled: bool


class ProcessingFeatures(TypedDict, total=False):
    """Optional analyses to run on an asset, keyed by feature. Every feature is off unless
    its ``enabled`` is true; unknown features are rejected."""
    ocr: Optional[OcrFeatureOptions]
    personDetection: Optional[PersonDetectionFeatureOptions]
    faceDetection: Optional[FaceDetectionFeatureOptions]
    linkDetection: Optional[LinkDetectionFeatureOptions]
    aiGeneratedDetection: Optional[AiGeneratedDetectionFeatureOptions]


class ProcessingOptions(TypedDict, total=False):
    """``processingOptions`` for an upload, as stored on the asset."""
    keepContentAfterProcessing: Optional[bool]
    flaggedContentPolicy: Optional[FlaggedContentPolicy]
    features: Optional[ProcessingFeatures]


# ---- Classification report --------------------------------------------------------------------

class _EvaluatedQualifierRequired(TypedDict):
    status: Literal["evaluated"]
    #: Confidence that *some* of the content is this qualifier.
    someScore: float
    likelihood: Likelihood


class EvaluatedQualifierResult(_EvaluatedQualifierRequired, total=False):
    #: Confidence that the content is *only* this qualifier; never above ``someScore``.
    allScore: float


class NotEvaluatedQualifierResult(TypedDict):
    status: Literal["not-evaluated"]
    reason: NotEvaluatedReason


#: A qualifier result; narrow on ``result["status"]``.
QualifierResult = Union[EvaluatedQualifierResult, NotEvaluatedQualifierResult]
#: Qualifier results keyed by qualifier; only assessed qualifiers are present.
QualifierResults = Dict[ModerationQualifier, QualifierResult]


class EvaluatedPolicyConditionResult(TypedDict):
    status: Literal["evaluated"]
    score: float


PolicyConditionResult = Union[EvaluatedPolicyConditionResult, NotEvaluatedQualifierResult]


class _EvaluatedCategoryRequired(TypedDict):
    status: Literal["evaluated"]
    likelihood: Likelihood
    score: float


class EvaluatedCategoryResult(_EvaluatedCategoryRequired, total=False):
    qualifiers: QualifierResults
    policyConditions: Dict[str, PolicyConditionResult]


class _PartialCategoryRequired(TypedDict):
    status: Literal["partial"]
    likelihood: Likelihood
    score: float


class PartialCategoryResult(_PartialCategoryRequired, total=False):
    """Some of the content (for example a media segment) could not be assessed."""
    qualifiers: QualifierResults
    policyConditions: Dict[str, PolicyConditionResult]


class _NotEvaluatedCategoryRequired(TypedDict):
    status: Literal["not-evaluated"]
    reason: NotEvaluatedReason


class NotEvaluatedCategoryResult(_NotEvaluatedCategoryRequired, total=False):
    qualifiers: QualifierResults
    policyConditions: Dict[str, PolicyConditionResult]


#: A category result; narrow on ``result["status"]`` before reading ``score``.
CategoryResult = Union[EvaluatedCategoryResult, PartialCategoryResult, NotEvaluatedCategoryResult]
#: Category results keyed by category. Every known category is present.
ClassificationCategories = Dict[ClassificationCategory, CategoryResult]


class MediaClassificationSegment(TypedDict):
    source: MediaSegmentSource
    startSeconds: float
    endSeconds: float
    categories: ClassificationCategories


class _MediaClassificationReportRequired(TypedDict):
    durationSeconds: float
    sampledFrames: int
    audioTranscribed: bool
    segments: list[MediaClassificationSegment]


class MediaClassificationReport(_MediaClassificationReportRequired, total=False):
    frameIntervalSeconds: float


class _ClassificationLabelRequired(TypedDict):
    description: str
    score: float
    likelihood: Likelihood


class ClassificationLabel(_ClassificationLabelRequired, total=False):
    topicalityScore: Optional[float]
    knowledgeBaseId: Optional[str]


class BoundingBox(TypedDict):
    """Position and size as fractions of the image width and height, from 0 to 1."""
    left: float
    top: float
    width: float
    height: float


class AgeRange(TypedDict):
    """Estimated age range in years. Estimates can be off by several years."""
    low: int
    high: int


class _DetectedRequired(TypedDict):
    box: BoundingBox
    confidence: float


class DetectedPerson(_DetectedRequired):
    pass


class DetectedFace(_DetectedRequired, total=False):
    ageRange: AgeRange


class NotEvaluatedFeatureResult(TypedDict):
    status: Literal["not-evaluated"]
    stage: ProcessingFeatureStage
    reason: NotEvaluatedReason


class EvaluatedPersonDetectionResult(TypedDict):
    status: Literal["evaluated"]
    stage: ProcessingFeatureStage
    people: list[DetectedPerson]


class EvaluatedFaceDetectionResult(TypedDict):
    status: Literal["evaluated"]
    stage: ProcessingFeatureStage
    faces: list[DetectedFace]


class TextRegion(TypedDict):
    """Where OCR found text in the image."""
    box: BoundingBox
    #: Whether the region is personal information, such as an email address, phone number or card
    #: number, rather than a paragraph of text.
    personalInformation: bool


class DetectedQrCode(TypedDict):
    """A decoded QR code."""
    #: The text the QR code holds, such as a URL.
    value: str
    box: BoundingBox


class DetectedLink(TypedDict):
    """A web link found in the image."""
    #: The link, with ``https://`` added when the image left it out.
    url: str
    #: ``qr-code`` or ``text`` (the text OCR extracted). New sources may be added.
    source: Union[Literal["qr-code", "text"], str]


class EvaluatedLinkDetectionResult(TypedDict):
    status: Literal["evaluated"]
    stage: ProcessingFeatureStage
    qrCodes: list[DetectedQrCode]
    links: list[DetectedLink]


class ProvenanceSignal(TypedDict):
    """Provenance metadata found in the image file."""
    #: ``c2pa``, ``iptc-digital-source-type`` or ``generator-metadata``. New kinds may be added.
    kind: Union[Literal["c2pa", "iptc-digital-source-type", "generator-metadata"], str]
    #: What it says, such as the digital source type or the generator's name.
    value: str


class EvaluatedAiGeneratedDetectionResult(TypedDict):
    status: Literal["evaluated"]
    stage: ProcessingFeatureStage
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


class ProcessingFeatureResults(TypedDict, total=False):
    """Results of the features requested in ``processingOptions.features``."""
    personDetection: PersonDetectionResult
    faceDetection: FaceDetectionResult
    linkDetection: LinkDetectionResult
    aiGeneratedDetection: AiGeneratedDetectionResult


class _PolicyRuleSnapshotRequired(TypedDict):
    when: List[str]
    action: ModerationAction


class PolicyRuleSnapshot(_PolicyRuleSnapshotRequired, total=False):
    name: str
    match: Literal["all"]
    unless: List[str]


class _CategoryPolicySettingsSnapshotRequired(TypedDict):
    categoryAction: ModerationAction
    allowances: List[PolicyRuleSnapshot]
    restrictions: List[PolicyRuleSnapshot]


class CategoryPolicySettingsSnapshot(_CategoryPolicySettingsSnapshotRequired, total=False):
    enabled: bool


class _CategoryPolicySourceRequired(TypedDict):
    kind: str


class CategoryPolicySource(_CategoryPolicySourceRequired, total=False):
    index: int
    indexes: List[int]


class ReportPolicyDecision(TypedDict):
    #: ``policy``, ``asset-override``, ``children`` or ``hash-list`` (a block from a hash list
    #: match). New sources may be added.
    source: Union[Literal["policy", "asset-override", "children", "hash-list"], str]
    action: Optional[ModerationAction]
    flaggedCategories: List[str]


class _CategoryPolicyScoreRequired(TypedDict):
    """How strongly a category meets the policy (``score``) and what the policy does with it."""
    score: float
    action: ModerationAction


class CategoryPolicyScore(_CategoryPolicyScoreRequired, total=False):
    source: CategoryPolicySource
    settings: CategoryPolicySettingsSnapshot


class _ReportPolicyRequired(TypedDict):
    """What the project's policy made of the report when the asset was decided."""
    score: float
    categories: Dict[str, CategoryPolicyScore]


class ReportPolicy(_ReportPolicyRequired, total=False):
    #: ``decision`` when questions that could not change any action were skipped (every action is
    #: final, but a category's policy score and the rule credited with its action can differ from a
    #: complete report); ``full`` when every question was answered. ``assets.explain`` completes it.
    evidence: Literal["decision", "full"]
    decision: ReportPolicyDecision


# ---- Assets -----------------------------------------------------------------------------------

class Checksums(TypedDict, total=False):
    md5: Optional[str]
    sha1: Optional[str]
    sha256: Optional[str]
    sha384: Optional[str]
    sha512: Optional[str]


class AssetImage(TypedDict):
    """The picture CalmLens serves at the rendered resource: the original for image assets, or a
    generated image for documents and websites. It remains after the content is removed, so check
    the content ``status`` before loading it; ``thumbhash`` and ``averageColor`` are ``None`` then.
    Width and height are the original's for image assets (a converted HEIC is served smaller at the
    same aspect ratio)."""
    width: Optional[int]
    height: Optional[int]
    thumbhash: Optional[str]
    averageColor: Optional[str]
    perceptualHash: Optional[str]
    #: How much detail ``perceptualHash`` captured, from 0 to 100. Hashes below 50 come from flat or
    #: featureless images and are never matched.
    perceptualHashQuality: Optional[int]


class _SafetyHoldRequired(TypedDict):
    placedAt: int
    reason: SafetyHoldReason


class SafetyHold(_SafetyHoldRequired, total=False):
    disposedAt: Optional[int]


class InlineExtractedText(TypedDict):
    """Small extracted text stored on the asset."""
    type: Literal["string"]
    content: str


class StoredExtractedText(TypedDict):
    """Larger extracted text stored separately."""
    type: Literal["document"]
    id: str


#: Extracted text; narrow on ``extracted["type"]``.
ExtractedText = Union[InlineExtractedText, StoredExtractedText]


class AssetUpload(TypedDict):
    """Receiving content, including multipart progress."""
    status: Literal["uploading", "completed"]
    updatedAt: Optional[int]
    partsReceived: Optional[int]


class _AssetReviewRequired(TypedDict):
    id: str
    decision: AssetModerationDecision
    note: Optional[str]
    reviewerUserId: Optional[str]
    reviewedAt: int
    appliedToAsset: bool


class AssetReview(_AssetReviewRequired, total=False):
    reviewerName: Optional[str]
    reviewerEmail: Optional[str]


class HashMatch(TypedDict):
    """An entry in the project's hash lists that the image matched."""
    #: Where the matching hash came from. New sources may be added.
    source: Union[Literal["hash-list"], str]
    listId: str
    entryId: str
    #: Number of bits that differ between the hashes, 0 to 256. 0 is the same picture.
    distance: int
    #: ``block`` when the match is close enough for a block list to block, otherwise ``flag``.
    action: Union[HashListAction, str]


class _AssetModerationRequired(TypedDict):
    manualReviews: List[AssetReview]
    status: AssetModerationStatus

class AssetModeration(_AssetModerationRequired, total=False):
    categories: ClassificationCategories
    score: float
    timeline: MediaClassificationReport
    policy: ReportPolicy
    #: Hash list entries the image matched, blocking matches first and then the closest. Absent
    #: when nothing matched.
    hashMatches: List[HashMatch]


class _AssetClassificationRequired(TypedDict):
    status: AssetClassificationStatus
    updatedAt: Optional[int]
    completedAt: Optional[int]
    moderation: AssetModeration


class AssetClassification(_AssetClassificationRequired, total=False):
    personDetection: PersonDetectionResult
    faceDetection: FaceDetectionResult
    linkDetection: LinkDetectionResult
    aiGeneratedDetection: AiGeneratedDetectionResult
    #: Where OCR found text, and personal information within it, in an image. Redaction
    #: transforms blur these regions.
    textRegions: List[TextRegion]
    labels: Optional[list[ClassificationLabel]]


class AssetContent(TypedDict):
    """Content state: whether CalmLens holds the source, preview and extracted text
    (``temporary`` until processing finishes, ``stored`` or ``removed``) and its properties."""
    status: AssetContentStatus
    removalReason: Optional[AssetContentRemovalReason]
    #: When the content status last changed, in milliseconds since the Unix epoch.
    updatedAt: Optional[int]
    safetyHold: Optional[SafetyHold]
    #: MIME type of the content.
    format: Optional[str]
    extension: Optional[str]
    sizeInBytes: Optional[int]
    checksums: Optional[Checksums]
    image: Optional[AssetImage]
    extractedText: Optional[ExtractedText]


class _AssetRequired(TypedDict):
    id: str
    projectId: str
    name: str
    type: AssetType
    createdAt: int
    upload: AssetUpload
    classification: AssetClassification
    content: AssetContent


class Asset(_AssetRequired, total=False):
    userId: Optional[str]
    parentId: Optional[str]
    folderId: Optional[str]
    uploadPresetId: Optional[str]
    updatedAt: int
    description: Optional[str]
    externalId: Optional[str]
    externalUrl: Optional[str]
    metadata: Optional[list[MetadataItem]]
    #: Your label for who wrote the content, or ``None`` when none was given.
    authorId: Optional[str]
    #: The earlier posts CalmLens used, or ``None`` when none were given or the content is removed.
    context: Optional[ModerationContext]
    tags: Optional[list[str]]
    processingOptions: Optional[ProcessingOptions]
    visibility: Union[Visibility, str, None]


Ordering = TypedDict("Ordering", {"field": str, "direction": Literal["ASC", "DESC"]})


class AssetPage(TypedDict):
    items: list[Asset]
    hasMore: bool
    nextCursor: str | None
    pageSize: int
    ordering: list[Ordering]


class AssetSearchMatch(TypedDict):
    asset: Asset
    score: float
    matchedFields: list[AssetSearchMatchField]


class AssetSearchResponse(TypedDict):
    query: str
    items: list[AssetSearchMatch]
    semanticStatus: SemanticStatus


class SignedUrl(TypedDict):
    url: str
    #: Milliseconds since the Unix epoch.
    expiresAt: int


# ---- Folders ----------------------------------------------------------------------------------

class _FolderRequired(TypedDict):
    id: str
    projectId: str
    name: str
    createdAt: int


class Folder(_FolderRequired, total=False):
    parentId: Optional[str]
    updatedAt: int


# ---- Hash lists -------------------------------------------------------------------------------

class _HashListRequired(TypedDict):
    id: str
    projectId: str
    name: str
    action: Union[HashListAction, str]
    createdAt: int


class HashList(_HashListRequired, total=False):
    """A list of perceptual hashes that image uploads are compared with."""
    description: Optional[str]
    createdByUserId: Optional[str]
    updatedAt: int


class _HashListEntryRequired(TypedDict):
    id: str
    projectId: str
    hashListId: str
    #: PDQ hash of the listed image, as 64 hexadecimal characters.
    hash: str
    #: PDQ quality of the hash from 0 to 100, or ``None`` when it was added without one. Entries
    #: below 50 are never matched.
    quality: Optional[int]
    createdAt: int


class HashListEntry(_HashListEntryRequired, total=False):
    label: Optional[str]
    #: The asset the hash was taken from, when it was added by ``assetId``.
    sourceAssetId: Optional[str]
    createdByUserId: Optional[str]


class HashListList(TypedDict):
    """Every hash list in the project, newest first."""
    items: List[HashList]


class HashListEntryPage(TypedDict):
    items: List[HashListEntry]
    hasMore: bool
    nextCursor: Optional[str]
    pageSize: int
    ordering: List[Ordering]


# ---- Lenses and CDN transforms ----------------------------------------------------------------

# <generated: image-transform-options>
# Generated by packages/sdk-contract/generate.ts from IMAGE_TRANSFORM_OPTIONS_SCHEMA; do not edit.

class ImageTransformRedaction(TypedDict, total=False):
    """Blurs regions found when the image was processed, before any other option applies. Text regions need OCR on the upload. An image without such regions is served unchanged."""
    #: Blurs every paragraph of text OCR found.
    text: bool
    #: Blurs the email addresses, phone numbers, card numbers, IBANs and social security numbers OCR found.
    personalInformation: bool


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
    """Options for the built-in ``imageTransform`` transform."""
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
    #: Blurs regions found when the image was processed, before any other option applies. Text regions need OCR on the upload. An image without such regions is served unchanged.
    redact: ImageTransformRedaction
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


class ImageTransform(TypedDict):
    """An ``imageTransform`` step, such as ``{"type": "imageTransform", "options": {"width": 1024}}``."""
    type: Literal["imageTransform"]
    options: ImageTransformOptions


#: One transform step of a lens or a structured CDN transform.
LensTransform = ImageTransform

#: A CDN transform: a selector string with one step per path segment, such as
#: ``"fit=cover,width=1024/blur=12"``, or one or more structured steps (the shape of a lens's
#: ``transforms``), which the SDK serializes to the same selector.
CdnTransform = Union[str, LensTransform, List[LensTransform]]


class _LensResponseRequired(TypedDict):
    id: str
    identifier: str
    name: str
    type: Union[LensType, str]
    active: bool
    version: int
    createdAt: int


class Lens(_LensResponseRequired, total=False):
    projectId: Optional[str]
    userId: Optional[str]
    description: Optional[str]
    transforms: Optional[list[LensTransform]]
    updatedAt: int


# ---- Events -----------------------------------------------------------------------------------

class _EventFactRequired(TypedDict):
    key: EventFactKey
    value: EventFactValue


class EventFact(_EventFactRequired, total=False):
    #: A stable link that opens the fact's item in the CalmLens portal.
    url: str


class EventAssetUpload(TypedDict):
    status: Literal["uploading", "completed"]


class EventAssetModeration(TypedDict):
    status: AssetModerationStatus


class EventAssetClassification(TypedDict):
    status: AssetClassificationStatus
    moderation: EventAssetModeration


class EventAssetContent(TypedDict):
    status: AssetContentStatus


class _EventAssetRequired(TypedDict):
    id: str
    upload: EventAssetUpload
    classification: EventAssetClassification
    content: EventAssetContent


class EventAsset(_EventAssetRequired, total=False):
    """Snapshot of an asset's processing, moderation and content status when the event was
    created."""
    externalId: Optional[str]
    uploadPresetId: Optional[str]


class _EventRequired(TypedDict):
    id: str
    projectId: str
    type: EventType
    severity: EventSeverity
    title: str
    facts: list[EventFact]
    createdAt: int


class Event(_EventRequired, total=False):
    userId: Optional[str]
    description: Optional[str]
    assetId: Optional[str]
    asset: Optional[EventAsset]
    notify: Optional[bool]
    updatedAt: int
    readAt: Optional[int]


class WebhookEventData(TypedDict, total=False):
    severity: str
    title: str
    description: Optional[str]
    assetId: Optional[str]
    asset: Optional[EventAsset]
    facts: list[EventFact]


class WebhookEventPayload(TypedDict):
    """The JSON body of a webhook delivery."""
    id: str
    type: str
    createdAt: int
    projectId: str
    data: WebhookEventData


class EventsPage(TypedDict):
    events: list[Event]
    cursor: str
    hasMore: bool


# ---- Request options --------------------------------------------------------------------------

class _SubmitRequired(TypedDict):
    name: str


class SubmitAssetOptions(_SubmitRequired, total=False):
    content: Content
    part: Content
    url: str
    description: str
    processingOptions: ProcessingOptions
    visibility: Visibility
    metadata: list[MetadataItem]
    authorId: str
    context: ModerationContext
    externalId: str
    externalUrl: str
    folderId: Optional[str]
    uploadPresetId: str
    totalSizeInBytes: int


class _SignUploadTokenRequired(TypedDict):
    uploadPresetId: str


class SignUploadTokenOptions(_SignUploadTokenRequired, total=False):
    externalId: str
    expiresInSeconds: int


class SignedUploadToken(TypedDict):
    token: str
    expiresAt: int


class AssetIdOptions(TypedDict):
    assetId: str


class FolderIdOptions(TypedDict):
    folderId: str


class HashListIdOptions(TypedDict):
    hashListId: str


class HashListEntryIdOptions(TypedDict):
    entryId: str


class _CreateHashListRequired(TypedDict):
    name: str
    action: HashListAction


class CreateHashListOptions(_CreateHashListRequired, total=False):
    description: Optional[str]


class UpdateHashListOptions(HashListIdOptions, total=False):
    name: str
    description: Optional[str]
    action: HashListAction


class ListHashListEntriesOptions(HashListIdOptions, total=False):
    #: The previous page's ``nextCursor``; omit for the first page.
    cursor: str
    pageSize: int


class AddHashListEntryOptions(HashListIdOptions, total=False):
    """Send ``hash`` (and ``quality`` when you know it) or ``assetId``, an image asset in the project."""
    hash: str
    quality: Optional[int]
    assetId: str
    label: Optional[str]


class _UploadPartRequired(AssetIdOptions):
    part: PartContent


class UploadPartOptions(_UploadPartRequired, total=False):
    queue: bool


class MoveAssetOptions(AssetIdOptions):
    folderId: Optional[str]


class ExplainAssetOptions(AssetIdOptions, total=False):
    rerun: bool


#: What ``assets.batch`` does to every asset: ``delete`` deletes it with its child assets and stored
#: content; ``remove-content`` removes its stored content and keeps the record.
AssetBatchOperation = Literal["delete", "remove-content"]


class BatchAssetsOptions(TypedDict):
    #: IDs of 1 to 500 assets in the project.
    assetIds: List[str]
    operation: AssetBatchOperation


class BatchAssetsResponse(TypedDict):
    """``assets.batch`` returns once the operation is queued: ``{"queued": True}``."""
    queued: bool


class MoveFolderOptions(FolderIdOptions):
    parentId: Optional[str]


class _CreateFolderRequired(TypedDict):
    name: str


class CreateFolderOptions(_CreateFolderRequired, total=False):
    parentId: Optional[str]


class _ClassifyTextRequired(TypedDict):
    text: str


class ClassifyTextOptions(_ClassifyTextRequired, total=False):
    name: str
    description: str
    processingOptions: ProcessingOptions
    metadata: list[MetadataItem]
    authorId: str
    context: ModerationContext
    externalId: str
    externalUrl: str
    folderId: Optional[str]


class ListAssetsOptions(TypedDict, total=False):
    cursor: str
    pageSize: int
    ordering: list[Ordering]
    filter: str
    folderId: str


class _ListChildrenRequired(TypedDict):
    assetId: str


class ListChildrenOptions(_ListChildrenRequired, total=False):
    cursor: str
    pageSize: int
    ordering: list[Ordering]
    filter: str


class _SearchRequired(TypedDict):
    query: str


class SearchAssetsOptions(_SearchRequired, total=False):
    limit: int
    mode: SearchMode


class UpdateAssetOptions(AssetIdOptions, total=False):
    name: str
    description: Optional[str]
    tags: Optional[list[str]]
    metadata: Optional[list[MetadataItem]]
    externalId: Optional[str]
    externalUrl: Optional[str]
    visibility: Visibility


class SignedUrlOptions(AssetIdOptions, total=False):
    #: Defaults to ``rendered`` on the server. ``original`` takes no lens or transform.
    resource: Literal["original", "rendered"]
    expiresInSeconds: int
    lens: str
    transform: CdnTransform


class WaitForDecisionOptions(AssetIdOptions, total=False):
    #: Seconds to wait for a decision before ``sdk/timeout`` (default 60).
    timeout: float


class UpdateFolderOptions(FolderIdOptions, total=False):
    name: str


class ListEventsOptions(TypedDict, total=False):
    after: str
    limit: int


class _LensRequired(TypedDict):
    identifier: str
    name: str
    type: LensType
    version: int


class LensDefinition(_LensRequired, total=False):
    description: Optional[str]
    active: bool
    transforms: Optional[list[LensTransform]]


class EnsureLensesOptions(TypedDict):
    lenses: list[LensDefinition]


class _AssetUrlRequired(TypedDict):
    assetIdentifier: str


class AssetUrlOptions(_AssetUrlRequired, total=False):
    resource: CdnResource
    lens: str
    transform: CdnTransform
    #: Appends ``?allowAgeRestricted=true`` so the public URL serves a public asset whose moderation
    #: status is ``age-restricted``. Set it only where your app has already decided the viewer may
    #: see age-restricted content.
    allowAgeRestricted: bool


class ServeInit(TypedDict, total=False):
    method: Literal["GET", "HEAD"]
    headers: Mapping[str, str]


class ServeOptions(AssetUrlOptions, total=False):
    init: ServeInit


class ListFoldersOptions(TypedDict, total=False):
    parentId: str
    pageIndex: int
    pageSize: int
    search: str
    searchAll: bool
    resolveOnly: bool
    ids: List[str]
    sort: Literal["name", "createdAt"]
    direction: Literal["ASC", "DESC"]

class FolderPage(TypedDict):
    folders: List[Folder]
    ancestors: List[Folder]
    hasMore: bool
