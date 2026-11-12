package calmlens

// Every response model keeps its JSON: these decoders store it once in the embedded responseJSON.

func (m *AIGeneratedDetectionResult) UnmarshalJSON(data []byte) error {
	type plain AIGeneratedDetectionResult
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *Actor) UnmarshalJSON(data []byte) error {
	type plain Actor
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AgeRange) UnmarshalJSON(data []byte) error {
	type plain AgeRange
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *Asset) UnmarshalJSON(data []byte) error {
	type plain Asset
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetClassification) UnmarshalJSON(data []byte) error {
	type plain AssetClassification
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetContent) UnmarshalJSON(data []byte) error {
	type plain AssetContent
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetHls) UnmarshalJSON(data []byte) error {
	type plain AssetHls
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetHlsRendition) UnmarshalJSON(data []byte) error {
	type plain AssetHlsRendition
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetInfo) UnmarshalJSON(data []byte) error {
	type plain AssetInfo
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetInfoContent) UnmarshalJSON(data []byte) error {
	type plain AssetInfoContent
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetModeration) UnmarshalJSON(data []byte) error {
	type plain AssetModeration
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetPage) UnmarshalJSON(data []byte) error {
	type plain AssetPage
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetPendingReview) UnmarshalJSON(data []byte) error {
	type plain AssetPendingReview
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetPreview) UnmarshalJSON(data []byte) error {
	type plain AssetPreview
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetRendered) UnmarshalJSON(data []byte) error {
	type plain AssetRendered
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetReview) UnmarshalJSON(data []byte) error {
	type plain AssetReview
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetSearchMatch) UnmarshalJSON(data []byte) error {
	type plain AssetSearchMatch
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetSearchResponse) UnmarshalJSON(data []byte) error {
	type plain AssetSearchResponse
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetTimelinePage) UnmarshalJSON(data []byte) error {
	type plain AssetTimelinePage
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *AssetUpload) UnmarshalJSON(data []byte) error {
	type plain AssetUpload
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *BatchAssetsResponse) UnmarshalJSON(data []byte) error {
	type plain BatchAssetsResponse
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *BoundingBox) UnmarshalJSON(data []byte) error {
	type plain BoundingBox
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *CategoryPolicyScore) UnmarshalJSON(data []byte) error {
	type plain CategoryPolicyScore
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *CategoryPolicySettings) UnmarshalJSON(data []byte) error {
	type plain CategoryPolicySettings
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *CategoryPolicySettingsSnapshot) UnmarshalJSON(data []byte) error {
	type plain CategoryPolicySettingsSnapshot
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *CategoryPolicySource) UnmarshalJSON(data []byte) error {
	type plain CategoryPolicySource
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *CategoryResult) UnmarshalJSON(data []byte) error {
	type plain CategoryResult
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *CheckedLink) UnmarshalJSON(data []byte) error {
	type plain CheckedLink
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *Checksums) UnmarshalJSON(data []byte) error {
	type plain Checksums
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *ClassificationProgress) UnmarshalJSON(data []byte) error {
	type plain ClassificationProgress
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *DecisionPolicy) UnmarshalJSON(data []byte) error {
	type plain DecisionPolicy
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *DecisionPolicyPreset) UnmarshalJSON(data []byte) error {
	type plain DecisionPolicyPreset
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *DetectedFace) UnmarshalJSON(data []byte) error {
	type plain DetectedFace
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *DetectedLink) UnmarshalJSON(data []byte) error {
	type plain DetectedLink
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *DetectedPerson) UnmarshalJSON(data []byte) error {
	type plain DetectedPerson
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *DetectedQRCode) UnmarshalJSON(data []byte) error {
	type plain DetectedQRCode
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *EnsureUploadPresetsResponse) UnmarshalJSON(data []byte) error {
	type plain EnsureUploadPresetsResponse
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *Event) UnmarshalJSON(data []byte) error {
	type plain Event
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *EventAsset) UnmarshalJSON(data []byte) error {
	type plain EventAsset
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *EventAssetClassification) UnmarshalJSON(data []byte) error {
	type plain EventAssetClassification
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *EventAssetContent) UnmarshalJSON(data []byte) error {
	type plain EventAssetContent
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *EventAssetModeration) UnmarshalJSON(data []byte) error {
	type plain EventAssetModeration
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *EventAssetUpload) UnmarshalJSON(data []byte) error {
	type plain EventAssetUpload
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *EventFact) UnmarshalJSON(data []byte) error {
	type plain EventFact
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *EventsPage) UnmarshalJSON(data []byte) error {
	type plain EventsPage
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *ExtractedText) UnmarshalJSON(data []byte) error {
	type plain ExtractedText
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *FaceDetectionFeatureOptions) UnmarshalJSON(data []byte) error {
	type plain FaceDetectionFeatureOptions
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *FaceDetectionResult) UnmarshalJSON(data []byte) error {
	type plain FaceDetectionResult
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *FileMetadata) UnmarshalJSON(data []byte) error {
	type plain FileMetadata
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *FileMetadataLocation) UnmarshalJSON(data []byte) error {
	type plain FileMetadataLocation
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *Folder) UnmarshalJSON(data []byte) error {
	type plain Folder
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *FolderPage) UnmarshalJSON(data []byte) error {
	type plain FolderPage
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *HashList) UnmarshalJSON(data []byte) error {
	type plain HashList
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *HashListEntry) UnmarshalJSON(data []byte) error {
	type plain HashListEntry
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *HashListEntryPage) UnmarshalJSON(data []byte) error {
	type plain HashListEntryPage
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *HashListPage) UnmarshalJSON(data []byte) error {
	type plain HashListPage
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *HashMatch) UnmarshalJSON(data []byte) error {
	type plain HashMatch
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *HumanReviewSettings) UnmarshalJSON(data []byte) error {
	type plain HumanReviewSettings
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *Lens) UnmarshalJSON(data []byte) error {
	type plain Lens
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *LensPage) UnmarshalJSON(data []byte) error {
	type plain LensPage
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *LinkDetectionFeatureOptions) UnmarshalJSON(data []byte) error {
	type plain LinkDetectionFeatureOptions
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *LinkDetectionResult) UnmarshalJSON(data []byte) error {
	type plain LinkDetectionResult
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *LinkSafetyDecision) UnmarshalJSON(data []byte) error {
	type plain LinkSafetyDecision
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *LinkSafetyEvidence) UnmarshalJSON(data []byte) error {
	type plain LinkSafetyEvidence
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *LinkSafetyOffPlatformLinks) UnmarshalJSON(data []byte) error {
	type plain LinkSafetyOffPlatformLinks
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *LinkSafetyResult) UnmarshalJSON(data []byte) error {
	type plain LinkSafetyResult
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *LinkSafetySettings) UnmarshalJSON(data []byte) error {
	type plain LinkSafetySettings
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *MediaClassificationSegment) UnmarshalJSON(data []byte) error {
	type plain MediaClassificationSegment
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *MetadataField) UnmarshalJSON(data []byte) error {
	type plain MetadataField
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *MetadataFieldsResource) UnmarshalJSON(data []byte) error {
	type plain MetadataFieldsResource
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *MetadataItem) UnmarshalJSON(data []byte) error {
	type plain MetadataItem
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *ModerationContext) UnmarshalJSON(data []byte) error {
	type plain ModerationContext
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *ModerationContextItem) UnmarshalJSON(data []byte) error {
	type plain ModerationContextItem
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *ModerationRaw) UnmarshalJSON(data []byte) error {
	type plain ModerationRaw
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *ModerationTimeline) UnmarshalJSON(data []byte) error {
	type plain ModerationTimeline
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *OCRFeatureOptions) UnmarshalJSON(data []byte) error {
	type plain OCRFeatureOptions
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *OCRResult) UnmarshalJSON(data []byte) error {
	type plain OCRResult
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *PersonDetectionFeatureOptions) UnmarshalJSON(data []byte) error {
	type plain PersonDetectionFeatureOptions
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *PersonDetectionResult) UnmarshalJSON(data []byte) error {
	type plain PersonDetectionResult
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *Policy) UnmarshalJSON(data []byte) error {
	type plain Policy
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *PolicyPage) UnmarshalJSON(data []byte) error {
	type plain PolicyPage
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *PolicyPresetOrigin) UnmarshalJSON(data []byte) error {
	type plain PolicyPresetOrigin
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *PolicyRuleSnapshot) UnmarshalJSON(data []byte) error {
	type plain PolicyRuleSnapshot
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *PolicySettings) UnmarshalJSON(data []byte) error {
	type plain PolicySettings
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *ProcessingFeatures) UnmarshalJSON(data []byte) error {
	type plain ProcessingFeatures
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *ProcessingOptions) UnmarshalJSON(data []byte) error {
	type plain ProcessingOptions
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *ProjectSettings) UnmarshalJSON(data []byte) error {
	type plain ProjectSettings
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *ProjectSettingsResource) UnmarshalJSON(data []byte) error {
	type plain ProjectSettingsResource
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *ProvenanceSignal) UnmarshalJSON(data []byte) error {
	type plain ProvenanceSignal
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *QualifierResult) UnmarshalJSON(data []byte) error {
	type plain QualifierResult
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *RegionalDecision) UnmarshalJSON(data []byte) error {
	type plain RegionalDecision
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *RemoteURLRule) UnmarshalJSON(data []byte) error {
	type plain RemoteURLRule
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *ReviewActor) UnmarshalJSON(data []byte) error {
	type plain ReviewActor
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *SafetyHold) UnmarshalJSON(data []byte) error {
	type plain SafetyHold
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *SignedAssetURL) UnmarshalJSON(data []byte) error {
	type plain SignedAssetURL
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *StreamingFeatureOptions) UnmarshalJSON(data []byte) error {
	type plain StreamingFeatureOptions
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *TextRegion) UnmarshalJSON(data []byte) error {
	type plain TextRegion
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *UploadPreset) UnmarshalJSON(data []byte) error {
	type plain UploadPreset
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}

func (m *UploadPresetPage) UnmarshalJSON(data []byte) error {
	type plain UploadPresetPage
	return decodeModel(data, (*plain)(m), &m.responseJSON)
}
