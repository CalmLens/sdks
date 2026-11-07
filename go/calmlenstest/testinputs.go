package calmlenstest

// Signed test inputs: text codes, test images and media phrases that a project's moderation
// recognises as a declared scenario when they are signed with its secret test input key and the
// project has "Recognise test inputs" turned on. The key is in the portal's project settings, for
// members and API keys that can read them. The formats match the backend byte for byte.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	calmlens "github.com/CalmLens/sdks/go"
)

// TestInput is a test scenario: the qualifying instances found, and optionally regional delivery
// actions, categories left unassessed and person and face detection results. A nil list is omitted
// from the signed scenario; a non-nil empty list is sent as an empty list.
type TestInput struct {
	// RegionalActions restrict delivery in up to 7 regions, each listed once.
	RegionalActions []TestRegionalAction `json:"regionalActions"`
	// UnassessedCategories are categories reported as not evaluated; none may have instances.
	UnassessedCategories []string `json:"unassessedCategories"`
	// Instances are the qualifying instances, at most 128.
	Instances []TestInstance `json:"instances"`
	// Detections are the person and face detection results to report, or nil for none.
	Detections *TestDetections `json:"detections,omitempty"`
}

// TestInstance is one qualifying instance of a category.
type TestInstance struct {
	// Category is one of the 8 moderation categories.
	Category string `json:"category"`
	// Score is the confidence from 0 to 1, or nil for the default.
	Score *float64 `json:"score,omitempty"`
	// Action is "allow", "limit", "age-restrict" or "block", or empty to let the project's policy
	// decide. Either every instance of a scenario has an action or none does.
	Action string `json:"action,omitempty"`
	// Qualifiers are unique qualifiers of the category, at most 64. Qualifiers set by the input
	// type, such as sexual-text, are added automatically and cannot be listed.
	Qualifiers []string `json:"qualifiers"`
}

// TestRegionalAction restricts delivery in one region: DE, AT, FR, GB, EU, AU or BR, with
// action "limit", "age-restrict" or "block".
type TestRegionalAction struct {
	Region string `json:"region"`
	Action string `json:"action"`
}

// TestInputKind is the kind of input a signal shortcut stands for.
type TestInputKind string

const (
	// TestInputText is a text input (GenerateTestTextCode).
	TestInputText TestInputKind = "text"
	// TestInputImage is an image input (PaintTestImage).
	TestInputImage TestInputKind = "image"
)

// TestInputPresetSet holds the built-in test scenarios.
type TestInputPresetSet struct {
	Clean            TestInput `json:"clean"`
	Limited          TestInput `json:"limited"`
	AdultImage       TestInput `json:"adultImage"`
	AdultText        TestInput `json:"adultText"`
	RegionalDelivery TestInput `json:"regionalDelivery"`
	Germany          TestInput `json:"germany"`
	Mixed            TestInput `json:"mixed"`
	// OneFace is one person with one face, without an age.
	OneFace TestInput `json:"oneFace"`
	// NoFace is person and face detection finding nobody.
	NoFace TestInput `json:"noFace"`
	// AdultFace is one person with an adult's face.
	AdultFace TestInput `json:"adultFace"`
	// MinorFace is one person with a minor's face.
	MinorFace TestInput `json:"minorFace"`
	// Group is three people, each with a face.
	Group TestInput `json:"group"`
}

// TestInputPresets returns the built-in test scenarios, freshly allocated so they can be edited.
func TestInputPresets() TestInputPresetSet {
	one := func(category string, qualifiers ...string) TestInput {
		return TestInput{Instances: []TestInstance{{Category: category, Qualifiers: qualifiers}}}
	}
	face := func(age TestFaceAge) TestInput {
		return TestInput{Instances: []TestInstance{}, Detections: &TestDetections{
			People: TestPersonList{{Box: TestBox{2500, 1500, 5000, 8500}}},
			Faces:  TestFaceList{{Box: TestBox{3500, 2000, 3000, 3500}, Age: age}},
		}}
	}
	return TestInputPresetSet{
		Clean:      TestInput{Instances: []TestInstance{}},
		Limited:    one("harassment", "harassment-abuse"),
		AdultImage: one("sexual", "sexual-pornographic-media"),
		AdultText:  one("sexual", "sexual-explicit-language"),
		RegionalDelivery: TestInput{Instances: []TestInstance{}, RegionalActions: []TestRegionalAction{
			{Region: "DE", Action: "block"}, {Region: "GB", Action: "age-restrict"}, {Region: "FR", Action: "limit"},
		}},
		Germany: one("hate", "hate-symbol", "hate-nazi-symbols-public-display"),
		Mixed: TestInput{Instances: []TestInstance{
			{Category: "harassment", Qualifiers: []string{"harassment-abuse", "harassment-documentary"}},
			{Category: "harassment", Qualifiers: []string{"harassment-threat"}},
		}},
		OneFace:   face(nil),
		NoFace:    TestInput{Instances: []TestInstance{}, Detections: &TestDetections{People: TestPersonList{}, Faces: TestFaceList{}}},
		AdultFace: face(TestAgeAdult),
		MinorFace: face(TestAgeMinor),
		Group: TestInput{Instances: []TestInstance{}, Detections: &TestDetections{
			People: TestPersonList{{Box: TestBox{500, 2000, 2800, 8000}}, {Box: TestBox{3600, 2000, 2800, 8000}}, {Box: TestBox{6700, 2000, 2800, 8000}}},
			Faces:  TestFaceList{{Box: TestBox{1200, 2500, 1400, 2000}}, {Box: TestBox{4300, 2500, 1400, 2000}}, {Box: TestBox{7400, 2500, 1400, 2000}}},
		}},
	}
}

// TestInputSignals returns the signals TestInputForSignal accepts: the 8 categories and
// sexual.involving-minors, harassment.insult, sexual.adult, hate.regional-symbol and
// violence.graphic.
func TestInputSignals() []string {
	return append(slices.Clone(mockCategories), "sexual.involving-minors", "harassment.insult", "sexual.adult", "hate.regional-symbol", "violence.graphic")
}

// MediaTestSignals returns the signals GenerateMediaTestCode accepts: the 8 categories and
// violence.graphic.
func MediaTestSignals() []string {
	return append(slices.Clone(mockCategories), "violence.graphic")
}

// TestInputForSignal returns the scenario a signal stands for in an input of the given kind. An
// unknown signal or kind is an sdk/invalid-argument error.
func TestInputForSignal(signal string, kind TestInputKind) (TestInput, error) {
	if kind != TestInputText && kind != TestInputImage {
		return TestInput{}, invalidTestInput("Test input kind must be text or image, not %q", kind)
	}
	presets := TestInputPresets()
	switch signal {
	case "harassment.insult":
		return presets.Limited, nil
	case "sexual.adult":
		if kind == TestInputImage {
			return presets.AdultImage, nil
		}
		return presets.AdultText, nil
	case "hate.regional-symbol":
		return presets.Germany, nil
	case "sexual.involving-minors":
		return TestInput{Instances: []TestInstance{{Category: "sexual", Qualifiers: []string{"sexual-minors"}}}}, nil
	case "violence.graphic":
		return TestInput{Instances: []TestInstance{{Category: "violence", Qualifiers: []string{"violence-injury", "violence-graphic"}}}}, nil
	}
	if !slices.Contains(mockCategories, signal) {
		return TestInput{}, invalidTestInput("Unknown test signal %q", signal)
	}
	return TestInput{Instances: []TestInstance{{Category: signal, Qualifiers: []string{}}}}, nil
}

// TestInputDefaultLifetimeSeconds is how long a text code or test image stays valid when
// TestInputCodeOptions doesn't set its expiry: one day.
const TestInputDefaultLifetimeSeconds = 24 * 60 * 60

// TestInputMaxLifetimeSeconds is the longest a code may still have to run when CalmLens reads it:
// CalmLens ignores a code or test image that expires more than seven days after it arrives.
const TestInputMaxLifetimeSeconds = 7 * 24 * 60 * 60

// TestInputCodeOptions are the options for GenerateTestTextCode and PaintTestImage. A nil
// *TestInputCodeOptions uses the defaults.
type TestInputCodeOptions struct {
	// ExpiresAt is when the code or image stops being recognised, in Unix seconds from 0 to
	// 4294967295.
	ExpiresAt int64
}

// testInputExpiry is the options' expiry, or one day from now.
func testInputExpiry(options *TestInputCodeOptions) (uint32, error) {
	if options == nil {
		return uint32(time.Now().Unix() + TestInputDefaultLifetimeSeconds), nil
	}
	if options.ExpiresAt < 0 || options.ExpiresAt > math.MaxUint32 {
		return 0, invalidTestInput("Test input expiry must be Unix seconds from 0 to 4294967295")
	}
	return uint32(options.ExpiresAt), nil
}

// testInputEnvelope is the signed bytes: the expiry (four bytes, big-endian Unix seconds), then
// the scenario's canonical JSON.
func testInputEnvelope(input TestInput, expiresAt uint32) []byte {
	return append(binary.BigEndian.AppendUint32(nil, expiresAt), canonicalTestInput(input)...)
}

// GenerateTestTextCode returns the signed text code for a scenario. CalmLens recognises it only as
// the whole of a text input (surrounding whitespace aside) in a project with test inputs turned on;
// any other text around it is moderated as ordinary content. The code expires, a day from now
// unless options set ExpiresAt, so generate it when the test runs rather than storing it.
// testInputKey is the project's secret test input key from the portal. An invalid key, scenario
// or expiry is an sdk/invalid-argument error.
func GenerateTestTextCode(input TestInput, testInputKey string, options *TestInputCodeOptions) (string, error) {
	if err := checkTestInputKey(testInputKey); err != nil {
		return "", err
	}
	if err := validateTestInput(input); err != nil {
		return "", err
	}
	expiresAt, err := testInputExpiry(options)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(testInputEnvelope(input, expiresAt))
	if len(payload) > 8000 {
		return "", invalidTestInput("Test scenario is too large")
	}
	return "<!calmlens-test " + testInputTag(testInputKey, "calmlens-test:v2:"+payload) + " " + payload + ">", nil
}

// GenerateMediaTestCode returns the phrase that triggers a signal (one of MediaTestSignals) in
// audio or video: read it aloud, or show it as large, high-contrast text in a frame. testInputKey
// is the project's secret test input key from the portal. An invalid key or signal is an
// sdk/invalid-argument error.
func GenerateMediaTestCode(signal, testInputKey string) (string, error) {
	if !slices.Contains(MediaTestSignals(), signal) {
		return "", invalidTestInput("Unsupported media test signal %q", signal)
	}
	if err := checkTestInputKey(testInputKey); err != nil {
		return "", err
	}
	words := []string{"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "alpha", "bravo", "charlie", "delta", "echo", "foxtrot"}
	phrase := []string{"Calm Lens test"}
	for _, digit := range testInputTag(testInputKey, "calmlens-test:media:"+signal) {
		value, _ := strconv.ParseUint(string(digit), 16, 8)
		phrase = append(phrase, words[value])
	}
	phrase = append(phrase, strings.NewReplacer(".", " ", "-", " ").Replace(signal), "end test")
	return strings.Join(phrase, " "), nil
}

// testInputQualifiers are the qualifiers a scenario may list for each category: all but those
// the input type sets.
func testInputQualifiers() map[string][]string {
	allowed := map[string][]string{}
	for category, qualifiers := range mockQualifiers {
		allowed[category] = slices.DeleteFunc(slices.Clone(qualifiers), func(q string) bool {
			return slices.Contains(inputQualifiers, q)
		})
	}
	return allowed
}

var (
	testInputActions    = []string{"allow", "limit", "age-restrict", "block"}
	testRegions         = []string{"DE", "AT", "FR", "GB", "EU", "AU", "BR"}
	regionalTestActions = []string{"limit", "age-restrict", "block"}
)

func validateTestInput(input TestInput) error {
	if len(input.Instances) > 128 {
		return invalidTestInput("A test scenario has at most 128 instances")
	}
	allowed := testInputQualifiers()
	withAction := 0
	for _, instance := range input.Instances {
		qualifiers, ok := allowed[instance.Category]
		switch {
		case !ok:
			return invalidTestInput("Unknown category %q", instance.Category)
		case instance.Score != nil && !isScore(*instance.Score):
			return invalidTestInput("Score must be a number from 0 to 1")
		case instance.Action != "" && !slices.Contains(testInputActions, instance.Action):
			return invalidTestInput("Action must be one of %s, not %q", strings.Join(testInputActions, ", "), instance.Action)
		case len(instance.Qualifiers) > 64:
			return invalidTestInput("An instance has at most 64 qualifiers")
		}
		if instance.Action != "" {
			withAction++
		}
		for i, qualifier := range instance.Qualifiers {
			if !slices.Contains(qualifiers, qualifier) || slices.Contains(instance.Qualifiers[:i], qualifier) {
				return invalidTestInput("Choose unique %s qualifiers; input-type qualifiers are automatic, not %q", instance.Category, qualifier)
			}
		}
	}
	if withAction != 0 && withAction != len(input.Instances) {
		return invalidTestInput("Set an action for every instance or omit all actions")
	}
	if len(input.UnassessedCategories) > len(mockCategories) {
		return invalidTestInput("A test scenario has at most %d unassessed categories", len(mockCategories))
	}
	for i, category := range input.UnassessedCategories {
		if !slices.Contains(mockCategories, category) || slices.Contains(input.UnassessedCategories[:i], category) ||
			slices.ContainsFunc(input.Instances, func(instance TestInstance) bool { return instance.Category == category }) {
			return invalidTestInput("Unassessed categories must be unique categories without instances, not %q", category)
		}
	}
	if len(input.RegionalActions) > len(testRegions) {
		return invalidTestInput("A test scenario has at most %d regional actions", len(testRegions))
	}
	for i, regional := range input.RegionalActions {
		if !slices.Contains(testRegions, regional.Region) || slices.ContainsFunc(input.RegionalActions[:i], func(other TestRegionalAction) bool { return other.Region == regional.Region }) {
			return invalidTestInput("Regional actions need unique regions from %s, not %q", strings.Join(testRegions, ", "), regional.Region)
		}
		if !slices.Contains(regionalTestActions, regional.Action) {
			return invalidTestInput("Regional action must be one of %s, not %q", strings.Join(regionalTestActions, ", "), regional.Action)
		}
	}
	return validateTestDetections(input.Detections)
}

// canonicalTestInput is the scenario's JSON in the backend's key order. Every string is a
// validated ASCII token, so none needs escaping.
func canonicalTestInput(input TestInput) []byte {
	b := []byte{'{'}
	list := func(name string, n int, item func(int)) {
		b = append(b, `"`+name+`":[`...)
		for i := range n {
			if i > 0 {
				b = append(b, ',')
			}
			item(i)
		}
		b = append(b, ']')
	}
	strs := func(values []string) func(int) {
		return func(i int) { b = append(b, `"`+values[i]+`"`...) }
	}
	if input.RegionalActions != nil {
		list("regionalActions", len(input.RegionalActions), func(i int) {
			b = append(b, `{"region":"`+input.RegionalActions[i].Region+`","action":"`+input.RegionalActions[i].Action+`"}`...)
		})
		b = append(b, ',')
	}
	if input.UnassessedCategories != nil {
		list("unassessedCategories", len(input.UnassessedCategories), strs(input.UnassessedCategories))
		b = append(b, ',')
	}
	list("instances", len(input.Instances), func(i int) {
		instance := input.Instances[i]
		b = append(b, `{"category":"`+instance.Category+`",`...)
		if instance.Score != nil {
			b = append(appendJSNumber(append(b, `"score":`...), *instance.Score), ',')
		}
		if instance.Action != "" {
			b = append(b, `"action":"`+instance.Action+`",`...)
		}
		list("qualifiers", len(instance.Qualifiers), strs(instance.Qualifiers))
		b = append(b, '}')
	})
	if input.Detections != nil {
		b = appendTestDetections(append(b, `,"detections":`...), input.Detections)
	}
	return append(b, '}')
}

// appendJSNumber formats a score in [0, 1] as JavaScript's JSON.stringify does: the shortest
// round-tripping digits, in exponent form below 1e-6, and 0 for -0.
func appendJSNumber(b []byte, value float64) []byte {
	if value == 0 {
		return append(b, '0')
	}
	if value >= 1e-6 {
		return strconv.AppendFloat(b, value, 'f', -1, 64)
	}
	exponent := strconv.FormatFloat(value, 'e', -1, 64) // 1.5e-07
	mantissa, power, _ := strings.Cut(exponent, "e")
	n, _ := strconv.Atoi(power)
	return append(append(b, mantissa...), "e"+strconv.Itoa(n)...)
}

func checkTestInputKey(key string) error {
	if len(key) != 32 || strings.Trim(key, "0123456789abcdef") != "" {
		return invalidTestInput("The test input key must be 32 lowercase hexadecimal characters")
	}
	return nil
}

// testInputTag is the first 32 hex characters of HMAC-SHA256(key's ASCII bytes, message).
func testInputTag(key, message string) string {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))[:32]
}

func invalidTestInput(format string, args ...any) error {
	return &calmlens.Error{Code: calmlens.CodeSDKInvalidArgument, Message: fmt.Sprintf(format, args...)}
}
