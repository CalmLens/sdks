package calmlens

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
)

func decodeOptions[T any](t *testing.T, raw json.RawMessage) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func TestJavaScriptContract(t *testing.T) {
	data, err := os.ReadFile("testdata/requests.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Operation string
		Options   json.RawMessage
		Request   struct {
			Method string
			Path   string
			Query  map[string]string
			Body   any
		}
		Response any
	}
	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Operation, func(t *testing.T) {
			c, h := setup(t)
			c.options.ProjectID = "project-1"
			h.result = fixture.Response
			ctx := context.Background()
			var err error
			switch fixture.Operation {
			case "text.classify":
				_, err = c.Text.Classify(ctx, decodeOptions[ClassifyTextOptions](t, fixture.Options))
			case "assets.create":
				_, err = c.Assets.Create(ctx, contractSubmit(t, fixture.Options))
			case "assets.classify":
				_, err = c.Assets.Classify(ctx, contractSubmit(t, fixture.Options))
			case "assets.search":
				_, err = c.Assets.Search(ctx, decodeOptions[SearchAssetsOptions](t, fixture.Options))
			case "assets.list":
				_, err = c.Assets.List(ctx, decodeOptions[ListAssetsOptions](t, fixture.Options))
			case "assets.retrieve":
				_, err = c.Assets.Retrieve(ctx, decodeOptions[AssetIDOptions](t, fixture.Options))
			case "assets.update":
				_, err = c.Assets.Update(ctx, decodeOptions[UpdateAssetOptions](t, fixture.Options))
			case "assets.listChildren":
				_, err = c.Assets.ListChildren(ctx, decodeOptions[ListAssetChildrenOptions](t, fixture.Options))
			case "assets.retry":
				_, err = c.Assets.Retry(ctx, decodeOptions[AssetIDOptions](t, fixture.Options))
			case "assets.explain":
				_, err = c.Assets.Explain(ctx, decodeOptions[ExplainAssetOptions](t, fixture.Options))
			case "assets.deleteContent":
				_, err = c.Assets.DeleteContent(ctx, decodeOptions[AssetIDOptions](t, fixture.Options))
			case "assets.delete":
				err = c.Assets.Delete(ctx, decodeOptions[AssetIDOptions](t, fixture.Options))
			case "assets.move":
				_, err = c.Assets.Move(ctx, decodeOptions[MoveAssetOptions](t, fixture.Options))
			case "assets.createSignedUrl":
				var input struct {
					SignedURLOptions
					Transform json.RawMessage `json:"transform"`
				}
				if err := json.Unmarshal(fixture.Options, &input); err != nil {
					t.Fatal(err)
				}
				options := input.SignedURLOptions
				options.Transform, options.TransformSteps = contractTransform(t, input.Transform)
				options.AssetID = "asset-1"
				_, err = c.Assets.CreateSignedURL(ctx, options)
			case "assets.uploadPart":
				_, err = c.Assets.UploadPart(ctx, decodeOptions[UploadAssetPartOptions](t, fixture.Options))
			case "folders.list":
				_, err = c.Folders.List(ctx, decodeOptions[ListFoldersOptions](t, fixture.Options))
			case "folders.retrieve":
				_, err = c.Folders.Retrieve(ctx, decodeOptions[FolderIDOptions](t, fixture.Options))
			case "folders.create":
				_, err = c.Folders.Create(ctx, decodeOptions[CreateFolderOptions](t, fixture.Options))
			case "folders.update":
				options := decodeOptions[UpdateFolderOptions](t, fixture.Options)
				options.FolderID = "folder-1"
				_, err = c.Folders.Update(ctx, options)
			case "folders.move":
				_, err = c.Folders.Move(ctx, decodeOptions[MoveFolderOptions](t, fixture.Options))
			case "folders.delete":
				err = c.Folders.Delete(ctx, decodeOptions[FolderIDOptions](t, fixture.Options))
			case "events.list":
				_, err = c.Events.List(ctx, decodeOptions[ListEventsOptions](t, fixture.Options))
			case "ensureLenses":
				_, err = c.EnsureLenses(ctx, decodeOptions[EnsureLensesOptions](t, fixture.Options))
			default:
				t.Fatal("unhandled operation", fixture.Operation)
			}
			if err != nil {
				t.Fatal(err)
			}
			r := h.last()
			var body any
			raw := h.bodies[len(h.bodies)-1]
			if len(raw) > 0 {
				body = string(raw)
				if r.Header.Get("Content-Type") == "application/json" {
					if err = json.Unmarshal(raw, &body); err != nil {
						t.Fatal(err)
					}
				}
			}
			params := map[string]string{}
			for key, values := range r.URL.Query() {
				params[key] = values[0]
			}
			if r.Method != fixture.Request.Method || r.URL.EscapedPath() != fixture.Request.Path || !reflect.DeepEqual(normalizeJSONQuery(params), normalizeJSONQuery(fixture.Request.Query)) || !reflect.DeepEqual(body, fixture.Request.Body) {
				t.Fatalf("got %s %s %v %#v; want %+v", r.Method, r.URL.EscapedPath(), params, body, fixture.Request)
			}
		})
	}
}

// normalizeJSONQuery decodes JSON-valued query parameters (metadata, processingOptions), so
// they compare by value: the API parses them, and Go encodes object keys in sorted order.
func normalizeJSONQuery(query map[string]string) map[string]any {
	normalized := make(map[string]any, len(query))
	for key, value := range query {
		var decoded any
		if (strings.HasPrefix(value, "{") || strings.HasPrefix(value, "[")) && json.Unmarshal([]byte(value), &decoded) == nil {
			normalized[key] = decoded
		} else {
			normalized[key] = value
		}
	}
	return normalized
}

// contractTransform maps a fixture transform (a selector string, one step or a list of
// steps) to Transform or TransformSteps.
func contractTransform(t *testing.T, raw json.RawMessage) (string, []LensTransform) {
	t.Helper()
	switch {
	case len(raw) == 0 || string(raw) == "null":
		return "", nil
	case raw[0] == '"':
		return decodeOptions[string](t, raw), nil
	case raw[0] == '[':
		steps := decodeOptions[[]LensTransform](t, raw)
		if steps == nil {
			steps = []LensTransform{}
		}
		return "", steps
	default:
		return "", []LensTransform{decodeOptions[LensTransform](t, raw)}
	}
}

func contractSubmit(t *testing.T, raw json.RawMessage) SubmitAssetOptions {
	options := decodeOptions[SubmitAssetOptions](t, raw)
	var input struct {
		Content *Content
		Part    *Content
	}
	if err := json.Unmarshal(raw, &input); err != nil {
		t.Fatal(err)
	}
	options.Content, options.Part = input.Content, input.Part
	return options
}

func TestJavaScriptPathSafety(t *testing.T) {
	data, err := os.ReadFile("testdata/paths.json")
	if err != nil {
		t.Fatal(err)
	}
	var paths struct {
		Rejections []struct {
			Operation string
			Options   json.RawMessage
			Error     string
		}
		CDNURLs []struct {
			Options json.RawMessage
			URL     string
			Error   string
		} `json:"cdnUrls"`
	}
	if err = json.Unmarshal(data, &paths); err != nil {
		t.Fatal(err)
	}
	errorCode := func(err error) string {
		var e *Error
		if errors.As(err, &e) {
			return e.Code
		}
		return fmt.Sprint(err)
	}
	for _, rejection := range paths.Rejections {
		t.Run(rejection.Operation, func(t *testing.T) {
			c, h := setup(t)
			ctx := context.Background()
			var err error
			switch rejection.Operation {
			case "assets.retrieve":
				_, err = c.Assets.Retrieve(ctx, decodeOptions[AssetIDOptions](t, rejection.Options))
			case "assets.update":
				_, err = c.Assets.Update(ctx, UpdateAssetOptions{AssetID: decodeOptions[AssetIDOptions](t, rejection.Options).AssetID})
			case "assets.listChildren":
				_, err = c.Assets.ListChildren(ctx, decodeOptions[ListAssetChildrenOptions](t, rejection.Options))
			case "assets.retry":
				_, err = c.Assets.Retry(ctx, decodeOptions[AssetIDOptions](t, rejection.Options))
			case "assets.explain":
				_, err = c.Assets.Explain(ctx, decodeOptions[ExplainAssetOptions](t, rejection.Options))
			case "assets.move":
				_, err = c.Assets.Move(ctx, decodeOptions[MoveAssetOptions](t, rejection.Options))
			case "assets.uploadPart":
				_, err = c.Assets.UploadPart(ctx, decodeOptions[UploadAssetPartOptions](t, rejection.Options))
			case "folders.retrieve":
				_, err = c.Folders.Retrieve(ctx, decodeOptions[FolderIDOptions](t, rejection.Options))
			case "folders.move":
				_, err = c.Folders.Move(ctx, decodeOptions[MoveFolderOptions](t, rejection.Options))
			case "folders.delete":
				err = c.Folders.Delete(ctx, decodeOptions[FolderIDOptions](t, rejection.Options))
			default:
				t.Fatal("unhandled operation", rejection.Operation)
			}
			if got := errorCode(err); got != rejection.Error || len(h.calls) != 0 {
				t.Fatalf("got %q after %d requests; want %q before any request", got, len(h.calls), rejection.Error)
			}
		})
	}
	c, err := NewServerClient(Options{APIKey: "key", ProjectID: "project-1"})
	if err != nil {
		t.Fatal(err)
	}
	for _, cdn := range paths.CDNURLs {
		// Unknown fixture options fail the test instead of being ignored.
		var fixture struct {
			AssetIdentifier    string          `json:"assetIdentifier"`
			Resource           string          `json:"resource"`
			Lens               string          `json:"lens"`
			Transform          json.RawMessage `json:"transform"`
			AllowAgeRestricted bool            `json:"allowAgeRestricted"`
		}
		decoder := json.NewDecoder(bytes.NewReader(cdn.Options))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&fixture); err != nil {
			t.Fatalf("CDN URL fixture %s: %v", cdn.Options, err)
		}
		options := CDNAssetURLOptions{AssetIdentifier: fixture.AssetIdentifier, Resource: fixture.Resource, Lens: fixture.Lens, AllowAgeRestricted: fixture.AllowAgeRestricted}
		options.Transform, options.TransformSteps = contractTransform(t, fixture.Transform)
		got, err := c.CDN.GetAssetURL(options)
		if got != cdn.URL || cdn.Error != "" && errorCode(err) != cdn.Error || cdn.Error == "" && err != nil {
			t.Errorf("%s: got %q, %v; want %q, %q", cdn.Options, got, err, cdn.URL, cdn.Error)
		}
	}
}

// Every transform option, decoded into ImageTransformOptions and serialized, gives the step the
// CDN writes for it: an option missing from the type, or encoded differently, fails here.
func TestTransformOptionsContract(t *testing.T) {
	data, err := os.ReadFile("testdata/transform-options.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Options  json.RawMessage
			Selector string
		}
	}
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, c := range fixture.Cases {
		options := decodeOptions[ImageTransformOptions](t, c.Options)
		selector, err := serializeTransform([]LensTransform{ImageTransform(options)})
		if err != nil {
			t.Fatalf("%s: %v", c.Options, err)
		}
		if selector != c.Selector {
			t.Errorf("%s: got %q, want %q", c.Options, selector, c.Selector)
		}
	}
}
