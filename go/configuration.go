package calmlens

import (
	"context"
	"encoding/json"
	"net/url"
	"strconv"
)

// UploadPresetAccess is who can upload with an upload preset.
type UploadPresetAccess string

// Values of UploadPreset.Access.
const (
	// UploadPresetAccessToken needs an upload token signed by your server.
	UploadPresetAccessToken UploadPresetAccess = "token"
	// UploadPresetAccessAnyone accepts the preset ID alone, and needs a DailyUploadLimit.
	UploadPresetAccessAnyone UploadPresetAccess = "anyone"
)

// UploadPreset holds the rules for uploads made from browsers and apps. Key identifies it within
// the project, and Revision changes with every saved change.
type UploadPreset struct {
	responseJSON
	ID              string  `json:"id"`
	ProjectID       string  `json:"projectId"`
	CreatedByUserID *string `json:"createdByUserId"`
	Key             string  `json:"key"`
	Revision        int     `json:"revision"`
	Name            string  `json:"name"`
	// Access is UploadPresetAccessToken or UploadPresetAccessAnyone.
	Access UploadPresetAccess `json:"access"`
	// Enabled is whether the preset accepts uploads.
	Enabled bool `json:"enabled"`
	// AllowedContentTypes are the MIME types the preset accepts, such as "image/*"; nil accepts
	// any supported type.
	AllowedContentTypes []string `json:"allowedContentTypes"`
	// MaxSizeInBytes is the largest upload the preset accepts; nil uses the standard limits.
	MaxSizeInBytes *int64 `json:"maxSizeInBytes"`
	// FolderID is the folder uploads go into; nil uses the project's root.
	FolderID *string `json:"folderId"`
	// PolicyID is the moderation policy for uploads through the preset; nil uses the project's.
	PolicyID *string `json:"policyId"`
	// Visibility of uploaded assets: VisibilityPrivate or VisibilityPublic.
	Visibility Visibility `json:"visibility"`
	// ProcessingOptions apply to every upload through the preset.
	ProcessingOptions *ProcessingOptions `json:"processingOptions"`
	// RevealDecision is whether browser uploads see the moderation decision for their own upload.
	RevealDecision bool `json:"revealDecision"`
	// DailyUploadLimit is the most uploads the preset accepts from each client (IP address) per
	// UTC day.
	DailyUploadLimit *int `json:"dailyUploadLimit"`
	// AllowedOrigins are the sites allowed to upload from the browser; nil allows any site.
	AllowedOrigins []string `json:"allowedOrigins"`
	CreatedAt      int64    `json:"createdAt"`
	// UpdatedAt is when it last changed; nil when the API leaves it out.
	UpdatedAt *int64 `json:"updatedAt,omitempty"`
}

// ListUploadPresetsOptions selects a page of the project's upload presets. Cursor is the previous
// page's NextCursor; PageSize is 1 to 100 (0 for the API's default). Sort works as in
// ListAssetsOptions, except that upload presets list oldest first by default.
type ListUploadPresetsOptions struct {
	Cursor   string `json:"cursor,omitempty"`
	PageSize int    `json:"pageSize,omitempty"`
	Sort     string `json:"sort,omitempty"`
	Params   `json:"-"`
}

// UploadPresetPage is one page of the project's upload presets.
type UploadPresetPage struct {
	responseJSON
	Items      []UploadPreset `json:"items"`
	HasMore    bool           `json:"hasMore"`
	NextCursor *string        `json:"nextCursor"`
	APIResource
}

// UploadPresetDefinition is one preset's whole definition, addressed by Key. Key and Name are
// required; fields left unset take their defaults, so the stored preset matches what was sent.
type UploadPresetDefinition struct {
	Key string `json:"key"`
	// Revision is the revision you last read. A preset changed since is refused with
	// CodeUploadPresetRevisionConflict; Ptr(0) creates it only if no preset has this key. Nil
	// creates or replaces the preset whatever its revision.
	Revision *int   `json:"revision"`
	Name     string `json:"name"`
	// Access is UploadPresetAccessToken (the default) or UploadPresetAccessAnyone, which needs a
	// DailyUploadLimit.
	Access UploadPresetAccess `json:"access"`
	// Enabled is whether the preset accepts uploads (default true).
	Enabled *bool `json:"enabled"`
	// AllowedContentTypes are the MIME types the preset accepts, such as "image/*". Empty accepts
	// any supported type.
	AllowedContentTypes []string `json:"allowedContentTypes"`
	// MaxSizeInBytes is the largest upload the preset accepts; nil uses the standard limits.
	MaxSizeInBytes *int64 `json:"maxSizeInBytes"`
	// FolderID is the folder uploads go into; unset or null uses the project's root.
	FolderID Patch[string] `json:"folderId"`
	// PolicyID is the moderation policy for uploads through the preset; unset or null uses the
	// project's.
	PolicyID Patch[string] `json:"policyId"`
	// Visibility of uploaded assets: VisibilityPrivate (the default) or VisibilityPublic.
	Visibility Visibility `json:"visibility"`
	// ProcessingOptions apply to every upload through the preset.
	ProcessingOptions *ProcessingOptions `json:"processingOptions"`
	// RevealDecision is whether browser uploads see the moderation decision for their own upload
	// (default false).
	RevealDecision *bool `json:"revealDecision"`
	// DailyUploadLimit is the most uploads the preset accepts from each client (IP address) per
	// UTC day.
	DailyUploadLimit *int `json:"dailyUploadLimit"`
	// AllowedOrigins are the sites allowed to upload from the browser. Empty allows any site.
	AllowedOrigins []string `json:"allowedOrigins"`
}

// MarshalJSON encodes the definition with only the fields that are set.
func (d UploadPresetDefinition) MarshalJSON() ([]byte, error) {
	body := map[string]any{"key": d.Key, "name": d.Name}
	if d.Revision != nil {
		body["revision"] = *d.Revision
	}
	if d.Access != "" {
		body["access"] = d.Access
	}
	if d.Enabled != nil {
		body["enabled"] = *d.Enabled
	}
	if d.AllowedContentTypes != nil {
		body["allowedContentTypes"] = d.AllowedContentTypes
	}
	if d.MaxSizeInBytes != nil {
		body["maxSizeInBytes"] = *d.MaxSizeInBytes
	}
	d.FolderID.put(body, "folderId")
	d.PolicyID.put(body, "policyId")
	if d.Visibility != "" {
		body["visibility"] = d.Visibility
	}
	if d.ProcessingOptions != nil {
		body["processingOptions"] = d.ProcessingOptions
	}
	if d.RevealDecision != nil {
		body["revealDecision"] = *d.RevealDecision
	}
	if d.DailyUploadLimit != nil {
		body["dailyUploadLimit"] = *d.DailyUploadLimit
	}
	if d.AllowedOrigins != nil {
		body["allowedOrigins"] = d.AllowedOrigins
	}
	return json.Marshal(body)
}

// EnsureUploadPresetsOptions are the presets to create or replace, at most 50 per request.
type EnsureUploadPresetsOptions struct {
	UploadPresets []UploadPresetDefinition `json:"uploadPresets"`
	Params        `json:"-"`
}

// EnsureUploadPresetsResponse holds the stored presets, in the order they were sent.
type EnsureUploadPresetsResponse struct {
	responseJSON
	UploadPresets []UploadPreset `json:"uploadPresets"`
	APIResource
}

// UploadPresetIDOptions identifies an upload preset.
type UploadPresetIDOptions struct {
	UploadPresetID string
	Params         `json:"-"`
}

// UploadPresetsService manages the project's upload presets: the rules for uploads from browsers
// and apps. Ensure creates or replaces presets by key, for deploys that declare them in code.
type UploadPresetsService struct{ c *ServerClient }

// List returns one page of the project's upload presets, oldest first unless options.Sort says
// otherwise. Use ListAll to iterate over every page.
func (s *UploadPresetsService) List(ctx context.Context, options ListUploadPresetsOptions) (*UploadPresetPage, error) {
	ctx, paramsErr := withCall(ctx, "uploadPresets.list", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	params, err := query(options)
	if err != nil {
		return nil, err
	}
	var result UploadPresetPage
	if err = s.c.request(ctx, "GET", s.c.project("upload-presets"), params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ListAll iterates over every upload preset of the project, starting at options.Cursor.
func (s *UploadPresetsService) ListAll(options ListUploadPresetsOptions) *Iterator[UploadPreset] {
	return newIterator(options.Cursor, func(ctx context.Context, cursor string) ([]UploadPreset, string, bool, error) {
		options.Cursor = cursor
		page, err := s.List(ctx, options)
		if err != nil {
			return nil, "", false, err
		}
		return page.Items, cursorOf(page.NextCursor), page.HasMore, nil
	})
}

// Ensure creates each preset, or replaces it with the definition sent, by key. An unchanged preset
// keeps its revision, so deploys can send their presets every time. Every preset is checked before
// any is saved.
func (s *UploadPresetsService) Ensure(ctx context.Context, options EnsureUploadPresetsOptions) (*EnsureUploadPresetsResponse, error) {
	ctx, paramsErr := withCall(ctx, "uploadPresets.ensure", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	var result EnsureUploadPresetsResponse
	if err := s.c.request(ctx, "PUT", s.c.project("upload-presets"), nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Delete deletes an upload preset. Browsers can no longer upload through it; assets already
// uploaded stay.
func (s *UploadPresetsService) Delete(ctx context.Context, options UploadPresetIDOptions) error {
	ctx, paramsErr := withCall(ctx, "uploadPresets.delete", options.Params)
	if paramsErr != nil {
		return paramsErr
	}
	path, err := resourcePath("upload-presets", options.UploadPresetID, "")
	if err != nil {
		return err
	}
	return s.c.request(ctx, "DELETE", path, nil, nil, nil)
}

// RemoteURLRule restricts the domains a project accepts when content is submitted by URL.
type RemoteURLRule struct {
	responseJSON
	// Mode is "allow", which accepts only Domains, or "deny", which accepts every domain except
	// Domains.
	Mode RemoteURLRuleMode `json:"mode"`
	// Domains are bare lowercase domains such as example.com.
	Domains []string `json:"domains"`
}

// HumanReviewSettings say which automated decisions are sampled into the human review queue. The
// zero value samples none, which is the default.
type HumanReviewSettings struct {
	responseJSON
	AllowedSamplePercent    float64 `json:"allowedSamplePercent"`
	RestrictedSamplePercent float64 `json:"restrictedSamplePercent"`
	// UncertaintyMarginPercent queues decisions with a moderated category whose policy score lies
	// less than this many percentage points from the policy threshold. 0 turns it off.
	UncertaintyMarginPercent float64 `json:"uncertaintyMarginPercent"`
	// ReviewMissingEvidence queues decisions with evidence that couldn't be assessed.
	ReviewMissingEvidence bool `json:"reviewMissingEvidence"`
}

// HumanReviewSettingsInput is the human review sampling an update stores: fields left nil return
// to their defaults (0 and false, sampling nothing). See HumanReviewSettings for each field.
type HumanReviewSettingsInput struct {
	AllowedSamplePercent     *float64 `json:"allowedSamplePercent,omitempty"`
	RestrictedSamplePercent  *float64 `json:"restrictedSamplePercent,omitempty"`
	UncertaintyMarginPercent *float64 `json:"uncertaintyMarginPercent,omitempty"`
	ReviewMissingEvidence    *bool    `json:"reviewMissingEvidence,omitempty"`
}

// ProjectSettings are a project's settings with defaults filled in. The project's policy and
// metadata fields have their own endpoints.
type ProjectSettings struct {
	responseJSON
	RetainContent bool `json:"retainContent"`
	// OptOutJurisdictions are optional standards this project doesn't serve, such as "EU".
	OptOutJurisdictions []Jurisdiction `json:"optOutJurisdictions"`
	// BlockUnmoderatedAssets makes the CDN refuse assets whose moderation is still pending.
	BlockUnmoderatedAssets bool `json:"blockUnmoderatedAssets"`
	// StoreSensitiveMetadata keeps embedded image metadata (EXIF, XMP and IPTC) on uploads.
	StoreSensitiveMetadata bool `json:"storeSensitiveMetadata"`
	// StreamingEnabled (preview) prepares an adaptive stream of audio and video uploads that keep
	// their content.
	StreamingEnabled bool `json:"streamingEnabled"`
	// AIMediaSearchEnabled indexes audio speech and video frames and transcripts for AI search.
	AIMediaSearchEnabled bool `json:"aiMediaSearchEnabled"`
	LinkCheckingEnabled  bool `json:"linkCheckingEnabled"`
	// RemoteURLRule restricts the domains accepted by URL; nil accepts every public domain.
	RemoteURLRule *RemoteURLRule `json:"remoteUrlRule"`
	// WebsiteSubmissionsPerMinute lowers how many websites the project can submit per minute; nil
	// uses the platform limit.
	WebsiteSubmissionsPerMinute *int                `json:"websiteSubmissionsPerMinute"`
	HumanReview                 HumanReviewSettings `json:"humanReview"`
}

// ProjectSettingsResource is a project's settings and the revision to send back with a change.
type ProjectSettingsResource struct {
	responseJSON
	ProjectID string `json:"projectId"`
	// Revision counts changes to the project's settings and metadata fields, starting at 1.
	Revision int             `json:"revision"`
	Settings ProjectSettings `json:"settings"`
	APIResource
}

// ProjectSettingsInput is the complete settings an update stores: fields left unset return to
// their defaults. See ProjectSettings for what each one does.
type ProjectSettingsInput struct {
	// RetainContent defaults to true.
	RetainContent *bool `json:"retainContent"`
	// OptOutJurisdictions defaults to none.
	OptOutJurisdictions []Jurisdiction `json:"optOutJurisdictions"`
	// BlockUnmoderatedAssets defaults to true.
	BlockUnmoderatedAssets *bool `json:"blockUnmoderatedAssets"`
	// StoreSensitiveMetadata defaults to false.
	StoreSensitiveMetadata *bool `json:"storeSensitiveMetadata"`
	// StreamingEnabled defaults to false.
	StreamingEnabled *bool `json:"streamingEnabled"`
	// AIMediaSearchEnabled defaults to false. Turning it on needs
	// UpdateProjectSettingsOptions.SearchIndexingBudgetUnits.
	AIMediaSearchEnabled *bool `json:"aiMediaSearchEnabled"`
	LinkCheckingEnabled  *bool `json:"linkCheckingEnabled"`
	// RemoteURLRule defaults to null, which accepts every public domain.
	RemoteURLRule Patch[RemoteURLRule] `json:"remoteUrlRule"`
	// WebsiteSubmissionsPerMinute defaults to null, which uses the platform limit.
	WebsiteSubmissionsPerMinute Patch[int] `json:"websiteSubmissionsPerMinute"`
	// HumanReview defaults to sampling nothing.
	HumanReview *HumanReviewSettingsInput `json:"humanReview"`
}

// MarshalJSON encodes the settings with only the fields that are set.
func (s ProjectSettingsInput) MarshalJSON() ([]byte, error) {
	body := map[string]any{}
	if s.RetainContent != nil {
		body["retainContent"] = *s.RetainContent
	}
	if s.OptOutJurisdictions != nil {
		body["optOutJurisdictions"] = s.OptOutJurisdictions
	}
	if s.BlockUnmoderatedAssets != nil {
		body["blockUnmoderatedAssets"] = *s.BlockUnmoderatedAssets
	}
	if s.StoreSensitiveMetadata != nil {
		body["storeSensitiveMetadata"] = *s.StoreSensitiveMetadata
	}
	if s.StreamingEnabled != nil {
		body["streamingEnabled"] = *s.StreamingEnabled
	}
	if s.LinkCheckingEnabled != nil {
		body["linkCheckingEnabled"] = *s.LinkCheckingEnabled
	}
	if s.AIMediaSearchEnabled != nil {
		body["aiMediaSearchEnabled"] = *s.AIMediaSearchEnabled
	}
	s.RemoteURLRule.put(body, "remoteUrlRule")
	s.WebsiteSubmissionsPerMinute.put(body, "websiteSubmissionsPerMinute")
	if s.HumanReview != nil {
		body["humanReview"] = s.HumanReview
	}
	return json.Marshal(body)
}

// UpdateProjectSettingsOptions replaces the project's settings.
type UpdateProjectSettingsOptions struct {
	// Revision is the revision you last read. Settings or metadata fields changed since are
	// refused with CodeProjectSettingsRevisionConflict; 0 replaces them whatever their revision.
	Revision int                  `json:"revision,omitempty"`
	Settings ProjectSettingsInput `json:"settings"`
	// SearchIndexingBudgetUnits is needed when turning on AIMediaSearchEnabled: the most indexing
	// units you accept for the project's existing media. A value below the estimate is refused
	// with CodeSearchEstimateChanged, whose details give the estimate.
	SearchIndexingBudgetUnits *float64 `json:"searchIndexingBudgetUnits,omitempty"`
	Params                    `json:"-"`
}

// ProjectSettingsService reads and replaces the project's settings.
type ProjectSettingsService struct{ c *ServerClient }

// GetProjectSettingsOptions holds the per-call Params of ProjectSettingsService.Get.
type GetProjectSettingsOptions struct {
	Params `json:"-"`
}

// Get returns the project's settings, with every default filled in, and the revision to send back
// with a change.
func (s *ProjectSettingsService) Get(ctx context.Context, options GetProjectSettingsOptions) (*ProjectSettingsResource, error) {
	ctx, paramsErr := withCall(ctx, "projectSettings.get", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	var result ProjectSettingsResource
	if err := s.c.request(ctx, "GET", s.c.project("settings"), nil, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Update replaces the project's settings: settings left out return to their defaults. Unchanged
// settings keep their revision.
func (s *ProjectSettingsService) Update(ctx context.Context, options UpdateProjectSettingsOptions) (*ProjectSettingsResource, error) {
	ctx, paramsErr := withCall(ctx, "projectSettings.update", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	var result ProjectSettingsResource
	if err := s.c.request(ctx, "PUT", s.c.project("settings"), nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// MetadataField is a metadata field the portal shows and filters by.
type MetadataField struct {
	responseJSON
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	// Type is "string", "number", "boolean", "date" or "url".
	Type MetadataFieldType `json:"type"`
	// Icon is "tag", "hash", "user", "folder", "layers", "photo" or "link".
	Icon MetadataFieldIcon `json:"icon"`
	// Color is a hex color such as "#2563eb".
	Color string `json:"color"`
}

// MetadataFieldsResource is a project's metadata fields, in display order, and the revision to
// send back with a change. It shares that revision with the project's settings.
type MetadataFieldsResource struct {
	responseJSON
	ProjectID string          `json:"projectId"`
	Revision  int             `json:"revision"`
	Fields    []MetadataField `json:"fields"`
	APIResource
}

// EnsureMetadataFieldsOptions are the fields to create, or replace by ID.
type EnsureMetadataFieldsOptions struct {
	// Revision is the revision you last read. Settings or metadata fields changed since are
	// refused with CodeProjectSettingsRevisionConflict; 0 changes them whatever their revision.
	Revision int             `json:"revision,omitempty"`
	Fields   []MetadataField `json:"fields"`
	Params   `json:"-"`
}

// DeleteMetadataFieldOptions identifies a metadata field to delete. Revision works as in
// EnsureMetadataFieldsOptions.
type DeleteMetadataFieldOptions struct {
	FieldID  string
	Revision int
	Params   `json:"-"`
}

// MetadataFieldsService manages the project's metadata fields.
type MetadataFieldsService struct{ c *ServerClient }

// ListMetadataFieldsOptions holds the per-call Params of MetadataFieldsService.List.
type ListMetadataFieldsOptions struct {
	Params `json:"-"`
}

// List returns the project's metadata fields in display order.
func (s *MetadataFieldsService) List(ctx context.Context, options ListMetadataFieldsOptions) (*MetadataFieldsResource, error) {
	ctx, paramsErr := withCall(ctx, "metadataFields.list", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	var result MetadataFieldsResource
	if err := s.c.request(ctx, "GET", s.c.project("metadata-fields"), nil, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Ensure creates each field, or replaces it with the definition sent, by ID. Other fields are kept
// and new ones are added at the end. Unchanged fields keep their revision.
func (s *MetadataFieldsService) Ensure(ctx context.Context, options EnsureMetadataFieldsOptions) (*MetadataFieldsResource, error) {
	ctx, paramsErr := withCall(ctx, "metadataFields.ensure", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	var result MetadataFieldsResource
	if err := s.c.request(ctx, "PUT", s.c.project("metadata-fields"), nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Delete deletes a metadata field definition. Assets keep the metadata values they hold.
func (s *MetadataFieldsService) Delete(ctx context.Context, options DeleteMetadataFieldOptions) error {
	ctx, paramsErr := withCall(ctx, "metadataFields.delete", options.Params)
	if paramsErr != nil {
		return paramsErr
	}
	escaped, err := segment(options.FieldID)
	if err != nil {
		return err
	}
	params := url.Values{}
	if options.Revision != 0 {
		params.Set("revision", strconv.Itoa(options.Revision))
	}
	return s.c.request(ctx, "DELETE", s.c.project("metadata-fields/"+escaped), params, nil, nil)
}

// Jurisdiction is an optional standard a project can opt out of serving.
type Jurisdiction string

const (
	// JurisdictionEU is the European Union's standard.
	JurisdictionEU Jurisdiction = "EU"
)

// RemoteURLRuleMode is how a RemoteURLRule uses its domains.
type RemoteURLRuleMode string

const (
	// RemoteURLRuleAllow accepts only the rule's domains.
	RemoteURLRuleAllow RemoteURLRuleMode = "allow"
	// RemoteURLRuleDeny accepts every domain except the rule's.
	RemoteURLRuleDeny RemoteURLRuleMode = "deny"
)

// MetadataFieldType is the kind of value a metadata field holds.
type MetadataFieldType string

const (
	MetadataFieldTypeString  MetadataFieldType = "string"
	MetadataFieldTypeNumber  MetadataFieldType = "number"
	MetadataFieldTypeBoolean MetadataFieldType = "boolean"
	MetadataFieldTypeDate    MetadataFieldType = "date"
	MetadataFieldTypeURL     MetadataFieldType = "url"
)

// MetadataFieldIcon is the icon the portal shows for a metadata field.
type MetadataFieldIcon string

const (
	MetadataFieldIconTag    MetadataFieldIcon = "tag"
	MetadataFieldIconHash   MetadataFieldIcon = "hash"
	MetadataFieldIconUser   MetadataFieldIcon = "user"
	MetadataFieldIconFolder MetadataFieldIcon = "folder"
	MetadataFieldIconLayers MetadataFieldIcon = "layers"
	MetadataFieldIconPhoto  MetadataFieldIcon = "photo"
	MetadataFieldIconLink   MetadataFieldIcon = "link"
)
