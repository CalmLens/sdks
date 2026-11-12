package calmlens

// Replays testdata/types.json (packages/sdk-contract/README.md, "Declared types"): every public
// operation's options and result schema, walked alongside the Go types its client method
// declares. This file is the one runner of types.json; it reads it through internal/fixtures.
//
// How Go expresses the schema:
//   - Struct fields are named by their json tag, or, for fields the SDK encodes by hand (path and
//     query parameters, json:"-"), by their Go name compared case-insensitively.
//   - Optional is a pointer, a slice, a map, an interface, a Patch or an omitempty tag. Nullable is
//     a pointer, a slice, a map, an interface or a Patch. A slice or map can't say "never null" in
//     Go, so either is accepted where the API never sends null.
//   - Integers are any Go integer or float kind; numbers are float kinds.
//   - An enum is a named string type whose typed constants match the schema's values exactly, or a
//     plain string listed in openStrings below, whose constant block (when it has one) must also
//     match the values exactly.
//   - A union of objects is one struct that has the fields of every branch: a field is required
//     only when every branch requires it, and a discriminator's values are the branches'
//     constants together. A union of different kinds is any, json.RawMessage or a type that
//     encodes and decodes itself.

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/CalmLens/sdks/go/internal/fixtures"
)

// openStrings lists the enum fields Go declares as a plain string, keyed by "<Type>.<Field>"
// (with " key" for a map's keys). Go's convention keeps them open so a value added to the API
// after this SDK still decodes, and so callers can pass the API's strings directly. Each names a
// constant of the block that lists the field's values, or none when the SDK declares no
// constants for it; the block's values, less those excluded (values of other fields that share
// the block), must match the schema exactly.
type openString struct {
	constant string
	exclude  []string
}

var openStrings = map[string]openString{
	"Actor.Type":                                {constant: "ActorUser"},
	"Asset.Type":                                {constant: "AssetTypeImage"},
	"Asset.Visibility":                          {constant: "VisibilityPrivate"},
	"AssetClassification.FailureReason":         {constant: "AssetFailureReasonFileTooLarge"},
	"AssetClassification.Status":                {constant: "ClassificationStatusQueued"},
	"AssetContent.RemovalReason":                {constant: "ContentRemovalReasonPolicy"},
	"AssetContent.Status":                       {constant: "ContentStatusTemporary"},
	"AssetHls.Reason":                           {},
	"AssetHls.Status":                           {},
	"AssetModeration.AutomatedStatus":           {constant: "ModerationDecisionAllowed"},
	"AssetModeration.Categories key":            {constant: "CategoryPersonalInformation"},
	"AssetModeration.FlaggedCategories":         {constant: "CategoryPersonalInformation"},
	"AssetModeration.Source":                    {constant: "DecisionSourcePolicy"},
	"AssetModeration.Status":                    {constant: "ModerationStatusPending"},
	"AssetPendingReview.Reason":                 {},
	"AssetPendingReview.UncertainCategories":    {constant: "CategoryPersonalInformation"},
	"AssetReview.Decision":                      {constant: "ModerationDecisionAllowed"},
	"AssetSearchMatch.MatchedFields":            {constant: "MatchedFieldName"},
	"AssetSearchResponse.SemanticStatus":        {constant: "SemanticStatusDisabled"},
	"AssetUpload.Status":                        {},
	"BatchAssetsResponse.Status":                {constant: "BatchStatusQueued"},
	"CategoryPolicyScore.Action":                {constant: "ModerationActionAllow"},
	"CategoryPolicySettings.Action":             {constant: "ModerationActionAllow"},
	"CategoryPolicySettingsSnapshot.Action":     {constant: "ModerationActionAllow"},
	"CategoryPolicySource.Kind":                 {},
	"CategoryResult.Likelihood":                 {constant: "LikelihoodVeryUnlikely"},
	"CategoryResult.Qualifiers key":             {constant: "QualifierSexualPornographicMedia"},
	"CategoryResult.Reason":                     {constant: "ReasonNotSupported", exclude: []string{"in-children"}},
	"CategoryResult.Status":                     {constant: "ResultEvaluated"},
	"CreateHashListOptions.Action":              {constant: "HashListActionFlag"},
	"CreateLensOptions.Type":                    {constant: "LensTypeImage"},
	"CreatePolicyOptions.PresetID":              {constant: "PolicyPresetGeneral"},
	"DecideAssetOptions.Decision":               {constant: "ModerationDecisionAllowed"},
	"DecisionPolicyPreset.ID":                   {constant: "PolicyPresetGeneral"},
	"DetectedLink.Source":                       {},
	"EnsureLensOptions.Type":                    {constant: "LensTypeImage"},
	"Event.Severity":                            {constant: "SeverityLow"},
	"Event.Type":                                {constant: "EventAssetUploaded"},
	"EventAssetClassification.Status":           {constant: "ClassificationStatusQueued"},
	"EventAssetContent.Status":                  {constant: "ContentStatusTemporary"},
	"EventAssetModeration.Status":               {constant: "ModerationStatusPending"},
	"EventAssetUpload.Status":                   {},
	"EventFact.Key":                             {constant: "FactAssetName"},
	"EventsPage.ExcludedTypes":                  {constant: "EventAssetUploaded"},
	"ExtractedText.Type":                        {constant: "ExtractedTextString"},
	"FaceDetectionResult.Reason":                {constant: "ReasonNotSupported"},
	"FaceDetectionResult.Status":                {constant: "ResultEvaluated", exclude: []string{"partial"}},
	"HashList.Action":                           {constant: "HashListActionFlag"},
	"HashMatch.Action":                          {constant: "HashListActionFlag"},
	"HashMatch.Source":                          {constant: "HashMatchSourceHashList"},
	"Lens.Type":                                 {constant: "LensTypeImage"},
	"LinkDetectionResult.Reason":                {constant: "ReasonNotSupported"},
	"LinkDetectionResult.Status":                {constant: "ResultEvaluated", exclude: []string{"partial"}},
	"ListEventsOptions.Types":                   {constant: "EventAssetUploaded"},
	"MediaClassificationSegment.Categories key": {constant: "CategoryPersonalInformation"},
	"MediaClassificationSegment.Source":         {constant: "SegmentSourceFrame"},
	"MetadataField.Icon":                        {},
	"MetadataField.Type":                        {},
	"ModerationRaw.Categories key":              {constant: "CategoryPersonalInformation"},
	"OCRResult.Reason":                          {constant: "ReasonNotSupported"},
	"OCRResult.Status":                          {constant: "ResultEvaluated", exclude: []string{"partial"}},
	"PersonDetectionResult.Reason":              {constant: "ReasonNotSupported"},
	"PersonDetectionResult.Status":              {constant: "ResultEvaluated", exclude: []string{"partial"}},
	"PolicyPresetOrigin.ID":                     {constant: "PolicyPresetGeneral"},
	"PolicyPresetOrigin.Mode":                   {constant: "PolicyPresetModeLive"},
	"PolicyRuleSnapshot.Action":                 {constant: "ModerationActionAllow"},
	"PolicyRuleSnapshot.Unless":                 {constant: "QualifierSexualPornographicMedia"},
	"PolicyRuleSnapshot.When":                   {constant: "QualifierSexualPornographicMedia"},
	"PolicySettings.CategorySettings key":       {constant: "CategoryPersonalInformation"},
	"ProjectSettings.OptOutJurisdictions":       {},
	"ProjectSettingsInput.OptOutJurisdictions":  {},
	"QualifierResult.Likelihood":                {constant: "LikelihoodVeryUnlikely"},
	"QualifierResult.Reason":                    {constant: "ReasonNotSupported", exclude: []string{"in-children"}},
	"QualifierResult.Status":                    {constant: "ResultEvaluated", exclude: []string{"partial"}},
	"RegionalDecision.Category":                 {constant: "CategoryPersonalInformation"},
	"RegionalDecision.Region":                   {},
	"RegionalDecision.Status":                   {constant: "ModerationDecisionAllowed", exclude: []string{"allowed"}},
	"RemoteURLRule.Mode":                        {},
	"ReviewActor.Type":                          {constant: "ReviewActorUser"},
	"SafetyHold.Reason":                         {constant: "SafetyHoldReasonSuspectedIllegalContent"},
	"SearchAssetsOptions.Mode":                  {constant: "SearchModeKeyword"},
	"SubmitAssetOptions.Visibility":             {constant: "VisibilityPrivate"},
	"UpdateAssetOptions.Visibility":             {constant: "VisibilityPrivate"},
	"UpdateHashListOptions.Action":              {constant: "HashListActionFlag"},
	"UpdateLensOptions.Type":                    {constant: "LensTypeImage"},
	"UploadPreset.Access":                       {constant: "UploadPresetAccessToken"},
	"UploadPreset.Visibility":                   {constant: "VisibilityPrivate"},
	"UploadPresetDefinition.Access":             {constant: "UploadPresetAccessToken"},
	"UploadPresetDefinition.Visibility":         {constant: "VisibilityPrivate"},
}

// enumExtras lists constants Go keeps although types.json lacks them, keyed by "<Type>.<Field>"
// (or the enum type's name), with the reason. Only values the API hides behind a disabled feature
// switch belong here.
var enumExtras = map[string]map[string]string{
	"AssetModeration.Source": {"link-safety": "ENABLE_LINK_SAFETY: link safety decisions are hidden while the switch is off"},
}

// switchedOff lists fields types.json lacks because the API leaves them out of its schemas while
// their feature switch (ENABLE_* in packages/shared/src/SharedConstants.ts) is off, keyed by
// "<Type>.<Field>", with the switch. Go keeps them so the SDK works once the feature is on.
var switchedOff = map[string]string{
	"AssetClassification.AIGeneratedDetection": "ENABLE_AI_GENERATED_DETECTION",
	"AssetClassification.LinkSafety":           "ENABLE_LINK_SAFETY",
	"AssetModeration.LinkSafety":               "ENABLE_LINK_SAFETY",
	"PolicySettings.LinkSafety":                "ENABLE_LINK_SAFETY",
}

// sdkOnlyFields lists option fields the schema lacks because they have a Go-native form, keyed by
// "<Type>.<Field>", with the reason.
var sdkOnlyFields = map[string]string{
	"SubmitAssetOptions.Content":           "upload payload: the content to upload, sent as the request body or multipart parts",
	"SubmitAssetOptions.Part":              "upload payload: the first part of a multipart upload",
	"SubmitAssetOptions.URL":               "upload payload: a remote URL the API fetches, sent as url",
	"SubmitAssetOptions.TotalSizeInBytes":  "upload payload: the full size of a multipart upload started with Part",
	"UploadAssetPartOptions.Part":          "upload payload: the part's content",
	"UploadAssetPartOptions.Wait":          "wait: whether the final part waits for the decision, sent as a query parameter types.json leaves out",
	"SignAssetURLOptions.ProjectID":        "projectId, which types.json leaves out: another project's ID for the signed URL, defaulting to the client's",
	"SignAssetURLOptions.TransformOptions": "Go-native form of the transform client option: ImageTransformOptions the SDK serializes into the URL",
}

// typeExceptions lists differences Go cannot express, keyed by
// "<operation> <options|result> $.<path>", with the reason.
var typeExceptions = map[string]string{
	"ensureLenses result $": "the lens helper returns the lenses it ensured, not a response model (types.ts UNTYPED_RESULTS)",
}

type typeSchema struct {
	Type                 json.RawMessage        `json:"type"`
	Properties           map[string]*typeSchema `json:"properties"`
	Required             []string               `json:"required"`
	Items                *typeSchema            `json:"items"`
	PrefixItems          []*typeSchema          `json:"prefixItems"`
	AdditionalProperties json.RawMessage        `json:"additionalProperties"`
	PropertyNames        *typeSchema            `json:"propertyNames"`
	Enum                 []json.RawMessage      `json:"enum"`
	Const                json.RawMessage        `json:"const"`
	AnyOf                []*typeSchema          `json:"anyOf"`
	OneOf                []*typeSchema          `json:"oneOf"`
	AllOf                []*typeSchema          `json:"allOf"`
	Format               string                 `json:"format"`
	Ref                  string                 `json:"$ref"`
}

func (s *typeSchema) types() []string {
	if len(s.Type) == 0 {
		return nil
	}
	var list []string
	if s.Type[0] == '[' {
		_ = json.Unmarshal(s.Type, &list)
	} else {
		var one string
		_ = json.Unmarshal(s.Type, &one)
		list = []string{one}
	}
	return list
}

type typesFixture struct {
	Operations []struct {
		ID      string
		Method  string
		Names   struct{ Go string }
		Options struct {
			ClientOptions []string
			Properties    map[string]struct {
				Location string
				Schema   *typeSchema
			}
			Required []string
		}
		Result *typeSchema
	}
	Definitions map[string]*typeSchema
}

// typeWalker compares one operation side and collects its mismatches.
type typeWalker struct {
	t           *testing.T
	definitions map[string]*typeSchema
	consts      packageConstants
	prefix      string
	options     bool
	// patch is set for a PATCH operation's options, where null clears a field.
	patch         bool
	clientOptions map[string]bool
	problems      []string
	used          map[string]bool
}

func (w *typeWalker) fail(path, format string, args ...any) {
	key := w.prefix + " " + path
	if _, ok := typeExceptions[key]; ok {
		w.used["exception "+key] = true
		return
	}
	w.problems = append(w.problems, key+": "+fmt.Sprintf(format, args...))
}

// flat is a schema with its references resolved, its null branch removed and its union branches
// expanded.
type flat struct {
	nullable bool
	open     bool
	branches []*typeSchema
	refs     map[string]bool
}

// expand resolves s into its non-null branches. A reference already on refs stops the walk
// (recursion); stopped reports it.
func (w *typeWalker) expand(s *typeSchema, refs map[string]bool, out *flat) (stopped bool) {
	if s.Ref != "" {
		name := strings.TrimPrefix(s.Ref, "#/definitions/")
		if refs[name] || out.refs[name] {
			return true
		}
		definition, ok := w.definitions[name]
		if !ok {
			w.t.Fatalf("%s: unknown $ref %s", w.prefix, s.Ref)
		}
		out.refs[name] = true
		return w.expand(definition, refs, out)
	}
	union := append(append([]*typeSchema{}, s.AnyOf...), s.OneOf...)
	if len(union) > 0 && len(s.types()) == 0 && len(s.Properties) == 0 {
		for _, branch := range union {
			if w.expand(branch, refs, out) {
				stopped = true
			}
		}
		return stopped
	}
	kinds := s.types()
	if len(kinds) == 0 && s.Enum == nil && s.Const == nil && len(s.AllOf) == 0 {
		out.open = true
		return false
	}
	var others []string
	for _, kind := range kinds {
		if kind == "null" {
			out.nullable = true
		} else {
			others = append(others, kind)
		}
	}
	if len(kinds) > 0 && len(others) == 0 {
		return false
	}
	for _, value := range s.Enum {
		if string(value) == "null" {
			out.nullable = true
		}
	}
	if len(others) > 1 {
		for _, kind := range others {
			copied := *s
			copied.Type, _ = json.Marshal(kind)
			out.branches = append(out.branches, &copied)
		}
		return false
	}
	copied := *s
	if len(others) == 1 {
		copied.Type, _ = json.Marshal(others[0])
	}
	out.branches = append(out.branches, &copied)
	return false
}

func (w *typeWalker) flatten(s *typeSchema, refs map[string]bool) (flat, bool) {
	out := flat{refs: map[string]bool{}}
	stopped := w.expand(s, refs, &out)
	for name := range refs {
		out.refs[name] = true
	}
	// A union of every JSON kind is an open value.
	kinds := map[string]bool{}
	for _, branch := range out.branches {
		for _, kind := range branch.types() {
			kinds[kind] = true
		}
	}
	if kinds["string"] && kinds["number"] && kinds["boolean"] && kinds["object"] && kinds["array"] {
		out.open = true
	}
	return out, stopped && len(out.branches) == 0 && !out.open
}

var (
	rawMessageType  = reflect.TypeFor[json.RawMessage]()
	marshalerType   = reflect.TypeFor[json.Marshaler]()
	unmarshalerType = reflect.TypeFor[json.Unmarshaler]()
)

func isPatch(t reflect.Type) bool {
	return t.PkgPath() == reflect.TypeFor[Patch[string]]().PkgPath() && strings.HasPrefix(t.Name(), "Patch[")
}

func nilable(t reflect.Type) bool {
	switch t.Kind() {
	case reflect.Pointer, reflect.Slice, reflect.Map, reflect.Interface:
		return true
	}
	return isPatch(t)
}

func isOpenValue(t reflect.Type) bool {
	return t == rawMessageType || t.Kind() == reflect.Interface && t.NumMethod() == 0
}

func codesItself(t reflect.Type) bool {
	return t.Implements(marshalerType) || reflect.PointerTo(t).Implements(unmarshalerType) ||
		reflect.PointerTo(t).Implements(marshalerType)
}

// field is a struct field with the name the schema knows it by.
type field struct {
	name      string
	goName    string
	typ       reflect.Type
	omitempty bool
	tagged    bool
	// custom is set when the struct encodes itself (MarshalJSON).
	custom bool
	// dash is json:"-": a field the SDK encodes by hand in options, and leaves out of results.
	dash bool
}

// structFields lists t's encoded fields, flattening embedded structs as encoding/json does.
// Untagged and json:"-" fields are kept under their Go names (matched case-insensitively), since
// the SDK encodes path and query parameters by hand.
func structFields(t reflect.Type) []field {
	var fields []field
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if !f.IsExported() {
			continue
		}
		tag, hasTag := f.Tag.Lookup("json")
		name, flags, _ := strings.Cut(tag, ",")
		if f.Anonymous && name == "" {
			embedded := f.Type
			if embedded.Kind() == reflect.Pointer {
				embedded = embedded.Elem()
			}
			if embedded.Kind() == reflect.Struct {
				fields = append(fields, structFields(embedded)...)
				continue
			}
		}
		entry := field{goName: f.Name, typ: f.Type, omitempty: strings.Contains(","+flags+",", ",omitempty,") || strings.Contains(","+flags+",", ",omitzero,")}
		switch {
		case tag == "-":
			entry.dash = true
		case hasTag && name != "":
			entry.name, entry.tagged = name, true
		}
		fields = append(fields, entry)
	}
	return fields
}

func (w *typeWalker) object(t reflect.Type, owner string, properties map[string][]*typeSchema, required map[string]bool, locations map[string]string, refs map[string]bool, path string) {
	var fields []field
	custom := t.Implements(marshalerType)
	for _, f := range structFields(t) {
		f.custom = custom
		if !f.dash || w.options {
			fields = append(fields, f)
		}
	}
	matched := map[string]bool{}
	names := make([]string, 0, len(properties))
	for name := range properties {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		var found *field
		for _, f := range fields {
			if f.tagged && f.name == name || !f.tagged && strings.EqualFold(f.goName, name) {
				found = &f
				break
			}
		}
		if found == nil && w.options {
			// A field the SDK encodes itself may carry another tag; match its Go name too.
			for _, f := range fields {
				if strings.EqualFold(f.goName, name) {
					found = &f
					break
				}
			}
		}
		fieldPath := path + "." + name
		if found == nil {
			w.fail(fieldPath, "%s has no field for it", t)
			continue
		}
		matched[found.goName] = true
		schemas := properties[name]
		s := schemas[0]
		if len(schemas) > 1 {
			s = &typeSchema{AnyOf: schemas}
		}
		w.property(*found, owner+"."+found.goName, s, required[name], locations[name], refs, fieldPath)
	}
	for _, f := range fields {
		if matched[f.goName] {
			continue
		}
		if w.options && path == "$" && w.isClientOption(f) {
			continue
		}
		key := t.Name() + "." + f.goName
		if _, ok := switchedOff[key]; ok {
			w.used["switched "+key] = true
			continue
		}
		if _, ok := sdkOnlyFields[key]; ok && w.options {
			w.used["sdkOnly "+key] = true
			continue
		}
		name := f.name
		if name == "" {
			name = f.goName
		}
		w.fail(path+"."+name, "%s.%s is not in the API", t.Name(), f.goName)
	}
}

func (w *typeWalker) isClientOption(f field) bool {
	for name := range w.clientOptions {
		if f.tagged && f.name == name || strings.EqualFold(f.goName, name) {
			return true
		}
	}
	return false
}

func (w *typeWalker) property(f field, owner string, s *typeSchema, required bool, location string, refs map[string]bool, path string) {
	shape, stopped := w.flatten(s, refs)
	if stopped {
		return
	}
	t := f.typ
	pointerLike := t.Kind() == reflect.Pointer || isPatch(t)
	if !w.options {
		optional := nilable(t) || f.omitempty
		switch {
		case required && f.omitempty:
			w.fail(path, "required, but %s is omitempty", f.goName)
		case required && pointerLike && !shape.nullable:
			w.fail(path, "required and not nullable, but %s is %s", f.goName, t)
		case !required && !optional && !shape.open:
			w.fail(path, "optional, but %s (%s) is required", f.goName, t)
		}
		if shape.nullable && !nilable(t) && !shape.open {
			w.fail(path, "nullable, but %s (%s) can't be null", f.goName, t)
		}
		w.value(t, owner, shape, path)
		return
	}
	// Options the SDK encodes by hand (path and query parameters, untagged or json:"-" fields, or
	// a struct with its own MarshalJSON) leave a zero value or nil out, Go's convention for an unset
	// option; a tagged field without omitempty is always sent.
	byHand := !f.tagged || f.custom
	optional := nilable(t) || f.omitempty || byHand
	// sendsNull: the field can put null on the wire. A nil slice or map is not counted, since Go
	// can't declare one that is never nil.
	sendsNull := isPatch(t) || !byHand && !f.omitempty && (t.Kind() == reflect.Pointer || t.Kind() == reflect.Interface)
	switch {
	case required && pointerLike && !shape.nullable:
		w.fail(path, "required, but %s is %s", f.goName, t)
	case required && f.omitempty && !shape.open:
		w.fail(path, "required, but %s is omitempty", f.goName)
	case !required && !optional && !shape.open:
		w.fail(path, "optional, but %s (%s) is required", f.goName, t)
	}
	if !shape.open {
		if shape.nullable && w.patch && !sendsNull {
			w.fail(path, "clearable with null in this PATCH, but %s (%s) can't send null", f.goName, t)
		}
		if !shape.nullable && sendsNull {
			w.fail(path, "the API refuses null, but %s (%s) can send it", f.goName, t)
		}
	}
	w.value(t, owner, shape, path)
}

// value compares a Go type with a flattened schema, unwrapping pointers and Patch.
func (w *typeWalker) value(t reflect.Type, owner string, shape flat, path string) {
	for t.Kind() == reflect.Pointer || isPatch(t) {
		if isPatch(t) {
			t = t.Field(0).Type
		} else {
			t = t.Elem()
		}
	}
	if shape.open {
		if !isOpenValue(t) {
			w.fail(path, "an open JSON value, but declared as %s", t)
		}
		return
	}
	if len(shape.branches) == 0 {
		return
	}
	kinds := map[string]bool{}
	for _, branch := range shape.branches {
		kind := "string"
		if list := branch.types(); len(list) > 0 {
			kind = list[0]
		} else if branch.Const != nil || branch.Enum != nil {
			kind = constKind(branch)
		} else if len(branch.AllOf) > 0 || len(branch.Properties) > 0 {
			kind = "object"
		}
		kinds[kind] = true
	}
	if kinds["integer"] && kinds["number"] {
		delete(kinds, "integer")
	}
	// A form boolean (true, false or the multipart form's "true"/"false") is a bool in options:
	// the SDK sends JSON or form values it encodes itself, never the string spelling.
	if w.options && len(kinds) == 2 && kinds["boolean"] && kinds["string"] && t.Kind() == reflect.Bool {
		return
	}
	if len(kinds) > 1 {
		if !isOpenValue(t) && !codesItself(t) {
			w.fail(path, "a union of %s, but declared as %s", schemaKeys(kinds), t)
		}
		return
	}
	if isOpenValue(t) {
		return
	}
	for kind := range kinds {
		switch kind {
		case "string":
			w.stringValue(t, owner, shape.branches, path)
		case "boolean":
			if t.Kind() != reflect.Bool {
				w.fail(path, "a boolean, but declared as %s", t)
			}
		case "integer":
			if !isInteger(t) && !isFloat(t) {
				w.fail(path, "an integer, but declared as %s", t)
			}
		case "number":
			if !isFloat(t) {
				w.fail(path, "a number, but declared as %s", t)
			}
		case "array":
			w.array(t, owner, shape, path)
		case "object":
			w.objectValue(t, owner, shape, path)
		default:
			w.fail(path, "unknown schema type %q", kind)
		}
	}
}

func constKind(s *typeSchema) string {
	values := s.Enum
	if s.Const != nil {
		values = []json.RawMessage{s.Const}
	}
	for _, value := range values {
		switch {
		case len(value) > 0 && value[0] == '"':
			return "string"
		case string(value) == "true" || string(value) == "false":
			return "boolean"
		case string(value) == "null":
		default:
			return "number"
		}
	}
	return "string"
}

func isInteger(t reflect.Type) bool {
	switch t.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return true
	}
	return false
}

func isFloat(t reflect.Type) bool {
	return t.Kind() == reflect.Float32 || t.Kind() == reflect.Float64
}

func schemaKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// enumValues returns the branches' string values, or ok false when a branch is an open string.
func enumValues(branches []*typeSchema) (values []string, ok bool) {
	set := map[string]bool{}
	for _, branch := range branches {
		list := branch.Enum
		if branch.Const != nil {
			list = []json.RawMessage{branch.Const}
		}
		if list == nil {
			return nil, false
		}
		for _, raw := range list {
			var value string
			if json.Unmarshal(raw, &value) == nil {
				set[value] = true
			}
		}
	}
	return schemaKeys(set), true
}

func (w *typeWalker) stringValue(t reflect.Type, owner string, branches []*typeSchema, path string) {
	if t.Kind() != reflect.String {
		w.fail(path, "a string, but declared as %s", t)
		return
	}
	values, isEnum := enumValues(branches)
	named := t != reflect.TypeFor[string]()
	if named {
		declared, ok := w.consts.typed[t.Name()]
		if !ok {
			if isEnum {
				w.fail(path, "an enum of %v, but %s has no constants", values, t.Name())
			}
			return
		}
		if !isEnum {
			w.fail(path, "an open string, but %s is an enum of %v", t.Name(), declared)
			return
		}
		w.compareEnum(path, t.Name(), declared, values)
		return
	}
	if !isEnum {
		return
	}
	open, listed := openStrings[owner]
	if !listed {
		w.fail(path, "an enum of %v, but %s is a plain string (declare an enum type or list it in openStrings)", values, owner)
		return
	}
	w.used["open "+owner] = true
	if open.constant == "" {
		return
	}
	block, ok := w.consts.blockOf[open.constant]
	if !ok {
		w.t.Errorf("openStrings[%q] names %s, which is not an untyped string constant", owner, open.constant)
		return
	}
	var declared []string
	for _, value := range block {
		if !slices.Contains(open.exclude, value) {
			declared = append(declared, value)
		}
	}
	for _, value := range open.exclude {
		if !slices.Contains(block, value) || slices.Contains(values, value) {
			w.t.Errorf("openStrings[%q] excludes %q, which is not in its block or is one of the field's values", owner, value)
		}
	}
	w.compareEnum(path, owner, declared, values)
}

func (w *typeWalker) compareEnum(path, key string, declared, values []string) {
	want := map[string]bool{}
	for _, value := range values {
		want[value] = true
	}
	have := map[string]bool{}
	for _, value := range declared {
		have[value] = true
	}
	var missing, extra []string
	for _, value := range values {
		if !have[value] {
			missing = append(missing, value)
		}
	}
	for _, value := range declared {
		if want[value] {
			continue
		}
		if _, ok := enumExtras[key][value]; ok {
			w.used["extra "+key+" "+value] = true
			continue
		}
		extra = append(extra, value)
	}
	if len(missing) > 0 {
		w.fail(path, "%s lacks the API's values %v", key, missing)
	}
	if len(extra) > 0 {
		w.fail(path, "%s has values the API lacks: %v", key, extra)
	}
}

func (w *typeWalker) array(t reflect.Type, owner string, shape flat, path string) {
	if t.Kind() != reflect.Slice && t.Kind() != reflect.Array {
		w.fail(path, "an array, but declared as %s", t)
		return
	}
	var items []*typeSchema
	var prefix []*typeSchema
	for _, branch := range shape.branches {
		if branch.Items != nil {
			items = append(items, branch.Items)
		}
		prefix = append(prefix, branch.PrefixItems...)
	}
	if len(prefix) > 0 {
		if t.Kind() == reflect.Array && t.Len() != len(prefix) {
			w.fail(path, "a tuple of %d, but declared as %s", len(prefix), t)
		}
		for i, item := range prefix {
			next, stopped := w.flatten(item, shape.refs)
			if !stopped {
				w.value(t.Elem(), owner, next, fmt.Sprintf("%s[%d]", path, i))
			}
		}
		return
	}
	if len(items) == 0 {
		return
	}
	s := items[0]
	if len(items) > 1 {
		s = &typeSchema{AnyOf: items}
	}
	next, stopped := w.flatten(s, shape.refs)
	if !stopped {
		w.value(t.Elem(), owner, next, path+"[]")
	}
}

func (w *typeWalker) objectValue(t reflect.Type, owner string, shape flat, path string) {
	properties := map[string][]*typeSchema{}
	counts := map[string]int{}
	var records []*typeSchema
	var keyNames []*typeSchema
	refs := shape.refs
	objects := 0
	for _, branch := range shape.branches {
		parts := append([]*typeSchema{branch}, branch.AllOf...)
		objects++
		requiredHere := map[string]bool{}
		for _, part := range parts {
			if part != branch {
				resolved, stopped := w.flatten(part, refs)
				if stopped {
					continue
				}
				for _, inner := range resolved.branches {
					for name, s := range inner.Properties {
						properties[name] = append(properties[name], s)
					}
					for _, name := range inner.Required {
						requiredHere[name] = true
					}
				}
				continue
			}
			for name, s := range part.Properties {
				properties[name] = append(properties[name], s)
			}
			for _, name := range part.Required {
				requiredHere[name] = true
			}
			if len(part.AdditionalProperties) > 0 && part.AdditionalProperties[0] == '{' {
				var record typeSchema
				if err := json.Unmarshal(part.AdditionalProperties, &record); err != nil {
					w.t.Fatal(err)
				}
				records = append(records, &record)
			}
			if part.PropertyNames != nil {
				keyNames = append(keyNames, part.PropertyNames)
			}
		}
		for name := range requiredHere {
			counts[name]++
		}
	}
	if len(properties) == 0 && len(records) > 0 {
		if open, _ := w.flatten(records[0], refs); open.open && len(records) == 1 && len(keyNames) == 0 {
			// A record of open values takes any declared object.
			if t.Kind() != reflect.Map && t.Kind() != reflect.Struct && !isOpenValue(t) {
				w.fail(path, "an object, but declared as %s", t)
			}
			return
		}
		if t.Kind() != reflect.Map {
			w.fail(path, "a record, but declared as %s", t)
			return
		}
		if len(keyNames) > 0 {
			keys, stopped := w.flatten(keyNames[0], refs)
			if !stopped {
				w.value(t.Key(), owner+" key", keys, path+"{key}")
			}
		}
		s := records[0]
		if len(records) > 1 {
			s = &typeSchema{AnyOf: records}
		}
		next, stopped := w.flatten(s, refs)
		if !stopped {
			w.value(t.Elem(), owner, next, path+"{}")
		}
		return
	}
	if t.Kind() == reflect.Map && len(properties) > 0 {
		// A map keyed by a fixed set of names, such as the eight categories: Go can't require each
		// key, so the keys must be exactly the property names and every value matches.
		keys := &typeSchema{Type: json.RawMessage(`"string"`)}
		for _, name := range schemaKeys(properties) {
			raw, _ := json.Marshal(name)
			keys.Enum = append(keys.Enum, raw)
		}
		w.stringValue(t.Key(), owner+" key", []*typeSchema{keys}, path+"{key}")
		for _, name := range schemaKeys(properties) {
			schemas := properties[name]
			s := schemas[0]
			if len(schemas) > 1 {
				s = &typeSchema{AnyOf: schemas}
			}
			next, stopped := w.flatten(s, refs)
			if stopped {
				continue
			}
			if next.nullable && !nilable(t.Elem()) {
				w.fail(path+"."+name, "nullable, but the map's values (%s) can't be null", t.Elem())
			}
			w.value(t.Elem(), owner, next, path+"."+name)
		}
		return
	}
	if t.Kind() != reflect.Struct {
		if len(properties) > 0 {
			w.fail(path, "an object with fields %v, but declared as %s", schemaKeys(properties), t)
		}
		return
	}
	required := map[string]bool{}
	for name, count := range counts {
		if count == objects {
			required[name] = true
		}
	}
	w.object(t, t.Name(), properties, required, nil, refs, path)
}

// packageConstants are the package's string constants: typed ones by their type's name, and
// untyped ones by the block that declares them, keyed by each constant's name.
type packageConstants struct {
	typed   map[string][]string
	blockOf map[string][]string
}

func readPackageConstants(t *testing.T) packageConstants {
	t.Helper()
	paths, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	files := token.NewFileSet()
	constants := packageConstants{typed: map[string][]string{}, blockOf: map[string][]string{}}
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(files, path, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, declaration := range file.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.CONST {
				continue
			}
			var block []string
			var names []string
			for _, spec := range general.Specs {
				value := spec.(*ast.ValueSpec)
				for i, name := range value.Names {
					if i >= len(value.Values) {
						continue
					}
					literal, ok := value.Values[i].(*ast.BasicLit)
					if !ok || literal.Kind != token.STRING {
						continue
					}
					text, err := strconv.Unquote(literal.Value)
					if err != nil {
						t.Fatal(err)
					}
					if ident, ok := value.Type.(*ast.Ident); ok {
						constants.typed[ident.Name] = append(constants.typed[ident.Name], text)
					} else if value.Type == nil {
						block = append(block, text)
						names = append(names, name.Name)
					}
				}
			}
			for _, name := range names {
				constants.blockOf[name] = block
			}
		}
	}
	return constants
}

func TestDeclaredTypesContract(t *testing.T) {
	fixture := fixtures.Read[typesFixture](t, "types.json")
	client, err := NewServerClient(Options{APIKey: "key", ProjectID: "project-1"})
	if err != nil {
		t.Fatal(err)
	}
	consts := readPackageConstants(t)
	used := map[string]bool{}
	var problems []string
	for _, operation := range fixture.Operations {
		target := reflect.ValueOf(client)
		parts := strings.Split(operation.Names.Go, ".")
		for _, part := range parts[:len(parts)-1] {
			target = target.Elem().FieldByName(part)
		}
		method := target.MethodByName(parts[len(parts)-1])
		if !method.IsValid() {
			problems = append(problems, fmt.Sprintf("%s: no method %s", operation.ID, operation.Names.Go))
			continue
		}
		declaration := method.Type()
		options := &typeWalker{t: t, definitions: fixture.Definitions, consts: consts, prefix: operation.ID + " options", options: true, patch: operation.Method == "PATCH", clientOptions: map[string]bool{}, used: used}
		for _, name := range operation.Options.ClientOptions {
			options.clientOptions[name] = true
		}
		if declaration.NumIn() >= 2 {
			optionsType := declaration.In(1)
			properties := map[string][]*typeSchema{}
			locations := map[string]string{}
			for name, property := range operation.Options.Properties {
				properties[name] = []*typeSchema{property.Schema}
				locations[name] = property.Location
			}
			required := map[string]bool{}
			for _, name := range operation.Options.Required {
				required[name] = true
			}
			if optionsType.Kind() != reflect.Struct {
				options.fail("$", "options are declared as %s, not a struct", optionsType)
			} else {
				options.object(optionsType, optionsType.Name(), properties, required, locations, map[string]bool{}, "$")
			}
		} else if len(operation.Options.Properties) > 0 {
			options.fail("$", "the method takes no options, but the API has %v", schemaKeys(operation.Options.Properties))
		}
		problems = append(problems, options.problems...)

		result := &typeWalker{t: t, definitions: fixture.Definitions, consts: consts, prefix: operation.ID + " result", used: used}
		if operation.Result == nil {
			if declaration.NumOut() != 1 {
				result.fail("$", "the API returns no model, but the method returns %d values", declaration.NumOut())
			}
		} else if declaration.NumOut() != 2 {
			result.fail("$", "the API returns a model, but the method returns none")
		} else {
			shape, _ := result.flatten(operation.Result, map[string]bool{})
			resultType := declaration.Out(0)
			if resultType.Kind() == reflect.Pointer && !shape.nullable {
				resultType = resultType.Elem()
			}
			result.value(resultType, resultType.Name(), shape, "$")
		}
		problems = append(problems, result.problems...)
	}
	for _, problem := range problems {
		t.Error(problem)
	}
	for owner := range openStrings {
		if !used["open "+owner] {
			t.Errorf("openStrings lists %s, which no operation declares as an enum", owner)
		}
	}
	for key, values := range enumExtras {
		for value := range values {
			if !used["extra "+key+" "+value] {
				t.Errorf("enumExtras lists %s %q, which Go no longer declares or the API now has", key, value)
			}
		}
	}
	for key := range switchedOff {
		if !used["switched "+key] {
			t.Errorf("switchedOff lists %s, which types.json now has or Go no longer declares", key)
		}
	}
	for key := range sdkOnlyFields {
		if !used["sdkOnly "+key] {
			t.Errorf("sdkOnlyFields lists %s, which no options type declares outside the API", key)
		}
	}
	for key := range typeExceptions {
		if !used["exception "+key] {
			t.Errorf("typeExceptions lists %q, which no longer differs", key)
		}
	}
}
