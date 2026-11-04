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

// Operations of ApplyPolicyPresetOptions.Operation.
const (
	// PolicyPresetReset restores the settings of the pinned preset version, discarding edits.
	PolicyPresetReset = "reset"
	// PolicyPresetUpdate moves an unchanged copy to the latest preset release.
	PolicyPresetUpdate = "update"
)

// Policy is a moderation policy. Policies belong to the project's organisation and its projects
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
	// AutomaticUpdates is whether the policy follows its preset: it has the latest preset
	// settings until its first saved change pins a copy.
	AutomaticUpdates bool `json:"automaticUpdates"`
	// Preset is where the policy started from a built-in preset, nil when it did not.
	Preset *PolicyPresetOrigin `json:"preset"`
	// ProjectIDs are the projects this policy moderates, as their policy or through one of their
	// upload presets.
	ProjectIDs []string `json:"projectIds"`
	CreatedAt  int64    `json:"createdAt"`
	UpdatedAt  int64    `json:"updatedAt"`
}

// PolicyPresetOrigin is the built-in preset a policy started from.
type PolicyPresetOrigin struct {
	// ID is a preset such as PolicyPresetGeneral.
	ID string `json:"id"`
	// Version is the preset release the policy is pinned to; resetting restores its settings.
	Version int `json:"version"`
	// LatestVersion is the newest release of the preset. A newer one than Version can be applied
	// with PolicyPresetUpdate.
	LatestVersion int `json:"latestVersion"`
	// Own is whether this is the organisation's own policy for the preset rather than a copy made
	// from it. An organisation has at most one per preset, and only it can follow automatic updates.
	Own bool `json:"own"`
}

// PolicySettings say what a policy does with each moderation category. Settings you send must
// define every category.
type PolicySettings struct {
	// CategorySettings maps a category, such as "profanity", to its settings.
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
	// age-restrict, block or purge. Empty leaves the API's default.
	Action string `json:"action,omitempty"`
	// Allowances let content through, or act on it more softly, when all of the category's
	// content is one of their qualifiers.
	Allowances []PolicyRule `json:"allowances,omitempty"`
	// Restrictions act on at least one matching qualifying instance. They outweigh allowances.
	Restrictions []PolicyRule `json:"restrictions,omitempty"`
}

// PolicyRule is an allowance or restriction: its When qualifiers apply to the same instance,
// excluding instances that also have an Unless qualifier (restrictions only). It has the shape
// of the rules recorded on a decision.
type PolicyRule = PolicyRuleSnapshot

// PolicyList is every policy of the project's organisation, oldest first, and the ID of the one
// the project moderates with.
type PolicyList struct {
	Policies        []Policy `json:"policies"`
	ProjectPolicyID string   `json:"projectPolicyId"`
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

// ApplyPolicyPresetOptions resets a preset copy to its pinned version (Operation
// PolicyPresetReset with PresetVersion = Preset.Version) or updates an unchanged copy to the
// latest release (PolicyPresetUpdate with PresetVersion = Preset.LatestVersion).
type ApplyPolicyPresetOptions struct {
	PolicyID      string
	Operation     string
	Revision      int
	PresetVersion int
}

// SetPolicyAutomaticUpdatesOptions switches automatic updates for the organisation's own preset
// policy. Enabled replaces the saved copy with the latest preset, discarding its changes;
// disabling pins the current preset version. PresetVersion is the policy's Preset.LatestVersion.
type SetPolicyAutomaticUpdatesOptions struct {
	PolicyID      string
	Enabled       bool
	Revision      int
	PresetVersion int
}

// AssignPolicyOptions chooses the policy the project moderates with.
type AssignPolicyOptions struct{ PolicyID string }

// PoliciesService manages the moderation policies of the project's organisation. Every change
// sends the policy's revision, so a policy changed since is refused. Through a project's key you
// can change only policies no other project uses or owns.
type PoliciesService struct{ c *ServerClient }

// List returns the organisation's policies and the ID of the one the project uses.
func (s *PoliciesService) List(ctx context.Context) (*PolicyList, error) {
	var result PolicyList
	if err := s.c.request(ctx, "GET", s.c.project("policies"), nil, nil, &result); err != nil {
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
	if err := s.c.request(ctx, "POST", s.c.project("policies"), nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Update changes a policy's name, description or settings; later moderation uses them. Saving a
// policy that follows automatic updates pins it as a copy under the same ID.
func (s *PoliciesService) Update(ctx context.Context, options UpdatePolicyOptions) (*Policy, error) {
	body := struct {
		Revision    int             `json:"revision"`
		Name        *string         `json:"name,omitempty"`
		Description *string         `json:"description,omitempty"`
		Settings    *PolicySettings `json:"settings,omitempty"`
	}{options.Revision, options.Name, options.Description, options.Settings}
	return s.policyRequest(ctx, "PATCH", options.PolicyID, "", body)
}

// ApplyPreset resets a preset copy to its pinned version, or updates an unchanged copy to the
// latest preset release.
func (s *PoliciesService) ApplyPreset(ctx context.Context, options ApplyPolicyPresetOptions) (*Policy, error) {
	body := struct {
		Operation     string `json:"operation"`
		Revision      int    `json:"revision"`
		PresetVersion int    `json:"presetVersion"`
	}{options.Operation, options.Revision, options.PresetVersion}
	return s.policyRequest(ctx, "POST", options.PolicyID, "/preset", body)
}

// SetAutomaticUpdates switches automatic updates on or off for the organisation's own preset
// policy.
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
	path, err := s.path(options.PolicyID, "")
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

func (s *PoliciesService) path(id, suffix string) (string, error) {
	escaped, err := segment(id)
	if err != nil {
		return "", err
	}
	return s.c.project("policies/" + escaped + suffix), nil
}

func (s *PoliciesService) policyRequest(ctx context.Context, method, id, suffix string, body any) (*Policy, error) {
	path, err := s.path(id, suffix)
	if err != nil {
		return nil, err
	}
	var result Policy
	if err = s.c.request(ctx, method, path, nil, body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
