// Package calmlens provides a server-side client for the CalmLens public API.
//
// Create a client with NewServerClient and call the services on it (Assets, Text, Folders, Events
// and CDN). Every method returns *Error on failure. Webhook deliveries are verified with
// VerifyWebhookRequest, ParseWebhookEvent or VerifyWebhookSignature. The calmlenstest
// sub-package provides an in-memory client for tests.
//
// Every enum, such as ModerationStatus or EventType, is a named string type with a constant for
// each value. A value the API adds after this SDK still decodes, as its string, so give switch
// statements on an enum a default case.
package calmlens

import (
	"encoding/json"
	"io"
	"time"
)

// JSON is a decoded JSON object. The SDK uses it only where the API allows arbitrary values
// (Raw fields and Error.Details); numbers decoded by the SDK are json.Number, so large
// integers keep their precision.
type JSON = map[string]any

// ClassificationStatus is where an asset is in the processing pipeline.
type ClassificationStatus string

// Processing status values of AssetClassification.Status and EventAssetClassification.Status: where
// the asset is in the pipeline. ClassificationStatusQueued assets wait for their content (a
// multipart upload still receiving parts) or their turn; an asset is settled once it is
// ClassificationStatusCompleted or ClassificationStatusFailed.
const (
	ClassificationStatusQueued     ClassificationStatus = "queued"
	ClassificationStatusProcessing ClassificationStatus = "processing"
	ClassificationStatusCompleted  ClassificationStatus = "completed"
	ClassificationStatusFailed     ClassificationStatus = "failed"
)

// ModerationStatus is an asset's moderation status, pending until it is decided.
type ModerationStatus string

// Moderation status values of AssetModeration.Decision and EventAssetModeration.Decision: the
// decision in force, which also decides delivery.
const (
	ModerationStatusPending ModerationStatus = "pending"
	// ModerationStatusAllowed assets are delivered normally.
	ModerationStatusAllowed ModerationStatus = "allowed"
	// ModerationStatusLimited assets are delivered exactly like allowed ones, but marked so your
	// app can reduce their reach: keep them out of recommendations, trending and notifications,
	// rank them lower or collapse them behind a "show" control.
	ModerationStatusLimited ModerationStatus = "limited"
	// ModerationStatusAgeRestricted assets are delivered only through signed URLs or API keys,
	// like private assets, so your backend decides who sees them.
	ModerationStatusAgeRestricted ModerationStatus = "age-restricted"
	// ModerationStatusBlocked assets are not delivered; their content is kept.
	ModerationStatusBlocked ModerationStatus = "blocked"
	// ModerationStatusPurged assets are not delivered and their stored content was deleted.
	ModerationStatusPurged ModerationStatus = "purged"
)

// ModerationDecision is a moderation decision: what happens to an asset.
type ModerationDecision string

// Reviewer decision values of AssetReview.Decision.
const (
	ModerationDecisionAllowed       ModerationDecision = "allowed"
	ModerationDecisionLimited       ModerationDecision = "limited"
	ModerationDecisionAgeRestricted ModerationDecision = "age-restricted"
	ModerationDecisionBlocked       ModerationDecision = "blocked"
	ModerationDecisionPurged        ModerationDecision = "purged"
)

// ContentStatus is whether an asset's content is stored.
type ContentStatus string

// Content status values of AssetContent.Status and EventAssetContent.Status: whether CalmLens holds
// the asset's content (source, preview and extracted text). ContentStatusTemporary content is kept
// only until processing finishes.
const (
	ContentStatusTemporary ContentStatus = "temporary"
	ContentStatusStored    ContentStatus = "stored"
	ContentStatusRemoved   ContentStatus = "removed"
)

// ContentRemovalReason is why an asset's content was removed.
type ContentRemovalReason string

// Content removal reasons of AssetContent.RemovalReason.
const (
	// ContentRemovalReasonPolicy means the project's policy purged the content.
	ContentRemovalReasonPolicy ContentRemovalReason = "policy"
	// ContentRemovalReasonRetention means processing finished and retainContent was off.
	ContentRemovalReasonRetention ContentRemovalReason = "retention"
	// ContentRemovalReasonRequested means the content was removed through the API or portal.
	ContentRemovalReasonRequested ContentRemovalReason = "requested"
	// ContentRemovalReasonParentRemoved means it was removed with its parent asset's content.
	ContentRemovalReasonParentRemoved ContentRemovalReason = "parent-removed"
	// ContentRemovalReasonDisposed means it was disposed of after a safety hold.
	ContentRemovalReasonDisposed ContentRemovalReason = "disposed"
)

// AssetFailureReason is why processing an asset failed.
type AssetFailureReason string

// Processing failure reasons of AssetClassification.FailureReason.
const (
	// AssetFailureReasonFileTooLarge means the file is larger than processing allows.
	AssetFailureReasonFileTooLarge AssetFailureReason = "file-too-large"
	// AssetFailureReasonDurationLimit means the audio or video is longer than processing allows.
	AssetFailureReasonDurationLimit AssetFailureReason = "duration-limit"
	// AssetFailureReasonResolutionLimit means the video is larger than 4096 × 2160 pixels.
	AssetFailureReasonResolutionLimit AssetFailureReason = "resolution-limit"
	// AssetFailureReasonUnsupportedFormat means the file format is not supported.
	AssetFailureReasonUnsupportedFormat AssetFailureReason = "unsupported-format"
	// AssetFailureReasonUndecodableContent means the content could not be decoded.
	AssetFailureReasonUndecodableContent AssetFailureReason = "undecodable-content"
	// AssetFailureReasonMultipleTracks means the audio or video has more than one audio or video track.
	AssetFailureReasonMultipleTracks AssetFailureReason = "multiple-tracks"
	// AssetFailureReasonTypeMismatch means the content does not match the asset's type.
	AssetFailureReasonTypeMismatch AssetFailureReason = "type-mismatch"
	// AssetFailureReasonFreeUploadsExhausted means the upload has more text than free uploads
	// allow before billing is set up.
	AssetFailureReasonFreeUploadsExhausted AssetFailureReason = "free-uploads-exhausted"
	// AssetFailureReasonMediaLimit means the organisation has analysed its daily allowance of long
	// audio and video; retry later.
	AssetFailureReasonMediaLimit AssetFailureReason = "media-limit"
	// AssetFailureReasonUploadsPaused means analysing the asset would pass a limit on the
	// organisation's usage, such as a spend limit, while uploads are paused.
	AssetFailureReasonUploadsPaused AssetFailureReason = "uploads-paused"
	// AssetFailureReasonTooManyItems means a document holds more embedded images or audio and
	// video files than can be moderated.
	AssetFailureReasonTooManyItems AssetFailureReason = "too-many-items"
	// AssetFailureReasonProcessingError means processing failed for another reason; retrying may succeed.
	AssetFailureReasonProcessingError AssetFailureReason = "processing-error"
)

// Visibility is whether an asset is served without a signed URL.
type Visibility string

// Asset visibility values.
const (
	VisibilityPrivate Visibility = "private"
	VisibilityPublic  Visibility = "public"
)

// AssetType is the kind of content an asset holds.
type AssetType string

// Asset type values.
const (
	AssetTypeImage              AssetType = "image"
	AssetTypeVideo              AssetType = "video"
	AssetTypeAudio              AssetType = "audio"
	AssetTypePlaintextDocument  AssetType = "plaintext-document"
	AssetTypeMultimediaDocument AssetType = "multimedia-document"
	AssetTypeWebsite            AssetType = "website"
	AssetTypeFile               AssetType = "file"
)

// ModerationAction is what a policy does with content.
type ModerationAction string

// Policy action values for category results and policy rules.
const (
	ModerationActionAllow       ModerationAction = "allow"
	ModerationActionLimit       ModerationAction = "limit"
	ModerationActionAgeRestrict ModerationAction = "age-restrict"
	ModerationActionBlock       ModerationAction = "block"
	ModerationActionPurge       ModerationAction = "purge"
)

// Asset is a moderated asset. Optional fields are nil when absent.
type Asset struct {
	responseJSON
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	// Type is one of the AssetType constants.
	Type     AssetType `json:"type"`
	ParentID *string   `json:"parentId"`
	// ParentPages are the pages of the parent document a child shows, numbered from 1; empty when
	// its page isn't known or it has no parent document.
	ParentPages []int   `json:"parentPages"`
	FolderID    *string `json:"folderId"`
	// UploadPresetID is the upload preset the asset was uploaded through, if any.
	UploadPresetID *string        `json:"uploadPresetId"`
	CreatedAt      int64          `json:"createdAt"`
	UpdatedAt      *int64         `json:"updatedAt"`
	Description    *string        `json:"description"`
	ExternalID     *string        `json:"externalId"`
	ExternalURL    *string        `json:"externalUrl"`
	Metadata       []MetadataItem `json:"metadata"`
	// AuthorID is who wrote the content, as given when it was submitted.
	AuthorID *string `json:"authorId"`
	// Context holds the earlier posts CalmLens used, oldest first. It is nil when none were
	// given and once the content is removed.
	Context *ModerationContext `json:"context"`
	Tags    []string           `json:"tags"`
	// Visibility is VisibilityPrivate or VisibilityPublic.
	Visibility Visibility `json:"visibility"`
	// Processing is where the asset is in the pipeline.
	Upload AssetUpload `json:"upload"`
	// Moderation is the moderation decision and report.
	Classification AssetClassification `json:"classification"`
	// Content describes the asset's content and whether CalmLens still holds it.
	Content AssetContent `json:"content"`
	APIResource
}

// AssetUpload tracks receipt of source content.
type AssetUpload struct {
	responseJSON
	Status        UploadStatus `json:"status"`
	UpdatedAt     *int64       `json:"updatedAt"`
	PartsReceived *int         `json:"partsReceived"`
}

// AssetClassification contains progress and results for each capability.
type AssetClassification struct {
	responseJSON
	Status ClassificationStatus `json:"status"`
	// FailureReason is why processing failed (an AssetFailureReason constant) while Status is
	// ClassificationStatusFailed; nil otherwise.
	FailureReason *AssetFailureReason `json:"failureReason"`
	UpdatedAt     *int64              `json:"updatedAt"`
	CompletedAt   *int64              `json:"completedAt"`
	// Progress is how far long audio or video analysed in sections has got; nil for other assets.
	Progress *ClassificationProgress `json:"progress"`
	// TestInput is whether the results came from one of the project's test inputs rather than
	// analysing the content. Never use test results, such as age ranges, for real decisions.
	TestInput  bool            `json:"testInput"`
	Moderation AssetModeration `json:"moderation"`
	// OCR holds where OCR found text, and personal information within it, in an image. Nil until
	// OCR has run, and when it wasn't requested. Each feature result below is nil in the same way.
	OCR             *OCRResult             `json:"ocr"`
	PersonDetection *PersonDetectionResult `json:"personDetection"`
	FaceDetection   *FaceDetectionResult   `json:"faceDetection"`
	// LinkDetection holds QR codes and web links found in the image.
	LinkDetection *LinkDetectionResult `json:"linkDetection"`
	// LinkSafety (preview) holds every link found in the asset, where it leads and its verdict.
	// It runs when the project's policy acts on links, not through ProcessingFeatures.
	LinkSafety *LinkSafetyResult `json:"linkSafety,omitempty"`
	// AIGeneratedDetection holds what the image's provenance metadata says about AI use.
	AIGeneratedDetection *AIGeneratedDetectionResult `json:"aiGeneratedDetection,omitempty"`
}

// OCRResult is the result of OCR: Status ResultEvaluated with the TextRegions it found, or
// ResultNotEvaluated with a Reason.
type OCRResult struct {
	responseJSON
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status ResultStatus `json:"status"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported, ReasonUnavailable or
	// ReasonInChildren.
	Reason ResultReason `json:"reason,omitempty"`
	// TextRegions are where OCR found text in the image; empty when it found none.
	TextRegions []TextRegion `json:"textRegions,omitempty"`
}

// ClassificationProgress is how far sectioned analysis of long audio or video has got.
type ClassificationProgress struct {
	responseJSON
	// CompletedSections is the number of sections analysed so far.
	CompletedSections int `json:"completedSections"`
	// TotalSections is the number of sections the media is analysed in.
	TotalSections int `json:"totalSections"`
}

// AssetReview records one reviewer decision without erasing earlier reviews.
type AssetReview struct {
	responseJSON
	ID string `json:"id"`
	// Decision is one of the ModerationDecision constants.
	Decision ModerationDecision `json:"decision"`
	Note     *string            `json:"note"`
	// DecidedBy is the person or API key that made the decision.
	DecidedBy  ReviewActor `json:"decidedBy"`
	ReviewedAt int64       `json:"reviewedAt"`
	// Applied is whether the decision was applied to the asset.
	Applied bool `json:"applied"`
}

// ReviewActorType is who decided a manual review.
type ReviewActorType string

// Values of ReviewActor.Type.
const (
	// ReviewActorUser is a person, or an assistant's API key acting for one.
	ReviewActorUser ReviewActorType = "user"
	// ReviewActorAPIKey is an API key.
	ReviewActorAPIKey ReviewActorType = "api-key"
)

// ReviewActor is who made a review decision.
type ReviewActor struct {
	responseJSON
	// Type is ReviewActorUser or ReviewActorAPIKey.
	Type ReviewActorType `json:"type"`
	// ID is the user's or API key's ID; nil only when it was not recorded.
	ID *string `json:"id"`
}

// AssetModeration holds content-safety findings and the decision in force.
type AssetModeration struct {
	responseJSON
	ManualReviews []AssetReview       `json:"manualReviews"`
	Decision      *ModerationDecision `json:"decision"`
	// AutomatedStatus is the status automated moderation decided (ModerationStatusAllowed,
	// ModerationStatusLimited, ModerationStatusAgeRestricted, ModerationStatusBlocked or
	// ModerationStatusPurged); a later applied review takes precedence in Status. It, Source,
	// Rule, ExplanationComplete, Categories and Raw are nil until moderation decides.
	AutomatedStatus *ModerationDecision `json:"automatedStatus"`
	// Policy is the policy that made the automated decision, as it was then; nil until
	// moderation decides.
	Policy *DecisionPolicy `json:"policy"`
	// PendingReview is the review the human review queue is waiting for, set with the automated
	// decision that joined the queue; nil when no review is waiting.
	PendingReview *AssetPendingReview `json:"pendingReview"`
	// Source is what decided the asset, one of the DecisionSource constants.
	Source *DecisionSource `json:"source"`
	// Rule names the mandatory rule that decided the asset, when Source is
	// DecisionSourceMandatoryRule.
	Rule                *string                          `json:"rule"`
	FlaggedCategories   []Category                       `json:"flaggedCategories"`
	Regions             []RegionalDecision               `json:"regions"`
	ExplanationComplete *bool                            `json:"explanationComplete"`
	Categories          map[Category]CategoryPolicyScore `json:"categories"`
	Raw                 *ModerationRaw                   `json:"raw"`
	// Timeline is the audio or video asset's findings timeline, listed by
	// AssetsService.ListTimeline; nil for assets without one.
	Timeline *ModerationTimeline `json:"timeline"`
	// LinkSafety (preview) is what the policy's link-safety settings made of the asset's links;
	// nil when the policy doesn't act on links and until moderation decides.
	LinkSafety *LinkSafetyDecision `json:"linkSafety"`
}

// DecisionPolicy is the policy that made a decision: its ID, its revision then and, for a policy
// from a built-in preset, the preset release it used.
type DecisionPolicy struct {
	responseJSON
	ID       string `json:"id"`
	Revision int    `json:"revision"`
	// Preset is nil for a policy not made from a preset.
	Preset *DecisionPolicyPreset `json:"preset"`
}

// DecisionPolicyPreset is the built-in preset release a decision's policy used.
type DecisionPolicyPreset struct {
	responseJSON
	ID      PolicyPresetID `json:"id"`
	Version int            `json:"version"`
}

// AssetPendingReview is a review the human review queue is waiting for.
type AssetPendingReview struct {
	responseJSON
	// RequestedAt is when the asset joined the queue, in Unix milliseconds.
	RequestedAt int64 `json:"requestedAt"`
	// Reason is "sampled" or "uncertain".
	Reason PendingReviewReason `json:"reason"`
	// UncertainCategories are the categories that made the decision uncertain.
	UncertainCategories []Category `json:"uncertainCategories"`
}

// LinkSafetyDecision (preview) is what the policy's link-safety settings made of an asset's links.
type LinkSafetyDecision struct {
	responseJSON
	// Action is the strongest action the asset's links take: ModerationActionAllow,
	// ModerationActionLimit, ModerationActionAgeRestrict or ModerationActionBlock.
	Action string `json:"action"`
	// Links are the checked links that take Action.
	Links []CheckedLink `json:"links"`
	// Settings are the policy's link-safety settings in force at decision time.
	Settings LinkSafetySettings `json:"settings"`
}

// LinkSafetySettings (preview) says what happens to assets that link to unsafe destinations.
// Link checks never change a moderation category's score.
type LinkSafetySettings struct {
	responseJSON
	// VerdictActions maps a flagged verdict (LinkVerdictPhishing, LinkVerdictMalware,
	// LinkVerdictAdult, LinkVerdictGambling or LinkVerdictUnresolved) to the action taken on an
	// asset with a link of that verdict. A verdict left out is allowed.
	VerdictActions map[string]string `json:"verdictActions"`
	// OffPlatformLinks acts on every link whose destination is outside its AllowedDomains,
	// whatever its verdict; nil when off.
	OffPlatformLinks *LinkSafetyOffPlatformLinks `json:"offPlatformLinks,omitempty"`
}

// LinkSafetyOffPlatformLinks (preview) acts on links that lead outside the allowed domains.
type LinkSafetyOffPlatformLinks struct {
	responseJSON
	// Action is ModerationActionLimit, ModerationActionAgeRestrict or ModerationActionBlock.
	Action string `json:"action"`
	// AllowedDomains are bare lowercase domains such as example.com; each also covers its
	// subdomains.
	AllowedDomains []string `json:"allowedDomains"`
}

// ModerationTimeline summarises an audio or video asset's findings timeline.
type ModerationTimeline struct {
	responseJSON
	// SegmentCount is the number of segments AssetsService.ListTimeline lists.
	SegmentCount int `json:"segmentCount"`
}

// ModerationRaw contains detection findings before policy evaluation.
type ModerationRaw struct {
	responseJSON
	Categories map[Category]CategoryResult `json:"categories"`
	// HashMatches are the hash list entries an image matched; empty when none did.
	HashMatches []HashMatch `json:"hashMatches"`
}

// HashMatchSource is where a hash match came from.
type HashMatchSource string

// HashMatchSourceHashList is the HashMatch.Source of a match against a project hash list.
const HashMatchSourceHashList HashMatchSource = "hash-list"

// HashMatch is a hash list entry an image matched.
type HashMatch struct {
	responseJSON
	// Source is where the matching hash came from, such as HashMatchSourceHashList.
	Source HashMatchSource `json:"source"`
	// HashListID is the matching hash list and HashListEntryID its matching entry.
	HashListID      string `json:"hashListId"`
	HashListEntryID string `json:"hashListEntryId"`
	// Distance is the number of bits that differ between the hashes; 0 is the same picture.
	Distance int `json:"distance"`
	// Action is what this match did: HashListActionBlock when it was close enough for a block
	// list to block, otherwise HashListActionFlag.
	Action HashListAction `json:"action"`
}

// AssetContent describes an asset's content: its format and properties, and whether CalmLens
// holds it.
type AssetContent struct {
	responseJSON
	// Status is one of the ContentStatus constants.
	Status ContentStatus `json:"status"`
	// RemovalReason is why the content was removed (a ContentRemovalReason constant); nil
	// while the content is held.
	RemovalReason *ContentRemovalReason `json:"removalReason"`
	// UpdatedAt is when Status last changed, in unix milliseconds.
	UpdatedAt  *int64      `json:"updatedAt"`
	SafetyHold *SafetyHold `json:"safetyHold"`
	// Format is the MIME type of the content.
	Format *string `json:"format"`
	// Extension is the file extension of the content.
	Extension   *string    `json:"extension"`
	SizeInBytes *int64     `json:"sizeInBytes"`
	Checksums   *Checksums `json:"checksums"`
	// Width and Height are the uploaded file's size in pixels, for images and video; nil when
	// unknown or not applicable.
	Width  *int `json:"width"`
	Height *int `json:"height"`
	// DurationSeconds is the length of audio or video; nil when unknown or not applicable.
	DurationSeconds *float64 `json:"durationSeconds"`
	// PageCount is the number of pages or slides in a document; nil when unknown or not applicable.
	PageCount *int `json:"pageCount"`
	// PerceptualHash matches visually similar images, for image assets.
	PerceptualHash *string `json:"perceptualHash"`
	// PerceptualHashQuality is how much detail PerceptualHash captured, from 0 to 100. Hashes
	// below 50 come from flat or featureless images and match less reliably.
	PerceptualHashQuality *int `json:"perceptualHashQuality"`
	// Metadata is the metadata embedded in an uploaded image, such as its capture time, camera
	// and software. It is read-only and separate from the asset's own Metadata; nil when the
	// image declares none, for other asset types, once the content is removed and while the
	// asset is held.
	Metadata      *FileMetadata  `json:"metadata"`
	ExtractedText *ExtractedText `json:"extractedText"`
	// Rendered is the displayable file CalmLens serves at ResourceRendered; nil when the asset
	// has none (yet), once the content is removed and while a safety hold is on.
	Rendered *AssetRendered `json:"rendered"`
	// HLS (preview) is the adaptive stream of video or audio asked for, which CalmLens serves at
	// ResourceHLS and the embed page plays once its Status is ready. Nil when none was asked for,
	// once the content is removed, while a hold is on and while the asset is blocked with no stream
	// prepared.
	HLS *AssetHls `json:"hls"`
	// Preview is the still image CalmLens serves at ResourcePreview; nil when the asset has none
	// (yet), once the content is removed and while a safety hold is on.
	Preview *AssetPreview `json:"preview"`
}

// AssetRenderedKind is what kind of file AssetRendered is.
type AssetRenderedKind string

// AssetRendered kinds.
const (
	AssetRenderedKindImage AssetRenderedKind = "image"
	AssetRenderedKindPDF   AssetRenderedKind = "pdf"
	AssetRenderedKindVideo AssetRenderedKind = "video"
	AssetRenderedKindAudio AssetRenderedKind = "audio"
)

// AssetRendered is the displayable file CalmLens serves for an asset: an image (an uploaded
// image or a website's screenshot), a PDF (a document or presentation), or browser-safe video or
// audio.
type AssetRendered struct {
	responseJSON
	// Kind is one of the AssetRenderedKind constants.
	Kind AssetRenderedKind `json:"kind"`
	// Format is the MIME type of the rendered file.
	Format string `json:"format"`
	// Width and Height are in pixels, when known.
	Width  *int `json:"width"`
	Height *int `json:"height"`
	// Peaks are an audio waveform's normalised peak levels, for rendered audio.
	Peaks []float64 `json:"peaks,omitempty"`
}

// AssetHls is the adaptive (HLS) stream of audio or video asked for, with fragmented MP4 (CMAF)
// segments, served at ResourceHLS once it is ready.
type AssetHls struct {
	responseJSON
	// Status is preparing until the stream is saved, ready once Renditions lists it, and
	// unavailable when it won't be prepared: see Reason.
	Status HLSStatus `json:"status"`
	// Reason says why an unavailable stream isn't prepared: allowance-used, billing-required,
	// spend-limit, processing-failed or content-not-kept. Nil otherwise.
	Reason *HLSReason `json:"reason"`
	// Renditions lists every rendition, video from the largest down, then audio; empty until the
	// stream is ready.
	Renditions []AssetHlsRendition `json:"renditions"`
}

// AssetHlsRenditionKind is what an AssetHlsRendition carries.
type AssetHlsRenditionKind string

// AssetHlsRendition kinds.
const (
	// AssetHlsRenditionKindVideo is a picture size; video renditions carry no sound and play with
	// the audio rendition.
	AssetHlsRenditionKindVideo AssetHlsRenditionKind = "video"
	AssetHlsRenditionKindAudio AssetHlsRenditionKind = "audio"
)

// AssetHlsRendition is one rendition of the adaptive stream, as the HLS master playlist lists it.
type AssetHlsRendition struct {
	responseJSON
	// Kind is one of the AssetHlsRenditionKind constants.
	Kind AssetHlsRenditionKind `json:"kind"`
	// Width and Height are the picture size in pixels; nil for audio.
	Width  *int `json:"width"`
	Height *int `json:"height"`
	// Bandwidth is the peak bit rate in bits per second, counting the audio a video rendition
	// plays with.
	Bandwidth int `json:"bandwidth"`
	// Codecs are the rendition's codecs as RFC 6381 names, such as "avc1.64001f".
	Codecs string `json:"codecs"`
}

// AssetPreview is the still image that stands for an asset: the image itself, a document's
// first page or slide, a website's first screen, a video's poster frame or an audio waveform.
type AssetPreview struct {
	responseJSON
	// Width and Height are in pixels, when known.
	Width  *int `json:"width"`
	Height *int `json:"height"`
	// Thumbhash is a ThumbHash placeholder to render while the preview loads; nil until
	// processing makes it.
	Thumbhash *string `json:"thumbhash"`
	// AverageColor is the preview's average colour; nil until processing makes it.
	AverageColor *string `json:"averageColor"`
}

// Checksums holds digests of the uploaded content. Each is nil when not computed.
type Checksums struct {
	responseJSON
	MD5    *string `json:"md5,omitempty"`
	SHA1   *string `json:"sha1,omitempty"`
	SHA256 *string `json:"sha256,omitempty"`
	SHA384 *string `json:"sha384,omitempty"`
	SHA512 *string `json:"sha512,omitempty"`
}

// SafetyHoldReason is why content is held.
type SafetyHoldReason string

// SafetyHoldReasonSuspectedIllegalContent is the SafetyHold.Reason for suspected illegal
// content.
const SafetyHoldReasonSuspectedIllegalContent SafetyHoldReason = "suspected-illegal-content"

// SafetyHold is a delivery restriction for suspected illegal content. Held content cannot be
// viewed, changed or deleted through normal asset operations.
type SafetyHold struct {
	responseJSON
	// PlacedAt is when the hold was placed, in unix milliseconds.
	PlacedAt int64            `json:"placedAt"`
	Reason   SafetyHoldReason `json:"reason"`
	// DisposedAt is when the held content was disposed of, in unix milliseconds.
	DisposedAt *int64 `json:"disposedAt,omitempty"`
}

// ExtractedTextType is the form of an asset's extracted text.
type ExtractedTextType string

// ExtractedText types.
const (
	// ExtractedTextString is small text stored inline in Content.
	ExtractedTextString ExtractedTextType = "string"
	// ExtractedTextDocument is larger text stored separately under ID.
	ExtractedTextDocument ExtractedTextType = "document"
)

// ExtractedText is the text extracted from an asset: Content is set for ExtractedTextString
// and ID for ExtractedTextDocument.
type ExtractedText struct {
	responseJSON
	Type    ExtractedTextType `json:"type"`
	Content *string           `json:"content,omitempty"`
	ID      *string           `json:"id,omitempty"`
}

// FileMetadata is the descriptive metadata embedded in an uploaded image. Each text field is
// nil when the file doesn't record it.
type FileMetadata struct {
	responseJSON
	// CapturedAt is when the picture was taken, as the file records it: an ISO 8601 date and
	// time, such as "2026-05-01T12:30:00+01:00". It includes the UTC offset only when the file
	// records one; without it, the time is the camera's local time.
	CapturedAt *string `json:"capturedAt"`
	// CameraMake is the camera manufacturer, such as "Canon".
	CameraMake *string `json:"cameraMake"`
	// CameraModel is the camera or phone model, such as "EOS R5".
	CameraModel *string `json:"cameraModel"`
	// LensModel is the lens model.
	LensModel *string `json:"lensModel"`
	// Software is the software that created or last edited the file.
	Software *string `json:"software"`
	// Creator is the creator or artist the file names. It is sensitive, so it is recorded only when
	// StoreSensitiveMetadata is on.
	Creator *string `json:"creator"`
	// Copyright is the copyright notice the file declares.
	Copyright *string `json:"copyright"`
	// DigitalSourceType is the IPTC digital source type the file declares, such as
	// "digitalCapture" for a camera photo or "trainedAlgorithmicMedia" for generated media.
	// Files can declare any value, so treat it as a claim.
	DigitalSourceType *string `json:"digitalSourceType"`
	// ContainsLocation is whether the uploaded file embedded GPS coordinates, whatever
	// StoreSensitiveMetadata is set to.
	ContainsLocation bool `json:"containsLocation"`
	// Location is where the picture was taken, from its GPS coordinates. It is sensitive, so it is
	// recorded only when StoreSensitiveMetadata is on; nil otherwise.
	Location *FileMetadataLocation `json:"location"`
}

// FileMetadataLocation is a GPS position in decimal degrees.
type FileMetadataLocation struct {
	responseJSON
	// Latitude is from -90 to 90.
	Latitude float64 `json:"latitude"`
	// Longitude is from -180 to 180.
	Longitude float64 `json:"longitude"`
}

// ProcessingOptions changes how one upload is processed. Unset (nil) fields are omitted
// from the request and use the project defaults.
type ProcessingOptions struct {
	responseJSON
	// RetainContent overrides whether content is kept after processing.
	// When nil, it inherits the upload preset or project setting.
	RetainContent *bool `json:"retainContent,omitempty"`
	// StoreSensitiveMetadata overrides the project's storeSensitiveMetadata setting for this
	// upload. When false, embedded image metadata (EXIF, XMP and IPTC) is removed from the file
	// before it is stored, and Content.Metadata leaves out the creator and location. When true, the
	// image is stored as uploaded.
	StoreSensitiveMetadata *bool `json:"storeSensitiveMetadata,omitempty"`
	// Features chooses optional analyses. Link detection runs unless turned off here; every other
	// feature is off unless enabled here.
	Features *ProcessingFeatures `json:"features,omitempty"`
}

// ProcessingFeatures holds the optional analyses to run, keyed by feature. A nil feature is
// not sent and keeps its default: link detection runs, the others stay off.
type ProcessingFeatures struct {
	responseJSON
	// OCR stores extracted text on the image asset and adds text moderation.
	OCR *OCRFeatureOptions `json:"ocr,omitempty"`
	// PersonDetection (preview) locates people; results are in AssetClassification.PersonDetection.
	PersonDetection *PersonDetectionFeatureOptions `json:"personDetection,omitempty"`
	// FaceDetection (preview) locates faces; results are in AssetClassification.FaceDetection.
	FaceDetection *FaceDetectionFeatureOptions `json:"faceDetection,omitempty"`
	// LinkDetection finds QR codes and web links in images (free), and moderates QR code text.
	// It runs unless set with Enabled false; results are in AssetClassification.LinkDetection.
	// With OCR on, links in the extracted text are listed too.
	LinkDetection *LinkDetectionFeatureOptions `json:"linkDetection,omitempty"`
	// Streaming (preview) prepares an adaptive (HLS) stream of audio or video once it is decided
	// and made browser-safe, served at ResourceHLS and played by ResourceEmbed. It needs
	// RetainContent and is billed per started minute of media. Left nil, the
	// project's streaming setting decides; Enabled false turns it off for this upload.
	Streaming *StreamingFeatureOptions `json:"streaming,omitempty"`
}

// StreamingFeatureOptions configures streaming (preview).
type StreamingFeatureOptions struct {
	responseJSON
	Enabled bool `json:"enabled"`
}

// OCRFeatureOptions configures OCR.
type OCRFeatureOptions struct {
	responseJSON
	Enabled bool `json:"enabled"`
}

// PersonDetectionFeatureOptions configures person detection (preview).
type PersonDetectionFeatureOptions struct {
	responseJSON
	Enabled bool `json:"enabled"`
}

// LinkDetectionFeatureOptions configures link detection.
type LinkDetectionFeatureOptions struct {
	responseJSON
	Enabled bool `json:"enabled"`
}

// FaceDetectionFeatureOptions configures face detection (preview).
type FaceDetectionFeatureOptions struct {
	responseJSON
	Enabled bool `json:"enabled"`
	// AgeEstimation also estimates an age range for each face (default false).
	AgeEstimation *bool `json:"ageEstimation,omitempty"`
}

// MetadataItem is a custom metadata value attached to an asset. Value is any JSON value
// (string, number, boolean, null, array or object) because the API stores it as given;
// decoded numbers are json.Number so large integers keep their precision.
type MetadataItem struct {
	responseJSON
	ID    string `json:"id"`
	Value any    `json:"value"`
}

// CategoryPolicyScore is how strongly a category meets the policy, from 0 to 1, and the action
// the policy takes: allow, limit, age-restrict, block or purge.
type CategoryPolicyScore struct {
	responseJSON
	Score    float64                         `json:"score"`
	Action   ModerationAction                `json:"action"`
	Source   *CategoryPolicySource           `json:"source,omitempty"`
	Settings *CategoryPolicySettingsSnapshot `json:"settings,omitempty"`
}

// CategoryPolicySource identifies the deciding rules, or that the policy score stayed below 50%.
type CategoryPolicySource struct {
	responseJSON
	// Kind is "allowance", "restriction", "default" or "below-threshold".
	Kind CategoryPolicySourceKind `json:"kind"`
	// Indexes are the deciding allowance or restriction rules, the decisive rule first; empty
	// for the other kinds.
	Indexes []int `json:"indexes,omitempty"`
	// ConditionScore is the evidence that triggered the deciding rules, from 0 to 1: a
	// restriction's same-content presence or the allowances' coverage. A rule with unless
	// qualifiers, or several when qualifiers, is assessed as a whole, so its qualifiers can be
	// missing from Raw. Nil for the other kinds.
	ConditionScore *float64 `json:"conditionScore,omitempty"`
}

// PolicyRuleSnapshot records a rule in force when the asset was decided.
type PolicyRuleSnapshot struct {
	responseJSON
	Name   string           `json:"name,omitempty"`
	When   []Qualifier      `json:"when"`
	Unless []Qualifier      `json:"unless,omitempty"`
	Action ModerationAction `json:"action"`
}

// CategoryPolicySettingsSnapshot preserves settings independently of later policy edits.
type CategoryPolicySettingsSnapshot struct {
	responseJSON
	// Action is the category's default action.
	Action       ModerationAction     `json:"action"`
	Allowances   []PolicyRuleSnapshot `json:"allowances"`
	Restrictions []PolicyRuleSnapshot `json:"restrictions"`
}

// DecisionSource is what decided an asset's moderation status.
type DecisionSource string

// Values of AssetModeration.Source.
const (
	DecisionSourcePolicy   DecisionSource = "policy"
	DecisionSourceChildren DecisionSource = "children"
	// DecisionSourceHashList is a block from a hash list match.
	DecisionSourceHashList      DecisionSource = "hash-list"
	DecisionSourceMandatoryRule DecisionSource = "mandatory-rule"
	// DecisionSourceLinkSafety (preview) is a decision made by the policy's link-safety settings.
	DecisionSourceLinkSafety DecisionSource = "link-safety"
)

// RegionalDecision records a stricter outcome in a served jurisdiction.
type RegionalDecision struct {
	responseJSON
	Region Region `json:"region"`
	// Status is the asset's status for viewers in Region: ModerationStatusLimited,
	// ModerationStatusAgeRestricted, ModerationStatusBlocked or ModerationStatusPurged.
	Status   ModerationDecision `json:"status"`
	Rule     string             `json:"rule"`
	Category Category           `json:"category,omitempty"`
}

// ProcessingFeatureResults holds the results of optional processing features, keyed by feature.
// A feature that wasn't requested is nil.
type ProcessingFeatureResults struct {
	PersonDetection      *PersonDetectionResult      `json:"personDetection,omitempty"`
	FaceDetection        *FaceDetectionResult        `json:"faceDetection,omitempty"`
	LinkDetection        *LinkDetectionResult        `json:"linkDetection,omitempty"`
	LinkSafety           *LinkSafetyResult           `json:"linkSafety,omitempty"`
	AIGeneratedDetection *AIGeneratedDetectionResult `json:"aiGeneratedDetection,omitempty"`
}

// LinkDetectionResult is the result of link detection.
type LinkDetectionResult struct {
	responseJSON
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status ResultStatus `json:"status"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported, ReasonUnavailable or ReasonInChildren.
	Reason  ResultReason     `json:"reason,omitempty"`
	QRCodes []DetectedQRCode `json:"qrCodes,omitempty"`
	Links   []DetectedLink   `json:"links,omitempty"`
}

// DetectedQRCode is a decoded QR code.
type DetectedQRCode struct {
	responseJSON
	// Value is the text the QR code holds, such as a URL.
	Value string      `json:"value"`
	Box   BoundingBox `json:"box"`
}

// DetectedLink is a web link found in an image.
type DetectedLink struct {
	responseJSON
	// URL is the link, with https:// added when the image left it out.
	URL string `json:"url"`
	// Source is "qr-code" or "text" (found in the text OCR extracted).
	Source DetectedLinkSource `json:"source"`
}

// LinkVerdict (preview) is what link safety found at a link.
type LinkVerdict string

// Link safety verdicts of CheckedLink.Verdict (preview): LinkVerdictSafe when every reputation
// check passed, LinkVerdictAdult or LinkVerdictGambling from the domain's content categories,
// LinkVerdictPhishing or LinkVerdictMalware from a threat list or the domain's security risks, and
// LinkVerdictUnresolved when a short link or redirect chain could not be followed or a check
// failed. Every address on a link's way is checked, and the most severe verdict is the link's.
const (
	LinkVerdictSafe       LinkVerdict = "safe"
	LinkVerdictAdult      LinkVerdict = "adult"
	LinkVerdictGambling   LinkVerdict = "gambling"
	LinkVerdictPhishing   LinkVerdict = "phishing"
	LinkVerdictMalware    LinkVerdict = "malware"
	LinkVerdictUnresolved LinkVerdict = "unresolved"
)

// LinkCheck (preview) is a link safety check.
type LinkCheck string

// Link safety checks of LinkSafetyEvidence.Check (preview).
const (
	// LinkCheckDomainCategories looks up the domain categories of every address on the way.
	LinkCheckDomainCategories LinkCheck = "domain-categories"
	// LinkCheckThreatLists looks up every URL on the way in threat lists.
	LinkCheckThreatLists LinkCheck = "threat-lists"
)

// LinkCheckStatus (preview) is whether a link safety check answered.
type LinkCheckStatus string

// Values of LinkSafetyEvidence.Status (preview).
const (
	LinkCheckStatusChecked LinkCheckStatus = "checked"
	// LinkCheckStatusFailed is a check that could not answer, which makes the link
	// LinkVerdictUnresolved.
	LinkCheckStatusFailed LinkCheckStatus = "failed"
)

// LinkSafetyResult (preview) is the result of link safety: every link found in the asset, where
// it leads and its verdict.
type LinkSafetyResult struct {
	responseJSON
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status string `json:"status"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported or ReasonUnavailable.
	Reason string        `json:"reason,omitempty"`
	Links  []CheckedLink `json:"links,omitempty"`
}

// CheckedLink (preview) is a link in the asset and what its destination is.
type CheckedLink struct {
	responseJSON
	// URL is the link as found, with https:// added when it was left out.
	URL string `json:"url"`
	// FinalURL is where the link leads after following its redirects; nil when a short link
	// or redirect chain could not be followed.
	FinalURL *string `json:"finalUrl"`
	// Redirects is how many redirects were followed to reach FinalURL.
	Redirects int `json:"redirects"`
	// Source is "qr-code" or "text".
	Source string `json:"source"`
	// Verdict is one of the LinkVerdict constants.
	Verdict  LinkVerdict          `json:"verdict"`
	Evidence []LinkSafetyEvidence `json:"evidence"`
}

// LinkSafetyEvidence (preview) is one reputation check of a link, every address it redirects
// through and its destination.
type LinkSafetyEvidence struct {
	responseJSON
	// Check is LinkCheckDomainCategories or LinkCheckThreatLists.
	Check LinkCheck `json:"check"`
	// Status is LinkCheckStatusChecked or LinkCheckStatusFailed.
	Status LinkCheckStatus `json:"status"`
	// Labels are what the check reported for any of the addresses, such as the domains' content
	// categories and security risks or the threat types listed.
	Labels []string `json:"labels"`
}

// AIGeneratedDetectionResult is what an image's provenance metadata says about AI use.
type AIGeneratedDetectionResult struct {
	responseJSON
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status string `json:"status"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported, ReasonUnavailable or ReasonInChildren.
	Reason string `json:"reason,omitempty"`
	// Provenance is "ai-generated", "ai-edited" or "unknown" (no AI provenance in the file,
	// which does not mean a person made it).
	Provenance string             `json:"provenance,omitempty"`
	Signals    []ProvenanceSignal `json:"signals,omitempty"`
}

// ProvenanceSignal is provenance metadata found in an image file.
type ProvenanceSignal struct {
	responseJSON
	// Kind is "c2pa", "iptc-digital-source-type" or "generator-metadata".
	Kind string `json:"kind"`
	// Value is what it says, such as the digital source type or the generator's name.
	Value string `json:"value"`
}

// TextRegion is where OCR found text in an image.
type TextRegion struct {
	responseJSON
	Box BoundingBox `json:"box"`
	// PersonalInformation reports whether the region is personal information, such as an email
	// address, phone number or card number, rather than a paragraph of text.
	PersonalInformation bool `json:"personalInformation"`
}

// PersonDetectionResult is the result of person detection (preview).
type PersonDetectionResult struct {
	responseJSON
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status ResultStatus `json:"status"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported, ReasonUnavailable or ReasonInChildren.
	Reason ResultReason     `json:"reason,omitempty"`
	People []DetectedPerson `json:"people,omitempty"`
}

// FaceDetectionResult is the result of face detection (preview).
type FaceDetectionResult struct {
	responseJSON
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status ResultStatus `json:"status"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported, ReasonUnavailable or ReasonInChildren.
	Reason ResultReason   `json:"reason,omitempty"`
	Faces  []DetectedFace `json:"faces,omitempty"`
}

// DetectedPerson is a person located in an image.
type DetectedPerson struct {
	responseJSON
	Box BoundingBox `json:"box"`
	// Confidence is the detection confidence from 0 to 1.
	Confidence float64 `json:"confidence"`
}

// DetectedFace is a face located in an image.
type DetectedFace struct {
	responseJSON
	Box BoundingBox `json:"box"`
	// Confidence is the detection confidence from 0 to 1.
	Confidence float64 `json:"confidence"`
	// AgeRange is set when the request asked for age estimation.
	AgeRange *AgeRange `json:"ageRange,omitempty"`
}

// BoundingBox is a position and size as fractions of the image width and height, from 0 to 1.
type BoundingBox struct {
	responseJSON
	Left   float64 `json:"left"`
	Top    float64 `json:"top"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// AgeRange is an estimated age range in years. Estimates can be off by several years.
type AgeRange struct {
	responseJSON
	Low  int `json:"low"`
	High int `json:"high"`
}

// SegmentSource is the kind of media a segment classifies.
type SegmentSource string

// Media segment sources.
const (
	SegmentSourceFrame     SegmentSource = "frame"
	SegmentSourceSpeech    SegmentSource = "speech"
	SegmentSourceFrameText SegmentSource = "frame-text"
	SegmentSourceClip      SegmentSource = "clip"
)

// MediaClassificationSegment is one analysed time range of audio or video.
type MediaClassificationSegment struct {
	responseJSON
	// Source is one of the SegmentSource constants.
	Source       SegmentSource               `json:"source"`
	StartSeconds float64                     `json:"startSeconds"`
	EndSeconds   float64                     `json:"endSeconds"`
	Categories   map[Category]CategoryResult `json:"categories"`
}

// Category is a moderation category.
type Category string

// Moderation categories, the keys of ClassificationReport.Categories.
const (
	CategoryPersonalInformation Category = "personal-information"
	CategoryProfanity           Category = "profanity"
	CategorySexual              Category = "sexual"
	CategoryViolence            Category = "violence"
	CategorySelfHarm            Category = "self-harm"
	CategoryHarassment          Category = "harassment"
	CategoryHate                Category = "hate"
	CategoryCriminalActivity    Category = "criminal-activity"
)

// ResultStatus is whether a result was evaluated.
type ResultStatus string

// Result status values of categories, qualifiers and processing features.
const (
	ResultEvaluated    ResultStatus = "evaluated"
	ResultPartial      ResultStatus = "partial"
	ResultNotEvaluated ResultStatus = "not-evaluated"
)

// ResultReason is why a result was not evaluated.
type ResultReason string

// Reasons for a ResultNotEvaluated result.
const (
	// ReasonNotSupported means this processing path cannot assess the signal.
	ReasonNotSupported ResultReason = "not-supported"
	// ReasonUnavailable means assessment was attempted but produced no usable result.
	ReasonUnavailable ResultReason = "unavailable"
	// ReasonInChildren means a processing feature ran on a document's or website's images, each a
	// child asset with its own result: list them with Assets.ListChildren.
	ReasonInChildren ResultReason = "in-children"
)

// Likelihood is how likely content matches a category or qualifier.
type Likelihood string

// Likelihood values, from least to most likely.
const (
	LikelihoodVeryUnlikely Likelihood = "very-unlikely"
	LikelihoodUnlikely     Likelihood = "unlikely"
	LikelihoodPossible     Likelihood = "possible"
	LikelihoodLikely       Likelihood = "likely"
	LikelihoodVeryLikely   Likelihood = "very-likely"
)

// CategoryResult is the result for one moderation category.
type CategoryResult struct {
	responseJSON
	// Status is ResultEvaluated, ResultPartial or ResultNotEvaluated; other values may be added.
	Status ResultStatus `json:"status"`
	// Score is nil when coverage is unknown; never treat absence as a safe zero.
	Score *float64 `json:"score"`
	// Likelihood is one of the Likelihood constants; empty when not evaluated.
	Likelihood Likelihood `json:"likelihood,omitempty"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported or ReasonUnavailable.
	Reason ResultReason `json:"reason,omitempty"`
	// Qualifiers holds results for the category's qualifiers, keyed by a Qualifier constant.
	Qualifiers map[Qualifier]QualifierResult `json:"qualifiers"`
}

// QualifierResult is the result for one qualifier of a category, such as QualifierSexualNudity.
type QualifierResult struct {
	responseJSON
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status ResultStatus `json:"status"`
	// SomeScore is the confidence that some of the content is this qualifier, from 0 to 1; nil
	// when not evaluated.
	SomeScore *float64 `json:"someScore,omitempty"`
	// AllScore is the confidence that the content is only this qualifier, from 0 to 1. It
	// never exceeds SomeScore.
	AllScore *float64 `json:"allScore,omitempty"`
	// Likelihood is one of the Likelihood constants; empty when not evaluated.
	Likelihood Likelihood `json:"likelihood,omitempty"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported or ReasonUnavailable.
	Reason ResultReason `json:"reason,omitempty"`
}

// ListAssetsOptions selects a page of assets. Cursor is the previous page's NextCursor; PageSize
// is 1 to 100 (0 for the API's default of 50). Sort is a comma-separated list of "createdAt" and
// "id", each descending when prefixed with "-" (the default is "-createdAt"). Filter is an RSQL
// expression over the asset's fields, with nested fields by path, such as
// "classification.moderation.decision==allowed;folderId==fldr_…"; "folderId==null" selects assets
// at the root.
type ListAssetsOptions struct {
	Cursor   string  `json:"cursor,omitempty"`
	PageSize int     `json:"pageSize,omitempty"`
	Sort     string  `json:"sort,omitempty"`
	Filter   *string `json:"filter,omitempty"`
	Params   `json:"-"`
}

// AssetPage is one page of assets. NextCursor is nil on the last page.
type AssetPage struct {
	responseJSON
	Items      []Asset `json:"items"`
	HasMore    bool    `json:"hasMore"`
	NextCursor *string `json:"nextCursor"`
	APIResource
}

// AssetIDOptions identifies an asset.
type AssetIDOptions struct {
	AssetID string
	Params  `json:"-"`
}

// DecideAssetOptions records a reviewer's decision with AssetsService.Decide. Decision is
// ModerationStatusAllowed, ...Limited, ...AgeRestricted, ...Blocked or ...Purged; Note (1 to
// 1499 characters after trimming) says why and joins the asset's review history. Purging
// permanently deletes the stored content, so it needs ConfirmPurge.
type DecideAssetOptions struct {
	AssetID      string             `json:"-"`
	Decision     ModerationDecision `json:"decision"`
	Note         string             `json:"note"`
	ConfirmPurge bool               `json:"confirmPurge,omitempty"`
	Params       `json:"-"`
}

// ExplainAssetOptions selects the asset AssetsService.Explain explains. Rerun moderates it again
// with the project's current policy instead of explaining the decision as made.
type ExplainAssetOptions struct {
	AssetID string
	Rerun   bool
	Params  `json:"-"`
}

// WaitForDecisionOptions selects the asset AssetsService.WaitForDecision waits for.
type WaitForDecisionOptions struct {
	AssetID string
	// Timeout is how long to wait for a decision: nil means DefaultDecisionTimeout, zero checks
	// once and negative values are rejected.
	Timeout *time.Duration
	Params  `json:"-"`
}

// ListAssetChildrenOptions selects a page of an asset's children. Sort works as in
// ListAssetsOptions.
type ListAssetChildrenOptions struct {
	AssetID  string
	Cursor   string
	PageSize int
	Sort     string
	Params   `json:"-"`
}

// ListAssetTimelineOptions selects a page of an audio or video asset's findings timeline.
type ListAssetTimelineOptions struct {
	AssetID  string
	Cursor   string
	PageSize int
	Params   `json:"-"`
}

// AssetTimelinePage is one page of an audio or video asset's findings timeline, in time order.
type AssetTimelinePage struct {
	responseJSON
	Items      []MediaClassificationSegment `json:"items"`
	HasMore    bool                         `json:"hasMore"`
	NextCursor *string                      `json:"nextCursor"`
	APIResource
}

// Content accepts exactly one representation. Use pointer strings to distinguish empty text/base64.
// Data is streamed without buffering; supply SizeInBytes for multipart streams. A Data
// reader that implements io.Seeker (such as *os.File) can be rewound, so the upload can be
// retried; other readers are sent once.
type Content struct {
	Type        string
	PlainText   *string
	Base64      *string
	Bytes       []byte
	Data        io.Reader
	SizeInBytes *int64
	PartNumber  int
	IsFinal     bool
}

// SubmitAssetOptions describes an asset to create or classify. Supply exactly one of
// Content, Part (first part of a multipart upload) or URL.
type SubmitAssetOptions struct {
	Name              string             `json:"name"`
	Content           *Content           `json:"-"`
	Part              *Content           `json:"-"`
	URL               string             `json:"url,omitempty"`
	Description       *string            `json:"description,omitempty"`
	ProcessingOptions *ProcessingOptions `json:"processingOptions,omitempty"`
	// Visibility is VisibilityPrivate (the default) or VisibilityPublic.
	Visibility Visibility     `json:"visibility,omitempty"`
	Metadata   []MetadataItem `json:"metadata,omitempty"`
	// Tags are tags for the asset, such as []string{"catalogue", "backpacks"}, which it keeps in
	// Asset.Tags.
	Tags []string `json:"tags,omitempty"`
	// AuthorID is your identifier for who wrote the content. CalmLens only compares it with the
	// author IDs in Context, to tell which posts share a speaker.
	AuthorID *string `json:"authorId,omitempty"`
	// Context holds earlier posts in the conversation, oldest first. CalmLens moderates only the
	// content and uses these to read who it addresses, what it refers to and whether it quotes,
	// reports, counters or mocks something. The SDK sends only the posts CalmLens uses: the most
	// recent 5 that fit in 2,000 characters (see SelectModerationContextItems).
	Context     *ModerationContext `json:"context,omitempty"`
	ExternalID  *string            `json:"externalId,omitempty"`
	ExternalURL *string            `json:"externalUrl,omitempty"`
	FolderID    *string            `json:"folderId,omitempty"`
	// UploadPresetID applies an upload preset: its folder, visibility, file types, size limit,
	// moderation policy and processing options apply to the upload. ProcessingOptions, when
	// set, replace the preset's.
	UploadPresetID *string `json:"uploadPresetId,omitempty"`
	// TotalSizeInBytes declares the size of the whole file when starting a multipart upload
	// (Part), so CalmLens can reject an upload that could never complete before storing it.
	TotalSizeInBytes *int64 `json:"totalSizeInBytes,omitempty"`
	Params           `json:"-"`
}

// UpdateAssetOptions changes an asset. Fields left unset are unchanged: a nil Name keeps
// the name, and a zero Patch keeps its field. Use Set(value) to change a field and
// Null[T]() to clear it, such as Description: calmlens.Null[string]().
type UpdateAssetOptions struct {
	AssetID     string                `json:"assetId"`
	Name        *string               `json:"name"`
	Description Patch[string]         `json:"description"`
	ExternalID  Patch[string]         `json:"externalId"`
	ExternalURL Patch[string]         `json:"externalUrl"`
	Metadata    Patch[[]MetadataItem] `json:"metadata"`
	Tags        Patch[[]string]       `json:"tags"`
	// Visibility is VisibilityPrivate or VisibilityPublic.
	Visibility Patch[Visibility] `json:"visibility"`
	Params     `json:"-"`
}

// MarshalJSON encodes the request body: only the fields that are set, without AssetID.
func (o UpdateAssetOptions) MarshalJSON() ([]byte, error) {
	body := map[string]any{}
	if o.Name != nil {
		body["name"] = *o.Name
	}
	o.Description.put(body, "description")
	o.ExternalID.put(body, "externalId")
	o.ExternalURL.put(body, "externalUrl")
	o.Metadata.put(body, "metadata")
	o.Tags.put(body, "tags")
	o.Visibility.put(body, "visibility")
	return json.Marshal(body)
}

// UploadAssetPartOptions sends part 2 or later of a multipart upload.
type UploadAssetPartOptions struct {
	AssetID string
	Part    Content
	// Wait says whether this upload's final part waits for the moderation decision (true) or
	// returns with the asset queued (false), overriding the choice saved when the upload started.
	// Leave it nil to use the saved choice (Classify waits, Create doesn't).
	Wait   *bool
	Params `json:"-"`
}

// AssetBatchOperation is what Assets.Batch does to every asset.
type AssetBatchOperation string

const (
	// AssetBatchOperationDelete deletes each asset with its child assets and stored content.
	AssetBatchOperationDelete AssetBatchOperation = "delete"
	// AssetBatchOperationRemoveContent removes each asset's stored content and keeps the record.
	AssetBatchOperationRemoveContent AssetBatchOperation = "remove-content"
)

// AssetBatchMaxAssets is the most assets one Assets.Batch request takes.
const AssetBatchMaxAssets = 500

// BatchAssetsOptions selects 1 to 500 assets and the operation to run on them.
type BatchAssetsOptions struct {
	AssetIDs  []string
	Operation AssetBatchOperation
	Params    `json:"-"`
}

// BatchStatus is the status of a batch operation.
type BatchStatus string

// BatchStatusQueued is BatchAssetsResponse.Status once a batch operation is queued.
const BatchStatusQueued BatchStatus = "queued"

// BatchAssetsResponse confirms that a batch operation is queued. BatchID names the batch: the
// asset.deleted and asset.content-removed events it causes carry it as their FactBatchID fact.
type BatchAssetsResponse struct {
	responseJSON
	BatchID string `json:"batchId"`
	// Status is BatchStatusQueued.
	Status BatchStatus `json:"status"`
	// AssetCount is the number of distinct assets the operation runs on.
	AssetCount int `json:"assetCount"`
	APIResource
}

// MoveAssetOptions moves an asset; a nil FolderID moves it to the root.
type MoveAssetOptions struct {
	AssetID  string
	FolderID *string
	Params   `json:"-"`
}

// CDN resources.
const (
	// ResourceOriginal is the asset's original file. It takes no Lens, Transform or TransformOptions.
	ResourceOriginal = "original"
	// ResourceRendered is the asset's displayable file (an image in the best format
	// the client accepts, a PDF, or browser-safe video or audio). It takes a Lens, Transform or
	// TransformOptions only when it is an image; the CDN refuses them otherwise with
	// transform/invalid.
	ResourceRendered = "rendered"
	// ResourcePreview is a still image that stands for the asset, such as a document's first page
	// or an audio waveform. It takes a Lens, Transform or TransformOptions.
	ResourcePreview = "preview"
	// ResourceHLS (preview) is the adaptive stream of audio or video, its HLS master playlist at
	// hls/index.m3u8, once Content.HLS.Status is ready; beneath a signed asset URL, its grant covers every
	// playlist and segment beneath hls/. It takes no Lens, Transform or TransformOptions.
	ResourceHLS = "hls"
	// ResourceEmbed (preview) is an HTML page that shows the asset, for an iframe: a player for
	// audio and video, or the viewer for its type. It takes no Lens, Transform or
	// TransformOptions.
	ResourceEmbed = "embed"
	// ResourcePlaceholder is a small blurred PNG, public for every asset whatever its visibility
	// or moderation status. It takes no Lens, Transform or TransformOptions, and needs no age confirmation.
	ResourcePlaceholder = "placeholder"
	// ResourceInfo is the asset's display info as JSON (AssetInfo): its type, size, rendered file,
	// preview and stream, and whether the viewer its claims describe can see it. CDN.GetAssetInfo
	// fetches it. It takes no Lens, Transform or TransformOptions.
	ResourceInfo = "info"
)

// Folder is an asset folder.
type Folder struct {
	responseJSON
	ID        string  `json:"id"`
	ProjectID string  `json:"projectId"`
	ParentID  *string `json:"parentId"`
	Name      string  `json:"name"`
	CreatedAt int64   `json:"createdAt"`
	UpdatedAt *int64  `json:"updatedAt"`
	APIResource
}

// FolderIDOptions identifies a folder.
type FolderIDOptions struct {
	FolderID string
	Params   `json:"-"`
}

// CreateFolderOptions creates a folder, optionally inside ParentID.
type CreateFolderOptions struct {
	Name     string  `json:"name"`
	ParentID *string `json:"parentId,omitempty"`
	Params   `json:"-"`
}

// UpdateFolderOptions renames a folder.
type UpdateFolderOptions struct {
	FolderID string  `json:"-"`
	Name     *string `json:"name,omitempty"`
	Params   `json:"-"`
}

// MoveFolderOptions moves a folder; a nil ParentID moves it to the root.
type MoveFolderOptions struct {
	FolderID string
	ParentID *string
	Params   `json:"-"`
}

// HashListAction is what a match against a hash list does.
type HashListAction string

// Hash list actions: what a match against the list does.
const (
	// HashListActionFlag records matches on the asset.
	HashListActionFlag HashListAction = "flag"
	// HashListActionBlock also blocks close matches.
	HashListActionBlock HashListAction = "block"
)

// HashList holds perceptual (PDQ) hashes of images the project never wants again. Image uploads
// are compared with every list in the project.
type HashList struct {
	responseJSON
	ID          string  `json:"id"`
	ProjectID   string  `json:"projectId"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	// Action is HashListActionFlag or HashListActionBlock.
	Action    HashListAction `json:"action"`
	CreatedAt int64          `json:"createdAt"`
	UpdatedAt *int64         `json:"updatedAt"`
	APIResource
}

// HashListEntry is one hash in a hash list.
type HashListEntry struct {
	responseJSON
	ID         string `json:"id"`
	ProjectID  string `json:"projectId"`
	HashListID string `json:"hashListId"`
	// Hash is the 256-bit PDQ hash as 64 hexadecimal characters.
	Hash string `json:"hash"`
	// Quality is the PDQ quality of Hash from 0 to 100, nil when unknown.
	Quality *int    `json:"quality"`
	Label   *string `json:"label"`
	// AssetID is the asset the hash was taken from, when the entry was added from an asset
	// (AddHashListEntryOptions.AssetID).
	AssetID   *string `json:"assetId"`
	CreatedAt int64   `json:"createdAt"`
	APIResource
}

// HashListPage is one page of a project's hash lists.
type HashListPage struct {
	responseJSON
	Items      []HashList `json:"items"`
	HasMore    bool       `json:"hasMore"`
	NextCursor *string    `json:"nextCursor"`
	APIResource
}

// HashListEntryPage is one page of a hash list's entries.
type HashListEntryPage struct {
	responseJSON
	Items      []HashListEntry `json:"items"`
	HasMore    bool            `json:"hasMore"`
	NextCursor *string         `json:"nextCursor"`
	APIResource
}

// ListHashListsOptions selects a page of a project's hash lists. Cursor is the previous page's
// NextCursor; PageSize is 1 to 100 (0 for the API's default of 50). Sort works as in
// ListAssetsOptions: newest first by default.
type ListHashListsOptions struct {
	Cursor   string `json:"cursor,omitempty"`
	PageSize int    `json:"pageSize,omitempty"`
	Sort     string `json:"sort,omitempty"`
	Params   `json:"-"`
}

// HashListIDOptions identifies a hash list.
type HashListIDOptions struct {
	HashListID string
	Params     `json:"-"`
}

// HashListEntryIDOptions identifies a hash list entry.
type HashListEntryIDOptions struct {
	EntryID string
	Params  `json:"-"`
}

// CreateHashListOptions creates a hash list. Action is HashListActionFlag or
// HashListActionBlock.
type CreateHashListOptions struct {
	Name        string         `json:"name"`
	Description *string        `json:"description,omitempty"`
	Action      HashListAction `json:"action"`
	Params      `json:"-"`
}

// UpdateHashListOptions renames a hash list or changes what its matches do. Fields left unset
// are unchanged; Description: calmlens.Null[string]() clears the description. A new Action
// applies to later uploads.
type UpdateHashListOptions struct {
	HashListID  string          `json:"hashListId"`
	Name        *string         `json:"name"`
	Description Patch[string]   `json:"description"`
	Action      *HashListAction `json:"action"`
	Params      `json:"-"`
}

// MarshalJSON encodes the request body: only the fields that are set, without HashListID.
func (o UpdateHashListOptions) MarshalJSON() ([]byte, error) {
	body := map[string]any{}
	if o.Name != nil {
		body["name"] = *o.Name
	}
	o.Description.put(body, "description")
	if o.Action != nil {
		body["action"] = *o.Action
	}
	return json.Marshal(body)
}

// ListHashListEntriesOptions selects a page of a hash list's entries. Sort works as in
// ListAssetsOptions: newest first by default.
type ListHashListEntriesOptions struct {
	HashListID string
	Cursor     string
	PageSize   int
	Sort       string
	Params     `json:"-"`
}

// AddHashListEntryOptions adds a hash to a list: either Hash (64 hexadecimal characters, with
// an optional Quality from 0 to 100) or AssetID, an image asset whose perceptual hash is used.
// Adding a hash already in the list returns its existing entry.
type AddHashListEntryOptions struct {
	HashListID string  `json:"hashListId"`
	Hash       string  `json:"hash"`
	Quality    *int    `json:"quality"`
	AssetID    string  `json:"assetId"`
	Label      *string `json:"label"`
	Params     `json:"-"`
}

// MarshalJSON encodes the request body: only the fields that are set, without HashListID.
func (o AddHashListEntryOptions) MarshalJSON() ([]byte, error) {
	body := map[string]any{}
	if o.Hash != "" {
		body["hash"] = o.Hash
	}
	if o.Quality != nil {
		body["quality"] = *o.Quality
	}
	if o.AssetID != "" {
		body["assetId"] = o.AssetID
	}
	if o.Label != nil {
		body["label"] = *o.Label
	}
	return json.Marshal(body)
}

// LensType is the asset type a lens applies to.
type LensType string

// Lens types: the asset type a lens applies to.
const (
	LensTypeImage    LensType = "image"
	LensTypeVideo    LensType = "video"
	LensTypeAudio    LensType = "audio"
	LensTypeDocument LensType = "document"
	LensTypeWebsite  LensType = "website"
)

// EnsureLensOptions is a lens definition.
type EnsureLensOptions struct {
	// Identifier is used in CDN URLs after "@": lowercase letters, numbers and hyphens.
	Identifier  string  `json:"identifier"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	// Type is one of the LensType constants.
	Type LensType `json:"type"`
	// Active is whether the CDN serves the lens. Nil means true.
	Active *bool `json:"active,omitempty"`
	// Transform holds the options, applied in one pass, that produce the derived asset:
	// ImageTransformOptions, or any other value that encodes as a JSON object with the same
	// option names. Lenses decoded from the API hold map[string]any with json.Number numbers.
	// The CDN serves files made with the lens's current transform.
	Transform any `json:"transform"`
	Params    `json:"-"`
}

// EnsureLensesOptions is a batch of lens definitions.
type EnsureLensesOptions struct {
	Lenses []EnsureLensOptions `json:"lenses"`
	Params `json:"-"`
}

// Lens is a stored lens: a named CDN transformation. The CDN serves files made with its current
// definition.
type Lens struct {
	responseJSON
	ID        string  `json:"id"`
	ProjectID *string `json:"projectId"`
	// Identifier is used in CDN URLs after "@".
	Identifier  string  `json:"identifier"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	// Type is one of the LensType constants.
	Type LensType `json:"type"`
	// Active is whether the CDN serves the lens.
	Active bool `json:"active"`
	// Transform holds the options that produce the derived asset, as map[string]any with
	// json.Number numbers.
	Transform any    `json:"transform"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt *int64 `json:"updatedAt"`
	APIResource
}

// ListLensesOptions selects a page of the project's lenses. Cursor is the previous page's
// NextCursor; PageSize is 1 to 100 (0 for the API's default of 50). Sort works as in
// ListAssetsOptions: newest first by default.
type ListLensesOptions struct {
	Cursor   string `json:"cursor,omitempty"`
	PageSize int    `json:"pageSize,omitempty"`
	Sort     string `json:"sort,omitempty"`
	Params   `json:"-"`
}

// LensPage is one page of the project's lenses. The built-in lenses are always available and
// aren't listed.
type LensPage struct {
	responseJSON
	Items      []Lens  `json:"items"`
	HasMore    bool    `json:"hasMore"`
	NextCursor *string `json:"nextCursor"`
	APIResource
}

// CreateLensOptions is a new lens; its Identifier must be new to the project. Fields work as in
// EnsureLensOptions; a nil Description, Active or Transform is left out.
type CreateLensOptions struct {
	Identifier  string   `json:"identifier"`
	Name        string   `json:"name"`
	Description *string  `json:"description,omitempty"`
	Type        LensType `json:"type"`
	Active      *bool    `json:"active,omitempty"`
	Transform   any      `json:"transform,omitempty"`
	Params      `json:"-"`
}

// LensIDOptions identifies a lens.
type LensIDOptions struct {
	LensID string
	Params `json:"-"`
}

// UpdateLensOptions changes a lens. Fields left unset are unchanged; Description:
// calmlens.Null[string]() clears the description and Transform: calmlens.Null[any]() the
// transform.
type UpdateLensOptions struct {
	LensID      string        `json:"lensId"`
	Name        *string       `json:"name"`
	Description Patch[string] `json:"description"`
	// Type is one of the LensType constants.
	Type *LensType `json:"type"`
	// Active is whether the CDN serves the lens.
	Active    *bool      `json:"active"`
	Transform Patch[any] `json:"transform"`
	Params    `json:"-"`
}

// MarshalJSON encodes the request body: only the fields that are set, without LensID.
func (o UpdateLensOptions) MarshalJSON() ([]byte, error) {
	body := map[string]any{}
	if o.Name != nil {
		body["name"] = *o.Name
	}
	o.Description.put(body, "description")
	if o.Type != nil {
		body["type"] = *o.Type
	}
	if o.Active != nil {
		body["active"] = *o.Active
	}
	o.Transform.put(body, "transform")
	return json.Marshal(body)
}

// ActorType is who caused an event.
type ActorType string

// Values of Actor.Type.
const (
	// ActorUser is a person in the portal, or an assistant acting for one.
	ActorUser ActorType = "user"
	// ActorAPIKey is an API key of its own.
	ActorAPIKey ActorType = "api-key"
	// ActorAutomated is automated moderation.
	ActorAutomated ActorType = "automated"
	// ActorSystem is CalmLens itself, such as when it pauses uploads.
	ActorSystem ActorType = "system"
)

// Actor is who caused an event.
type Actor struct {
	responseJSON
	// Type is ActorUser, ActorAPIKey, ActorAutomated or ActorSystem.
	Type ActorType `json:"type"`
	// ID is the user's or API key's ID; nil for ActorAutomated and ActorSystem, and when the ID
	// was not recorded.
	ID *string `json:"id"`
}

// Event is an entry in the project event feed, in the shape Events.List returns and webhook
// connectors deliver.
type Event struct {
	responseJSON
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	// Actor is who caused the event.
	Actor Actor `json:"actor"`
	// Type is one of the EventType constants.
	Type EventType `json:"type"`
	// Severity is SeverityLow or SeverityHigh.
	Severity    Severity `json:"severity"`
	Title       string   `json:"title"`
	Description *string  `json:"description"`
	AssetID     *string  `json:"assetId"`
	// AssetSequence increases with each event about the asset; nil for events not about an
	// asset. Deliveries can arrive out of order: see IsNewerAssetEvent.
	AssetSequence *int64      `json:"assetSequence"`
	Asset         *EventAsset `json:"asset"`
	Facts         EventFacts  `json:"facts"`
	CreatedAt     int64       `json:"createdAt"`
}

// ListEventsOptions reads events after Cursor, a previous page's NextCursor. Without Cursor,
// the response is empty and its NextCursor marks "now". PageSize is 1 to 100 (0 for the
// API's default of 50). Types (EventType constants) and AssetID narrow the feed to those event
// types or one asset's events. A cursor belongs to the filters it was issued with, so pass the
// same Types and AssetID with each Cursor.
type ListEventsOptions struct {
	Cursor   string      `json:"cursor,omitempty"`
	PageSize int         `json:"pageSize,omitempty"`
	Types    []EventType `json:"types,omitempty"`
	AssetID  string      `json:"assetId,omitempty"`
	Params   `json:"-"`
}

// EventsPage is one page of the event feed, oldest first. Unlike other pages, NextCursor is
// never empty: keep it to poll for later events.
type EventsPage struct {
	responseJSON
	Items      []Event `json:"items"`
	NextCursor string  `json:"nextCursor"`
	HasMore    bool    `json:"hasMore"`
	// ExcludedTypes are the event types (EventType constants) this feed never includes, because
	// the API key lacks the permission to see them. Give the key that permission to receive them.
	ExcludedTypes []EventType `json:"excludedTypes"`
	APIResource
}

// Ptr conveniently supplies optional scalar fields.
func Ptr[T any](value T) *T { return &value }

// ClassifyTextOptions moderates plain text. Name defaults to "text".
type ClassifyTextOptions struct {
	Text        string
	Name        string
	Description *string
	// Visibility works as in SubmitAssetOptions.
	Visibility        Visibility
	ProcessingOptions *ProcessingOptions
	Metadata          []MetadataItem
	// Tags work as in SubmitAssetOptions.
	Tags []string
	// AuthorID and Context work as in SubmitAssetOptions.
	AuthorID       *string
	Context        *ModerationContext
	ExternalID     *string
	ExternalURL    *string
	FolderID       *string
	UploadPresetID *string
	Params         `json:"-"`
}

// SearchMode is how Assets.Search matches.
type SearchMode string

// Search modes.
const (
	SearchModeKeyword  SearchMode = "keyword"
	SearchModeSemantic SearchMode = "semantic"
	SearchModeHybrid   SearchMode = "hybrid"
)

// SemanticStatus is whether semantic search could run.
type SemanticStatus string

// Semantic search status values of AssetSearchResponse.SemanticStatus.
const (
	SemanticStatusDisabled    SemanticStatus = "disabled"
	SemanticStatusReady       SemanticStatus = "ready"
	SemanticStatusIndexing    SemanticStatus = "indexing"
	SemanticStatusUnavailable SemanticStatus = "unavailable"
)

// MatchedField is an asset field a search matched.
type MatchedField string

// Matched fields of AssetSearchMatch.MatchedFields.
const (
	MatchedFieldName             MatchedField = "name"
	MatchedFieldID               MatchedField = "id"
	MatchedFieldExternalID       MatchedField = "externalId"
	MatchedFieldDescription      MatchedField = "description"
	MatchedFieldTags             MatchedField = "tags"
	MatchedFieldType             MatchedField = "type"
	MatchedFieldContentFormat    MatchedField = "content.format"
	MatchedFieldContentExtension MatchedField = "content.extension"
	MatchedFieldModerationStatus MatchedField = "classification.moderation.decision"
	MatchedFieldVisual           MatchedField = "visual"
	MatchedFieldTranscript       MatchedField = "transcript"
)

// SearchAssetsOptions searches assets. Mode is one of the SearchMode constants (default
// SearchModeHybrid).
type SearchAssetsOptions struct {
	Query string     `json:"query"`
	Mode  SearchMode `json:"mode,omitempty"`
	// PageSize is how many of the best matches to return, 1 to 20 (0 for the API's default of 10).
	PageSize int `json:"pageSize,omitempty"`
	Params   `json:"-"`
}

// AssetSearchMatch is one search result.
type AssetSearchMatch struct {
	responseJSON
	Asset         Asset          `json:"asset"`
	Score         float64        `json:"score"`
	MatchedFields []MatchedField `json:"matchedFields"`
}

// AssetSearchResponse holds search results. SemanticStatus is one of the SemanticStatus
// constants.
type AssetSearchResponse struct {
	responseJSON
	Query          string             `json:"query"`
	Items          []AssetSearchMatch `json:"items"`
	SemanticStatus SemanticStatus     `json:"semanticStatus"`
	APIResource
}

// ListFoldersOptions selects a page of immediate children or searches folder names. Cursor is
// the previous page's NextCursor; PageSize is 1 to 100 (0 for the API's default of 50).
// Sort is one field, "name" (the default) or "createdAt", descending when prefixed with "-".
type ListFoldersOptions struct {
	ParentID *string `json:"parentId,omitempty"`
	Cursor   string  `json:"cursor,omitempty"`
	PageSize int     `json:"pageSize,omitempty"`
	Sort     string  `json:"sort,omitempty"`
	Search   string  `json:"search,omitempty"`
	Params   `json:"-"`
}

// FolderPage is one page of folders, with the folders above the listed or requested ones in
// Ancestors.
type FolderPage struct {
	responseJSON
	Items      []Folder `json:"items"`
	Ancestors  []Folder `json:"ancestors"`
	HasMore    bool     `json:"hasMore"`
	NextCursor *string  `json:"nextCursor"`
	APIResource
}

// ViewerClaims are optional customer assertions that a CDN URL carries in its
// viewerClaims query. Region is the viewer's country (an ISO 3166-1 alpha-2 code such as "DE");
// age confirmation defaults to false. The defaults (no region, AgeConfirmed nil or false) are
// left out of URLs, so default URLs stay cacheable.
//
// AgeConfirmed is your platform's confirmation that the viewer passed its age check. Your
// platform confirms the viewer's age; viewer claims are assertions from your app, and CalmLens
// doesn't verify them. Set it only where your app has already decided the viewer may
// see age-restricted content.
type ViewerClaims struct {
	Region       string `json:"region,omitempty"`
	AgeConfirmed *bool  `json:"ageConfirmed,omitempty"`
}

// UploadStatus is whether an asset's upload has finished.
type UploadStatus string

const (
	// UploadStatusUploading is a multipart upload still receiving parts.
	UploadStatusUploading UploadStatus = "uploading"
	// UploadStatusCompleted is an upload whose content has all arrived.
	UploadStatusCompleted UploadStatus = "completed"
)

// HLSStatus is whether an asset's adaptive stream can be played.
type HLSStatus string

const (
	HLSStatusPreparing   HLSStatus = "preparing"
	HLSStatusReady       HLSStatus = "ready"
	HLSStatusUnavailable HLSStatus = "unavailable"
)

// HLSReason is why an asset's adaptive stream is unavailable.
type HLSReason string

const (
	HLSReasonAllowanceUsed    HLSReason = "allowance-used"
	HLSReasonBillingRequired  HLSReason = "billing-required"
	HLSReasonContentNotKept   HLSReason = "content-not-kept"
	HLSReasonProcessingFailed HLSReason = "processing-failed"
	HLSReasonSpendLimit       HLSReason = "spend-limit"
)

// PendingReviewReason is why an asset waits for a human review.
type PendingReviewReason string

const (
	// PendingReviewReasonSampled is a decision sampled for review.
	PendingReviewReasonSampled PendingReviewReason = "sampled"
	// PendingReviewReasonUncertain is a decision close to a policy threshold or missing evidence.
	PendingReviewReasonUncertain PendingReviewReason = "uncertain"
)

// CategoryPolicySourceKind is what set a category's policy action.
type CategoryPolicySourceKind string

const (
	// CategoryPolicySourceDefault is the category's default action.
	CategoryPolicySourceDefault CategoryPolicySourceKind = "default"
	// CategoryPolicySourceBelowThreshold is a score below the category's threshold.
	CategoryPolicySourceBelowThreshold CategoryPolicySourceKind = "below-threshold"
	// CategoryPolicySourceAllowance is an allowance rule.
	CategoryPolicySourceAllowance CategoryPolicySourceKind = "allowance"
	// CategoryPolicySourceRestriction is a restriction rule.
	CategoryPolicySourceRestriction CategoryPolicySourceKind = "restriction"
)

// DetectedLinkSource is where link detection found a link.
type DetectedLinkSource string

const (
	// DetectedLinkSourceText is a link in the image's text.
	DetectedLinkSourceText DetectedLinkSource = "text"
	// DetectedLinkSourceQRCode is a link in a QR code.
	DetectedLinkSourceQRCode DetectedLinkSource = "qr-code"
)

// Region is a jurisdiction with its own regional delivery rules.
type Region string

const (
	RegionAT Region = "AT"
	RegionAU Region = "AU"
	RegionBR Region = "BR"
	RegionDE Region = "DE"
	RegionEU Region = "EU"
	RegionFR Region = "FR"
	RegionGB Region = "GB"
)
