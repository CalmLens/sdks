package calmlenstest

// Replays testdata/test-inputs.json (packages/sdk-contract/testInputs.ts): the backend verifies
// these exact codes and phrases. Untyped rejections (unknown fields, wrong value types)
// cannot be expressed with TestInput and are skipped.

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	calmlens "github.com/CalmLens/sdks/go"
	"github.com/CalmLens/sdks/go/internal/fixtures"
)

type testInputCase struct {
	Name, Key, Signal, Code string
	Kind                    TestInputKind
	Input                   json.RawMessage
	Typed                   bool
}

type testInputFixture struct {
	Presets      json.RawMessage
	Signals      struct{ Text, Media []string }
	SignalInputs []testInputCase
	Qualifiers   map[string][]string
	Text         []testInputCase
	Media        []testInputCase
	Rejections   []testInputCase
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
