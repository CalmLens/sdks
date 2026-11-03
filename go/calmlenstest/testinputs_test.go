package calmlenstest

// Replays testdata/test-inputs.json (packages/sdk-contract/testInputs.ts): the backend verifies
// these exact codes, images and phrases. Untyped rejections (unknown fields, wrong value types)
// cannot be expressed with TestInput and are skipped.

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

	calmlens "github.com/CalmLens/sdks/go"
	"github.com/CalmLens/sdks/go/internal/fixtures"
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
			if !c.Typed {
				t.Skip("untyped input: not expressible as a TestInput")
			}
			var err error
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

// fixtureLevels is each cell's level as packages/sdk-contract/testInputs.ts records it: the index
// of the cell's first red value among the data levels, or -1.
func fixtureLevels(painted *TestImage, cells int) string {
	size := painted.Width / cells
	var levels strings.Builder
	for row := range cells {
		for column := range cells {
			red := int(painted.RGBA[(row*size*painted.Width+column*size)*4])
			levels.WriteString(strconv.Itoa(slices.Index(testImageGridLevels[:], red)))
		}
	}
	return levels.String()
}
