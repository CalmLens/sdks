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
// asset is in the pipeline. Status is a plain string so values added later still decode.
const (
	ClassificationStatusPending    = "pending"
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

// Policy action values of FlaggedContentPolicy.Action, CategoryPolicyScore.Action and policy
// rules. ReportPolicyDecision.Action is ModerationActionLimit, ModerationActionAgeRestrict,
// ModerationActionBlock or ModerationActionPurge, or nil when nothing was acted on.
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
	UserID   *string `json:"userId"`
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
	Context           *ModerationContext `json:"context"`
	Tags              []string           `json:"tags"`
	ProcessingOptions *ProcessingOptions `json:"processingOptions"`
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
	Status          string                 `json:"status"`
	UpdatedAt       *int64                 `json:"updatedAt"`
	CompletedAt     *int64                 `json:"completedAt"`
	Moderation      AssetModeration        `json:"moderation"`
	PersonDetection *PersonDetectionResult `json:"personDetection,omitempty"`
	FaceDetection   *FaceDetectionResult   `json:"faceDetection,omitempty"`
	// LinkDetection holds QR codes and web links found in the image.
	LinkDetection *LinkDetectionResult `json:"linkDetection,omitempty"`
	// AIGeneratedDetection holds what the image's provenance metadata says about AI use.
	AIGeneratedDetection *AIGeneratedDetectionResult `json:"aiGeneratedDetection,omitempty"`
	// TextRegions are where OCR found text, and personal information within it, in an image.
	// Redaction transforms (ImageRedaction) blur these regions.
	TextRegions []TextRegion          `json:"textRegions,omitempty"`
	Labels      []ClassificationLabel `json:"labels,omitempty"`
}

// AssetReview records one reviewer decision without erasing earlier reviews.
type AssetReview struct {
	ID string `json:"id"`
	// Decision is one of the ModerationDecision constants.
	Decision       string  `json:"decision"`
	Note           *string `json:"note"`
	ReviewerUserID *string `json:"reviewerUserId"`
	// ReviewerName is the reviewer's display name, when known.
	ReviewerName *string `json:"reviewerName,omitempty"`
	// ReviewerEmail is the reviewer's email address, when known.
	ReviewerEmail  *string `json:"reviewerEmail,omitempty"`
	ReviewedAt     int64   `json:"reviewedAt"`
	AppliedToAsset bool    `json:"appliedToAsset"`
}

// TestRegionalAction is a regional restriction supplied by an authenticated test input.
type TestRegionalAction struct {
	Region string `json:"region"`
	Action string `json:"action"`
}

// AssetModeration holds content-safety findings and the decision in force.
type AssetModeration struct {
	TestCategoryActions map[string]string    `json:"testCategoryActions,omitempty"`
	TestRegionalActions []TestRegionalAction `json:"testRegionalActions,omitempty"`
	ManualReviews       []AssetReview        `json:"manualReviews"`
	// Status is one of the ModerationStatus constants.
	Status     string                     `json:"status"`
	Categories map[string]CategoryResult  `json:"categories,omitempty"`
	Score      *float64                   `json:"score,omitempty"`
	Timeline   *MediaClassificationReport `json:"timeline,omitempty"`
	Policy     *ReportPolicy              `json:"policy,omitempty"`
	// HashMatches are the hash list entries the image matched, blocking matches first and then
	// the closest. Empty when nothing matched.
	HashMatches []HashMatch `json:"hashMatches,omitempty"`
	Raw         JSON        `json:"-"`
}

// HashMatchSourceHashList is the HashMatch.Source of a match against a project hash list.
// Source is a plain string so sources added later still decode.
const HashMatchSourceHashList = "hash-list"

// HashMatch is a hash list entry an image matched.
type HashMatch struct {
	// Source is where the matching hash came from, such as HashMatchSourceHashList.
	Source  string `json:"source"`
	ListID  string `json:"listId"`
	EntryID string `json:"entryId"`
	// Distance is the number of bits that differ between the hashes; 0 is the same picture.
	Distance int `json:"distance"`
	// Action is what this match did: HashListActionBlock when it was close enough for a block
	// list to block, otherwise HashListActionFlag.
	Action string `json:"action"`
}

// AssetContent describes an asset's content: its format and properties, and whether CalmLens
// holds it.
type AssetContent struct {
	SafetyTest *bool `json:"safetyTest,omitempty"`
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
	// Image is the picture CalmLens serves at the rendered resource, nil when the asset has none.
	Image         *AssetImage    `json:"image"`
	ExtractedText *ExtractedText `json:"extractedText"`
}

// Checksums holds digests of the uploaded content. Each is nil when not computed.
type Checksums struct {
	MD5    *string `json:"md5,omitempty"`
	SHA1   *string `json:"sha1,omitempty"`
	SHA256 *string `json:"sha256,omitempty"`
	SHA384 *string `json:"sha384,omitempty"`
	SHA512 *string `json:"sha512,omitempty"`
}

// AssetImage is the picture CalmLens can show for an asset: the original for image assets, or a
// generated image for documents and websites. It remains after the content is removed, so check
// Content.Status before loading it.
type AssetImage struct {
	// Width and Height are in pixels: the original's for image assets (a converted HEIC is served
	// smaller at the same aspect ratio), and the generated image's for documents and websites.
	Width  *int `json:"width"`
	Height *int `json:"height"`
	// Thumbhash is a ThumbHash placeholder to render while the image loads; nil once it is removed.
	Thumbhash *string `json:"thumbhash"`
	// AverageColor is the image's average colour; nil once it is removed.
	AverageColor *string `json:"averageColor"`
	// PerceptualHash matches visually similar images, for image assets.
	PerceptualHash *string `json:"perceptualHash"`
	// PerceptualHashQuality is how much detail PerceptualHash captured, from 0 to 100. Hashes
	// below 50 come from flat or featureless images and match less reliably.
	PerceptualHashQuality *int `json:"perceptualHashQuality"`
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

// ProcessingOptions changes how one upload is processed. Unset (nil) fields are omitted
// from the request and use the project defaults.
type ProcessingOptions struct {
	// KeepContentAfterProcessing keeps the content after processing (default false).
	KeepContentAfterProcessing *bool `json:"keepContentAfterProcessing,omitempty"`
	// FlaggedContentPolicy overrides the project moderation action for this asset.
	FlaggedContentPolicy *FlaggedContentPolicy `json:"flaggedContentPolicy,omitempty"`
	// Features turns on optional analyses. Every feature is off unless enabled here.
	Features *ProcessingFeatures `json:"features,omitempty"`
}

// FlaggedContentPolicy is what happens when the asset is flagged. Action is one of the
// ModerationAction constants: allow takes no action, limit delivers the asset normally but marks it
// so your app can reduce its reach, age-restrict delivers the asset only through signed URLs or
// API keys, block stops delivery while retaining content and purge deletes content.
type FlaggedContentPolicy struct {
	Action string `json:"action"`
}

// ProcessingFeatures holds the optional analyses to run, keyed by feature. A nil feature is
// not sent and stays off.
type ProcessingFeatures struct {
	// OCR stores extracted text on the image asset and adds text moderation.
	OCR *OCRFeatureOptions `json:"ocr,omitempty"`
	// PersonDetection (beta) locates people; results are in Report.Features.
	PersonDetection *PersonDetectionFeatureOptions `json:"personDetection,omitempty"`
	// FaceDetection (beta) locates faces; results are in Report.Features.
	FaceDetection *FaceDetectionFeatureOptions `json:"faceDetection,omitempty"`
	// LinkDetection finds QR codes and web links in images (free); results are in
	// AssetClassification.LinkDetection. With OCR on, links in the extracted text are listed too.
	LinkDetection *LinkDetectionFeatureOptions `json:"linkDetection,omitempty"`
}

// OCRFeatureOptions configures OCR.
type OCRFeatureOptions struct {
	Enabled bool `json:"enabled"`
}

// PersonDetectionFeatureOptions configures person detection (beta).
type PersonDetectionFeatureOptions struct {
	Enabled bool `json:"enabled"`
}

// LinkDetectionFeatureOptions configures link detection.
type LinkDetectionFeatureOptions struct {
	Enabled bool `json:"enabled"`
}

// FaceDetectionFeatureOptions configures face detection (beta).
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

// ReportPolicy holds each assessed category's policy score and action, and the highest score.
type ReportPolicy struct {
	Score      float64                        `json:"score"`
	Categories map[string]CategoryPolicyScore `json:"categories"`
	// Evidence is PolicyEvidenceDecision when questions that could not change any action were
	// skipped, and PolicyEvidenceFull (or empty) when every question was answered.
	// AssetsService.Explain completes it.
	Evidence string                `json:"evidence,omitempty"`
	Decision *ReportPolicyDecision `json:"decision,omitempty"`
}

// Values of ReportPolicy.Evidence.
const (
	// PolicyEvidenceDecision means every action is final, but a category's policy score and the
	// rule credited with its action can differ from a complete report.
	PolicyEvidenceDecision = "decision"
	// PolicyEvidenceFull means every question was answered.
	PolicyEvidenceFull = "full"
)

// CategoryPolicyScore is how strongly a category meets the policy, from 0 to 1, and the action
// the policy takes: allow, limit, age-restrict, block or purge.
type CategoryPolicyScore struct {
	Score    float64                         `json:"score"`
	Action   string                          `json:"action"`
	Source   *CategoryPolicySource           `json:"source,omitempty"`
	Settings *CategoryPolicySettingsSnapshot `json:"settings,omitempty"`
}

// CategoryPolicySource identifies the deciding rule, or that the policy score stayed below 50%.
type CategoryPolicySource struct {
	Kind    string `json:"kind"`
	Index   *int   `json:"index,omitempty"`
	Indexes []int  `json:"indexes,omitempty"`
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

// Values of ReportPolicyDecision.Source. Source is a plain string so sources added later
// still decode.
const (
	DecisionSourcePolicy        = "policy"
	DecisionSourceAssetOverride = "asset-override"
	DecisionSourceChildren      = "children"
	// DecisionSourceHashList is a block from a hash list match.
	DecisionSourceHashList      = "hash-list"
	DecisionSourceMandatoryRule = "mandatory-rule"
)

// ReportPolicyDecision records the automatic action and what triggered it.
type RegionalDecision struct {
	Region   string `json:"region"`
	Action   string `json:"action"`
	Rule     string `json:"rule"`
	Category string `json:"category,omitempty"`
}

type ReportPolicyDecision struct {
	Rule    *string            `json:"rule,omitempty"`
	Regions []RegionalDecision `json:"regions"`
	// Source is one of the DecisionSource constants.
	Source            string   `json:"source"`
	Action            *string  `json:"action"`
	FlaggedCategories []string `json:"flaggedCategories"`
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

// PersonDetectionResult is the result of person detection (beta).
type PersonDetectionResult struct {
	// Status is ResultEvaluated or ResultNotEvaluated; other values may be added.
	Status string `json:"status"`
	// Stage is FeatureStageBeta or FeatureStageGA.
	Stage string `json:"stage"`
	// Reason explains a ResultNotEvaluated result: ReasonNotSupported or ReasonUnavailable.
	Reason string           `json:"reason,omitempty"`
	People []DetectedPerson `json:"people,omitempty"`
}

// FaceDetectionResult is the result of face detection (beta).
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

// MediaClassificationReport describes audio and video analysis.
type MediaClassificationReport struct {
	DurationSeconds      float64                      `json:"durationSeconds"`
	FrameIntervalSeconds *float64                     `json:"frameIntervalSeconds,omitempty"`
	SampledFrames        int                          `json:"sampledFrames"`
	AudioTranscribed     bool                         `json:"audioTranscribed"`
	Segments             []MediaClassificationSegment `json:"segments"`
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
	// PolicyConditions contains assessed same-instance and collective-coverage conditions. Keys are opaque.
	PolicyConditions map[string]PolicyConditionResult `json:"policyConditions,omitempty"`
	// Raw contains the entire category result.
	Raw JSON `json:"-"`
}

// PolicyConditionResult carries either an evaluated score or an unassessed reason.
type PolicyConditionResult struct {
	Status string   `json:"status"`
	Score  *float64 `json:"score,omitempty"`
	Reason string   `json:"reason,omitempty"`
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

// ClassificationLabel is a descriptive label detected in the content.
type ClassificationLabel struct {
	Description     string   `json:"description"`
	Score           float64  `json:"score"`
	TopicalityScore *float64 `json:"topicalityScore,omitempty"`
	// Likelihood is one of the Likelihood constants.
	Likelihood      string  `json:"likelihood"`
	KnowledgeBaseID *string `json:"knowledgeBaseId,omitempty"`
}

// Order directions.
const (
	OrderAscending  = "ASC"
	OrderDescending = "DESC"
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

// BatchAssetsResponse confirms that a batch operation is queued.
type BatchAssetsResponse struct {
	Queued bool `json:"queued"`
}

// MoveAssetOptions moves an asset; a nil FolderID moves it to the root.
type MoveAssetOptions struct {
	AssetID  string
	FolderID *string
}

// CDN resources.
const (
	// ResourceOriginal is the asset's original file. It takes no Lens, Transform or TransformSteps.
	ResourceOriginal = "original"
	// ResourceRendered is the default: the asset rendered through a Lens, Transform or
	// TransformSteps, or its default rendition when none is given.
	ResourceRendered = "rendered"
	// ResourcePlaceholder is a small blurred PNG, public for every asset whatever its visibility
	// or moderation status. It takes no Lens, Transform or TransformSteps, and needs no age confirmation.
	ResourcePlaceholder = "placeholder"
)

// SignedURLOptions requests a signed CDN URL. Resource is ResourceRendered (the server's
// default when empty) or ResourceOriginal, which takes no lens or transform. ExpiresInSeconds
// defaults to 900. Lens runs before Transform (a selector string such as
// "format=png,width=1024") or TransformSteps (structured steps, serialized
// to the same selector). Supply only one transform representation.
type SignedURLOptions struct {
	ViewerClaims     *ViewerClaims   `json:"viewerClaims,omitempty"`
	AssetID          string          `json:"-"`
	Resource         string          `json:"resource,omitempty"`
	Lens             string          `json:"lens,omitempty"`
	Transform        string          `json:"transform,omitempty"`
	TransformSteps   []LensTransform `json:"-"`
	ExpiresInSeconds int             `json:"expiresInSeconds"`
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
	Action          string  `json:"action"`
	CreatedByUserID *string `json:"createdByUserId"`
	CreatedAt       int64   `json:"createdAt"`
	UpdatedAt       *int64  `json:"updatedAt"`
}

// HashListEntry is one hash in a hash list.
type HashListEntry struct {
	ID         string `json:"id"`
	ProjectID  string `json:"projectId"`
	HashListID string `json:"hashListId"`
	// Hash is the 256-bit PDQ hash as 64 hexadecimal characters.
	Hash string `json:"hash"`
	// Quality is the PDQ quality of Hash from 0 to 100, nil when unknown.
	Quality       *int    `json:"quality"`
	Label         *string `json:"label"`
	SourceAssetID *string `json:"sourceAssetId"`
	// CreatedByUserID is the portal user who added the entry, nil for API keys.
	CreatedByUserID *string `json:"createdByUserId"`
	CreatedAt       int64   `json:"createdAt"`
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
// NextCursor; PageSize is 1 to 100 (0 for the API's default of 10).
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
	// Transforms are applied in order to produce the derived asset.
	Transforms []LensTransform `json:"transforms"`
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
	UserID    *string `json:"userId"`
	CreatedAt int64   `json:"createdAt"`
	UpdatedAt *int64  `json:"updatedAt"`
}

// Event is an entry in the project event feed.
type Event struct {
	ID        string  `json:"id"`
	ProjectID string  `json:"projectId"`
	UserID    *string `json:"userId"`
	// Type is one of the EventType constants.
	Type string `json:"type"`
	// Severity is SeverityLow or SeverityHigh.
	Severity    string      `json:"severity"`
	Title       string      `json:"title"`
	Description *string     `json:"description"`
	AssetID     *string     `json:"assetId"`
	Asset       *EventAsset `json:"asset"`
	Facts       EventFacts  `json:"facts"`
	Notify      *bool       `json:"notify"`
	CreatedAt   int64       `json:"createdAt"`
	UpdatedAt   *int64      `json:"updatedAt"`
	ReadAt      *int64      `json:"readAt"`
	// Raw contains the entire event.
	Raw JSON `json:"-"`
}

// ListEventsOptions reads events after Cursor, a previous page's NextCursor. Without Cursor,
// the response is empty and its NextCursor marks "now". PageSize is 1 to 100 (0 for the
// API's default of 50).
type ListEventsOptions struct {
	Cursor   string `json:"cursor,omitempty"`
	PageSize int    `json:"pageSize,omitempty"`
}

// EventsPage is one page of the event feed, oldest first. Unlike other pages, NextCursor is
// never empty: keep it to poll for later events.
type EventsPage struct {
	Items      []Event `json:"items"`
	NextCursor string  `json:"nextCursor"`
	HasMore    bool    `json:"hasMore"`
}

// CDNAssetURLOptions identifies CDN content. AssetIdentifier is an asset ID or external
// ID; Resource is "rendered" (default), "original" or "placeholder". Only "rendered" takes a
// lens or transform; the Lens runs before extra transforms.
// Supply Transform (a selector string such as "format=png,width=1024")
// or TransformSteps (structured steps; a non-nil empty slice is rejected), not both.
type CDNAssetURLOptions struct {
	ViewerClaims    *ViewerClaims
	AssetIdentifier string
	Resource        string
	Lens            string
	Transform       string
	TransformSteps  []LensTransform
	// ViewerClaims with AgeConfirmed pointing to true appends a viewerClaims query parameter
	// containing {"ageConfirmed":true}. The CDN requires it before it serves an asset whose
	// moderation status is age-restricted, even with a signed URL or an API key. Set it only
	// where your app has already decided the viewer may see age-restricted content.
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

// UnmarshalJSON decodes the report and keeps every field in Raw.
func (r *AssetModeration) UnmarshalJSON(data []byte) error {
	type plain AssetModeration
	return withRaw(data, (*plain)(r), &r.Raw)
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
// the previous page's NextCursor; PageSize is 1 to 100 (0 for the API's default of 100).
// Ordering holds at most one Order, by "name" (the default, ascending) or "createdAt".
type ListFoldersOptions struct {
	ParentID    *string  `json:"parentId,omitempty"`
	Cursor      string   `json:"cursor,omitempty"`
	PageSize    int      `json:"pageSize,omitempty"`
	Ordering    []Order  `json:"ordering,omitempty"`
	Search      string   `json:"search,omitempty"`
	SearchAll   *bool    `json:"searchAll,omitempty"`
	IDs         []string `json:"ids,omitempty"`
	ResolveOnly *bool    `json:"resolveOnly,omitempty"`
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
type ViewerClaims struct {
	Region       string `json:"region,omitempty"`
	AgeConfirmed *bool  `json:"ageConfirmed,omitempty"`
}
