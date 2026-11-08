package calmlenstest

import (
	"encoding/json"
	"fmt"
	"maps"
	"net/url"
	"slices"
	"strconv"
	"strings"

	calmlens "github.com/CalmLens/sdks/go"
)

// configurationStore holds the project's upload presets by key, its settings as last sent and its
// metadata fields in display order. Settings and metadata fields share one revision.
type configurationStore struct {
	presets  map[string]calmlens.JSON
	revision int
	settings calmlens.JSON
	fields   []calmlens.JSON
}

func newConfigurationStore() configurationStore {
	return configurationStore{presets: map[string]calmlens.JSON{}, revision: 1, settings: calmlens.JSON{}, fields: []calmlens.JSON{}}
}

// sameJSON reports whether two values encode alike; maps encode with sorted keys.
func sameJSON(left, right any) bool {
	a, _ := json.Marshal(left)
	b, _ := json.Marshal(right)
	return string(a) == string(b)
}

// orDefault is value, or fallback when it is absent or null.
func orDefault(value, fallback any) any {
	if value == nil {
		return fallback
	}
	return value
}

// uniqueList is a list without repeats in the order sent, or null when it is empty or absent.
func uniqueList(value any) any {
	list, _ := value.([]any)
	if len(list) == 0 {
		return nil
	}
	seen := map[string]bool{}
	unique := []any{}
	for _, item := range list {
		if name := text(item); !seen[name] {
			seen[name] = true
			unique = append(unique, item)
		}
	}
	return unique
}

// listUploadPresets pages the project's upload presets, oldest first unless sort says otherwise.
func (m *MockServerClient) listUploadPresets(q url.Values) (any, error) {
	size, err := intRange(q, "pageSize", defaultPageSize, 1, maxPageSize)
	if err != nil {
		return nil, err
	}
	ordering, err := cursorOrdering(q, sortRule{Field: "createdAt", Direction: sortAscending})
	if err != nil {
		return nil, err
	}
	items := []calmlens.JSON{}
	for _, preset := range m.config.presets {
		items = append(items, preset)
	}
	return keysetPage(items, ordering, q.Get("cursor"), "upload-presets:"+m.options.ProjectID, size)
}

// ensureUploadPresets creates or replaces presets by key. Like the API, every preset's revision and
// settings are checked before any is saved, and an unchanged preset keeps its revision.
func (m *MockServerClient) ensureUploadPresets(body calmlens.JSON, now int64) (any, error) {
	definitions, _ := body["uploadPresets"].([]any)
	if len(definitions) == 0 {
		return nil, validation("validation/too-small", "uploadPresets")
	}
	type plan struct {
		existing, values calmlens.JSON
	}
	plans := make([]plan, 0, len(definitions))
	for index, value := range definitions {
		definition, _ := value.(map[string]any)
		key, name := text(definition["key"]), text(definition["name"])
		if key == "" {
			return nil, validation("validation/invalid-type", fmt.Sprintf("uploadPresets.%d.key", index))
		}
		if name == "" {
			return nil, validation("validation/invalid-type", fmt.Sprintf("uploadPresets.%d.name", index))
		}
		existing := m.config.presets[key]
		current := 0.0
		if existing != nil {
			current = number(existing["revision"])
		}
		if revision, sent := definition["revision"]; sent && number(revision) != current {
			failure := fail(calmlens.CodeUploadPresetRevisionConflict).(*apiError)
			failure.details = calmlens.JSON{"key": key, "revision": current}
			return nil, failure
		}
		values := calmlens.JSON{
			"key": key, "name": name,
			"access":              orDefault(definition["access"], calmlens.UploadPresetAccessToken),
			"enabled":             orDefault(definition["enabled"], true),
			"allowedContentTypes": uniqueList(definition["allowedContentTypes"]),
			"maxSizeInBytes":      definition["maxSizeInBytes"],
			"folderId":            definition["folderId"],
			"policyId":            definition["policyId"],
			"visibility":          orDefault(definition["visibility"], calmlens.VisibilityPrivate),
			"processingOptions":   definition["processingOptions"],
			"revealDecision":      orDefault(definition["revealDecision"], false),
			"dailyUploadLimit":    definition["dailyUploadLimit"],
			"allowedOrigins":      uniqueList(definition["allowedOrigins"]),
		}
		if values["access"] == calmlens.UploadPresetAccessAnyone && number(values["dailyUploadLimit"]) == 0 {
			return nil, fail(calmlens.CodeUploadPresetDailyLimitRequired)
		}
		plans = append(plans, plan{existing, values})
	}
	result := []calmlens.JSON{}
	for _, planned := range plans {
		existing := planned.existing
		if existing != nil {
			unchanged := true
			for key, value := range planned.values {
				unchanged = unchanged && sameJSON(value, existing[key])
			}
			if unchanged {
				result = append(result, existing)
				continue
			}
		}
		preset := calmlens.JSON{"projectId": m.options.ProjectID, "createdByUserId": nil, "updatedAt": now}
		for key, value := range planned.values {
			preset[key] = value
		}
		if existing != nil {
			preset["id"], preset["createdAt"], preset["revision"] = existing["id"], existing["createdAt"], number(existing["revision"])+1
		} else {
			preset["id"], preset["createdAt"], preset["revision"] = m.options.CreateID("preset"), now, 1
		}
		m.config.presets[text(preset["key"])] = preset
		result = append(result, preset)
	}
	return calmlens.JSON{"uploadPresets": result}, nil
}

// applyUploadPreset is an API-key upload through a preset, as the API applies it: the preset gives
// the folder and visibility, which the upload can't change, and the processing options unless the
// upload sets its own, and refuses types and sizes it doesn't accept. mime and size describe the
// upload's content, when hasContent. options is returned as it is without a preset.
func (m *MockServerClient) applyUploadPreset(options calmlens.JSON, hasContent bool, mime string, size int64) (calmlens.JSON, error) {
	id := text(options["uploadPresetId"])
	if id == "" {
		return options, nil
	}
	var preset calmlens.JSON
	for _, candidate := range m.config.presets {
		if candidate["id"] == id {
			preset = candidate
		}
	}
	if preset == nil {
		return nil, fail(calmlens.CodeUploadPresetNotFound)
	}
	if preset["enabled"] != true {
		return nil, fail(calmlens.CodeUploadPresetDisabled)
	}
	notAllowed := func(field string) error {
		failure := fail(calmlens.CodeUploadPresetFieldNotAllowed).(*apiError)
		failure.details = calmlens.JSON{"field": field}
		return failure
	}
	if folder := text(preset["folderId"]); folder != "" && text(options["folderId"]) != "" && options["folderId"] != folder {
		return nil, notAllowed("folderId")
	}
	if text(options["visibility"]) != "" && options["visibility"] != preset["visibility"] {
		return nil, notAllowed("visibility")
	}
	if hasContent {
		allowed, _ := preset["allowedContentTypes"].([]any)
		if len(allowed) > 0 && !acceptedByPreset(text(options["name"]), mime, allowed) {
			failure := fail(calmlens.CodeUnsupportedUploadType).(*apiError)
			failure.details = calmlens.JSON{"source": "preset", "contentType": mime, "allowedContentTypes": allowed}
			return nil, failure
		}
		if limit := number(preset["maxSizeInBytes"]); limit > 0 && float64(size) > limit {
			failure := fail(calmlens.CodeUploadTooLarge).(*apiError)
			failure.details = calmlens.JSON{"limitBytes": limit, "source": "preset"}
			return nil, failure
		}
	}
	applied := maps.Clone(options)
	applied["visibility"] = preset["visibility"]
	if preset["folderId"] != nil {
		applied["folderId"] = preset["folderId"]
	}
	if applied["processingOptions"] == nil && preset["processingOptions"] != nil {
		applied["processingOptions"] = preset["processingOptions"]
	}
	return applied, nil
}

// acceptedByPreset reads a preset's allowed types as the browser's file accept patterns: a
// wildcard, a type family such as image/*, a file extension or an exact type.
func acceptedByPreset(name, mime string, allowed []any) bool {
	name, mime = strings.ToLower(name), strings.ToLower(mime)
	return slices.ContainsFunc(allowed, func(value any) bool {
		pattern := strings.ToLower(strings.TrimSpace(text(value)))
		switch {
		case pattern == "*", pattern == "*/*":
			return true
		case strings.HasSuffix(pattern, "/*"):
			return strings.HasPrefix(mime, strings.TrimSuffix(pattern, "*"))
		case strings.HasPrefix(pattern, "."):
			return strings.HasSuffix(name, pattern)
		}
		return mime == pattern
	})
}

// uploadPresetRoute answers /upload-presets/:id, of which the mock serves only delete.
func (m *MockServerClient) uploadPresetRoute(method, id, suffix string) (any, error) {
	if method != "DELETE" || suffix != "" {
		return nil, errUnknownRoute
	}
	for key, preset := range m.config.presets {
		if preset["id"] == id {
			delete(m.config.presets, key)
			return calmlens.JSON{}, nil
		}
	}
	return nil, fail(calmlens.CodeUploadPresetNotFound)
}

// projectSettings is the settings resource, with defaults filled in.
func (m *MockServerClient) projectSettings() calmlens.JSON {
	settings := calmlens.JSON{
		"optOutJurisdictions": []any{}, "blockUnmoderatedAssets": true, "storeSensitiveMetadata": false,
		"streamingEnabled": false, "aiMediaSearchEnabled": false, "remoteUrlRule": nil, "websiteSubmissionsPerMinute": nil,
	}
	for key, value := range m.config.settings {
		settings[key] = value
	}
	humanReview := calmlens.JSON{"allowedSamplePercent": 0, "restrictedSamplePercent": 0, "uncertaintyMarginPercent": 0, "reviewMissingEvidence": false}
	if sent, ok := m.config.settings["humanReview"].(map[string]any); ok {
		for key, value := range sent {
			humanReview[key] = value
		}
	}
	settings["humanReview"] = humanReview
	return calmlens.JSON{"projectId": m.options.ProjectID, "revision": m.config.revision, "settings": settings}
}

// checkSettingsRevision refuses a sent revision that isn't the current one; nil isn't checked.
func (m *MockServerClient) checkSettingsRevision(revision any) error {
	if revision != nil && number(revision) != float64(m.config.revision) {
		return fail(calmlens.CodeProjectSettingsRevisionConflict)
	}
	return nil
}

// updateProjectSettings replaces the settings: those left out return to their defaults. Only a real
// change moves the revision.
func (m *MockServerClient) updateProjectSettings(body calmlens.JSON) (any, error) {
	if err := m.checkSettingsRevision(body["revision"]); err != nil {
		return nil, err
	}
	settings, ok := body["settings"].(map[string]any)
	if !ok {
		return nil, validation("validation/invalid-type", "settings")
	}
	before, previous := m.projectSettings()["settings"], m.config.settings
	m.config.settings = settings
	if sameJSON(m.projectSettings()["settings"], before) {
		m.config.settings = previous
	} else {
		m.config.revision++
	}
	return m.projectSettings(), nil
}

// metadataFields is the metadata fields resource.
func (m *MockServerClient) metadataFields() calmlens.JSON {
	return calmlens.JSON{"projectId": m.options.ProjectID, "revision": m.config.revision, "fields": m.config.fields}
}

// ensureMetadataFields creates or replaces fields by ID, keeping the others in order and adding new
// ones at the end. Only a real change moves the revision.
func (m *MockServerClient) ensureMetadataFields(body calmlens.JSON) (any, error) {
	if err := m.checkSettingsRevision(body["revision"]); err != nil {
		return nil, err
	}
	sent, _ := body["fields"].([]any)
	if len(sent) == 0 {
		return nil, validation("validation/too-small", "fields")
	}
	byID := map[string]calmlens.JSON{}
	for _, value := range sent {
		field, _ := value.(map[string]any)
		byID[text(field["id"])] = field
	}
	merged := make([]calmlens.JSON, 0, len(m.config.fields)+len(sent))
	known := map[string]bool{}
	for _, field := range m.config.fields {
		id := text(field["id"])
		known[id] = true
		if replacement, ok := byID[id]; ok {
			field = replacement
		}
		merged = append(merged, field)
	}
	for _, value := range sent {
		field, _ := value.(map[string]any)
		if !known[text(field["id"])] {
			merged = append(merged, field)
		}
	}
	if !sameJSON(merged, m.config.fields) {
		m.config.fields = merged
		m.config.revision++
	}
	return m.metadataFields(), nil
}

// deleteMetadataField deletes a field definition, refusing an unknown field before a stale revision
// like the API.
func (m *MockServerClient) deleteMetadataField(id string, q url.Values) (any, error) {
	remaining := make([]calmlens.JSON, 0, len(m.config.fields))
	for _, field := range m.config.fields {
		if text(field["id"]) != id {
			remaining = append(remaining, field)
		}
	}
	if len(remaining) == len(m.config.fields) {
		failure := fail(calmlens.CodeMetadataFieldNotFound).(*apiError)
		failure.details = calmlens.JSON{"fieldId": id}
		return nil, failure
	}
	if q.Has("revision") {
		revision, err := strconv.ParseFloat(q.Get("revision"), 64)
		if err != nil {
			return nil, m.checkSettingsRevision(-1.0)
		}
		if err = m.checkSettingsRevision(revision); err != nil {
			return nil, err
		}
	}
	m.config.fields = remaining
	m.config.revision++
	return m.metadataFields(), nil
}
