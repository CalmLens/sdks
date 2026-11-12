package calmlenstest

// Replays testdata/test-inputs.json (packages/sdk-contract/testInputs.ts): the backend verifies
// these exact codes, images and phrases. Untyped rejections (unknown fields, wrong value types)
// cannot be expressed with TestInput and are skipped, except those in detections, which
// TestDetections refuses when decoding JSON.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"

	"calmlens.com/go/calmlens"
	"calmlens.com/go/calmlens/internal/fixtures"
)

type testInputCase struct {
	Name, Key, Signal, Code string
	Kind                    TestInputKind
	Input                   json.RawMessage
	Typed                   bool
	Width, Height, Cells    int
	Levels, RgbaSha256      string
}

type testInputFixture struct {
	Presets         json.RawMessage
	Signals         struct{ Text, Media []string }
	SignalInputs    []testInputCase
	Qualifiers      map[string][]string
	Text            []testInputCase
	Media           []testInputCase
	Images          []testInputCase
	ImageRejections []testInputCase
	Rejections      []testInputCase
	Detections      struct {
		MaxEntries, BoxMax, AgeMax int
		AgePresets                 map[string]TestAgeRange
	}
}

// decodeStrict decodes raw into a T, failing on fields T does not have.
func decodeStrict[T any](t *testing.T, raw json.RawMessage) T {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var v T
	if err := decoder.Decode(&v); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return v
}

// scenario is the case's input, or the scenario its signal stands for in an input of kind.
func (c testInputCase) scenario(t *testing.T, kind TestInputKind) (TestInput, error) {
	t.Helper()
	if c.Input != nil {
		return decodeStrict[TestInput](t, c.Input), nil
	}
	return TestInputForSignal(c.Signal, kind)
}

func TestTestInputsContract(t *testing.T) {
	fixture := fixtures.Read[testInputFixture](t, "test-inputs.json")

	t.Run("presets", func(t *testing.T) {
		if got := TestInputPresets(); !reflect.DeepEqual(got, decodeStrict[TestInputPresetSet](t, fixture.Presets)) {
			t.Errorf("presets = %+v, fixture %s", got, fixture.Presets)
		}
	})
	t.Run("signals", func(t *testing.T) {
		if got := TestInputSignals(); !reflect.DeepEqual(got, fixture.Signals.Text) {
			t.Errorf("TestInputSignals() = %q, want %q", got, fixture.Signals.Text)
		}
		if got := MediaTestSignals(); !reflect.DeepEqual(got, fixture.Signals.Media) {
			t.Errorf("MediaTestSignals() = %q, want %q", got, fixture.Signals.Media)
		}
	})
	t.Run("qualifiers", func(t *testing.T) {
		if got := testInputQualifiers(); !reflect.DeepEqual(got, fixture.Qualifiers) {
			t.Errorf("allowed qualifiers = %v, want %v", got, fixture.Qualifiers)
		}
	})
	t.Run("detection limits", func(t *testing.T) {
		limits := fixture.Detections
		if testDetectionsMax != limits.MaxEntries || testDetectionBoxMax != limits.BoxMax || testFaceAgeMax != limits.AgeMax {
			t.Errorf("limits = %d entries, box %d, age %d; fixture %+v", testDetectionsMax, testDetectionBoxMax, testFaceAgeMax, limits)
		}
		names := []string{}
		for name := range limits.AgePresets {
			names = append(names, name)
		}
		slices.Sort(names)
		want := slices.Clone(testFaceAgePresets)
		slices.Sort(want)
		if !reflect.DeepEqual(names, want) {
			t.Errorf("age presets = %q, fixture %q", testFaceAgePresets, names)
		}
	})
	for _, c := range fixture.SignalInputs {
		t.Run("signal input "+c.Signal+" "+string(c.Kind), func(t *testing.T) {
			got, err := TestInputForSignal(c.Signal, c.Kind)
			if err != nil {
				t.Fatal(err)
			}
			if want := decodeStrict[TestInput](t, c.Input); !reflect.DeepEqual(got, want) {
				t.Errorf("TestInputForSignal = %+v, want %+v", got, want)
			}
		})
	}
	for _, c := range fixture.Text {
		t.Run("text "+c.Name, func(t *testing.T) {
			input, err := c.scenario(t, TestInputText)
			if err != nil {
				t.Fatal(err)
			}
			code, err := GenerateTestTextCode(input, c.Key)
			if err != nil {
				t.Fatal(err)
			}
			if code != c.Code {
				t.Errorf("code = %s, want %s", code, c.Code)
			}
		})
	}
	for _, c := range fixture.Media {
		t.Run("media "+c.Signal+" "+c.Key, func(t *testing.T) {
			code, err := GenerateMediaTestCode(c.Signal, c.Key)
			if err != nil {
				t.Fatal(err)
			}
			if code != c.Code {
				t.Errorf("phrase = %q, want %q", code, c.Code)
			}
		})
	}
	for _, c := range fixture.Images {
		t.Run("image "+c.Name, func(t *testing.T) {
			input, err := c.scenario(t, TestInputImage)
			if err != nil {
				t.Fatal(err)
			}
			painted, err := PaintTestImage(input, c.Key)
			if err != nil {
				t.Fatal(err)
			}
			if painted.Width != c.Width || painted.Height != c.Height {
				t.Fatalf("size = %dx%d, want %dx%d", painted.Width, painted.Height, c.Width, c.Height)
			}
			if sum := sha256.Sum256(painted.RGBA); hex.EncodeToString(sum[:]) != c.RgbaSha256 {
				t.Errorf("rgba sha256 = %x, want %s", sum, c.RgbaSha256)
			}
			if got := fixtureLevels(painted, c.Cells); got != c.Levels {
				t.Errorf("levels = %s, want %s", got, c.Levels)
			}
			decoded, err := png.Decode(bytes.NewReader(painted.PNG))
			if err != nil {
				t.Fatal(err)
			}
			nrgba, ok := decoded.(*image.NRGBA)
			if !ok || nrgba.Rect.Dx() != painted.Width || nrgba.Rect.Dy() != painted.Height || !bytes.Equal(nrgba.Pix, painted.RGBA) {
				t.Errorf("PNG does not decode to the painted RGBA")
			}
		})
	}
	for _, c := range fixture.ImageRejections {
		t.Run("rejects image "+c.Name, func(t *testing.T) {
			input, err := c.scenario(t, TestInputImage)
			if err != nil {
				t.Fatal(err)
			}
			_, err = PaintTestImage(input, c.Key)
			var sdkError *calmlens.Error
			if !errors.As(err, &sdkError) || sdkError.Code != calmlens.CodeSDKInvalidArgument {
				t.Errorf("error = %v, want %s", err, calmlens.CodeSDKInvalidArgument)
			}
		})
	}
	for _, c := range fixture.Rejections {
		t.Run("rejects "+c.Name+" "+string(c.Kind), func(t *testing.T) {
			var err error
			if !c.Typed {
				var fields map[string]json.RawMessage
				if json.Unmarshal(c.Input, &fields) != nil || fields["detections"] == nil {
					t.Skip("untyped input: not expressible as a TestInput")
				}
				var input TestInput
				if err = json.Unmarshal(c.Input, &input); err == nil {
					_, err = GenerateTestTextCode(input, c.Key)
				}
				var sdkError *calmlens.Error
				if !errors.As(err, &sdkError) || sdkError.Code != calmlens.CodeSDKInvalidArgument {
					t.Errorf("error = %v, want %s", err, calmlens.CodeSDKInvalidArgument)
				}
				return
			}
			switch c.Kind {
			case "media":
				_, err = GenerateMediaTestCode(c.Signal, c.Key)
			case TestInputText:
				var input TestInput
				if input, err = c.scenario(t, TestInputText); err == nil {
					_, err = GenerateTestTextCode(input, c.Key)
				}
			default:
				t.Fatalf("unknown rejection kind %q", c.Kind)
			}
			var sdkError *calmlens.Error
			if !errors.As(err, &sdkError) || sdkError.Code != calmlens.CodeSDKInvalidArgument {
				t.Errorf("error = %v, want %s", err, calmlens.CodeSDKInvalidArgument)
			}
		})
	}
}

// fixtureLevels is each cell's level as packages/sdk-contract/testInputs.ts records it: "r" for
// the outer ring, else the data level (0-3) nearest the luma of the cell's top-left pixel.
func fixtureLevels(painted *TestImage, cells int) string {
	size := painted.Width / cells
	var levels strings.Builder
	for row := range cells {
		for column := range cells {
			if row == 0 || column == 0 || row == cells-1 || column == cells-1 {
				levels.WriteString("r")
				continue
			}
			pixel := painted.RGBA[(row*size*painted.Width+column*size)*4:]
			luma := (77*int(pixel[0]) + 150*int(pixel[1]) + 29*int(pixel[2])) >> 8
			nearest := 0
			for level, target := range testImageGridLevels {
				if abs(target-luma) < abs(testImageGridLevels[nearest]-luma) {
					nearest = level
				}
			}
			levels.WriteString(strconv.Itoa(nearest))
		}
	}
	return levels.String()
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func TestTestDetectionsRefuseRepeatedKeys(t *testing.T) {
	for key, detections := range map[string]string{
		"people":     `{"people":[],"people":[]}`,
		"faces":      `{"faces":"unavailable","faces":[]}`,
		"box":        `{"faces":[{"box":[0,0,1,1],"box":[0,0,2,2]}]}`,
		"confidence": `{"people":[{"box":[0,0,1,1],"confidence":5,"confidence":6}]}`,
		"age":        `{"faces":[{"box":[0,0,1,1],"age":"adult","age":"minor"}]}`,
		"low":        `{"faces":[{"box":[0,0,1,1],"age":{"low":1,"low":2,"high":3}}]}`,
		"high":       `{"faces":[{"box":[0,0,1,1],"age":{"low":1,"high":2,"high":3}}]}`,
	} {
		t.Run(key, func(t *testing.T) {
			var input TestInput
			err := json.Unmarshal([]byte(`{"instances":[],"detections":`+detections+`}`), &input)
			var sdkError *calmlens.Error
			if !errors.As(err, &sdkError) || sdkError.Code != calmlens.CodeSDKInvalidArgument {
				t.Errorf("error = %v, want %s", err, calmlens.CodeSDKInvalidArgument)
			}
		})
	}
}

// Values only Go can build: they bypass the JSON decoder's checks.
func TestTestDetectionsRejectUnsupportedValues(t *testing.T) {
	for name, detections := range map[string]TestDetections{
		"unknown age preset":  {Faces: TestFaceList{{Age: TestAgePreset("teen")}}},
		"unavailable pointer": {People: &TestUnavailable{}},
		"age range pointer":   {Faces: TestFaceList{{Age: &TestAgeRange{Low: 1, High: 2}}}},
		"person list pointer": {People: &TestPersonList{}},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := GenerateTestTextCode(TestInput{Instances: []TestInstance{}, Detections: &detections}, "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d")
			var sdkError *calmlens.Error
			if !errors.As(err, &sdkError) || sdkError.Code != calmlens.CodeSDKInvalidArgument {
				t.Errorf("error = %v, want %s", err, calmlens.CodeSDKInvalidArgument)
			}
		})
	}
}

func TestTestDetectionsNilListsAreSentEmpty(t *testing.T) {
	const key = "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d"
	empty, err := GenerateTestTextCode(TestInputPresets().NoFace, key)
	if err != nil {
		t.Fatal(err)
	}
	nilLists, err := GenerateTestTextCode(TestInput{Instances: []TestInstance{}, Detections: &TestDetections{People: TestPersonList(nil), Faces: TestFaceList(nil)}}, key)
	if err != nil {
		t.Fatal(err)
	}
	if nilLists != empty {
		t.Errorf("nil lists sign %s, want the empty lists' %s", nilLists, empty)
	}
}
