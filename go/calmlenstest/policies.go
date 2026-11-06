package calmlenstest

import (
	"encoding/json"
	"net/url"
	"slices"
	"strings"

	calmlens "github.com/CalmLens/sdks/go"
)

// ---- Policies -------------------------------------------------------------------------------
// The project starts on the organisation's own General preset policy, following automatic
// updates. The mock's presets have one release, version 1, with mockPresetSettings, and uploads
// are never decided by a policy.

// mockPresetNames are the built-in presets the mock knows, by display name.
var mockPresetNames = map[string]string{
	calmlens.PolicyPresetGeneral:            "General",
	calmlens.PolicyPresetKids:               "Kids",
	calmlens.PolicyPresetLearningAndSupport: "Learning and support",
	calmlens.PolicyPresetTeenSafe:           "Teen-safe",
}

// mockPolicy is a stored policy: the API's fields without the derived ones, plus its reset
// baseline. Settings are kept as the JSON that was sent.
type mockPolicy struct {
	id, name, description string
	settings, baseline    any
	revision              int
	// followsPreset is whether the organisation's own preset policy follows its preset (mode
	// live).
	followsPreset bool
	// presetID is empty for a policy that did not start from a preset; presetOwn is whether it
	// is the organisation's own policy for the preset rather than a copy.
	presetID             string
	presetOwn            bool
	createdAt, updatedAt int64
}

// policyStore holds the organisation's policies and the project's policy.
type policyStore struct {
	byID          map[string]*mockPolicy
	projectPolicy string
}

// mockPresetSettings are the settings of the mock's presets: every category with its default
// action (allow for personal information and profanity, block otherwise) and no rules. The mock
// holds no built-in preset settings.
func mockPresetSettings() any {
	categories := calmlens.JSON{}
	for _, category := range mockCategories {
		action := calmlens.ModerationActionBlock
		if category == calmlens.CategoryPersonalInformation || category == calmlens.CategoryProfanity {
			action = calmlens.ModerationActionAllow
		}
		categories[category] = calmlens.JSON{"action": action, "allowances": []any{}, "restrictions": []any{}}
	}
	return calmlens.JSON{"categorySettings": categories}
}

// checkPolicySettings refuses settings the API refuses: every category, each with an action and
// its allowances and restrictions lists, and no other category. The first problem is reported.
func checkPolicySettings(settings any) error {
	object, _ := settings.(map[string]any)
	categories, ok := object["categorySettings"].(map[string]any)
	if !ok {
		return validation(calmlens.CodeInvalidType, "settings.categorySettings")
	}
	for _, category := range mockCategories {
		path := "settings.categorySettings." + category
		value, ok := categories[category].(map[string]any)
		if !ok {
			return validation(calmlens.CodeInvalidType, path)
		}
		for _, key := range []string{"allowances", "restrictions"} {
			if _, ok := value[key].([]any); !ok {
				return validation(calmlens.CodeInvalidType, path+"."+key)
			}
		}
		if _, ok := value["action"].(string); !ok {
			return validation(calmlens.CodeInvalidValue, path+".action")
		}
	}
	for key := range categories {
		if !slices.Contains(mockCategories, key) {
			return validation(calmlens.CodeUnknownField, "settings.categorySettings."+key)
		}
	}
	return nil
}

// cloneJSON deep-copies a decoded JSON value.
func cloneJSON(value any) any {
	data, _ := json.Marshal(value)
	var out any
	_ = json.Unmarshal(data, &out)
	return out
}

// ensurePolicies creates the organisation's own General policy on first use, and makes it the
// project's.
func (m *MockServerClient) ensurePolicies() {
	if m.policies.projectPolicy != "" {
		return
	}
	m.policies.byID = map[string]*mockPolicy{}
	general := m.newPolicy(mockPresetNames[calmlens.PolicyPresetGeneral], "", mockPresetSettings(), calmlens.PolicyPresetGeneral, true)
	general.followsPreset = true
	m.policies.projectPolicy = general.id
}

func (m *MockServerClient) newPolicy(name, description string, settings any, presetID string, presetOwn bool) *mockPolicy {
	now := m.options.Now()
	policy := &mockPolicy{id: m.options.CreateID("pol"), name: name, description: description, settings: settings, baseline: cloneJSON(settings), revision: 1, presetID: presetID, presetOwn: presetOwn, createdAt: now, updatedAt: now}
	m.policies.byID[policy.id] = policy
	return policy
}

func (m *MockServerClient) policyJSON(policy *mockPolicy) calmlens.JSON {
	var preset any
	if policy.presetID != "" {
		mode := calmlens.PolicyPresetModeCopy
		switch {
		case policy.presetOwn && policy.followsPreset:
			mode = calmlens.PolicyPresetModeLive
		case policy.presetOwn:
			mode = calmlens.PolicyPresetModePinned
		}
		preset = calmlens.JSON{"id": policy.presetID, "version": 1, "latestVersion": 1, "mode": mode}
	}
	projects := []string{}
	if policy.id == m.policies.projectPolicy {
		projects = append(projects, m.options.ProjectID)
	}
	return calmlens.JSON{"id": policy.id, "name": policy.name, "description": policy.description, "settings": cloneJSON(policy.settings), "revision": policy.revision, "preset": preset, "projectIds": projects, "createdAt": policy.createdAt, "updatedAt": policy.updatedAt}
}

func (m *MockServerClient) findPolicy(id string) (*mockPolicy, error) {
	m.ensurePolicies()
	policy := m.policies.byID[id]
	if policy == nil {
		return nil, fail(calmlens.CodePolicyNotFound)
	}
	return policy, nil
}

// isNumber reports whether a decoded JSON value is the number want.
func isNumber(value any, want int) bool {
	n, ok := value.(float64)
	return ok && n == float64(want)
}

// projectPolicyRoute answers /projects/:id/policy: the project's policy, and assigning one.
func (m *MockServerClient) projectPolicyRoute(method string, body calmlens.JSON) (any, error) {
	switch method {
	case "GET":
		m.ensurePolicies()
		return m.policyJSON(m.policies.byID[m.policies.projectPolicy]), nil
	case "PUT":
		policy, err := m.findPolicy(text(body["policyId"]))
		if err != nil {
			return nil, err
		}
		m.policies.projectPolicy = policy.id
		return m.policyJSON(policy), nil
	}
	return nil, errUnknownRoute
}

// listPolicies pages the organisation's policies, oldest first unless sort says otherwise.
func (m *MockServerClient) listPolicies(q url.Values) (any, error) {
	size, err := intRange(q, "pageSize", defaultPageSize, 1, maxPageSize)
	if err != nil {
		return nil, err
	}
	ordering, err := cursorOrdering(q, sortRule{Field: "createdAt", Direction: sortAscending})
	if err != nil {
		return nil, err
	}
	m.ensurePolicies()
	items := []calmlens.JSON{}
	for _, policy := range m.policies.byID {
		items = append(items, m.policyJSON(policy))
	}
	return keysetPage(items, ordering, q.Get("cursor"), "policies", size)
}

// policyRoute answers /policies[/...]; parts follow "policies".
func (m *MockServerClient) policyRoute(method string, parts []string, body calmlens.JSON, q url.Values) (any, error) {
	if len(parts) == 0 {
		switch method {
		case "GET":
			return m.listPolicies(q)
		case "POST":
			return m.createPolicy(body)
		}
		return nil, errUnknownRoute
	}
	if len(parts) > 2 {
		return nil, errUnknownRoute
	}
	action := strings.Join(parts[1:], "/")
	switch method + " " + action {
	case "GET ", "PATCH ", "DELETE ", "POST reset", "POST upgrade", "PUT automatic-updates":
	default:
		return nil, errUnknownRoute
	}
	policy, err := m.findPolicy(parts[0])
	if err != nil {
		return nil, err
	}
	switch method + " " + action {
	case "GET ":
		return m.policyJSON(policy), nil
	case "PATCH ":
		return m.updatePolicy(policy, body)
	case "DELETE ":
		if policy.id == m.policies.projectPolicy {
			return nil, fail(calmlens.CodePolicyInUse)
		}
		delete(m.policies.byID, policy.id)
		return calmlens.JSON{}, nil
	case "POST reset":
		return m.restorePolicy(policy, false, body)
	case "POST upgrade":
		return m.restorePolicy(policy, true, body)
	default:
		return m.setPolicyAutomaticUpdates(policy, body)
	}
}

func (m *MockServerClient) createPolicy(body calmlens.JSON) (any, error) {
	m.ensurePolicies()
	name, _ := body["name"].(string)
	name = strings.TrimSpace(name)
	settings, hasSettings := body["settings"]
	preset, isPreset := body["presetId"].(string)
	_, known := mockPresetNames[preset]
	if hasSettings == isPreset || isPreset && !known || !isPreset && name == "" {
		return nil, fail(calmlens.CodeInvalidValue)
	}
	description, _ := body["description"].(string)
	if isPreset {
		if name == "" {
			name = mockPresetNames[preset]
		}
		return m.policyJSON(m.newPolicy(name, description, mockPresetSettings(), preset, false)), nil
	}
	if err := checkPolicySettings(settings); err != nil {
		return nil, err
	}
	return m.policyJSON(m.newPolicy(name, description, settings, "", false)), nil
}

// savePolicy applies change under the next revision, once revision is the current one.
func (m *MockServerClient) savePolicy(policy *mockPolicy, revision any, change func()) (any, error) {
	if !isNumber(revision, policy.revision) {
		return nil, fail(calmlens.CodePolicyRevisionConflict)
	}
	change()
	policy.revision++
	policy.updatedAt = m.options.Now()
	return m.policyJSON(policy), nil
}

func (m *MockServerClient) updatePolicy(policy *mockPolicy, body calmlens.JSON) (any, error) {
	if settings, ok := body["settings"]; ok {
		if err := checkPolicySettings(settings); err != nil {
			return nil, err
		}
	}
	return m.savePolicy(policy, body["revision"], func() {
		if name, ok := body["name"].(string); ok {
			policy.name = strings.TrimSpace(name)
		}
		if description, ok := body["description"].(string); ok {
			policy.description = description
		}
		if settings, ok := body["settings"]; ok {
			policy.settings = settings
		}
		// Saving a live policy pins it.
		policy.followsPreset = false
	})
}

// restorePolicy resets a pinned policy or copy to its preset release, or upgrades it to the
// latest (upgrade).
func (m *MockServerClient) restorePolicy(policy *mockPolicy, upgrade bool, body calmlens.JSON) (any, error) {
	if policy.presetID == "" || policy.followsPreset {
		return nil, fail(calmlens.CodePolicyNoPreset)
	}
	if !isNumber(body["presetVersion"], 1) {
		return nil, fail(calmlens.CodePolicyPresetVersionConflict)
	}
	// The mock's presets have one release, so an upgrade never has a newer one to apply.
	if upgrade {
		return nil, fail(calmlens.CodePolicyPresetUpdateUnavailable)
	}
	return m.savePolicy(policy, body["revision"], func() { policy.settings = cloneJSON(policy.baseline) })
}

func (m *MockServerClient) setPolicyAutomaticUpdates(policy *mockPolicy, body calmlens.JSON) (any, error) {
	enabled := body["enabled"] == true
	if !policy.presetOwn || policy.followsPreset == enabled {
		return nil, fail(calmlens.CodePolicyAutomaticUpdatesUnavailable)
	}
	if !isNumber(body["revision"], policy.revision) {
		return nil, fail(calmlens.CodePolicyRevisionConflict)
	}
	if !isNumber(body["presetVersion"], 1) {
		return nil, fail(calmlens.CodePolicyPresetVersionConflict)
	}
	return m.savePolicy(policy, body["revision"], func() {
		policy.followsPreset = enabled
		if enabled {
			policy.name, policy.description = mockPresetNames[policy.presetID], ""
			policy.settings = cloneJSON(policy.baseline)
		}
	})
}
