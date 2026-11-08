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

class ViewerClaims(TypedDict, total=False):
    """Optional customer assertions for CDN delivery.

    ``region`` is the viewer's ISO 3166-1 alpha-2 country, such as ``DE``. ``ageConfirmed`` is
    your platform's confirmation that the viewer passed its age check, and defaults to false.
    Claims are your app's unsigned assertions, sent with any asset URL, signed or not: CalmLens
    does not verify them, and anyone holding a URL can add them. Default claims (no region, age
    not confirmed) are left out of URLs so default URLs stay cacheable.
    """

    region: str
    ageConfirmed: bool


__all__ = [
    "PolicyRuleSnapshot", "CategoryPolicySettingsSnapshot", "CategoryPolicySource", "CategoryPolicyDefaultSource", "CategoryPolicyRuleSource", "RegionalDecision", "ViewerClaims", "CategoryPolicyScore",
    "AgeRange", "Asset", "AssetClassificationFailureReason", "AssetContent", "AssetContentRemovalReason", "AssetContentStatus", "AssetIdOptions",
    "Actor", "ActorType", "ReviewActor", "AssetReview", "AssetModeration", "ModerationRaw", "AssetModerationDecision", "AssetModerationStatus", "AssetPage", "AssetTimelinePage", "AssetTimelineSegment", "AssetClassification", "ClassificationProgress", "AssetUpload",
    "AssetClassificationStatus", "AssetSearchMatch", "AssetSearchMatchField",
    "AssetSearchResponse", "AssetType", "AssetUrlOptions", "BinaryData", "BoundingBox",
    "CategoryResult", "CdnResource", "CdnTransform", "Checksums", "ClassificationCategories",
    "ClassificationCategory", "Content", "CreateFolderOptions",
    "DetectedFace", "DetectedPerson", "EnsureLensesOptions",
    "EvaluatedCategoryResult", "EvaluatedFaceDetectionResult", "EvaluatedPersonDetectionResult",
    "EvaluatedQualifierResult", "Event", "EventAsset", "EventAssetContent", "EventAssetModeration",
    "EventAssetClassification", "EventAssetUpload", "EventFact", "EventFactKey", "EventFactValue",
    "EventSeverity", "EventType", "EventsPage", "ExplainAssetOptions", "ExtractedText", "FaceDetectionFeatureOptions",
    "FaceDetectionResult", "FileMetadata", "FileMetadataLocation", "Folder", "FolderPage", "ListFoldersOptions", "FolderIdOptions", "AssetRendered", "AssetRenderedKind", "AssetHls", "AssetHlsRendition", "AssetHlsStatus", "StreamingFeatureOptions", "AssetPreview", "AssetModerationTimeline", "AssetInfo", "AssetInfoContent", "AssetAvailability",
    "ImageTransformBorder", "ImageTransformGravityPoint", "ImageTransformOptions", "ImageTransformTrim",
    "ImageTransformTrimBorder", "InlineExtractedText", "Lens", "LensDefinition", "LensType",
    "Likelihood", "ListAssetsOptions", "ListChildrenOptions", "ListTimelineOptions", "ListEventsOptions",
    "MediaClassificationSegment", "MediaSegmentSource", "MetadataItem", "ClassifyTextOptions", "ModerationAction",
    "ModerationQualifier", "MoveAssetOptions", "MoveFolderOptions", "NotEvaluatedCategoryResult",
    "FeatureNotEvaluatedReason", "NotEvaluatedFeatureResult", "NotEvaluatedQualifierResult", "NotEvaluatedReason", "OcrFeatureOptions",
    "PartContent", "PartialCategoryResult", "PersonDetectionFeatureOptions", "PersonDetectionResult",
    "ProcessingFeatures", "ProcessingOptions",
    "QualifierResult", "QualifierResults", "SafetyHold", "SafetyHoldReason", "SearchAssetsOptions", "SearchMode",
    "SemanticStatus", "ServeInit", "ServeOptions", "SignedAssetUrl", "SignAssetUrlOptions", "GetAssetInfoOptions", "StoredExtractedText",
    "SignedUploadToken", "SignUploadTokenOptions", "SubmitAssetOptions", "UpdateAssetOptions",
    "UpdateFolderOptions", "UploadPartOptions", "Visibility", "WaitForDecisionOptions",
    "WebhookEventPayload",
    "ImageTransformRedaction", "TextRegion", "DetectedQrCode", "DetectedLink", "EvaluatedLinkDetectionResult",
    "LinkDetectionResult", "ProvenanceSignal", "EvaluatedAiGeneratedDetectionResult", "AiGeneratedDetectionResult",
    "LinkDetectionFeatureOptions", "AiGeneratedDetectionFeatureOptions", "LinkSafetyVerdict", "LinkSafetyAction",
    "LinkSafetyEvidence", "CheckedLink", "EvaluatedLinkSafetyResult", "LinkSafetyResult", "OffPlatformLinkSettings",
    "LinkSafetySettings", "LinkSafetyDecision", "HashMatch", "HashListAction", "HashList",
    "HashListEntry", "HashListPage", "ListHashListsOptions", "HashListEntryPage", "HashListIdOptions",
    "HashListEntryIdOptions", "DecideAssetOptions", "CreateHashListOptions", "UpdateHashListOptions", "ListHashListEntriesOptions", "AddHashListEntryOptions",
    "PolicyPresetId", "CategoryPolicySettings", "CategorySettings", "PolicySettings", "PolicyPresetMode", "PolicyPreset",
    "Policy", "PolicyPage", "ListPoliciesOptions", "PolicyIdOptions", "CreatePolicyOptions", "UpdatePolicyOptions",
    "ResetPolicyOptions", "UpgradePolicyOptions", "SetPolicyAutomaticUpdatesOptions", "AssignPolicyOptions",
    "LensPage", "ListLensesOptions", "LensIdOptions", "UpdateLensOptions", "EvaluatedOcrResult", "OcrResult",
]

# ---- Enum-like values -----------------------------------------------------------------------

#: Where an asset is in the pipeline (``classification.status``): ``queued`` while it waits for its
#: content (a multipart upload still receiving parts) or its turn, ``processing``, then
#: ``completed`` or ``failed``. The asset is settled once it is ``completed`` or ``failed``. New
#: statuses may be added.
AssetClassificationStatus = Union[Literal["queued", "processing", "completed", "failed"], str]
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
#: master playlist of audio or video at ``hls/index.m3u8``, once ``content.hls`` is set; its
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
                                      "content.extension", "classification.moderation.status", "visual", "transcript"], str]
#: State of the project's semantic search index. New values may be added.
SemanticStatus = Union[Literal["disabled", "ready", "indexing", "unavailable"], str]
#: Event types. New types may be added; ignore ones you don't handle.
EventType = Union[Literal["asset.uploaded", "asset.classified", "asset.region-restricted", "asset.allowed",
                          "asset.limited", "asset.age-restricted", "asset.blocked", "asset.purged", "asset.failed",
                          "asset.progress-updated", "asset.deleted", "asset.content-removed", "asset.retried",
                          "asset.rerun-requested", "asset.review-requested", "asset.hash-matched", "asset.link-flagged",
                          "usage.free-uploads-exhausted", "usage.uploads-paused", "upload-preset.daily-limit-reached",
                          "project.member-joined", "project.member-removed", "project.member-left",
                          "project.member-role-changed", "project.invitation-sent", "project.transferred",
                          "api-key.created", "api-key.revoked", "api-key.deleted", "connector.disabled"], str]
#: Default severity of an event type. New values may be added.
EventSeverity = Union[Literal["low", "high"], str]
#: Registered fact keys (kebab-case) across event types, plus ``test`` on test sends. Webhook,
#: Slack and email deliveries and the public events feed leave out facts that hold personal or
#: account data (names, email addresses, the organisation's ID).
EventFactKey = Union[Literal[
    "asset-name", "asset-type", "file-format", "parent-asset", "flagged-categories", "moderation-status",
    "automated-status", "region", "rule", "status", "note", "previous-status", "failure-reason",
    "completed-sections", "total-sections", "batch-id", "review-reason", "uncertain-categories", "hash-list-id",
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


class OcrFeatureOptions(TypedDict):
    """Extract image text onto the image asset and add a text moderation pass to its report."""
    enabled: bool


class PersonDetectionFeatureOptions(TypedDict):
    """Preview. Locate people in images; results never change the moderation decision."""
    enabled: bool


class _FaceDetectionFeatureRequired(TypedDict):
    enabled: bool


class FaceDetectionFeatureOptions(_FaceDetectionFeatureRequired, total=False):
    """Preview. Locate faces in images, optionally estimating an age range for each."""
    ageEstimation: bool


class LinkDetectionFeatureOptions(TypedDict):
    """Find web links in images, in QR codes and in OCR text."""
    enabled: bool


class AiGeneratedDetectionFeatureOptions(TypedDict):
    """Preview. Read AI provenance metadata (C2PA, IPTC, generator settings) from image files."""
    enabled: bool


class StreamingFeatureOptions(TypedDict):
    """Preview. Prepare an adaptive stream (HLS) of audio or video once it is decided and made
    browser-safe, served at the ``hls`` resource and played by the ``embed`` resource. Needs
    ``keepContentAfterProcessing``. Billed per started minute of media; ``enabled: False`` turns it
    off for an upload in a project that streams by default."""
    #: Whether to prepare the stream. Left out, the project's streaming setting decides.
    enabled: bool


class ProcessingFeatures(TypedDict, total=False):
    """Optional analyses to run on an asset, keyed by feature. ``linkDetection`` runs unless
    its ``enabled`` is false; every other feature is off unless its ``enabled`` is true.
    Unknown features are rejected."""
    ocr: Optional[OcrFeatureOptions]
    personDetection: Optional[PersonDetectionFeatureOptions]
    faceDetection: Optional[FaceDetectionFeatureOptions]
    linkDetection: Optional[LinkDetectionFeatureOptions]
    aiGeneratedDetection: Optional[AiGeneratedDetectionFeatureOptions]
    streaming: Optional[StreamingFeatureOptions]


class ProcessingOptions(TypedDict, total=False):
    """``processingOptions`` for an upload."""
    keepContentAfterProcessing: Optional[bool]
    #: Overrides the project's ``storeSensitiveMetadata`` setting for this upload. When false,
    #: embedded image metadata (EXIF, XMP and IPTC) is removed from the file before it is stored,
    #: and ``content.metadata`` leaves out the creator and location. When true, the image is stored as
    #: uploaded.
    storeSensitiveMetadata: Optional[bool]
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


class _EvaluatedCategoryRequired(TypedDict):
    status: Literal["evaluated"]
    likelihood: Likelihood
    score: float


class EvaluatedCategoryResult(_EvaluatedCategoryRequired, total=False):
    qualifiers: QualifierResults


class _PartialCategoryRequired(TypedDict):
    status: Literal["partial"]
    likelihood: Likelihood
    score: float


class PartialCategoryResult(_PartialCategoryRequired, total=False):
    """Some of the content (for example a media segment) could not be assessed."""
    qualifiers: QualifierResults


class _NotEvaluatedCategoryRequired(TypedDict):
    status: Literal["not-evaluated"]
    reason: NotEvaluatedReason


class NotEvaluatedCategoryResult(_NotEvaluatedCategoryRequired, total=False):
    qualifiers: QualifierResults


#: A category result; narrow on ``result["status"]`` before reading ``score``.
CategoryResult = Union[EvaluatedCategoryResult, PartialCategoryResult, NotEvaluatedCategoryResult]
#: Category results keyed by category. Every known category is present.
ClassificationCategories = Dict[ClassificationCategory, CategoryResult]


class MediaClassificationSegment(TypedDict):
    source: MediaSegmentSource
    startSeconds: float
    endSeconds: float
    categories: ClassificationCategories


#: One stretch of an audio or video asset's findings: its source, times and scores.
AssetTimelineSegment = MediaClassificationSegment


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
    reason: FeatureNotEvaluatedReason


class EvaluatedPersonDetectionResult(TypedDict):
    status: Literal["evaluated"]
    people: list[DetectedPerson]


class EvaluatedFaceDetectionResult(TypedDict):
    status: Literal["evaluated"]
    faces: list[DetectedFace]


class TextRegion(TypedDict):
    """Where OCR found text in the image."""
    box: BoundingBox
    #: Whether the region is personal information, such as an email address, phone number or card
    #: number, rather than a paragraph of text.
    personalInformation: bool


class EvaluatedOcrResult(TypedDict):
    status: Literal["evaluated"]
    #: Where OCR found text, and personal information within it. Redaction transforms blur these
    #: regions. The text itself is ``content.extractedText``.
    textRegions: list[TextRegion]


#: What OCR found in an image; narrow on ``result["status"]`` before reading ``textRegions``.
OcrResult = Union[EvaluatedOcrResult, NotEvaluatedFeatureResult]


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


class LinkSafetyEvidence(TypedDict):
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


class CheckedLink(TypedDict):
    """Preview. A link in the asset and what its destination is."""
    #: The link as found, with ``https://`` added when it was left out.
    url: str
    #: Where the link leads after following its redirects, or ``None`` when a short link or redirect
    #: chain could not be followed.
    finalUrl: Optional[str]
    #: How many redirects were followed to reach ``finalUrl``.
    redirects: int
    #: ``qr-code`` or ``text``. New sources may be added.
    source: Union[Literal["qr-code", "text"], str]
    verdict: LinkSafetyVerdict
    evidence: list[LinkSafetyEvidence]


class EvaluatedLinkSafetyResult(TypedDict):
    status: Literal["evaluated"]
    links: list[CheckedLink]


#: Preview. Link safety result: where each link in the asset leads and its verdict. It runs when the
#: project's policy acts on links, not through ``processingOptions.features``. Narrow on
#: ``result["status"]`` before reading ``links``.
LinkSafetyResult = Union[EvaluatedLinkSafetyResult, NotEvaluatedFeatureResult]


class OffPlatformLinkSettings(TypedDict):
    """Preview. Acts on every link whose destination is outside ``allowedDomains``, whatever its
    verdict."""
    #: ``limit``, ``age-restrict`` or ``block``.
    action: LinkSafetyAction
    #: Bare lowercase domains such as ``example.com``. A domain also covers its subdomains.
    allowedDomains: list[str]


class _LinkSafetySettingsRequired(TypedDict):
    #: What happens to an asset with a link of each verdict (``phishing``, ``malware``, ``adult``,
    #: ``gambling``, ``unresolved``). A verdict left out is allowed.
    verdictActions: Dict[str, LinkSafetyAction]


class LinkSafetySettings(_LinkSafetySettingsRequired, total=False):
    """Preview. What happens to assets that link to unsafe destinations. Link checks never change a
    moderation category's score."""
    offPlatformLinks: OffPlatformLinkSettings


class LinkSafetyDecision(TypedDict):
    """Preview. What the policy's link-safety section made of the asset's links."""
    #: The strongest action the asset's links take under the policy's link-safety settings.
    action: LinkSafetyAction
    #: The links that take that action, with where each leads and its verdict.
    links: list[CheckedLink]
    #: The link-safety settings in force at decision time.
    settings: LinkSafetySettings


class _PolicyRuleSnapshotRequired(TypedDict):
    when: List[str]
    action: ModerationAction


class PolicyRuleSnapshot(_PolicyRuleSnapshotRequired, total=False):
    name: str
    unless: List[str]


class CategoryPolicySettingsSnapshot(TypedDict):
    #: The category's default action.
    action: ModerationAction
    allowances: List[PolicyRuleSnapshot]
    restrictions: List[PolicyRuleSnapshot]


class CategoryPolicyDefaultSource(TypedDict):
    """The category's ``default`` action, or a policy score ``below-threshold``."""
    kind: Literal["default", "below-threshold"]


class CategoryPolicyRuleSource(TypedDict):
    """The ``allowance`` or ``restriction`` rules that decided the category's action."""
    kind: Literal["allowance", "restriction"]
    #: Indexes into the category's ``settings["allowances"]`` or ``settings["restrictions"]`` of the
    #: deciding rules, the decisive one first. Several allowances list every rule that covers the
    #: content together.
    indexes: List[int]


#: What decided a category's action; narrow on ``source["kind"]``.
CategoryPolicySource = Union[CategoryPolicyDefaultSource, CategoryPolicyRuleSource]


class _RegionalDecisionRequired(TypedDict):
    region: str
    #: The status in force in the region, stricter than ``moderation["status"]``: ``limited``,
    #: ``age-restricted``, ``blocked`` or ``purged``.
    status: AssetModerationDecision
    #: The mandatory rule that sets it.
    rule: str


class RegionalDecision(_RegionalDecisionRequired, total=False):
    category: str


class _CategoryPolicyScoreRequired(TypedDict):
    """How strongly a category meets the policy (``score``) and what the policy does with it."""
    score: float
    action: ModerationAction


class CategoryPolicyScore(_CategoryPolicyScoreRequired, total=False):
    source: CategoryPolicySource
    settings: CategoryPolicySettingsSnapshot


# ---- Assets -----------------------------------------------------------------------------------

class Checksums(TypedDict, total=False):
    md5: Optional[str]
    sha1: Optional[str]
    sha256: Optional[str]
    sha384: Optional[str]
    sha512: Optional[str]


#: What the rendered resource serves: an ``image`` (images, and a website's screenshot), a ``pdf``
#: (PDFs, and documents and presentations converted to PDF), or browser-safe ``video`` or ``audio``.
AssetRenderedKind = Literal["image", "pdf", "video", "audio"]


class AssetHlsRendition(TypedDict):
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


class AssetHls(TypedDict):
    """Preview. The adaptive stream of audio or video: HLS with fragmented MP4 (CMAF) segments,
    served at the ``hls`` resource (``/hls/index.m3u8``) and played by the ``embed`` resource."""
    #: Every rendition, video from the largest down, then audio.
    renditions: list[AssetHlsRendition]


class AssetHlsStatus(TypedDict):
    """Preview. Whether the adaptive stream asked for is ready, or why it isn't."""
    #: ``preparing`` until the stream is saved, ``ready`` once ``content.hls`` lists it,
    #: ``unavailable`` when it won't be prepared: see ``reason``.
    status: Literal["preparing", "ready", "unavailable"]
    #: Why an ``unavailable`` stream isn't prepared; ``None`` otherwise.
    reason: Optional[Literal["allowance-used", "billing-required", "spend-limit", "processing-failed", "content-not-kept"]]


class _AssetRenderedRequired(TypedDict):
    kind: AssetRenderedKind
    #: MIME type of the rendered file. An image is served in the best format the client accepts,
    #: such as AVIF or WebP, unless a transform sets one.
    format: str
    #: Width in pixels of the full view, for images and video, before any transform; ``None`` when
    #: unknown or for PDFs and audio.
    width: Optional[int]
    height: Optional[int]


class AssetRendered(_AssetRenderedRequired, total=False):
    """The displayable file of the asset, served at the ``rendered`` resource."""
    #: Audio only, once processing has measured them: up to 512 loudness peaks from 0 to 1, evenly
    #: spaced over the audio, for drawing a waveform.
    peaks: list[float]


class AssetPreview(TypedDict):
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
    averageColor: Optional[str]


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


class FileMetadataLocation(TypedDict):
    """A GPS position in decimal degrees."""
    latitude: float
    longitude: float


class FileMetadata(TypedDict):
    """Descriptive metadata embedded in an uploaded image. Each text field is ``None`` when the
    file doesn't record it."""
    #: When the picture was taken, as the file records it: an ISO 8601 date and time, such as
    #: ``2026-05-01T12:30:00+01:00``. It includes the UTC offset only when the file records one;
    #: without it, the time is the camera's local time.
    capturedAt: Optional[str]
    #: Camera manufacturer, such as ``Canon``.
    cameraMake: Optional[str]
    #: Camera or phone model, such as ``EOS R5``.
    cameraModel: Optional[str]
    lensModel: Optional[str]
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
    digitalSourceType: Optional[str]
    #: Whether the uploaded file embedded GPS coordinates, whatever ``storeSensitiveMetadata`` is
    #: set to.
    containsLocation: bool
    #: Where the picture was taken, from its GPS coordinates. Sensitive: recorded only when
    #: ``storeSensitiveMetadata`` is on.
    location: Optional[FileMetadataLocation]


class AssetUpload(TypedDict):
    """Receiving content, including multipart progress."""
    status: Literal["uploading", "completed"]
    updatedAt: Optional[int]
    partsReceived: Optional[int]


class ReviewActor(TypedDict):
    """Who made a reviewer's decision: a ``user`` (a person, or an assistant's key acting for one)
    or an ``api-key``."""
    type: Union[Literal["user", "api-key"], str]
    #: The user's or API key's ID; ``None`` when it was not recorded.
    id: Optional[str]


class AssetReview(TypedDict):
    id: str
    decision: AssetModerationDecision
    note: Optional[str]
    decidedBy: ReviewActor
    reviewedAt: int
    #: Whether the decision was applied to the asset. ``False`` for a review queue decision
    #: recorded without changing the asset's status.
    applied: bool


class HashMatch(TypedDict):
    """An entry in the project's hash lists that the image matched."""
    #: Where the matching hash came from. New sources may be added.
    source: Union[Literal["hash-list"], str]
    hashListId: str
    hashListEntryId: str
    #: Number of bits that differ between the hashes, 0 to 256. 0 is the same picture.
    distance: int
    #: ``block`` when the match is close enough for a block list to block, otherwise ``flag``.
    action: Union[HashListAction, str]


class AssetModerationTimeline(TypedDict):
    """Summary of an audio or video asset's findings timeline."""
    #: How many segments the timeline holds; page through them with ``assets.list_timeline``.
    segmentCount: int


class _ModerationRawRequired(TypedDict):
    categories: ClassificationCategories
    #: The hash list entries the image matched; empty when it matched none.
    hashMatches: List[HashMatch]


class ModerationRaw(_ModerationRawRequired):
    """The scores and hash matches behind a moderation decision."""


class AssetModeration(TypedDict):
    manualReviews: List[AssetReview]
    status: AssetModerationStatus
    #: The status automated moderation decided; ``None`` before a decision. Manual reviews can
    #: change ``status`` without changing this, so the two differ when a reviewer overrode it.
    automatedStatus: Optional[AssetModerationDecision]
    #: What decided ``automatedStatus``, such as ``policy`` or ``hash-list``; ``None`` before a decision.
    source: Optional[str]
    #: The mandatory rule that decided, when ``source`` is ``mandatory-rule``; otherwise ``None``.
    rule: Optional[str]
    #: Whether every question a complete explanation needs was answered; ``None`` before a decision.
    explanationComplete: Optional[bool]
    #: The policy's score and action for each category; ``None`` before a decision.
    categories: Optional[Dict[str, CategoryPolicyScore]]
    flaggedCategories: List[str]
    regions: List[RegionalDecision]
    #: Preview. What the policy's link-safety section made of the asset's links; ``None`` when the
    #: policy doesn't act on links or before a decision.
    linkSafety: Optional[LinkSafetyDecision]
    #: The scores behind the decision; ``None`` before a decision.
    raw: Optional[ModerationRaw]
    #: For audio and video, a summary of the findings timeline; ``None`` for other assets, before
    #: there are findings and while a safety or copyright hold withholds the content.
    timeline: Optional[AssetModerationTimeline]


class ClassificationProgress(TypedDict):
    """How far long audio or video, analysed in sections, has got."""
    completedSections: int
    totalSections: int


class _AssetClassificationRequired(TypedDict):
    status: AssetClassificationStatus
    #: Why processing failed, while ``status`` is ``failed``; otherwise ``None``.
    failureReason: Optional[AssetClassificationFailureReason]
    updatedAt: Optional[int]
    completedAt: Optional[int]
    #: Sections analysed so far while long audio or video is processing; otherwise ``None``.
    progress: Optional[ClassificationProgress]
    #: Whether the results came from one of the project's test inputs rather than analysing the
    #: content. Never use test results, such as age ranges, for real decisions.
    testInput: bool
    moderation: AssetModeration
    #: What OCR found in an image; ``None`` until it has run or when it wasn't requested.
    ocr: Optional[OcrResult]
    #: Preview. The people person detection found; ``None`` until it has run or when it wasn't requested.
    personDetection: Optional[PersonDetectionResult]
    #: Preview. The faces face detection found; ``None`` until it has run or when it wasn't requested.
    faceDetection: Optional[FaceDetectionResult]
    #: The QR codes and web links link detection found; ``None`` until it has run or when it is off.
    linkDetection: Optional[LinkDetectionResult]
    #: Preview. Where each link in the asset leads and its verdict, when the project's policy acts
    #: on links; otherwise ``None``.
    linkSafety: Optional[LinkSafetyResult]


class AssetClassification(_AssetClassificationRequired, total=False):
    aiGeneratedDetection: Optional[AiGeneratedDetectionResult]


class AssetContent(TypedDict):
    """Content state: whether CalmLens holds the source, preview, extracted text and file
    metadata (``temporary`` until processing finishes, ``stored`` or ``removed``) and its
    properties."""
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
    #: Width in pixels of the uploaded image or video; ``None`` when unknown, for other types and
    #: while the asset is held.
    width: Optional[int]
    height: Optional[int]
    #: Length in seconds of audio and video once analysed; otherwise ``None``.
    durationSeconds: Optional[float]
    #: Number of pages or slides of a document or presentation, when known.
    pageCount: Optional[int]
    #: PDQ perceptual hash of an image asset, as 64 hexadecimal characters; ``None`` while held.
    perceptualHash: Optional[str]
    #: How much detail ``perceptualHash`` captured, from 0 to 100. Hashes below 50 come from flat or
    #: featureless images and match unrelated pictures, so leave them out of comparisons.
    perceptualHashQuality: Optional[int]
    #: Metadata embedded in an uploaded image, such as its capture time, camera and software.
    #: Read-only and separate from the asset's own ``metadata``; ``None`` when the image declares
    #: none, for other asset types, once the content is removed and while the asset is held.
    metadata: Optional[FileMetadata]
    extractedText: Optional[ExtractedText]
    #: The displayable file, served at the ``rendered`` resource: an image, a PDF, or browser-safe
    #: video or audio. ``None`` when the asset has none, once the content is removed and while the
    #: asset is held.
    rendered: Optional[AssetRendered]
    #: Preview. The adaptive (HLS) stream of video or audio, once streaming has prepared it from the
    #: rendered file, served at the ``hls`` resource and played by the ``embed`` page. ``None`` for
    #: other assets, until a stream is prepared, once the content is removed and while the asset is
    #: held.
    hls: Optional[AssetHls]
    #: Preview. Whether the stream asked for is ready, or why it isn't. ``None`` when none was asked
    #: for, once the content is removed and while the asset is held.
    hlsStatus: Optional[AssetHlsStatus]
    #: A still image for the asset, served at the ``preview`` resource (and its blurred placeholder
    #: at ``placeholder``). ``None`` when the asset has none, once the content is removed and while
    #: the asset is held.
    preview: Optional[AssetPreview]


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
    parentId: Optional[str]
    #: For a child extracted from a document, the pages of the parent it shows, numbered from 1;
    #: empty when its page isn't known or it has no parent document.
    parentPages: list[int]
    folderId: Optional[str]
    uploadPresetId: Optional[str]
    updatedAt: int
    description: Optional[str]
    externalId: Optional[str]
    externalUrl: Optional[str]
    #: The asset's custom metadata items; empty when it has none.
    metadata: list[MetadataItem]
    #: Your label for who wrote the content, or ``None`` when none was given.
    authorId: Optional[str]
    #: The earlier posts CalmLens used, or ``None`` when none were given or the content is removed.
    context: Optional[ModerationContext]
    #: The asset's tags; empty when it has none.
    tags: list[str]
    visibility: Union[Visibility, str]


class AssetPage(TypedDict):
    items: list[Asset]
    hasMore: bool
    nextCursor: str | None


class AssetTimelinePage(TypedDict):
    """One page of an audio or video asset's findings timeline, in time order."""
    items: list[AssetTimelineSegment]
    hasMore: bool
    nextCursor: str | None


class AssetSearchMatch(TypedDict):
    asset: Asset
    score: float
    matchedFields: list[AssetSearchMatchField]


class AssetSearchResponse(TypedDict):
    query: str
    items: list[AssetSearchMatch]
    semanticStatus: SemanticStatus


class SignedAssetUrl(TypedDict):
    """A signed asset URL, or a resource URL beneath its grant."""
    url: str
    #: When the grant expires, in milliseconds since the Unix epoch.
    expiresAt: int


#: Whether the viewer an asset URL's claims describe can see the asset now. New values may be added.
AssetAvailability = Union[Literal["available", "age-restricted", "unavailable"], str]


class AssetInfoContent(TypedDict):
    """The display fields of an asset's content, named as on :class:`Asset`."""
    format: Optional[str]
    width: Optional[int]
    height: Optional[int]
    durationSeconds: Optional[float]
    pageCount: Optional[int]
    rendered: Optional[AssetRendered]
    preview: Optional[AssetPreview]
    hls: Optional[AssetHls]


class _AssetInfoRequired(TypedDict):
    id: str
    projectId: str
    type: AssetType
    content: AssetInfoContent
    availability: AssetAvailability


class AssetInfo(_AssetInfoRequired, total=False):
    """What ``cdn.get_asset_info`` returns: the asset URL's ``info`` resource, an allowlist of the
    asset's public fields (no moderation, metadata, names, tags or extracted text) and whether the
    viewer can see it now."""
    #: A website asset's page.
    externalUrl: Optional[str]


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
    assetId: Optional[str]


class HashListPage(TypedDict):
    """One page of the project's hash lists, newest first unless ``sort`` says otherwise."""
    items: List[HashList]
    hasMore: bool
    nextCursor: Optional[str]


class HashListEntryPage(TypedDict):
    items: List[HashListEntry]
    hasMore: bool
    nextCursor: Optional[str]


# ---- Policies ---------------------------------------------------------------------------------

#: A built-in policy preset. New presets may be added.
PolicyPresetId = Union[Literal["general-community", "children-platform", "education-support",
                               "wholesome-community"], str]


class CategoryPolicySettings(TypedDict):
    """What a policy does with one category: ``action`` when its policy score reaches 0.5,
    ``allowances`` that let covered content through or act on it more softly, and
    ``restrictions``, which outweigh allowances."""
    action: ModerationAction
    allowances: List[PolicyRuleSnapshot]
    restrictions: List[PolicyRuleSnapshot]


#: A policy's settings for every category; each one is required.
CategorySettings = TypedDict("CategorySettings", {
    "sexual": CategoryPolicySettings, "violence": CategoryPolicySettings, "self-harm": CategoryPolicySettings,
    "harassment": CategoryPolicySettings, "hate": CategoryPolicySettings,
    "criminal-activity": CategoryPolicySettings, "personal-information": CategoryPolicySettings,
    "profanity": CategoryPolicySettings})


class _PolicySettingsRequired(TypedDict):
    #: Settings for every category (``sexual``, ``violence``, ...).
    categorySettings: CategorySettings


class PolicySettings(_PolicySettingsRequired, total=False):
    """What a policy does with each category, its allowances and restrictions."""
    linkSafety: LinkSafetySettings


#: How a policy relates to its preset: ``live`` follows every preset release (the organisation's
#: own preset policy with automatic updates on), ``pinned`` is the organisation's own preset policy
#: kept at one release, and ``copy`` is a policy made from a preset. New modes may be added.
PolicyPresetMode = Union[Literal["live", "pinned", "copy"], str]


class PolicyPreset(TypedDict):
    """Where a policy started from a built-in preset."""
    id: PolicyPresetId
    #: The preset release the policy is pinned to. ``policies.reset`` restores this version's settings.
    version: int
    #: The newest release of the preset. A ``pinned`` or ``copy`` policy on an older one can move to
    #: it with ``policies.upgrade``.
    latestVersion: int
    mode: PolicyPresetMode


class _PolicyRequired(TypedDict):
    id: str
    name: str
    description: str
    settings: PolicySettings
    #: Changes with every saved change. Send it with each change; a policy changed since is refused
    #: with ``policy/revision-conflict``.
    revision: int
    preset: Optional[PolicyPreset]
    #: Projects this policy moderates, as their default policy or through an upload preset.
    projectIds: List[str]
    createdAt: int


class Policy(_PolicyRequired, total=False):
    """A moderation policy. Policies belong to the organisation and its projects share them."""
    updatedAt: int


class PolicyPage(TypedDict):
    """One page of the organisation's policies, oldest first unless ``sort`` says otherwise."""
    items: List[Policy]
    hasMore: bool
    nextCursor: Optional[str]


# ---- Lenses and CDN transforms ----------------------------------------------------------------

# <generated: image-transform-options>
# Generated by packages/sdk-contract/generate.ts from IMAGE_TRANSFORM_OPTIONS_SCHEMA; do not edit.

class ImageTransformRedaction(TypedDict, total=False):
    """Blurs regions found when the image was processed, before any other option applies. Text regions need OCR on the upload. An image without such regions is served unchanged."""
    #: Blurs every paragraph of text OCR found.
    text: bool
    #: Blurs the email addresses, phone numbers, card numbers, IBANs and social security numbers OCR found.
    personalInformation: bool
    #: Preview. Blurs every face that face detection found when the image was uploaded.
    faces: bool


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


#: A CDN transform, applied in one pass: comma-separated options such as
#: ``"width=1024,fit=cover"``, or structured options such as ``{"width": 1024, "fit": "cover"}``,
#: which the SDK serializes to the same selector. With a lens, its options replace the lens's.
CdnTransform = Union[str, ImageTransformOptions]


class _LensResponseRequired(TypedDict):
    id: str
    identifier: str
    name: str
    type: Union[LensType, str]
    active: bool
    createdAt: int


class Lens(_LensResponseRequired, total=False):
    """A named image transform the CDN applies at ``/@<identifier>``. The CDN serves files made
    with its current definition."""
    projectId: Optional[str]
    description: Optional[str]
    transform: Optional[ImageTransformOptions]
    updatedAt: int


class LensPage(TypedDict):
    """One page of the project's lenses, newest first unless ``sort`` says otherwise."""
    items: List[Lens]
    hasMore: bool
    nextCursor: Optional[str]


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
    #: Whether the results came from one of the project's test inputs rather than analysing the
    #: content. Never use test results, such as age ranges, for real decisions.
    testInput: bool
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


#: Who caused an event: a ``user`` (a person in the portal, or an assistant acting for one), an
#: ``api-key``, ``automated`` moderation or CalmLens itself (``system``). New types may be added.
ActorType = Union[Literal["user", "api-key", "automated", "system"], str]


class Actor(TypedDict):
    """Who caused an event."""
    type: ActorType
    #: The user's or API key's ID; ``None`` for ``automated`` and ``system``, and when the ID was
    #: not recorded.
    id: Optional[str]


class Event(TypedDict):
    """An event as ``events.list`` returns it and a webhook delivers it."""
    id: str
    projectId: str
    actor: Actor
    type: EventType
    severity: EventSeverity
    title: str
    description: Optional[str]
    assetId: Optional[str]
    #: Increases with each event about the same asset; ``None`` for events not about an asset.
    #: Deliveries can arrive out of order: see :func:`~calmlens.webhooks.is_newer_asset_event`.
    assetSequence: Optional[int]
    asset: Optional[EventAsset]
    facts: list[EventFact]
    createdAt: int


class _WebhookEventPayloadRequired(TypedDict):
    id: str
    projectId: str
    type: str
    createdAt: int


class WebhookEventPayload(_WebhookEventPayloadRequired, total=False):
    """The JSON body of a webhook delivery: the event in the shape ``events.list`` returns it.
    ``type`` is a string so event types added later still parse; a received body may carry
    fields this SDK doesn't know."""
    actor: Actor
    severity: str
    title: str
    description: Optional[str]
    assetId: Optional[str]
    assetSequence: Optional[int]
    asset: Optional[EventAsset]
    facts: list[EventFact]


class EventsPage(TypedDict):
    items: list[Event]
    #: Pass as ``cursor`` for the next request. Unlike other lists it is never ``None``: keep it to
    #: receive later events.
    nextCursor: str
    hasMore: bool
    #: Event types this feed never includes, because the API key lacks the permission to see them.
    #: Give the key that permission to receive them.
    excludedTypes: list[EventType]


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
    #: How long the token can start an upload, in seconds: 1 to 3600, default 600.
    expiresIn: int


class SignedUploadToken(TypedDict):
    token: str
    expiresAt: int


class AssetIdOptions(TypedDict, total=False):
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


class ListHashListsOptions(TypedDict, total=False):
    #: The previous page's ``nextCursor``; omit for the first page.
    cursor: str
    #: 1 to 100, default 50.
    pageSize: int
    #: Comma-separated ``createdAt`` and ``id``, each descending when prefixed with ``-``, such as
    #: ``"-createdAt,id"``; newest first by default.
    sort: str


class ListHashListEntriesOptions(HashListIdOptions, total=False):
    #: The previous page's ``nextCursor``; omit for the first page.
    cursor: str
    pageSize: int
    #: Comma-separated ``createdAt`` and ``id``, each descending when prefixed with ``-``, such as
    #: ``"-createdAt,id"``; newest first by default.
    sort: str


class ListPoliciesOptions(TypedDict, total=False):
    #: The previous page's ``nextCursor``; omit for the first page.
    cursor: str
    #: 1 to 100, default 50.
    pageSize: int
    #: Comma-separated ``createdAt`` and ``id``, each descending when prefixed with ``-``, such as
    #: ``"-createdAt,id"``; oldest first by default.
    sort: str


class ListLensesOptions(TypedDict, total=False):
    #: The previous page's ``nextCursor``; omit for the first page.
    cursor: str
    #: 1 to 100, default 50.
    pageSize: int
    #: Comma-separated ``createdAt`` and ``id``, each descending when prefixed with ``-``, such as
    #: ``"-createdAt,id"``; newest first by default.
    sort: str


class AddHashListEntryOptions(HashListIdOptions, total=False):
    """Send ``hash`` (and ``quality`` when you know it) or ``assetId``, an image asset in the project."""
    hash: str
    quality: Optional[int]
    assetId: str
    label: Optional[str]


class PolicyIdOptions(TypedDict):
    policyId: str


class CreatePolicyOptions(TypedDict, total=False):
    """Send ``settings`` (defining every category) with a ``name``, or ``presetId`` to copy the
    latest release of a built-in preset, which defaults to the preset's name."""
    name: str
    description: str
    settings: PolicySettings
    presetId: Literal["general-community", "children-platform", "education-support", "wholesome-community"]


class _UpdatePolicyRequired(PolicyIdOptions):
    #: The policy's current ``revision``; a policy changed since is refused.
    revision: int


class UpdatePolicyOptions(_UpdatePolicyRequired, total=False):
    name: str
    description: str
    #: The complete new settings, defining every category.
    settings: PolicySettings


class ResetPolicyOptions(PolicyIdOptions):
    #: The policy's current ``revision``; a policy changed since is refused.
    revision: int
    #: The pinned ``preset.version`` you reviewed.
    presetVersion: int


class UpgradePolicyOptions(PolicyIdOptions):
    #: The policy's current ``revision``; a policy changed since is refused.
    revision: int
    #: The ``preset.latestVersion`` you reviewed.
    presetVersion: int


class SetPolicyAutomaticUpdatesOptions(PolicyIdOptions):
    enabled: bool
    revision: int
    #: The preset's ``latestVersion`` you reviewed.
    presetVersion: int


class AssignPolicyOptions(TypedDict):
    policyId: str


class _UploadPartRequired(AssetIdOptions):
    part: PartContent


class UploadPartOptions(_UploadPartRequired, total=False):
    #: Whether the final part waits for the decision (``True``) or returns with the asset
    #: ``queued`` (``False``), overriding the choice saved when the upload started.
    wait: bool


class MoveAssetOptions(AssetIdOptions):
    folderId: Optional[str]


class ExplainAssetOptions(AssetIdOptions, total=False):
    rerun: bool


class _DecideAssetRequired(AssetIdOptions):
    #: The moderation status to set: ``allowed``, ``limited``, ``age-restricted``, ``blocked`` or
    #: ``purged`` (which also needs ``confirmPurge``).
    decision: Literal["allowed", "limited", "age-restricted", "blocked", "purged"]
    #: Why the reviewer decided this, 1 to 1499 characters after trimming.
    note: str


class DecideAssetOptions(_DecideAssetRequired, total=False):
    """A reviewer's decision for ``assets.decide``."""
    #: Must be ``True`` to purge: purging permanently deletes the stored content.
    confirmPurge: bool


#: What ``assets.batch`` does to every asset: ``delete`` deletes it with its child assets and stored
#: content; ``remove-content`` removes its stored content and keeps the record.
AssetBatchOperation = Literal["delete", "remove-content"]


class BatchAssetsOptions(TypedDict):
    #: IDs of 1 to 500 assets in the project.
    assetIds: List[str]
    operation: AssetBatchOperation


class BatchAssetsResponse(TypedDict):
    """``assets.batch`` returns once the operation is queued: ``{"batchId", "status": "queued",
    "assetCount"}``. The ``asset.deleted`` and ``asset.content-removed`` events it causes carry a
    ``batch-id`` fact naming ``batchId``."""
    batchId: str
    #: ``queued``; new statuses may be added.
    status: Union[Literal["queued"], str]
    #: How many assets the batch covers.
    assetCount: int


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
    #: Comma-separated ``createdAt`` and ``id``, each descending when prefixed with ``-``, such as
    #: ``"-createdAt,id"``; newest first by default.
    sort: str
    #: An RSQL filter, such as ``folderId==fldr_…`` or ``classification.moderation.status==allowed``.
    filter: str


class _ListChildrenRequired(TypedDict):
    assetId: str


class ListChildrenOptions(_ListChildrenRequired, total=False):
    cursor: str
    pageSize: int
    #: Comma-separated ``createdAt`` and ``id``, each descending when prefixed with ``-``, such as
    #: ``"-createdAt,id"``; newest first by default.
    sort: str
    filter: str


class _ListTimelineRequired(TypedDict):
    assetId: str


class ListTimelineOptions(_ListTimelineRequired, total=False):
    cursor: str
    pageSize: int


class _SearchRequired(TypedDict):
    query: str


class SearchAssetsOptions(_SearchRequired, total=False):
    #: How many of the best matches to return: 1 to 20, default 10.
    pageSize: int
    mode: SearchMode


class UpdateAssetOptions(AssetIdOptions, total=False):
    name: str
    description: Optional[str]
    tags: Optional[list[str]]
    metadata: Optional[list[MetadataItem]]
    externalId: Optional[str]
    externalUrl: Optional[str]
    visibility: Optional[Visibility]


class WaitForDecisionOptions(AssetIdOptions, total=False):
    #: Seconds to wait for a decision before ``sdk/timeout`` (default 60).
    timeout: float


class UpdateFolderOptions(FolderIdOptions, total=False):
    name: str


class ListEventsOptions(TypedDict, total=False):
    #: The previous response's ``nextCursor``. Omit it to get a cursor for now without any events.
    cursor: str
    #: 1 to 100, default 50.
    pageSize: int
    #: Only these event types. Sent as one comma-separated value.
    types: List[EventType]
    #: Only events about this asset.
    assetId: str


class _LensRequired(TypedDict):
    identifier: str
    name: str
    type: LensType


class LensDefinition(_LensRequired, total=False):
    """A lens definition for ``ensure_lens``, ``ensure_lenses`` and ``lenses.create``."""
    description: Optional[str]
    active: bool
    transform: Optional[ImageTransformOptions]


class LensIdOptions(TypedDict):
    lensId: str


class UpdateLensOptions(LensIdOptions, total=False):
    name: str
    description: Optional[str]
    type: LensType
    #: Whether the CDN serves the lens.
    active: bool
    transform: Optional[ImageTransformOptions]


class EnsureLensesOptions(TypedDict):
    lenses: list[LensDefinition]


class AssetUrlOptions(TypedDict, total=False):
    """An asset's CDN URL: exactly one of ``assetId`` and ``externalId``, and optionally a resource
    beneath it with its lens or transform, and the viewer's claims."""
    #: Defaults to the client's project.
    projectId: str
    assetId: str
    externalId: str
    #: Without it the URL is the asset URL itself, which takes no lens or transform.
    resource: CdnResource
    lens: str
    transform: CdnTransform
    viewerClaims: ViewerClaims


class SignAssetUrlOptions(AssetUrlOptions, total=False):
    #: The grant's lifetime: 1 to 86400 whole seconds, default 900.
    expiresIn: int
    #: Whether the grant serves ``original``, the exact upload. Defaults to False.
    original: bool


class GetAssetInfoOptions(TypedDict, total=False):
    #: The viewer's claims, in place of those the URL carries.
    viewerClaims: ViewerClaims



class ServeInit(TypedDict, total=False):
    method: Literal["GET", "HEAD"]
    headers: Mapping[str, str]


class ServeOptions(AssetUrlOptions, total=False):
    init: ServeInit


class ListFoldersOptions(TypedDict, total=False):
    #: List this folder's children; omit for the project root.
    parentId: str
    #: The previous page's ``nextCursor``; omit for the first page.
    cursor: str
    #: 1 to 100, default 50.
    pageSize: int
    #: ``name`` (the default) or ``createdAt``, descending when prefixed with ``-``.
    sort: str
    search: str


class FolderPage(TypedDict):
    items: List[Folder]
    #: Folders above the listed or requested folders, for showing their paths.
    ancestors: List[Folder]
    hasMore: bool
    nextCursor: Optional[str]
