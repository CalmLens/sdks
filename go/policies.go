package calmlens

import (
	"context"
	"encoding/json"
)

// Built-in preset IDs for CreatePolicyOptions.PresetID and PolicyPresetOrigin.ID. ID is a plain
// string so presets added later still decode.
const (
	// PolicyPresetGeneral is the General preset.
	PolicyPresetGeneral = "general-community"
	// PolicyPresetKids is the Kids preset.
	PolicyPresetKids = "children-platform"
	// PolicyPresetLearningAndSupport is the Learning and support preset.
	PolicyPresetLearningAndSupport = "education-support"
	// PolicyPresetTeenSafe is the Teen-safe preset.
	PolicyPresetTeenSafe = "wholesome-community"
)

// Values of PolicyPresetOrigin.Mode. Mode is a plain string so modes added later still decode.
const (
	// PolicyPresetModeLive is the organisation's own preset policy following automatic updates:
	// it always has the latest preset settings. Its first saved change pins it.
	PolicyPresetModeLive = "live"
	// PolicyPresetModePinned is the organisation's own preset policy pinned at a preset release,
	// with any changes saved since.
	PolicyPresetModePinned = "pinned"
	// PolicyPresetModeCopy is a policy created from a preset, pinned at the release it was copied
	// from. It never follows automatic updates.
	PolicyPresetModeCopy = "copy"
)

// Policy is a moderation policy. Policies belong to the API key's organisation and its projects
// share them; each project moderates with one, and an upload preset can name another for its own
// uploads. Revision counts saved changes and guards every change, separately from the preset
// release Preset.Version.
type Policy struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	// Settings say what the policy does with each category, its allowances and restrictions.
	Settings PolicySettings `json:"settings"`
	// Revision changes with every saved change. Send it with each change; a policy changed since
	// is refused with CodePolicyRevisionConflict.
	Revision int `json:"revision"`
	// Preset is where the policy started from a built-in preset, nil when it did not.
	Preset *PolicyPresetOrigin `json:"preset"`
	// ProjectIDs are the projects this policy moderates, as their policy or through one of their
	// upload presets.
	ProjectIDs []string `json:"projectIds"`
	CreatedAt  int64    `json:"createdAt"`
	// UpdatedAt is when it last changed; nil when the API leaves it out.
	UpdatedAt *int64 `json:"updatedAt,omitempty"`
}

// PolicyPresetOrigin is the built-in preset a policy started from.
type PolicyPresetOrigin struct {
	// ID is a preset such as PolicyPresetGeneral.
	ID string `json:"id"`
	// Version is the preset release the policy is pinned to; PoliciesService.Reset restores its
	// settings.
	Version int `json:"version"`
	// LatestVersion is the newest release of the preset. PoliciesService.Upgrade moves an
	// unchanged pinned policy or copy to it.
	LatestVersion int `json:"latestVersion"`
	// Mode is PolicyPresetModeLive, PolicyPresetModePinned or PolicyPresetModeCopy. An
	// organisation has at most one policy of its own per preset, live or pinned; only it can
	// follow automatic updates.
	Mode string `json:"mode"`
}

// PolicySettings say what a policy does with each moderation category.
type PolicySettings struct {
	// CategorySettings maps every category, such as CategoryProfanity, to its settings. Settings
	// you send must define all eight.
	CategorySettings map[string]CategoryPolicySettings `json:"categorySettings"`
	// LinkSafety (preview) says what happens to assets that link to unsafe destinations; nil
	// when off.
	LinkSafety *LinkSafetySettings `json:"linkSafety,omitempty"`
}

// MarshalJSON encodes nil CategorySettings as an empty object.
func (s PolicySettings) MarshalJSON() ([]byte, error) {
	type plain PolicySettings
	if s.CategorySettings == nil {
		s.CategorySettings = map[string]CategoryPolicySettings{}
	}
	return json.Marshal(plain(s))
}

// CategoryPolicySettings are one category's action, allowances and restrictions.
type CategoryPolicySettings struct {
	// Action is what happens when the category's policy score reaches 0.5: allow, limit,
	// age-restrict, block or purge.
	Action string `json:"action"`
	// Allowances let content through, or act on it more softly, when all of the category's
	// content is one of their qualifiers. Nil is sent as an empty list.
	Allowances []PolicyRule `json:"allowances"`
	// Restrictions act on at least one matching qualifying instance. They outweigh allowances.
	// Nil is sent as an empty list.
	Restrictions []PolicyRule `json:"restrictions"`
}

// MarshalJSON encodes nil Allowances and Restrictions as empty lists.
func (s CategoryPolicySettings) MarshalJSON() ([]byte, error) {
	type plain CategoryPolicySettings
	if s.Allowances == nil {
		s.Allowances = []PolicyRule{}
	}
	if s.Restrictions == nil {
		s.Restrictions = []PolicyRule{}
	}
	return json.Marshal(plain(s))
}

// PolicyRule is an allowance or restriction: its When qualifiers apply to the same instance,
// excluding instances that also have an Unless qualifier (restrictions only). It has the shape
// of the rules recorded on a decision.
type PolicyRule = PolicyRuleSnapshot

// ListPoliciesOptions selects a page of the organisation's policies. Cursor is the previous page's
// NextCursor; PageSize is 1 to 100 (0 for the API's default of 50). Sort works as in
// ListAssetsOptions, except that policies list oldest first by default.
type ListPoliciesOptions struct {
	Cursor   string `json:"cursor,omitempty"`
	PageSize int    `json:"pageSize,omitempty"`
	Sort     string `json:"sort,omitempty"`
}

// PolicyPage is one page of the organisation's policies. PoliciesService.RetrieveAssigned
// returns the one the project moderates with.
type PolicyPage struct {
	Items      []Policy `json:"items"`
	HasMore    bool     `json:"hasMore"`
	NextCursor *string  `json:"nextCursor"`
}

// PolicyIDOptions identifies a policy.
type PolicyIDOptions struct{ PolicyID string }

// CreatePolicyOptions creates a policy from Settings with a Name, or a copy of the latest release
// of a built-in preset with PresetID (whose Name defaults to the preset's).
type CreatePolicyOptions struct {
	Name        string          `json:"name,omitempty"`
	Description string          `json:"description,omitempty"`
	Settings    *PolicySettings `json:"settings,omitempty"`
	PresetID    string          `json:"presetId,omitempty"`
}

// UpdatePolicyOptions changes a policy's name, description or settings; nil fields are
// unchanged. Revision is the policy's current revision.
type UpdatePolicyOptions struct {
	PolicyID    string
	Revision    int
	Name        *string
	Description *string
	// Settings replace the policy's settings and must define every category.
	Settings *PolicySettings
}

// ResetPolicyOptions restores a pinned policy or copy to its preset release. Revision is the
// policy's current revision and PresetVersion the Preset.Version you reviewed.
type ResetPolicyOptions struct {
	PolicyID      string
	Revision      int
	PresetVersion int
}

// UpgradePolicyOptions moves an unchanged pinned policy or copy to the latest release of its
// preset. Revision is the policy's current revision and PresetVersion the Preset.LatestVersion
// you reviewed.
type UpgradePolicyOptions struct {
	PolicyID      string
	Revision      int
	PresetVersion int
}

// SetPolicyAutomaticUpdatesOptions switches automatic updates for the organisation's own preset
// policy. Enabled turns a pinned policy live, replacing its settings with the latest preset's;
// disabling pins a live policy at its current preset release. PresetVersion is the policy's
// Preset.LatestVersion.
type SetPolicyAutomaticUpdatesOptions struct {
	PolicyID      string
	Enabled       bool
	Revision      int
	PresetVersion int
}

// AssignPolicyOptions chooses the policy the project moderates with.
type AssignPolicyOptions struct{ PolicyID string }

// PoliciesService manages the moderation policies of the API key's organisation. Every change
// sends the policy's revision, so a policy changed since is refused. Through a project's key you
// can change only policies no other project uses.
type PoliciesService struct{ c *ServerClient }

// List returns one page of the organisation's policies, oldest first unless options.Sort says
// otherwise. Use ListAll to iterate over every page.
func (s *PoliciesService) List(ctx context.Context, options ListPoliciesOptions) (*PolicyPage, error) {
	params, err := query(options)
	if err != nil {
		return nil, err
	}
	var result PolicyPage
	if err := s.c.request(ctx, "GET", "/policies", params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ListAll iterates over every policy of the organisation, starting at options.Cursor.
func (s *PoliciesService) ListAll(options ListPoliciesOptions) *Iterator[Policy] {
	return newIterator(options.Cursor, func(ctx context.Context, cursor string) ([]Policy, string, bool, error) {
		options.Cursor = cursor
		page, err := s.List(ctx, options)
		if err != nil {
			return nil, "", false, err
		}
		return page.Items, cursorOf(page.NextCursor), page.HasMore, nil
	})
}

// RetrieveAssigned returns the policy the project moderates with. Uploads through an upload
// preset that names its own policy use that one instead.
func (s *PoliciesService) RetrieveAssigned(ctx context.Context) (*Policy, error) {
	var result Policy
	if err := s.c.request(ctx, "GET", s.c.project("policy"), nil, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Retrieve returns a policy.
func (s *PoliciesService) Retrieve(ctx context.Context, options PolicyIDOptions) (*Policy, error) {
	return s.policyRequest(ctx, "GET", options.PolicyID, "", nil)
}

// Create creates a policy. It moderates nothing until you assign it to a project or name it on
// an upload preset.
func (s *PoliciesService) Create(ctx context.Context, options CreatePolicyOptions) (*Policy, error) {
	var result Policy
	if err := s.c.request(ctx, "POST", "/policies", nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Update changes a policy's name, description or settings; later moderation uses them. Saving a
// live policy (PolicyPresetModeLive) pins it under the same ID.
func (s *PoliciesService) Update(ctx context.Context, options UpdatePolicyOptions) (*Policy, error) {
	body := struct {
		Revision    int             `json:"revision"`
		Name        *string         `json:"name,omitempty"`
		Description *string         `json:"description,omitempty"`
		Settings    *PolicySettings `json:"settings,omitempty"`
	}{options.Revision, options.Name, options.Description, options.Settings}
	return s.policyRequest(ctx, "PATCH", options.PolicyID, "", body)
}

// presetBody is the body of Reset and Upgrade.
type presetBody struct {
	Revision      int `json:"revision"`
	PresetVersion int `json:"presetVersion"`
}

// Reset restores the settings of the preset release a pinned policy or copy is pinned to,
// discarding its changes.
func (s *PoliciesService) Reset(ctx context.Context, options ResetPolicyOptions) (*Policy, error) {
	return s.policyRequest(ctx, "POST", options.PolicyID, "/reset", presetBody{options.Revision, options.PresetVersion})
}

// Upgrade moves a pinned policy or copy whose settings are unchanged from its preset release to
// the latest release of the preset.
func (s *PoliciesService) Upgrade(ctx context.Context, options UpgradePolicyOptions) (*Policy, error) {
	return s.policyRequest(ctx, "POST", options.PolicyID, "/upgrade", presetBody{options.Revision, options.PresetVersion})
}

// SetAutomaticUpdates switches automatic updates on or off for the organisation's own preset
// policy: on turns a pinned policy live, and off pins a live policy at its current preset release.
func (s *PoliciesService) SetAutomaticUpdates(ctx context.Context, options SetPolicyAutomaticUpdatesOptions) (*Policy, error) {
	body := struct {
		Enabled       bool `json:"enabled"`
		Revision      int  `json:"revision"`
		PresetVersion int  `json:"presetVersion"`
	}{options.Enabled, options.Revision, options.PresetVersion}
	return s.policyRequest(ctx, "PUT", options.PolicyID, "/automatic-updates", body)
}

// Delete deletes a policy that no project or upload preset uses.
func (s *PoliciesService) Delete(ctx context.Context, options PolicyIDOptions) error {
	path, err := resourcePath("policies", options.PolicyID, "")
	if err != nil {
		return err
	}
	return s.c.request(ctx, "DELETE", path, nil, nil, nil)
}

// Assign chooses the policy the project moderates with.
func (s *PoliciesService) Assign(ctx context.Context, options AssignPolicyOptions) (*Policy, error) {
	body := struct {
		PolicyID string `json:"policyId"`
	}{options.PolicyID}
	var result Policy
	if err := s.c.request(ctx, "PUT", s.c.project("policy"), nil, body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (s *PoliciesService) policyRequest(ctx context.Context, method, id, suffix string, body any) (*Policy, error) {
	path, err := resourcePath("policies", id, suffix)
	if err != nil {
		return nil, err
	}
	var result Policy
	if err = s.c.request(ctx, method, path, nil, body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
