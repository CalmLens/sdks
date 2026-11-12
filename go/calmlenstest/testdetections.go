package calmlenstest

// Person and face detection results a test scenario declares.

import (
	"bytes"
	"encoding/json"
	"errors"
	"slices"
	"strconv"

	"calmlens.com/go/calmlens"
)

// TestDetections are the person and face detection results a scenario reports. A nil field is
// omitted from the signed scenario.
type TestDetections struct {
	// People is a TestPersonList, or TestUnavailable to report person detection as not evaluated.
	People TestPeople `json:"people,omitempty"`
	// Faces is a TestFaceList, or TestUnavailable to report face detection as not evaluated.
	Faces TestFaces `json:"faces,omitempty"`
}

// TestPeople is a scenario's person detection: a TestPersonList or TestUnavailable.
type TestPeople interface{ isTestPeople() }

// TestFaces is a scenario's face detection: a TestFaceList or TestUnavailable.
type TestFaces interface{ isTestFaces() }

// TestPersonList is the people found, at most 32. A nil list is sent as an empty list.
type TestPersonList []TestPerson

// TestFaceList is the faces found, at most 32. A nil list is sent as an empty list.
type TestFaceList []TestFace

// TestUnavailable reports a detection feature as not evaluated.
type TestUnavailable struct{}

func (TestPersonList) isTestPeople()  {}
func (TestFaceList) isTestFaces()     {}
func (TestUnavailable) isTestPeople() {}
func (TestUnavailable) isTestFaces()  {}

// MarshalJSON encodes TestUnavailable as "unavailable".
func (TestUnavailable) MarshalJSON() ([]byte, error) { return []byte(`"unavailable"`), nil }

// TestBox is a region of the image as [left, top, width, height], in basis points of the image's
// width and height (0 to 10000). It must lie within the image.
type TestBox [4]int

// TestPerson is one person found.
type TestPerson struct {
	Box TestBox `json:"box"`
	// Confidence is from 0 to 100, or nil for the default.
	Confidence *int `json:"confidence,omitempty"`
}

// TestFace is one face found.
type TestFace struct {
	Box TestBox `json:"box"`
	// Confidence is from 0 to 100, or nil for the default.
	Confidence *int `json:"confidence,omitempty"`
	// Age is the estimated age: TestAgeAdult, TestAgeMinor or a TestAgeRange, or nil for none.
	Age TestFaceAge `json:"age,omitempty"`
}

// TestFaceAge is a face's estimated age: a TestAgePreset or a TestAgeRange.
type TestFaceAge interface{ isTestFaceAge() }

// TestAgePreset is a named age range.
type TestAgePreset string

const (
	// TestAgeAdult is an adult's age range.
	TestAgeAdult TestAgePreset = "adult"
	// TestAgeMinor is a minor's age range.
	TestAgeMinor TestAgePreset = "minor"
)

// TestAgeRange is an estimated age range in years, from 0 to 120 with Low at most High.
type TestAgeRange struct {
	Low  int `json:"low"`
	High int `json:"high"`
}

func (TestAgePreset) isTestFaceAge() {}
func (TestAgeRange) isTestFaceAge()  {}

func validateTestDetections(detections *TestDetections) error {
	if detections == nil {
		return nil
	}
	switch people := detections.People.(type) {
	case nil, TestUnavailable:
	case TestPersonList:
		if len(people) > testDetectionsMax {
			return invalidTestInput("A test scenario has at most %d people", testDetectionsMax)
		}
		for _, person := range people {
			if err := validateTestDetection(person.Box, person.Confidence); err != nil {
				return err
			}
		}
	default:
		return invalidTestInput("People must be a TestPersonList or TestUnavailable, not %T", people)
	}
	switch faces := detections.Faces.(type) {
	case nil, TestUnavailable:
	case TestFaceList:
		if len(faces) > testDetectionsMax {
			return invalidTestInput("A test scenario has at most %d faces", testDetectionsMax)
		}
		for _, face := range faces {
			if err := validateTestDetection(face.Box, face.Confidence); err != nil {
				return err
			}
			switch age := face.Age.(type) {
			case nil:
			case TestAgePreset:
				if !slices.Contains(testFaceAgePresets, string(age)) {
					return invalidTestInput("Unknown age preset %q", age)
				}
			case TestAgeRange:
				if age.Low < 0 || age.High > testFaceAgeMax || age.Low > age.High {
					return invalidTestInput("An age range runs from 0 to %d with low at most high", testFaceAgeMax)
				}
			default:
				return invalidTestInput("Age must be a TestAgePreset or TestAgeRange, not %T", age)
			}
		}
	default:
		return invalidTestInput("Faces must be a TestFaceList or TestUnavailable, not %T", faces)
	}
	return nil
}

func validateTestDetection(box TestBox, confidence *int) error {
	for _, value := range box {
		if value < 0 || value > testDetectionBoxMax {
			return invalidTestInput("Box values run from 0 to %d", testDetectionBoxMax)
		}
	}
	if box[0]+box[2] > testDetectionBoxMax || box[1]+box[3] > testDetectionBoxMax {
		return invalidTestInput("A box must lie within the image")
	}
	if confidence != nil && (*confidence < 0 || *confidence > 100) {
		return invalidTestInput("Confidence runs from 0 to 100")
	}
	return nil
}

// appendTestDetections appends the detections' canonical JSON: people then faces, each entry's
// box, confidence and age in that order.
func appendTestDetections(b []byte, detections *TestDetections) []byte {
	b = append(b, '{')
	entries := func(n int, entry func(int)) {
		b = append(b, '[')
		for i := range n {
			if i > 0 {
				b = append(b, ',')
			}
			entry(i)
		}
		b = append(b, ']')
	}
	detection := func(box TestBox, confidence *int) {
		b = append(b, `{"box":[`...)
		for i, value := range box {
			if i > 0 {
				b = append(b, ',')
			}
			b = strconv.AppendInt(b, int64(value), 10)
		}
		b = append(b, ']')
		if confidence != nil {
			b = strconv.AppendInt(append(b, `,"confidence":`...), int64(*confidence), 10)
		}
	}
	if detections.People != nil {
		b = append(b, `"people":`...)
		switch people := detections.People.(type) {
		case TestUnavailable:
			b = append(b, `"unavailable"`...)
		case TestPersonList:
			entries(len(people), func(i int) {
				detection(people[i].Box, people[i].Confidence)
				b = append(b, '}')
			})
		}
		if detections.Faces != nil {
			b = append(b, ',')
		}
	}
	if detections.Faces != nil {
		b = append(b, `"faces":`...)
		switch faces := detections.Faces.(type) {
		case TestUnavailable:
			b = append(b, `"unavailable"`...)
		case TestFaceList:
			entries(len(faces), func(i int) {
				face := faces[i]
				detection(face.Box, face.Confidence)
				switch age := face.Age.(type) {
				case TestAgePreset:
					b = append(b, `,"age":"`+string(age)+`"`...)
				case TestAgeRange:
					b = strconv.AppendInt(append(b, `,"age":{"low":`...), int64(age.Low), 10)
					b = append(strconv.AppendInt(append(b, `,"high":`...), int64(age.High), 10), '}')
				}
				b = append(b, '}')
			})
		}
	}
	return append(b, '}')
}

// UnmarshalJSON decodes detections strictly: unknown, repeated or null keys are an
// sdk/invalid-argument error.
func (d *TestDetections) UnmarshalJSON(data []byte) error {
	*d = TestDetections{}
	_, err := decodeTestObject(data, "Detections", map[string]func(json.RawMessage) error{
		"people": func(raw json.RawMessage) error {
			if isUnavailable(raw) {
				d.People = TestUnavailable{}
				return nil
			}
			var people TestPersonList
			if err := decodeTestList(raw, "People", &people); err != nil {
				return err
			}
			d.People = people
			return nil
		},
		"faces": func(raw json.RawMessage) error {
			if isUnavailable(raw) {
				d.Faces = TestUnavailable{}
				return nil
			}
			var faces TestFaceList
			if err := decodeTestList(raw, "Faces", &faces); err != nil {
				return err
			}
			d.Faces = faces
			return nil
		},
	})
	return err
}

// UnmarshalJSON decodes a person strictly: box is required, and unknown, repeated or null keys
// are an sdk/invalid-argument error.
func (p *TestPerson) UnmarshalJSON(data []byte) error {
	*p = TestPerson{}
	seen, err := decodeTestObject(data, "A person", map[string]func(json.RawMessage) error{
		"box":        func(raw json.RawMessage) error { return decodeTestBox(raw, &p.Box) },
		"confidence": func(raw json.RawMessage) error { return decodeTestOptionalInt(raw, "Confidence", &p.Confidence) },
	})
	if err == nil && !seen["box"] {
		return invalidTestInput("A person needs a box")
	}
	return err
}

// UnmarshalJSON decodes a face strictly: box is required, and unknown, repeated or null keys are
// an sdk/invalid-argument error.
func (f *TestFace) UnmarshalJSON(data []byte) error {
	*f = TestFace{}
	seen, err := decodeTestObject(data, "A face", map[string]func(json.RawMessage) error{
		"box":        func(raw json.RawMessage) error { return decodeTestBox(raw, &f.Box) },
		"confidence": func(raw json.RawMessage) error { return decodeTestOptionalInt(raw, "Confidence", &f.Confidence) },
		"age":        func(raw json.RawMessage) error { return decodeTestFaceAge(raw, &f.Age) },
	})
	if err == nil && !seen["box"] {
		return invalidTestInput("A face needs a box")
	}
	return err
}

func decodeTestFaceAge(raw json.RawMessage, age *TestFaceAge) error {
	var preset string
	if json.Unmarshal(raw, &preset) == nil {
		if !slices.Contains(testFaceAgePresets, preset) {
			return invalidTestInput("Unknown age preset %q", preset)
		}
		*age = TestAgePreset(preset)
		return nil
	}
	var ageRange TestAgeRange
	seen, err := decodeTestObject(raw, "An age", map[string]func(json.RawMessage) error{
		"low":  func(raw json.RawMessage) error { return decodeTestInt(raw, "Low", &ageRange.Low) },
		"high": func(raw json.RawMessage) error { return decodeTestInt(raw, "High", &ageRange.High) },
	})
	if err != nil {
		return err
	}
	if !seen["low"] || !seen["high"] {
		return invalidTestInput("An age range needs low and high")
	}
	*age = ageRange
	return nil
}

func isUnavailable(raw json.RawMessage) bool {
	var value string
	return json.Unmarshal(raw, &value) == nil && value == "unavailable"
}

func decodeTestList[L ~[]T, T any](raw json.RawMessage, what string, list *L) error {
	if raw[0] != '[' {
		return invalidTestInput("%s must be a list or \"unavailable\"", what)
	}
	if err := json.Unmarshal(raw, list); err != nil {
		return asInvalidTestInput(err, what)
	}
	if *list == nil {
		*list = L{}
	}
	return nil
}

func decodeTestBox(raw json.RawMessage, box *TestBox) error {
	var values []json.RawMessage
	if err := json.Unmarshal(raw, &values); err != nil || len(values) != len(box) {
		return invalidTestInput("A box is a list of 4 integers")
	}
	for i, value := range values {
		if err := decodeTestInt(value, "Box values", &box[i]); err != nil {
			return err
		}
	}
	return nil
}

func decodeTestOptionalInt(raw json.RawMessage, what string, value **int) error {
	var n int
	if err := decodeTestInt(raw, what, &n); err != nil {
		return err
	}
	*value = &n
	return nil
}

// decodeTestInt decodes a JSON integer; null, fractions and other types are refused.
func decodeTestInt(raw json.RawMessage, what string, value *int) error {
	if bytes.Equal(raw, []byte("null")) || json.Unmarshal(raw, value) != nil {
		return invalidTestInput("%s must be integers", what)
	}
	return nil
}

// decodeTestObject decodes a JSON object whose keys are among fields, each given once and not
// null, and returns the keys it held.
func decodeTestObject(data []byte, what string, fields map[string]func(json.RawMessage) error) (map[string]bool, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return nil, invalidTestInput("%s must be an object", what)
	}
	seen := map[string]bool{}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, asInvalidTestInput(err, what)
		}
		key, _ := token.(string)
		decode, known := fields[key]
		switch {
		case !known:
			return nil, invalidTestInput("%s has no field %q", what, key)
		case seen[key]:
			return nil, invalidTestInput("%s gives %q twice", what, key)
		}
		seen[key] = true
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			return nil, asInvalidTestInput(err, what)
		}
		if bytes.Equal(raw, []byte("null")) {
			return nil, invalidTestInput("%s cannot set %q to null", what, key)
		}
		if err := decode(raw); err != nil {
			return nil, err
		}
	}
	return seen, nil
}

// asInvalidTestInput returns err if it is already an SDK error, else an sdk/invalid-argument
// error describing it.
func asInvalidTestInput(err error, what string) error {
	if sdkError := (*calmlens.Error)(nil); errors.As(err, &sdkError) {
		return err
	}
	return invalidTestInput("%s is not valid JSON: %v", what, err)
}
