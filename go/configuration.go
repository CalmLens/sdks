package calmlens

import (
	"context"
	"encoding/json"
	"net/url"
	"strconv"
)

// Values of UploadPreset.Access. Access is a plain string so values added later still decode.
const (
	// UploadPresetAccessToken needs an upload token signed by your server.
	UploadPresetAccessToken = "token"
	// UploadPresetAccessAnyone accepts the preset ID alone, and needs a DailyUploadLimit.
	UploadPresetAccessAnyone = "anyone"
)

// UploadPreset holds the rules for uploads made from browsers and apps. Key identifies it within
// the project, and Revision changes with every saved change.
type UploadPreset struct {
	ID              string  `json:"id"`
	ProjectID       string  `json:"projectId"`
	CreatedByUserID *string `json:"createdByUserId"`
	Key             string  `json:"key"`
	Revision        int     `json:"revision"`
	Name            string  `json:"name"`
	// Access is UploadPresetAccessToken or UploadPresetAccessAnyone.
	Access string `json:"access"`
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
	Visibility string `json:"visibility"`
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
}

// UploadPresetPage is one page of the project's upload presets.
type UploadPresetPage struct {
	Items      []UploadPreset `json:"items"`
	HasMore    bool           `json:"hasMore"`
	NextCursor *string        `json:"nextCursor"`
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
	Access string `json:"access"`
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
	Visibility string `json:"visibility"`
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
}

// EnsureUploadPresetsResponse holds the stored presets, in the order they were sent.
type EnsureUploadPresetsResponse struct {
	UploadPresets []UploadPreset `json:"uploadPresets"`
}

// UploadPresetIDOptions identifies an upload preset.
type UploadPresetIDOptions struct{ UploadPresetID string }

// UploadPresetsService manages the project's upload presets: the rules for uploads from browsers
// and apps. Ensure creates or replaces presets by key, for deploys that declare them in code.
type UploadPresetsService struct{ c *ServerClient }

// List returns one page of the project's upload presets, oldest first unless options.Sort says
// otherwise. Use ListAll to iterate over every page.
func (s *UploadPresetsService) List(ctx context.Context, options ListUploadPresetsOptions) (*UploadPresetPage, error) {
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
	var result EnsureUploadPresetsResponse
	if err := s.c.request(ctx, "PUT", s.c.project("upload-presets"), nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Delete deletes an upload preset. Browsers can no longer upload through it; assets already
// uploaded stay.
func (s *UploadPresetsService) Delete(ctx context.Context, options UploadPresetIDOptions) error {
	path, err := resourcePath("upload-presets", options.UploadPresetID, "")
	if err != nil {
		return err
	}
	return s.c.request(ctx, "DELETE", path, nil, nil, nil)
}

// RemoteURLRule restricts the domains a project accepts when content is submitted by URL.
type RemoteURLRule struct {
	// Mode is "allow", which accepts only Domains, or "deny", which accepts every domain except
	// Domains.
	Mode string `json:"mode"`
	// Domains are bare lowercase domains such as example.com.
	Domains []string `json:"domains"`
}

// HumanReviewSettings say which automated decisions are sampled into the human review queue. The
// zero value samples none, which is the default.
type HumanReviewSettings struct {
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
	RetainContent bool `json:"retainContent"`
	// OptOutJurisdictions are optional standards this project doesn't serve, such as "EU".
	OptOutJurisdictions []string `json:"optOutJurisdictions"`
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
	ProjectID string `json:"projectId"`
	// Revision counts changes to the project's settings and metadata fields, starting at 1.
	Revision int             `json:"revision"`
	Settings ProjectSettings `json:"settings"`
}

// ProjectSettingsInput is the complete settings an update stores: fields left unset return to
// their defaults. See ProjectSettings for what each one does.
type ProjectSettingsInput struct {
	// RetainContent defaults to true.
	RetainContent *bool `json:"retainContent"`
	// OptOutJurisdictions defaults to none.
	OptOutJurisdictions []string `json:"optOutJurisdictions"`
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
}

// ProjectSettingsService reads and replaces the project's settings.
type ProjectSettingsService struct{ c *ServerClient }

// Get returns the project's settings, with every default filled in, and the revision to send back
// with a change.
func (s *ProjectSettingsService) Get(ctx context.Context) (*ProjectSettingsResource, error) {
	var result ProjectSettingsResource
	if err := s.c.request(ctx, "GET", s.c.project("settings"), nil, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Update replaces the project's settings: settings left out return to their defaults. Unchanged
// settings keep their revision.
func (s *ProjectSettingsService) Update(ctx context.Context, options UpdateProjectSettingsOptions) (*ProjectSettingsResource, error) {
	var result ProjectSettingsResource
	if err := s.c.request(ctx, "PUT", s.c.project("settings"), nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// MetadataField is a metadata field the portal shows and filters by.
type MetadataField struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	// Type is "string", "number", "boolean", "date" or "url".
	Type string `json:"type"`
	// Icon is "tag", "hash", "user", "folder", "layers", "photo" or "link".
	Icon string `json:"icon"`
	// Color is a hex color such as "#2563eb".
	Color string `json:"color"`
}

// MetadataFieldsResource is a project's metadata fields, in display order, and the revision to
// send back with a change. It shares that revision with the project's settings.
type MetadataFieldsResource struct {
	ProjectID string          `json:"projectId"`
	Revision  int             `json:"revision"`
	Fields    []MetadataField `json:"fields"`
}

// EnsureMetadataFieldsOptions are the fields to create, or replace by ID.
type EnsureMetadataFieldsOptions struct {
	// Revision is the revision you last read. Settings or metadata fields changed since are
	// refused with CodeProjectSettingsRevisionConflict; 0 changes them whatever their revision.
	Revision int             `json:"revision,omitempty"`
	Fields   []MetadataField `json:"fields"`
}

// DeleteMetadataFieldOptions identifies a metadata field to delete. Revision works as in
// EnsureMetadataFieldsOptions.
type DeleteMetadataFieldOptions struct {
	FieldID  string
	Revision int
}

// MetadataFieldsService manages the project's metadata fields.
type MetadataFieldsService struct{ c *ServerClient }

// List returns the project's metadata fields in display order.
func (s *MetadataFieldsService) List(ctx context.Context) (*MetadataFieldsResource, error) {
	var result MetadataFieldsResource
	if err := s.c.request(ctx, "GET", s.c.project("metadata-fields"), nil, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Ensure creates each field, or replaces it with the definition sent, by ID. Other fields are kept
// and new ones are added at the end. Unchanged fields keep their revision.
func (s *MetadataFieldsService) Ensure(ctx context.Context, options EnsureMetadataFieldsOptions) (*MetadataFieldsResource, error) {
	var result MetadataFieldsResource
	if err := s.c.request(ctx, "PUT", s.c.project("metadata-fields"), nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Delete deletes a metadata field definition. Assets keep the metadata values they hold.
func (s *MetadataFieldsService) Delete(ctx context.Context, options DeleteMetadataFieldOptions) error {
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
