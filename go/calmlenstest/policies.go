package calmlenstest

import (
	"encoding/json"
	"slices"
	"strings"

	calmlens "github.com/CalmLens/sdks/go"
)

// ---- Policies -------------------------------------------------------------------------------
// The project starts on its General preset policy, following automatic updates. The mock holds
// no built-in preset settings: a preset's settings are {"categorySettings": {}} at version 1,
// and uploads are never decided by a policy.

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
	automaticUpdates      bool
	// presetID is empty for a policy that did not start from a preset; presetProject is the
	// project whose preset policy this is, empty for a copy.
	presetID, presetProject string
	createdAt, updatedAt    int64
}

// policyStore holds the organisation's policies, oldest first, and the project's policy.
type policyStore struct {
	byID          map[string]*mockPolicy
	order         []string
	projectPolicy string
}

func emptyPolicySettings() any { return calmlens.JSON{"categorySettings": calmlens.JSON{}} }

// cloneJSON deep-copies a decoded JSON value.
func cloneJSON(value any) any {
	data, _ := json.Marshal(value)
	var out any
	_ = json.Unmarshal(data, &out)
	return out
}

func (m *MockServerClient) ensurePolicies() {
	if m.policies.projectPolicy != "" {
		return
	}
	m.policies.byID = map[string]*mockPolicy{}
	general := m.newPolicy(mockPresetNames[calmlens.PolicyPresetGeneral], "", emptyPolicySettings(), calmlens.PolicyPresetGeneral, m.options.ProjectID)
	general.automaticUpdates = true
	m.policies.projectPolicy = general.id
}

func (m *MockServerClient) newPolicy(name, description string, settings any, presetID, presetProject string) *mockPolicy {
	now := m.options.Now()
	policy := &mockPolicy{id: m.options.CreateID("pol"), name: name, description: description, settings: settings, baseline: cloneJSON(settings), revision: 1, presetID: presetID, presetProject: presetProject, createdAt: now, updatedAt: now}
	m.policies.byID[policy.id] = policy
	m.policies.order = append(m.policies.order, policy.id)
	return policy
}

func (m *MockServerClient) policyJSON(policy *mockPolicy) calmlens.JSON {
	var preset any
	if policy.presetID != "" {
		var project any
		if policy.presetProject != "" {
			project = policy.presetProject
		}
		preset = calmlens.JSON{"id": policy.presetID, "version": 1, "latestVersion": 1, "projectId": project}
	}
	projects := []string{}
	if policy.id == m.policies.projectPolicy {
		projects = append(projects, m.options.ProjectID)
	}
	return calmlens.JSON{"id": policy.id, "name": policy.name, "description": policy.description, "settings": cloneJSON(policy.settings), "revision": policy.revision, "automaticUpdates": policy.automaticUpdates, "preset": preset, "projectIds": projects, "createdAt": policy.createdAt, "updatedAt": policy.updatedAt}
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

// policyRoute answers /projects/:id/policies[/...] and /projects/:id/policy.
func (m *MockServerClient) policyRoute(method string, parts []string, body calmlens.JSON) (any, error) {
	if parts[0] == "policy" {
		if method != "PUT" || len(parts) != 1 {
			return nil, errUnknownRoute
		}
		policy, err := m.findPolicy(text(body["policyId"]))
		if err != nil {
			return nil, err
		}
		m.policies.projectPolicy = policy.id
		return m.policyJSON(policy), nil
	}
	if len(parts) == 1 {
		switch method {
		case "GET":
			m.ensurePolicies()
			policies := []calmlens.JSON{}
			for _, id := range m.policies.order {
				policies = append(policies, m.policyJSON(m.policies.byID[id]))
			}
			return calmlens.JSON{"policies": policies, "projectPolicyId": m.policies.projectPolicy}, nil
		case "POST":
			return m.createPolicy(body)
		}
		return nil, errUnknownRoute
	}
	if len(parts) > 3 {
		return nil, errUnknownRoute
	}
	action := strings.Join(parts[2:], "/")
	switch method + " " + action {
	case "GET ", "PATCH ", "DELETE ", "POST preset", "PUT automatic-updates":
	default:
		return nil, errUnknownRoute
	}
	policy, err := m.findPolicy(parts[1])
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
		m.policies.order = slices.DeleteFunc(m.policies.order, func(id string) bool { return id == policy.id })
		return calmlens.JSON{}, nil
	case "POST preset":
		return m.applyPolicyPreset(policy, body)
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
		return m.policyJSON(m.newPolicy(name, description, emptyPolicySettings(), preset, "")), nil
	}
	return m.policyJSON(m.newPolicy(name, description, settings, "", "")), nil
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
		// Saving a policy that follows its preset pins it as a copy.
		policy.automaticUpdates = false
	})
}

func (m *MockServerClient) applyPolicyPreset(policy *mockPolicy, body calmlens.JSON) (any, error) {
	if policy.presetID == "" || policy.automaticUpdates {
		return nil, fail(calmlens.CodePolicyNoPreset)
	}
	if !isNumber(body["presetVersion"], 1) {
		return nil, fail(calmlens.CodePolicyPresetVersionConflict)
	}
	// The mock's presets have one release, so an update never has a newer one to apply.
	if body["operation"] == calmlens.PolicyPresetUpdate {
		return nil, fail(calmlens.CodePolicyPresetUpdateUnavailable)
	}
	return m.savePolicy(policy, body["revision"], func() { policy.settings = cloneJSON(policy.baseline) })
}

func (m *MockServerClient) setPolicyAutomaticUpdates(policy *mockPolicy, body calmlens.JSON) (any, error) {
	enabled := body["enabled"] == true
	if policy.presetProject != m.options.ProjectID || policy.automaticUpdates == enabled {
		return nil, fail(calmlens.CodePolicyAutomaticUpdatesUnavailable)
	}
	if !isNumber(body["revision"], policy.revision) {
		return nil, fail(calmlens.CodePolicyRevisionConflict)
	}
	if !isNumber(body["presetVersion"], 1) {
		return nil, fail(calmlens.CodePolicyPresetVersionConflict)
	}
	return m.savePolicy(policy, body["revision"], func() {
		policy.automaticUpdates = enabled
		if enabled {
			policy.name, policy.description = mockPresetNames[policy.presetID], ""
			policy.settings = cloneJSON(policy.baseline)
		}
	})
}
