// Package calmlens provides a server-side client for the CalmLens public API.
//
// Create a client with NewServerClient and call the services on it (Assets, Text, Folders, Events
// and CDN). Every method returns *Error on failure. Webhook deliveries are verified with
// VerifyWebhookRequest, ParseWebhookEvent or VerifyWebhookSignature. The calmlenstest
// sub-package provides an in-memory client for tests.
package calmlens

import (
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// JSON is a decoded JSON object. The SDK uses it only where the API allows arbitrary values
// (Raw fields and Error.Details); numbers decoded by the SDK are json.Number, so large
// integers keep their precision.
type JSON = map[string]any

// Processing status values of AssetClassification.Status and EventAssetClassification.Status: where the
// asset is in the pipeline. ClassificationStatusQueued assets wait for their content (a multipart
// upload still receiving parts) or their turn; an asset is settled once it is
// ClassificationStatusCompleted or ClassificationStatusFailed. Status is a plain string so values
// added later still decode.
const (
	ClassificationStatusQueued     = "queued"
	ClassificationStatusProcessing = "processing"
	ClassificationStatusCompleted  = "completed"
	ClassificationStatusFailed     = "failed"
)

// Moderation status values of AssetModeration.Status and EventAssetModeration.Status: the
// decision in force, which also decides delivery. Status is a plain string so values added later
// still decode; handle unknown values as "not allowed".
const (
	ModerationStatusPending = "pending"
	// ModerationStatusAllowed assets are delivered normally.
	ModerationStatusAllowed = "allowed"
	// ModerationStatusLimited assets are delivered exactly like allowed ones, but marked so your
	// app can reduce their reach: keep them out of recommendations, trending and notifications,
	// rank them lower or collapse them behind a "show" control.
	ModerationStatusLimited = "limited"
	// ModerationStatusAgeRestricted assets are delivered only through signed URLs or API keys,
	// like private assets, so your backend decides who sees them.
	ModerationStatusAgeRestricted = "age-restricted"
	// ModerationStatusBlocked assets are not delivered; their content is kept.
	ModerationStatusBlocked = "blocked"
	// ModerationStatusPurged assets are not delivered and their stored content was deleted.
	ModerationStatusPurged = "purged"
)

// Reviewer decision values of AssetReview.Decision. Decision is a plain string so values added
// later still decode.
const (
	ModerationDecisionAllowed       = "allowed"
	ModerationDecisionLimited       = "limited"
	ModerationDecisionAgeRestricted = "age-restricted"
	ModerationDecisionBlocked       = "blocked"
	ModerationDecisionPurged        = "purged"
)

// Content status values of AssetContent.Status and EventAssetContent.Status: whether CalmLens
// holds the asset's content (source, preview and extracted text). ContentStatusTemporary content
// is kept only until processing finishes.
const (
	ContentStatusTemporary = "temporary"
	ContentStatusStored    = "stored"
	ContentStatusRemoved   = "removed"
)

// Content removal reasons of AssetContent.RemovalReason. RemovalReason is a plain string so
// reasons added later still decode.
const (
	// ContentRemovalReasonPolicy means the project's policy purged the content.
	ContentRemovalReasonPolicy = "policy"
	// ContentRemovalReasonRetention means processing finished and keepContentAfterProcessing was off.
	ContentRemovalReasonRetention = "retention"
	// ContentRemovalReasonRequested means the content was removed through the API or portal.
	ContentRemovalReasonRequested = "requested"
	// ContentRemovalReasonParentRemoved means it was removed with its parent asset's content.
	ContentRemovalReasonParentRemoved = "parent-removed"
	// ContentRemovalReasonDisposed means it was disposed of after a safety hold.
	ContentRemovalReasonDisposed = "disposed"
)

// Processing failure reasons of AssetClassification.FailureReason. FailureReason is a plain string
// so reasons added later still decode.
const (
	// AssetFailureReasonFileTooLarge means the file is larger than processing allows.
	AssetFailureReasonFileTooLarge = "file-too-large"
	// AssetFailureReasonDurationLimit means the audio or video is longer than processing allows.
	AssetFailureReasonDurationLimit = "duration-limit"
	// AssetFailureReasonResolutionLimit means the video is larger than 4096 × 2160 pixels.
	AssetFailureReasonResolutionLimit = "resolution-limit"
	// AssetFailureReasonUnsupportedFormat means the file format is not supported.
	AssetFailureReasonUnsupportedFormat = "unsupported-format"
	// AssetFailureReasonUndecodableContent means the content could not be decoded.
	AssetFailureReasonUndecodableContent = "undecodable-content"
	// AssetFailureReasonMultipleTracks means the audio or video has more than one audio or video track.
	AssetFailureReasonMultipleTracks = "multiple-tracks"
	// AssetFailureReasonTypeMismatch means the content does not match the asset's type.
	AssetFailureReasonTypeMismatch = "type-mismatch"
	// AssetFailureReasonFreeUploadsExhausted means the upload has more text than free uploads
	// allow before billing is set up.
	AssetFailureReasonFreeUploadsExhausted = "free-uploads-exhausted"
	// AssetFailureReasonMediaLimit means the organisation has analysed its daily allowance of long
	// audio and video; retry later.
	AssetFailureReasonMediaLimit = "media-limit"
	// AssetFailureReasonUploadsPaused means analysing the asset would pass a limit on the
	// organisation's usage, such as a spend limit, while uploads are paused.
	AssetFailureReasonUploadsPaused = "uploads-paused"
	// AssetFailureReasonChildFailed means a part of the asset, such as an embedded image, failed.
	AssetFailureReasonChildFailed = "child-failed"
	// AssetFailureReasonProcessingError means processing failed for another reason; retrying may succeed.
	AssetFailureReasonProcessingError = "processing-error"
)

// Asset visibility values.
const (
	VisibilityPrivate = "private"
	VisibilityPublic  = "public"
)

// Asset type values. Type is a plain string so types added later still decode.
const (
	AssetTypeImage              = "image"
	AssetTypeVideo              = "video"
	AssetTypeAudio              = "audio"
	AssetTypePlaintextDocument  = "plaintext-document"
	AssetTypeMultimediaDocument = "multimedia-document"
	AssetTypeWebsite            = "website"
	AssetTypeFile               = "file"
)

// Policy action values for category results and policy rules.
const (
	ModerationActionAllow       = "allow"
	ModerationActionLimit       = "limit"
	ModerationActionAgeRestrict = "age-restrict"
	ModerationActionBlock       = "block"
	ModerationActionPurge       = "purge"
)

// Asset is a moderated asset. Optional fields are nil when absent.
type Asset struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	// Type is one of the AssetType constants.
	Type     string  `json:"type"`
	ParentID *string `json:"parentId"`
	FolderID *string `json:"folderId"`
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
	Visibility *string `json:"visibility"`
	// Processing is where the asset is in the pipeline.
	Upload AssetUpload `json:"upload"`
	// Moderation is the moderation decision and report.
	Classification AssetClassification `json:"classification"`
	// Content describes the asset's content and whether CalmLens still holds it.
	Content AssetContent `json:"content"`
	// Raw contains the entire asset, including fields added to the API after this SDK.
	Raw JSON `json:"-"`
}

// AssetUpload tracks receipt of source content.
type AssetUpload struct {
	Status        string `json:"status"`
	UpdatedAt     *int64 `json:"updatedAt"`
	PartsReceived *int   `json:"partsReceived"`
}

// AssetClassification contains progress and results for each capability.
type AssetClassification struct {
	Status string `json:"status"`
	// FailureReason is why processing failed (an AssetFailureReason constant) while Status is
	// ClassificationStatusFailed; nil otherwise.
	FailureReason *string `json:"failureReason"`
	UpdatedAt     *int64  `json:"updatedAt"`
	CompletedAt   *int64  `json:"completedAt"`
	// Progress is how far long audio or video analysed in sections has got; nil for other assets.
	Progress *ClassificationProgress `json:"progress"`
	// TestInput is whether the results came from one of the project's test inputs rather than
	// analysing the content. Never use test results, such as age ranges, for real decisions.
	TestInput       bool                   `json:"testInput"`
	Moderation      AssetModeration        `json:"moderation"`
	PersonDetection *PersonDetectionResult `json:"personDetection,omitempty"`
	FaceDetection   *FaceDetectionResult   `json:"faceDetection,omitempty"`
	// LinkDetection holds QR codes and web links found in the image.
	LinkDetection *LinkDetectionResult `json:"linkDetection,omitempty"`
	// LinkSafety (preview) holds every link found in the asset, where it leads and its verdict.
	// It runs when the project's policy acts on links, not through ProcessingFeatures.
	LinkSafety *LinkSafetyResult `json:"linkSafety,omitempty"`
	// AIGeneratedDetection holds what the image's provenance metadata says about AI use.
	AIGeneratedDetection *AIGeneratedDetectionResult `json:"aiGeneratedDetection,omitempty"`
	// TextRegions are where OCR found text, and personal information within it, in an image.
	// Redaction transforms (ImageRedaction) blur these regions.
	TextRegions []TextRegion `json:"textRegions,omitempty"`
}

// ClassificationProgress is how far sectioned analysis of long audio or video has got.
type ClassificationProgress struct {
	// CompletedSections is the number of sections analysed so far.
	CompletedSections int `json:"completedSections"`
	// TotalSections is the number of sections the media is analysed in.
	TotalSections int `json:"totalSections"`
}

// AssetReview records one reviewer decision without erasing earlier reviews.
type AssetReview struct {
	ID string `json:"id"`
	// Decision is one of the ModerationDecision constants.
	Decision string  `json:"decision"`
	Note     *string `json:"note"`
	// DecidedBy is the person or API key that made the decision.
	DecidedBy  ReviewActor `json:"decidedBy"`
	ReviewedAt int64       `json:"reviewedAt"`
	// Applied is whether the decision was applied to the asset.
	Applied bool `json:"applied"`
}

// Values of ReviewActor.Type. Type is a plain string so values added later still decode.
const (
	// ReviewActorUser is a person, or an assistant's API key acting for one.
	ReviewActorUser = "user"
	// ReviewActorAPIKey is an API key.
	ReviewActorAPIKey = "api-key"
)

// ReviewActor is who made a review decision.
type ReviewActor struct {
	// Type is ReviewActorUser or ReviewActorAPIKey.
	Type string `json:"type"`
	// ID is the user's or API key's ID; nil only when it was not recorded.
	ID *string `json:"id"`
}

// AssetModeration holds content-safety findings and the decision in force.
type AssetModeration struct {
	ManualReviews []AssetReview `json:"manualReviews"`
	Status        string        `json:"status"`
	// AutomatedStatus is the status automated moderation decided (ModerationStatusAllowed,
	// ModerationStatusLimited, ModerationStatusAgeRestricted, ModerationStatusBlocked or
	// ModerationStatusPurged); a later applied review takes precedence in Status. Nil before a
	// decision.
	AutomatedStatus     *string                        `json:"automatedStatus,omitempty"`
	Source              *string                        `json:"source,omitempty"`
	Rule                *string                        `json:"rule,omitempty"`
	FlaggedCategories   []string                       `json:"flaggedCategories"`
	Regions             []RegionalDecision             `json:"regions"`
	ExplanationComplete *bool                          `json:"explanationComplete,omitempty"`
	Categories          map[string]CategoryPolicyScore `json:"categories,omitempty"`
	Raw                 *ModerationRaw                 `json:"raw,omitempty"`
	// Timeline is the audio or video asset's findings timeline, listed by
	// AssetsService.ListTimeline; nil for assets without one.
	Timeline *ModerationTimeline `json:"timeline"`
	// LinkSafety (preview) is what the policy's link-safety settings made of the asset's links;
	// nil when the policy doesn't act on links.
	LinkSafety *LinkSafetyDecision `json:"linkSafety,omitempty"`
	Extra      JSON                `json:"-"`
}

// LinkSafetyDecision (preview) is what the policy's link-safety settings made of an asset's links.
type LinkSafetyDecision struct {
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
	// Action is ModerationActionLimit, ModerationActionAgeRestrict or ModerationActionBlock.
	Action string `json:"action"`
	// AllowedDomains are bare lowercase domains such as example.com; each also covers its
	// subdomains.
	AllowedDomains []string `json:"allowedDomains"`
}

// ModerationTimeline summarises an audio or video asset's findings timeline.
type ModerationTimeline struct {
	// SegmentCount is the number of segments AssetsService.ListTimeline lists.
	SegmentCount int `json:"segmentCount"`
}

// ModerationRaw contains detection findings before policy evaluation.
type ModerationRaw struct {
	Categories  map[string]CategoryResult `json:"categories"`
	HashMatches []HashMatch               `json:"hashMatches,omitempty"`
}

// HashMatchSourceHashList is the HashMatch.Source of a match against a project hash list.
// Source is a plain string so sources added later still decode.
const HashMatchSourceHashList = "hash-list"

// HashMatch is a hash list entry an image matched.
type HashMatch struct {
	// Source is where the matching hash came from, such as HashMatchSourceHashList.
	Source string `json:"source"`
	// HashListID is the matching hash list and HashListEntryID its matching entry.
	HashListID      string `json:"hashListId"`
	HashListEntryID string `json:"hashListEntryId"`
	// Distance is the number of bits that differ between the hashes; 0 is the same picture.
	Distance int `json:"distance"`
	// Action is what this match did: HashListActionBlock when it was close enough for a block
	// list to block, otherwise HashListActionFlag.
	Action string `json:"action"`
}

// AssetContent describes an asset's content: its format and properties, and whether CalmLens
// holds it.
type AssetContent struct {
	// Status is one of the ContentStatus constants.
	Status string `json:"status"`
	// RemovalReason is why the content was removed (a ContentRemovalReason constant); nil
	// while the content is held.
	RemovalReason *string `json:"removalReason"`
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
	// Preview is the still image CalmLens serves at ResourcePreview; nil when the asset has none
	// (yet), once the content is removed and while a safety hold is on.
	Preview *AssetPreview `json:"preview"`
}

// AssetRenderedKind is what kind of file AssetRendered is. It is a string type so kinds added
// later still decode.
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

// AssetPreview is the still image that stands for an asset: the image itself, a document's
// first page or slide, a website's first screen, a video's poster frame or an audio waveform.
type AssetPreview struct {
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
	MD5    *string `json:"md5,omitempty"`
	SHA1   *string `json:"sha1,omitempty"`
	SHA256 *string `json:"sha256,omitempty"`
	SHA384 *string `json:"sha384,omitempty"`
	SHA512 *string `json:"sha512,omitempty"`
}

// SafetyHoldReasonSuspectedIllegalContent is the SafetyHold.Reason for suspected illegal
// content. Reason is a plain string so reasons added later still decode.
const SafetyHoldReasonSuspectedIllegalContent = "suspected-illegal-content"

// SafetyHold is a delivery restriction for suspected illegal content. Held content cannot be
// viewed, changed or deleted through normal asset operations.
type SafetyHold struct {
	// PlacedAt is when the hold was placed, in unix milliseconds.
	PlacedAt int64  `json:"placedAt"`
	Reason   string `json:"reason"`
	// DisposedAt is when the held content was disposed of, in unix milliseconds.
	DisposedAt *int64 `json:"disposedAt,omitempty"`
}

// ExtractedText types. Type is a plain string so types added later still decode.
const (
	// ExtractedTextString is small text stored inline in Content.
	ExtractedTextString = "string"
	// ExtractedTextDocument is larger text stored separately under ID.
	ExtractedTextDocument = "document"
)

// ExtractedText is the text extracted from an asset: Content is set for ExtractedTextString
// and ID for ExtractedTextDocument.
type ExtractedText struct {
	Type    string  `json:"type"`
	Content *string `json:"content,omitempty"`
	ID      *string `json:"id,omitempty"`
}

// FileMetadata is the descriptive metadata embedded in an uploaded image. Each text field is
// nil when the file doesn't record it.
type FileMetadata struct {
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
	// Latitude is from -90 to 90.
	Latitude float64 `json:"latitude"`
	// Longitude is from -180 to 180.
	Longitude float64 `json:"longitude"`
}

// ProcessingOptions changes how one upload is processed. Unset (nil) fields are omitted
// from the request and use the project defaults.
type ProcessingOptions struct {
	// KeepContentAfterProcessing keeps the content after processing (default false).
	KeepContentAfterProcessing *bool `json:"keepContentAfterProcessing,omitempty"`
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
	// OCR stores extracted text on the image asset and adds text moderation.
	OCR *OCRFeatureOptions `json:"ocr,omitempty"`
	// PersonDetection (preview) locates people; results are in Report.Features.
	PersonDetection *PersonDetectionFeatureOptions `json:"personDetection,omitempty"`
	// FaceDetection (preview) locates faces; results are in Report.Features.
	FaceDetection *FaceDetectionFeatureOptions `json:"faceDetection,omitempty"`
	// LinkDetection finds QR codes and web links in images (free), and moderates QR code text.
	// It runs unless set with Enabled false; results are in AssetClassification.LinkDetection.
	// With OCR on, links in the extracted text are listed too.
	LinkDetection *LinkDetectionFeatureOptions `json:"linkDetection,omitempty"`
}

// OCRFeatureOptions configures OCR.
type OCRFeatureOptions struct {
	Enabled bool `json:"enabled"`
}

// PersonDetectionFeatureOptions configures person detection (preview).
type PersonDetectionFeatureOptions struct {
	Enabled bool `json:"enabled"`
}

// LinkDetectionFeatureOptions configures link detection.
type LinkDetectionFeatureOptions struct {
	Enabled bool `json:"enabled"`
}

// FaceDetectionFeatureOptions configures face detection (preview).
type FaceDetectionFeatureOptions struct {
	Enabled bool `json:"enabled"`
	// AgeEstimation also estimates an age range for each face (default false).
	AgeEstimation *bool `json:"ageEstimation,omitempty"`
}

// MetadataItem is a custom metadata value attached to an asset. Value is any JSON value
// (string, number, boolean, null, array or object) because the API stores it as given;
// decoded numbers are json.Number so large integers keep their precision.
type MetadataItem struct {
	ID    string `json:"id"`
	Value any    `json:"value"`
}

// CategoryPolicyScore is how strongly a category meets the policy, from 0 to 1, and the action
// the policy takes: allow, limit, age-restrict, block or purge.
type CategoryPolicyScore struct {
	Score    float64                         `json:"score"`
	Action   string                          `json:"action"`
	Source   *CategoryPolicySource           `json:"source,omitempty"`
	Settings *CategoryPolicySettingsSnapshot `json:"settings,omitempty"`
}

// CategoryPolicySource identifies the deciding rules, or that the policy score stayed below 50%.
type CategoryPolicySource struct {
	// Kind is "allowance", "restriction", "default" or "below-threshold".
	Kind string `json:"kind"`
	// Indexes are the deciding allowance or restriction rules, the decisive rule first; empty
	// for the other kinds.
	Indexes []int `json:"indexes,omitempty"`
}

// PolicyRuleSnapshot records a rule in force when the asset was decided.
type PolicyRuleSnapshot struct {
	Name   string   `json:"name,omitempty"`
	When   []string `json:"when"`
	Match  string   `json:"match,omitempty"`
	Unless []string `json:"unless,omitempty"`
	Action string   `json:"action"`
}

// CategoryPolicySettingsSnapshot preserves settings independently of later policy edits.
type CategoryPolicySettingsSnapshot struct {
	CategoryAction string               `json:"categoryAction"`
	Allowances     []PolicyRuleSnapshot `json:"allowances"`
	Restrictions   []PolicyRuleSnapshot `json:"restrictions"`
}

// Values of AssetModeration.Source. New source strings still decode.
const (
	DecisionSourcePolicy   = "policy"
	DecisionSourceChildren = "children"
	// DecisionSourceHashList is a block from a hash list match.
	DecisionSourceHashList      = "hash-list"
	DecisionSourceMandatoryRule = "mandatory-rule"
	// DecisionSourceLinkSafety (preview) is a decision made by the policy's link-safety settings.
	DecisionSourceLinkSafety = "link-safety"
)

// RegionalDecision records a stricter outcome in a served jurisdiction.
type RegionalDecision struct {
	Region string `json:"region"`
	// Status is the asset's status for viewers in Region: ModerationStatusLimited,
	// ModerationStatusAgeRestricted, ModerationStatusBlocked or ModerationStatusPurged.
	Status   string `json:"status"`
	Rule     string `json:"rule"`
	Category string `json:"category,omitempty"`
}

// Processing feature stages. Beta results may change shape.
const (
	FeatureStageBeta = "beta"
	FeatureStageGA   = "ga"
)

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
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status string `json:"status"`
	// Stage is FeatureStageBeta or FeatureStageGA.
	Stage string `json:"stage"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported or ReasonUnavailable.
	Reason  string           `json:"reason,omitempty"`
	QRCodes []DetectedQRCode `json:"qrCodes,omitempty"`
	Links   []DetectedLink   `json:"links,omitempty"`
}

// DetectedQRCode is a decoded QR code.
type DetectedQRCode struct {
	// Value is the text the QR code holds, such as a URL.
	Value string      `json:"value"`
	Box   BoundingBox `json:"box"`
}

// DetectedLink is a web link found in an image.
type DetectedLink struct {
	// URL is the link, with https:// added when the image left it out.
	URL string `json:"url"`
	// Source is "qr-code" or "text" (found in the text OCR extracted).
	Source string `json:"source"`
}

// Link safety verdicts of CheckedLink.Verdict (preview): LinkVerdictSafe when every reputation
// check passed, LinkVerdictAdult or LinkVerdictGambling from the domain's content categories,
// LinkVerdictPhishing or LinkVerdictMalware from a threat list or the domain's security risks,
// and LinkVerdictUnresolved when a short link or redirect chain could not be followed or a check
// failed. Every address on a link's way is checked, and the most severe verdict is the link's.
// Verdict is a plain string so verdicts added later still decode.
const (
	LinkVerdictSafe       = "safe"
	LinkVerdictAdult      = "adult"
	LinkVerdictGambling   = "gambling"
	LinkVerdictPhishing   = "phishing"
	LinkVerdictMalware    = "malware"
	LinkVerdictUnresolved = "unresolved"
)

// Link safety checks of LinkSafetyEvidence.Check (preview). Check is a plain string so checks
// added later still decode.
const (
	// LinkCheckDomainCategories looks up the domain categories of every address on the way.
	LinkCheckDomainCategories = "domain-categories"
	// LinkCheckThreatLists looks up every URL on the way in threat lists.
	LinkCheckThreatLists = "threat-lists"
)

// Values of LinkSafetyEvidence.Status (preview).
const (
	LinkCheckStatusChecked = "checked"
	// LinkCheckStatusFailed is a check that could not answer, which makes the link
	// LinkVerdictUnresolved.
	LinkCheckStatusFailed = "failed"
)

// LinkSafetyResult (preview) is the result of link safety: every link found in the asset, where
// it leads and its verdict.
type LinkSafetyResult struct {
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status string `json:"status"`
	// Stage is FeatureStageBeta or FeatureStageGA.
	Stage string `json:"stage"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported or ReasonUnavailable.
	Reason string        `json:"reason,omitempty"`
	Links  []CheckedLink `json:"links,omitempty"`
}

// CheckedLink (preview) is a link in the asset and what its destination is.
type CheckedLink struct {
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
	Verdict  string               `json:"verdict"`
	Evidence []LinkSafetyEvidence `json:"evidence"`
}

// LinkSafetyEvidence (preview) is one reputation check of a link, every address it redirects
// through and its destination.
type LinkSafetyEvidence struct {
	// Check is LinkCheckDomainCategories or LinkCheckThreatLists.
	Check string `json:"check"`
	// Status is LinkCheckStatusChecked or LinkCheckStatusFailed.
	Status string `json:"status"`
	// Labels are what the check reported for any of the addresses, such as the domains' content
	// categories and security risks or the threat types listed.
	Labels []string `json:"labels"`
}

// AIGeneratedDetectionResult is what an image's provenance metadata says about AI use.
type AIGeneratedDetectionResult struct {
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status string `json:"status"`
	// Stage is FeatureStageBeta or FeatureStageGA.
	Stage string `json:"stage"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported or ReasonUnavailable.
	Reason string `json:"reason,omitempty"`
	// Provenance is "ai-generated", "ai-edited" or "unknown" (no AI provenance in the file,
	// which does not mean a person made it).
	Provenance string             `json:"provenance,omitempty"`
	Signals    []ProvenanceSignal `json:"signals,omitempty"`
}

// ProvenanceSignal is provenance metadata found in an image file.
type ProvenanceSignal struct {
	// Kind is "c2pa", "iptc-digital-source-type" or "generator-metadata".
	Kind string `json:"kind"`
	// Value is what it says, such as the digital source type or the generator's name.
	Value string `json:"value"`
}

// TextRegion is where OCR found text in an image.
type TextRegion struct {
	Box BoundingBox `json:"box"`
	// PersonalInformation reports whether the region is personal information, such as an email
	// address, phone number or card number, rather than a paragraph of text.
	PersonalInformation bool `json:"personalInformation"`
}

// PersonDetectionResult is the result of person detection (preview).
type PersonDetectionResult struct {
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status string `json:"status"`
	// Stage is FeatureStageBeta or FeatureStageGA.
	Stage string `json:"stage"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported or ReasonUnavailable.
	Reason string           `json:"reason,omitempty"`
	People []DetectedPerson `json:"people,omitempty"`
}

// FaceDetectionResult is the result of face detection (preview).
type FaceDetectionResult struct {
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status string `json:"status"`
	// Stage is FeatureStageBeta or FeatureStageGA.
	Stage string `json:"stage"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported or ReasonUnavailable.
	Reason string         `json:"reason,omitempty"`
	Faces  []DetectedFace `json:"faces,omitempty"`
}

// DetectedPerson is a person located in an image.
type DetectedPerson struct {
	Box BoundingBox `json:"box"`
	// Confidence is the detection confidence from 0 to 1.
	Confidence float64 `json:"confidence"`
}

// DetectedFace is a face located in an image.
type DetectedFace struct {
	Box BoundingBox `json:"box"`
	// Confidence is the detection confidence from 0 to 1.
	Confidence float64 `json:"confidence"`
	// AgeRange is set when the request asked for age estimation.
	AgeRange *AgeRange `json:"ageRange,omitempty"`
}

// BoundingBox is a position and size as fractions of the image width and height, from 0 to 1.
type BoundingBox struct {
	Left   float64 `json:"left"`
	Top    float64 `json:"top"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// AgeRange is an estimated age range in years. Estimates can be off by several years.
type AgeRange struct {
	Low  int `json:"low"`
	High int `json:"high"`
}

// Media segment sources. Source is a plain string so sources added later still decode.
const (
	SegmentSourceFrame     = "frame"
	SegmentSourceSpeech    = "speech"
	SegmentSourceFrameText = "frame-text"
	SegmentSourceClip      = "clip"
)

// MediaClassificationSegment is one analysed time range of audio or video.
type MediaClassificationSegment struct {
	// Source is one of the SegmentSource constants.
	Source       string                    `json:"source"`
	StartSeconds float64                   `json:"startSeconds"`
	EndSeconds   float64                   `json:"endSeconds"`
	Categories   map[string]CategoryResult `json:"categories"`
}

// Moderation categories, the keys of ClassificationReport.Categories. Categories added
// later still decode under their own keys.
const (
	CategoryPersonalInformation = "personal-information"
	CategoryProfanity           = "profanity"
	CategorySexual              = "sexual"
	CategoryViolence            = "violence"
	CategorySelfHarm            = "self-harm"
	CategoryHarassment          = "harassment"
	CategoryHate                = "hate"
	CategoryCriminalActivity    = "criminal-activity"
)

// Result status values of categories, qualifiers and processing features. Status is a plain
// string so values added later still decode.
const (
	ResultEvaluated    = "evaluated"
	ResultPartial      = "partial"
	ResultNotEvaluated = "not-evaluated"
)

// Reasons for a ResultNotEvaluated result.
const (
	// ReasonNotSupported means this processing path cannot assess the signal.
	ReasonNotSupported = "not-supported"
	// ReasonUnavailable means assessment was attempted but produced no usable result.
	ReasonUnavailable = "unavailable"
)

// Likelihood values, from least to most likely.
const (
	LikelihoodVeryUnlikely = "very-unlikely"
	LikelihoodUnlikely     = "unlikely"
	LikelihoodPossible     = "possible"
	LikelihoodLikely       = "likely"
	LikelihoodVeryLikely   = "very-likely"
)

// CategoryResult is the result for one moderation category.
type CategoryResult struct {
	// Status is ResultEvaluated, ResultPartial or ResultNotEvaluated; other values may be added.
	Status string `json:"status"`
	// Score is nil when coverage is unknown; never treat absence as a safe zero.
	Score *float64 `json:"score"`
	// Likelihood is one of the Likelihood constants; empty when not evaluated.
	Likelihood string `json:"likelihood"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported or ReasonUnavailable.
	Reason string `json:"reason"`
	// Qualifiers holds results for the category's qualifiers, keyed by a Qualifier constant.
	Qualifiers map[string]QualifierResult `json:"qualifiers"`
	// Raw contains the entire category result.
	Raw JSON `json:"-"`
}

// QualifierResult is the result for one qualifier of a category, such as QualifierSexualNudity.
type QualifierResult struct {
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status string `json:"status"`
	// SomeScore is the confidence that some of the content is this qualifier, from 0 to 1; nil
	// when not evaluated.
	SomeScore *float64 `json:"someScore,omitempty"`
	// AllScore is the confidence that the content is only this qualifier, from 0 to 1. It
	// never exceeds SomeScore.
	AllScore *float64 `json:"allScore,omitempty"`
	// Likelihood is one of the Likelihood constants; empty when not evaluated.
	Likelihood string `json:"likelihood,omitempty"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported or ReasonUnavailable.
	Reason string `json:"reason,omitempty"`
}

// Order directions.
const (
	OrderAscending  = "asc"
	OrderDescending = "desc"
)

// Order sorts a list by Field in Direction (OrderAscending or OrderDescending).
type Order struct {
	Field     string `json:"field"`
	Direction string `json:"direction"`
}

// ListAssetsOptions selects a page of assets. Filter is an RSQL expression over the asset's
// fields, with nested fields by path, such as "classification.moderation.status==allowed;content.format==image/png".
type ListAssetsOptions struct {
	Cursor   string  `json:"cursor,omitempty"`
	PageSize int     `json:"pageSize,omitempty"`
	Ordering []Order `json:"ordering,omitempty"`
	Filter   *string `json:"filter,omitempty"`
	FolderID *string `json:"folderId,omitempty"`
}

// AssetPage is one page of assets.
type AssetPage struct {
	Items      []Asset `json:"items"`
	HasMore    bool    `json:"hasMore"`
	NextCursor string  `json:"nextCursor"`
	PageSize   int     `json:"pageSize"`
	Ordering   []Order `json:"ordering"`
}

// AssetIDOptions identifies an asset.
type AssetIDOptions struct {
	AssetID string
}

// DecideAssetOptions records a reviewer's decision with AssetsService.Decide. Decision is
// ModerationStatusAllowed, ...Limited, ...AgeRestricted, ...Blocked or ...Purged; Note (1 to
// 1499 characters after trimming) says why and joins the asset's review history. Purging
// permanently deletes the stored content, so it needs ConfirmPurge.
type DecideAssetOptions struct {
	AssetID      string `json:"-"`
	Decision     string `json:"decision"`
	Note         string `json:"note"`
	ConfirmPurge bool   `json:"confirmPurge,omitempty"`
}

// ExplainAssetOptions selects the asset AssetsService.Explain explains. Rerun moderates it again
// with the project's current policy instead of explaining the decision as made.
type ExplainAssetOptions struct {
	AssetID string
	Rerun   bool
}

// WaitForDecisionOptions selects the asset AssetsService.WaitForDecision waits for.
type WaitForDecisionOptions struct {
	AssetID string
	// Timeout is how long to wait for a decision: nil means DefaultDecisionTimeout, zero checks
	// once and negative values are rejected.
	Timeout *time.Duration
}

// ListAssetChildrenOptions selects a page of an asset's children.
type ListAssetChildrenOptions struct {
	AssetID  string
	Cursor   string
	PageSize int
	Ordering []Order
}

// ListAssetTimelineOptions selects a page of an audio or video asset's findings timeline.
type ListAssetTimelineOptions struct {
	AssetID  string
	Cursor   string
	PageSize int
}

// AssetTimelinePage is one page of an audio or video asset's findings timeline, in time order.
type AssetTimelinePage struct {
	Items      []MediaClassificationSegment `json:"items"`
	HasMore    bool                         `json:"hasMore"`
	NextCursor string                       `json:"nextCursor"`
	PageSize   int                          `json:"pageSize"`
	Ordering   []Order                      `json:"ordering"`
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
	Visibility string         `json:"visibility,omitempty"`
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
	// UploadPresetID applies an upload preset: its folder, visibility, file types and size
	// limit apply to the upload.
	UploadPresetID *string `json:"uploadPresetId,omitempty"`
	// TotalSizeInBytes declares the size of the whole file when starting a multipart upload
	// (Part), so CalmLens can reject an upload that could never complete before storing it.
	TotalSizeInBytes *int64 `json:"totalSizeInBytes,omitempty"`
	// IdempotencyKey is sent as the Idempotency-Key header. When empty the SDK generates one
	// per call and reuses it for its own retries. Set it to retry safely across processes.
	IdempotencyKey string `json:"-"`
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
	Visibility Patch[string] `json:"visibility"`
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
	// Queue overrides, for this upload, the queue mode chosen when the upload started. Leave
	// it nil to use the saved choice.
	Queue *bool
	// IdempotencyKey is sent as the Idempotency-Key header; see SubmitAssetOptions.
	IdempotencyKey string
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
}

// BatchStatusQueued is BatchAssetsResponse.Status once a batch operation is queued.
const BatchStatusQueued = "queued"

// BatchAssetsResponse confirms that a batch operation is queued. BatchID names the batch: the
// asset.deleted and asset.content-removed events it causes carry it as their FactBatchID fact.
type BatchAssetsResponse struct {
	BatchID string `json:"batchId"`
	// Status is BatchStatusQueued.
	Status string `json:"status"`
	// AssetCount is the number of distinct assets the operation runs on.
	AssetCount int `json:"assetCount"`
}

// MoveAssetOptions moves an asset; a nil FolderID moves it to the root.
type MoveAssetOptions struct {
	AssetID  string
	FolderID *string
}

// CDN resources.
const (
	// ResourceOriginal is the asset's original file. It takes no Lens, Transform or TransformOptions.
	ResourceOriginal = "original"
	// ResourceRendered is the default: the asset's displayable file (an image in the best format
	// the client accepts, a PDF, or browser-safe video or audio). It takes a Lens, Transform or
	// TransformOptions only when it is an image; the CDN refuses them otherwise with
	// transform/invalid.
	ResourceRendered = "rendered"
	// ResourcePreview is a still image that stands for the asset, such as a document's first page
	// or an audio waveform. It takes a Lens, Transform or TransformOptions.
	ResourcePreview = "preview"
	// ResourcePlaceholder is a small blurred PNG, public for every asset whatever its visibility
	// or moderation status. It takes no Lens, Transform or TransformOptions, and needs no age confirmation.
	ResourcePlaceholder = "placeholder"
)

// SignedCDNResources are the CDN resources a signed URL can be created for.
var SignedCDNResources = []string{ResourceOriginal, ResourceRendered, ResourcePreview}

// SignedURLOptions requests a signed CDN URL. Resource is one of SignedCDNResources:
// ResourceRendered (the server's default when empty), ResourcePreview or ResourceOriginal, which
// takes no lens or transform. ExpiresInSeconds
// defaults to 900. Transform (options such as "format=png,width=1024") or TransformOptions
// (ImageTransformOptions, serialized to the same selector) applies in one pass; with a Lens, its
// options replace the lens's. Supply only one transform representation.
type SignedURLOptions struct {
	ViewerClaims     *ViewerClaims `json:"viewerClaims,omitempty"`
	AssetID          string        `json:"-"`
	Resource         string        `json:"resource,omitempty"`
	Lens             string        `json:"lens,omitempty"`
	Transform        string        `json:"transform,omitempty"`
	TransformOptions any           `json:"-"`
	ExpiresInSeconds int           `json:"expiresInSeconds"`
}

// SignedURL is a signed CDN URL and its expiry in unix milliseconds.
type SignedURL struct {
	URL       string `json:"url"`
	ExpiresAt int64  `json:"expiresAt"`
}

// Folder is an asset folder.
type Folder struct {
	ID        string  `json:"id"`
	ProjectID string  `json:"projectId"`
	ParentID  *string `json:"parentId"`
	Name      string  `json:"name"`
	CreatedAt int64   `json:"createdAt"`
	UpdatedAt *int64  `json:"updatedAt"`
}

// FolderIDOptions identifies a folder.
type FolderIDOptions struct{ FolderID string }

// CreateFolderOptions creates a folder, optionally inside ParentID.
type CreateFolderOptions struct {
	Name     string  `json:"name"`
	ParentID *string `json:"parentId,omitempty"`
}

// UpdateFolderOptions renames a folder.
type UpdateFolderOptions struct {
	FolderID string  `json:"-"`
	Name     *string `json:"name,omitempty"`
}

// MoveFolderOptions moves a folder; a nil ParentID moves it to the root.
type MoveFolderOptions struct {
	FolderID string
	ParentID *string
}

// Hash list actions: what a match against the list does. Action is a plain string so actions
// added later still decode.
const (
	// HashListActionFlag records matches on the asset.
	HashListActionFlag = "flag"
	// HashListActionBlock also blocks close matches.
	HashListActionBlock = "block"
)

// HashList holds perceptual (PDQ) hashes of images the project never wants again. Image uploads
// are compared with every list in the project.
type HashList struct {
	ID          string  `json:"id"`
	ProjectID   string  `json:"projectId"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	// Action is HashListActionFlag or HashListActionBlock.
	Action    string `json:"action"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt *int64 `json:"updatedAt"`
}

// HashListEntry is one hash in a hash list.
type HashListEntry struct {
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
}

// HashListPage is one page of a project's hash lists, newest first.
type HashListPage struct {
	Items      []HashList `json:"items"`
	HasMore    bool       `json:"hasMore"`
	NextCursor string     `json:"nextCursor"`
	PageSize   int        `json:"pageSize"`
	Ordering   []Order    `json:"ordering"`
}

// HashListEntryPage is one page of a hash list's entries, newest first.
type HashListEntryPage struct {
	Items      []HashListEntry `json:"items"`
	HasMore    bool            `json:"hasMore"`
	NextCursor string          `json:"nextCursor"`
	PageSize   int             `json:"pageSize"`
	Ordering   []Order         `json:"ordering"`
}

// ListHashListsOptions selects a page of a project's hash lists. Cursor is the previous page's
// NextCursor; PageSize is 1 to 100 (0 for the API's default of 50).
type ListHashListsOptions struct {
	Cursor   string `json:"cursor,omitempty"`
	PageSize int    `json:"pageSize,omitempty"`
}

// HashListIDOptions identifies a hash list.
type HashListIDOptions struct{ HashListID string }

// HashListEntryIDOptions identifies a hash list entry.
type HashListEntryIDOptions struct{ EntryID string }

// CreateHashListOptions creates a hash list. Action is HashListActionFlag or
// HashListActionBlock.
type CreateHashListOptions struct {
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	Action      string  `json:"action"`
}

// UpdateHashListOptions renames a hash list or changes what its matches do. Fields left unset
// are unchanged; Description: calmlens.Null[string]() clears the description. A new Action
// applies to later uploads.
type UpdateHashListOptions struct {
	HashListID  string        `json:"hashListId"`
	Name        *string       `json:"name"`
	Description Patch[string] `json:"description"`
	Action      *string       `json:"action"`
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

// ListHashListEntriesOptions selects a page of a hash list's entries.
type ListHashListEntriesOptions struct {
	HashListID string
	Cursor     string
	PageSize   int
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

// Lens types: the asset type a lens applies to.
const (
	LensTypeImage    = "image"
	LensTypeVideo    = "video"
	LensTypeAudio    = "audio"
	LensTypeDocument = "document"
	LensTypeWebsite  = "website"
)

// EnsureLensOptions is a lens definition.
type EnsureLensOptions struct {
	// Identifier is used in CDN URLs after "@": lowercase letters, numbers and hyphens.
	Identifier  string  `json:"identifier"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	// Type is one of the LensType constants.
	Type   string `json:"type"`
	Active bool   `json:"active"`
	// Transform holds the options, applied in one pass, that produce the derived asset:
	// ImageTransformOptions, or any other value that encodes as a JSON object with the same
	// option names. Lenses decoded from the API hold map[string]any with json.Number numbers.
	Transform any `json:"transform"`
	// Version must increase on every change; it is part of the CDN cache key.
	Version int `json:"version"`
}

// EnsureLensesOptions is a batch of lens definitions.
type EnsureLensesOptions struct {
	Lenses []EnsureLensOptions `json:"lenses"`
}

// Lens is a stored lens.
type Lens struct {
	EnsureLensOptions
	ID        string  `json:"id"`
	ProjectID *string `json:"projectId"`
	CreatedAt int64   `json:"createdAt"`
	UpdatedAt *int64  `json:"updatedAt"`
}

// Values of Actor.Type. Type is a plain string so values added later still decode.
const (
	// ActorUser is a person in the portal, or an assistant acting for one.
	ActorUser = "user"
	// ActorAPIKey is an API key of its own.
	ActorAPIKey = "api-key"
	// ActorAutomated is automated moderation.
	ActorAutomated = "automated"
	// ActorSystem is CalmLens itself, such as when it pauses uploads.
	ActorSystem = "system"
)

// Actor is who caused an event.
type Actor struct {
	// Type is ActorUser, ActorAPIKey, ActorAutomated or ActorSystem.
	Type string `json:"type"`
	// ID is the user's or API key's ID; nil for ActorAutomated and ActorSystem, and when the ID
	// was not recorded.
	ID *string `json:"id"`
}

// Event is an entry in the project event feed, in the shape Events.List returns and webhook
// connectors deliver.
type Event struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	// Actor is who caused the event.
	Actor Actor `json:"actor"`
	// Type is one of the EventType constants.
	Type string `json:"type"`
	// Severity is SeverityLow or SeverityHigh.
	Severity    string  `json:"severity"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	AssetID     *string `json:"assetId"`
	// AssetSequence increases with each event about the asset; nil for events not about an
	// asset. Deliveries can arrive out of order: see IsNewerAssetEvent.
	AssetSequence *int64      `json:"assetSequence"`
	Asset         *EventAsset `json:"asset"`
	Facts         EventFacts  `json:"facts"`
	CreatedAt     int64       `json:"createdAt"`
	// Raw contains the entire event, including fields added to the API after this SDK.
	Raw JSON `json:"-"`
}

// ListEventsOptions reads events after Cursor, a previous page's NextCursor. Without Cursor,
// the response is empty and its NextCursor marks "now". PageSize is 1 to 100 (0 for the
// API's default of 50). Types (EventType constants) and AssetID narrow the feed to those event
// types or one asset's events. A cursor belongs to the filters it was issued with, so pass the
// same Types and AssetID with each Cursor.
type ListEventsOptions struct {
	Cursor   string   `json:"cursor,omitempty"`
	PageSize int      `json:"pageSize,omitempty"`
	Types    []string `json:"types,omitempty"`
	AssetID  string   `json:"assetId,omitempty"`
}

// EventsPage is one page of the event feed, oldest first. Unlike other pages, NextCursor is
// never empty: keep it to poll for later events.
type EventsPage struct {
	Items      []Event `json:"items"`
	NextCursor string  `json:"nextCursor"`
	HasMore    bool    `json:"hasMore"`
	// ExcludedTypes are the event types (EventType constants) this feed never includes, because
	// the API key lacks the permission to see them. Give the key that permission to receive them.
	ExcludedTypes []string `json:"excludedTypes"`
}

// CDNAssetURLOptions identifies CDN content. AssetIdentifier is an asset ID or external
// ID; Resource is "rendered" (default), "original" or "placeholder". Only "rendered" takes a
// lens or transform, applied in one pass; transform options replace the lens's same-named
// options. Supply Transform (options such as "format=png,width=1024") or TransformOptions
// (ImageTransformOptions, or any value that encodes as a JSON object with the same option
// names; one with no options is rejected), not both.
type CDNAssetURLOptions struct {
	ViewerClaims     *ViewerClaims
	AssetIdentifier  string
	Resource         string
	Lens             string
	Transform        string
	TransformOptions any
	// ViewerClaims with AgeConfirmed pointing to true appends a viewerClaims query parameter
	// containing {"ageConfirmed":true}. The CDN requires it before it serves an asset whose
	// moderation status is age-restricted, even with a signed URL or an API key. Set it only
	// where your app has already decided the viewer may see age-restricted content. Your
	// platform confirms the viewer's age; CalmLens does not verify this claim, and anyone can add
	// it to a public URL. To control who loads an age-restricted asset, make it private and sign
	// the claim into a signed URL.
}

// CDNServeOptions fetches CDN content with an optional method and extra headers (such as
// Range).
type CDNServeOptions struct {
	CDNAssetURLOptions
	Method  string
	Headers http.Header
}

// Ptr conveniently supplies optional scalar fields.
func Ptr[T any](value T) *T { return &value }

// ClassifyTextOptions moderates plain text. Name defaults to "text".
type ClassifyTextOptions struct {
	Text              string
	Name              string
	Description       *string
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
	// IdempotencyKey is sent as the Idempotency-Key header; see SubmitAssetOptions.
	IdempotencyKey string `json:"-"`
}

// Search modes.
const (
	SearchModeKeyword  = "keyword"
	SearchModeSemantic = "semantic"
	SearchModeHybrid   = "hybrid"
)

// Semantic search status values of AssetSearchResponse.SemanticStatus.
const (
	SemanticStatusDisabled    = "disabled"
	SemanticStatusReady       = "ready"
	SemanticStatusIndexing    = "indexing"
	SemanticStatusUnavailable = "unavailable"
)

// Matched fields of AssetSearchMatch.MatchedFields. Fields added later still decode.
const (
	MatchedFieldName             = "name"
	MatchedFieldID               = "id"
	MatchedFieldExternalID       = "externalId"
	MatchedFieldDescription      = "description"
	MatchedFieldTags             = "tags"
	MatchedFieldType             = "type"
	MatchedFieldContentFormat    = "content.format"
	MatchedFieldContentExtension = "content.extension"
	MatchedFieldModerationStatus = "classification.moderation.status"
	MatchedFieldVisual           = "visual"
	MatchedFieldTranscript       = "transcript"
)

// SearchAssetsOptions searches assets. Mode is one of the SearchMode constants (default
// SearchModeHybrid).
type SearchAssetsOptions struct {
	Query string `json:"query"`
	Mode  string `json:"mode,omitempty"`
	Limit int    `json:"limit,omitempty"`
}

// AssetSearchMatch is one search result.
type AssetSearchMatch struct {
	Asset         Asset    `json:"asset"`
	Score         float64  `json:"score"`
	MatchedFields []string `json:"matchedFields"`
}

// AssetSearchResponse holds search results. SemanticStatus is one of the SemanticStatus
// constants.
type AssetSearchResponse struct {
	Query          string             `json:"query"`
	Items          []AssetSearchMatch `json:"items"`
	SemanticStatus string             `json:"semanticStatus"`
}

// withRaw decodes data into plain and also keeps the whole object in raw.
func withRaw(data []byte, plain any, raw *JSON) error {
	if err := decodeJSON(data, plain); err != nil {
		return err
	}
	if string(data) == "null" {
		return nil
	}
	return decodeJSON(data, raw)
}

// UnmarshalJSON decodes the asset and keeps every field in Raw.
func (a *Asset) UnmarshalJSON(data []byte) error {
	type plain Asset
	return withRaw(data, (*plain)(a), &a.Raw)
}

// UnmarshalJSON decodes moderation and keeps every field in Extra.
func (r *AssetModeration) UnmarshalJSON(data []byte) error {
	type plain AssetModeration
	return withRaw(data, (*plain)(r), &r.Extra)
}

// UnmarshalJSON decodes the category result and keeps every field in Raw.
func (r *CategoryResult) UnmarshalJSON(data []byte) error {
	type plain CategoryResult
	return withRaw(data, (*plain)(r), &r.Raw)
}

// UnmarshalJSON decodes the event and keeps every field in Raw.
func (e *Event) UnmarshalJSON(data []byte) error {
	type plain Event
	return withRaw(data, (*plain)(e), &e.Raw)
}

var _ json.Unmarshaler = (*Asset)(nil)

// ListFoldersOptions selects a page of immediate children or searches folder names. Cursor is
// the previous page's NextCursor; PageSize is 1 to 100 (0 for the API's default of 50).
// Ordering holds at most one Order, by "name" (the default, ascending) or "createdAt".
type ListFoldersOptions struct {
	ParentID *string `json:"parentId,omitempty"`
	Cursor   string  `json:"cursor,omitempty"`
	PageSize int     `json:"pageSize,omitempty"`
	Ordering []Order `json:"ordering,omitempty"`
	Search   string  `json:"search,omitempty"`
}

// FolderPage is one page of folders, with the folders above the listed or requested ones in
// Ancestors.
type FolderPage struct {
	Items      []Folder `json:"items"`
	Ancestors  []Folder `json:"ancestors"`
	HasMore    bool     `json:"hasMore"`
	NextCursor string   `json:"nextCursor"`
	PageSize   int      `json:"pageSize"`
	Ordering   []Order  `json:"ordering"`
}

// ViewerClaims are optional customer assertions. Age confirmation defaults to false.
//
// AgeConfirmed is your platform's confirmation that the viewer passed its age check. Your
// platform confirms the viewer's age; CalmLens does not verify this claim. Anyone requesting a
// public asset's URL can set it, so it doesn't restrict access: to control who loads an
// age-restricted asset, make it private and include the claim in a signed URL, whose signature
// covers it.
type ViewerClaims struct {
	Region       string `json:"region,omitempty"`
	AgeConfirmed *bool  `json:"ageConfirmed,omitempty"`
}
