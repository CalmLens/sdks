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

// Processing status values of AssetProcessing.Status and EventAssetProcessing.Status: where the
// asset is in the pipeline. Status is a plain string so values added later still decode.
const (
	ProcessingStatusUploading  = "uploading"
	ProcessingStatusProcessing = "processing"
	ProcessingStatusDone       = "done"
	ProcessingStatusFailed     = "failed"
)

// Moderation status values of AssetModeration.Status and EventAssetModeration.Status: the
// decision in force. Status is a plain string so values added later still decode; handle
// unknown values as "not yet approved".
const (
	ModerationStatusPending  = "pending"
	ModerationStatusApproved = "approved"
	ModerationStatusRejected = "rejected"
)

// Reviewer action values of AssetModeration.ReviewerAction.
const (
	ReviewerActionApproved = "approved"
	ReviewerActionRejected = "rejected"
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

// Moderation action values. FlaggedContentPolicy.Action takes any of them; AssetModeration.Action,
// EventAssetModeration.Action and the moderation-action fact are ModerationActionAlert,
// ModerationActionHide or ModerationActionPurge (an ignored match leaves them nil).
const (
	ModerationActionIgnore = "ignore"
	ModerationActionAlert  = "alert"
	ModerationActionHide   = "hide"
	ModerationActionPurge  = "purge"
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
	UploadPresetID    *string            `json:"uploadPresetId"`
	CreatedAt         int64              `json:"createdAt"`
	UpdatedAt         *int64             `json:"updatedAt"`
	Description       *string            `json:"description"`
	ExternalID        *string            `json:"externalId"`
	ExternalURL       *string            `json:"externalUrl"`
	Metadata          []MetadataItem     `json:"metadata"`
	Tags              []string           `json:"tags"`
	ProcessingOptions *ProcessingOptions `json:"processingOptions"`
	// Visibility is VisibilityPrivate or VisibilityPublic.
	Visibility *string `json:"visibility"`
	// Processing is where the asset is in the pipeline.
	Processing AssetProcessing `json:"processing"`
	// Moderation is the moderation decision and report.
	Moderation AssetModeration `json:"moderation"`
	// Content describes the asset's content and whether CalmLens still holds it.
	Content AssetContent `json:"content"`
	// Raw contains the entire asset, including fields added to the API after this SDK.
	Raw JSON `json:"-"`
}

// AssetProcessing is the processing state of an asset.
type AssetProcessing struct {
	// Status is one of the ProcessingStatus constants.
	Status string `json:"status"`
	// UpdatedAt is when Status last changed, in unix milliseconds.
	UpdatedAt *int64 `json:"updatedAt"`
	// UploadPartsReceived is how many parts of a multipart upload have been received; nil
	// for other uploads.
	UploadPartsReceived *int `json:"uploadPartsReceived"`
}

// AssetModeration is the moderation state of an asset. Status is the decision in force: a
// reviewer's decision takes precedence over the automated one.
type AssetModeration struct {
	// Status is one of the ModerationStatus constants.
	Status string `json:"status"`
	// Action is what the policy did with flagged content (ModerationActionAlert,
	// ModerationActionHide or ModerationActionPurge), or nil when nothing was flagged. It is
	// kept after a reviewer decides.
	Action *string `json:"action"`
	// Note is why automated moderation rejected the asset.
	Note *string `json:"note"`
	// ReviewerAction is a reviewer's decision (a ReviewerAction constant), or nil when no
	// reviewer has decided.
	ReviewerAction *string `json:"reviewerAction"`
	ReviewerNote   *string `json:"reviewerNote"`
	ReviewerUserID *string `json:"reviewerUserId"`
	// ReviewedAt is when a reviewer decided, in unix milliseconds.
	ReviewedAt *int64 `json:"reviewedAt"`
	// DecidedAt is when the decision in force was made, in unix milliseconds.
	DecidedAt *int64 `json:"decidedAt"`
	// Report is the moderation report, set once classification finishes.
	Report *ClassificationReport `json:"report"`
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
	Extension     *string        `json:"extension"`
	SizeInBytes   *int64         `json:"sizeInBytes"`
	Checksums     *Checksums     `json:"checksums"`
	Image         *ImageData     `json:"image"`
	PreviewImage  *PreviewImage  `json:"previewImage"`
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

// ImageData holds image properties, for image assets.
type ImageData struct {
	// PerceptualHash matches visually similar images.
	PerceptualHash *string `json:"perceptualHash,omitempty"`
	// Width and Height are in pixels.
	Width  *int `json:"width,omitempty"`
	Height *int `json:"height,omitempty"`
}

// PreviewImage is the browser-friendly preview generated for images, documents and websites.
type PreviewImage struct {
	// FileFormat is the preview's file format, such as "webp".
	FileFormat *string `json:"fileFormat"`
	// Thumbhash is a ThumbHash placeholder to render while the preview loads.
	Thumbhash    *string `json:"thumbhash"`
	AverageColor *string `json:"averageColor"`
	// Width and Height are in pixels.
	Width  *int `json:"width"`
	Height *int `json:"height"`
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
// ModerationAction constants: ignore takes no action, alert keeps delivery enabled, hide
// blocks delivery while retaining content and purge deletes content.
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
}

// OCRFeatureOptions configures OCR.
type OCRFeatureOptions struct {
	Enabled bool `json:"enabled"`
}

// PersonDetectionFeatureOptions configures person detection (beta).
type PersonDetectionFeatureOptions struct {
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

// ClassificationReport is the moderation report of an asset.
type ClassificationReport struct {
	Media       *MediaClassificationReport `json:"media,omitempty"`
	ProcessedAt int64                      `json:"processedAt"`
	Score       float64                    `json:"score"`
	Notes       *string                    `json:"notes"`
	Labels      []ClassificationLabel      `json:"labels"`
	Categories  map[string]CategoryResult  `json:"categories"`
	// Features holds the results of the processing features the upload turned on.
	Features *ProcessingFeatureResults `json:"features,omitempty"`
	// Policy is what the project's policy made of the report when the asset was decided.
	Policy *ReportPolicy `json:"policy,omitempty"`
	// Raw contains the entire report, including provider-specific fields.
	Raw JSON `json:"-"`
}

// ReportPolicy holds each assessed category's policy score and action, and the highest score.
type ReportPolicy struct {
	Score      float64                        `json:"score"`
	Categories map[string]CategoryPolicyScore `json:"categories"`
}

// CategoryPolicyScore is how strongly a category meets the policy, from 0 to 1, and the action
// the policy takes: ignore, alert, hide or purge.
type CategoryPolicyScore struct {
	Score  float64 `json:"score"`
	Action string  `json:"action"`
}

// Processing feature stages. Beta results may change shape.
const (
	FeatureStageBeta = "beta"
	FeatureStageGA   = "ga"
)

// ProcessingFeatureResults holds the results of optional processing features, keyed by feature.
// A feature that wasn't requested is nil.
type ProcessingFeatureResults struct {
	PersonDetection *PersonDetectionResult `json:"personDetection,omitempty"`
	FaceDetection   *FaceDetectionResult   `json:"faceDetection,omitempty"`
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
	CategorySexual           = "sexual"
	CategoryViolence         = "violence"
	CategorySelfHarm         = "self-harm"
	CategoryHarassment       = "harassment"
	CategoryHate             = "hate"
	CategoryCriminalActivity = "criminal-activity"
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

// Qualifiers, the keys of CategoryResult.Qualifiers. Qualifiers added later still decode
// under their own keys.
const (
	QualifierSexualNudity                      = "sexual-nudity"
	QualifierSexualActivity                    = "sexual-activity"
	QualifierSexualExplicitLanguage            = "sexual-explicit-language"
	QualifierSexualSolicitation                = "sexual-solicitation"
	QualifierSexualRevealingClothing           = "sexual-revealing-clothing"
	QualifierSexualHistorical                  = "sexual-historical"
	QualifierSexualDocumentary                 = "sexual-documentary"
	QualifierSexualEducational                 = "sexual-educational"
	QualifierSexualFictional                   = "sexual-fictional"
	QualifierSexualSupportPrevention           = "sexual-support-prevention"
	QualifierViolenceAttack                    = "violence-attack"
	QualifierViolenceThreat                    = "violence-threat"
	QualifierViolencePreparation               = "violence-preparation"
	QualifierViolenceEncouragement             = "violence-encouragement"
	QualifierViolenceInjury                    = "violence-injury"
	QualifierViolenceViolentDeath              = "violence-violent-death"
	QualifierViolenceNaturalDeath              = "violence-natural-death"
	QualifierViolenceGraphic                   = "violence-graphic"
	QualifierViolenceWeapon                    = "violence-weapon"
	QualifierViolenceSport                     = "violence-sport"
	QualifierViolenceHistorical                = "violence-historical"
	QualifierViolenceDocumentary               = "violence-documentary"
	QualifierViolenceEducational               = "violence-educational"
	QualifierViolenceFictional                 = "violence-fictional"
	QualifierViolenceSupportPrevention         = "violence-support-prevention"
	QualifierSelfHarmThoughts                  = "self-harm-thoughts"
	QualifierSelfHarmPreparation               = "self-harm-preparation"
	QualifierSelfHarmAct                       = "self-harm-act"
	QualifierSelfHarmMethods                   = "self-harm-methods"
	QualifierSelfHarmEncouragement             = "self-harm-encouragement"
	QualifierSelfHarmDocumentary               = "self-harm-documentary"
	QualifierSelfHarmEducational               = "self-harm-educational"
	QualifierSelfHarmFictional                 = "self-harm-fictional"
	QualifierSelfHarmSupportPrevention         = "self-harm-support-prevention"
	QualifierHarassmentAbuse                   = "harassment-abuse"
	QualifierHarassmentIntimidation            = "harassment-intimidation"
	QualifierHarassmentThreat                  = "harassment-threat"
	QualifierHarassmentSexual                  = "harassment-sexual"
	QualifierHarassmentEncouragement           = "harassment-encouragement"
	QualifierHarassmentFictional               = "harassment-fictional"
	QualifierHarassmentSupportPrevention       = "harassment-support-prevention"
	QualifierHateAbuse                         = "hate-abuse"
	QualifierHateDehumanization                = "hate-dehumanization"
	QualifierHateInferiority                   = "hate-inferiority"
	QualifierHateExclusion                     = "hate-exclusion"
	QualifierHateThreat                        = "hate-threat"
	QualifierHateHistorical                    = "hate-historical"
	QualifierHateFictional                     = "hate-fictional"
	QualifierHateSupportPrevention             = "hate-support-prevention"
	QualifierCriminalActivityDemonstration     = "criminal-activity-demonstration"
	QualifierCriminalActivityPreparation       = "criminal-activity-preparation"
	QualifierCriminalActivityRequest           = "criminal-activity-request"
	QualifierCriminalActivityInstructions      = "criminal-activity-instructions"
	QualifierCriminalActivityPromotion         = "criminal-activity-promotion"
	QualifierCriminalActivitySubstances        = "criminal-activity-substances"
	QualifierCriminalActivityFraud             = "criminal-activity-fraud"
	QualifierCriminalActivityGraffiti          = "criminal-activity-graffiti"
	QualifierCriminalActivityFictional         = "criminal-activity-fictional"
	QualifierCriminalActivitySupportPrevention = "criminal-activity-support-prevention"
)

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
// fields, with nested fields by path, such as "moderation.status==approved;content.format==image/png".
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
type AssetIDOptions struct{ AssetID string }

// WaitForDecisionOptions selects the asset AssetsService.WaitForDecision waits for.
type WaitForDecisionOptions struct {
	AssetID string
	// Timeout is how long to wait for a decision. Zero means DefaultDecisionTimeout;
	// negative values are rejected.
	Timeout time.Duration
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

// SubmitAssetOptions describes an asset to create or moderate. Supply exactly one of
// Content, Part (first part of a multipart upload) or URL.
type SubmitAssetOptions struct {
	Name              string             `json:"name"`
	Content           *Content           `json:"-"`
	Part              *Content           `json:"-"`
	URL               string             `json:"url,omitempty"`
	Description       *string            `json:"description,omitempty"`
	ProcessingOptions *ProcessingOptions `json:"processingOptions,omitempty"`
	// Visibility is VisibilityPrivate (the default) or VisibilityPublic.
	Visibility  string         `json:"visibility,omitempty"`
	Metadata    []MetadataItem `json:"metadata,omitempty"`
	ExternalID  *string        `json:"externalId,omitempty"`
	ExternalURL *string        `json:"externalUrl,omitempty"`
	FolderID    *string        `json:"folderId,omitempty"`
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

// MoveAssetOptions moves an asset; a nil FolderID moves it to the root.
type MoveAssetOptions struct {
	AssetID  string
	FolderID *string
}

// CDN resources.
const (
	ResourceContent = "content"
	ResourcePreview = "preview"
)

// SignedURLOptions requests a signed CDN URL. Resource defaults to ResourceContent and
// ExpiresInSeconds to 900. Lens runs before Transform (a selector string such as
// "imageTransform[format=png,width=1024]") or TransformSteps (structured steps, serialized
// to the same selector). Supply only one transform representation.
type SignedURLOptions struct {
	AssetID          string          `json:"-"`
	Resource         string          `json:"resource"`
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

// ListEventsOptions reads events after a cursor. Without After, the response is empty
// and its cursor marks "now".
type ListEventsOptions struct {
	After string `json:"after,omitempty"`
	Limit int    `json:"limit,omitempty"`
}

// EventsPage is one page of the event feed.
type EventsPage struct {
	Events  []Event `json:"events"`
	Cursor  string  `json:"cursor,omitempty"`
	HasMore bool    `json:"hasMore"`
}

// CDNAssetURLOptions identifies CDN content. AssetIdentifier is an asset ID or external
// ID; Resource is "content" (default) or "preview". Lens runs before extra transforms.
// Supply Transform (a selector string such as "imageTransform[format=png,width=1024]")
// or TransformSteps (structured steps; a non-nil empty slice is rejected), not both.
type CDNAssetURLOptions struct {
	AssetIdentifier string
	Resource        string
	Lens            string
	Transform       string
	TransformSteps  []LensTransform
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

// ModerateTextOptions moderates plain text. Name defaults to "text".
type ModerateTextOptions struct {
	Text              string
	Name              string
	Description       *string
	ProcessingOptions *ProcessingOptions
	Metadata          []MetadataItem
	ExternalID        *string
	ExternalURL       *string
	FolderID          *string
	UploadPresetID    *string
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
	MatchedFieldModerationStatus = "moderation.status"
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
func (r *ClassificationReport) UnmarshalJSON(data []byte) error {
	type plain ClassificationReport
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
