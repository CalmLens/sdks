package calmlens

// Replays the shared SDK contract fixtures that packages/sdk-contract/generate.ts writes to
// testdata (format in packages/sdk-contract/README.md): requests captured from the JavaScript
// SDK, path safety and CDN URLs, transform options, webhooks and rejections. Each fixture case
// is its own subtest. The mock scenarios and the SDK surface need calmlenstest, so they are
// replayed by calmlenstest/contract_test.go.

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
	"time"
)

// readFixture decodes testdata/<name>.
func readFixture[T any](t *testing.T, name string) T {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	var v T
	if err = json.Unmarshal(data, &v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return v
}

func decodeOptions[T any](t *testing.T, raw json.RawMessage) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func TestJavaScriptContract(t *testing.T) {
	fixtures := readFixture[[]struct {
		Operation string
		Options   json.RawMessage
		Request   struct {
			Method string
			Path   string
			Query  map[string]string
			Body   any
		}
		Response any
	}](t, "requests.json")
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
	paths := readFixture[struct {
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
	}](t, "paths.json")
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
		t.Run("cdn "+string(cdn.Options), func(t *testing.T) {
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
		})
	}
}

// Every transform option, decoded into ImageTransformOptions and serialized, gives the step the
// CDN writes for it: an option missing from the type, or encoded differently, fails here.
func TestTransformOptionsContract(t *testing.T) {
	fixture := readFixture[struct {
		Cases []struct {
			Options  json.RawMessage
			Selector string
		}
	}](t, "transform-options.json")
	for _, c := range fixture.Cases {
		t.Run(c.Selector, func(t *testing.T) {
			options := decodeOptions[ImageTransformOptions](t, c.Options)
			selector, err := serializeTransform([]LensTransform{ImageTransform(options)})
			if err != nil {
				t.Fatalf("%s: %v", c.Options, err)
			}
			if selector != c.Selector {
				t.Errorf("%s: got %q, want %q", c.Options, selector, c.Selector)
			}
		})
	}
}

// testdata/webhooks.json is generated from the JavaScript SDK by packages/sdk-contract/generate.ts.
type webhookSignatureFixture struct {
	Secret, Timestamp, Body, Signature string
}
type webhookVerificationFixture struct {
	Name, Secret, Timestamp, Body, Signature string
	Now, ToleranceSeconds                    int64
	Valid                                    bool
}
type webhookPayloadFixture struct {
	Event   json.RawMessage
	Payload any
}
type webhookFixtures struct {
	Parsing []struct {
		Body, Signature, Timestamp, Secret, ExpectedType, ExpectedFactKey string
		Now                                                               int64
	}
	Signatures   []webhookSignatureFixture
	Verification []webhookVerificationFixture
	Payloads     []webhookPayloadFixture
}

func TestWebhookContract(t *testing.T) {
	fixtures := readFixture[webhookFixtures](t, "webhooks.json")
	for _, f := range fixtures.Parsing {
		t.Run("parses "+f.ExpectedType+" with "+f.ExpectedFactKey, func(t *testing.T) {
			event, err := ParseWebhookEvent([]byte(f.Body), f.Signature, f.Timestamp, f.Secret, WithNow(time.Unix(f.Now, 0)))
			if err != nil {
				t.Fatal(err)
			}
			if event.Type != f.ExpectedType || len(event.Data.Facts) != 1 || event.Data.Facts[0].Key != f.ExpectedFactKey {
				t.Fatal(event)
			}
		})
	}

	for _, fixture := range fixtures.Signatures {
		t.Run("signs at "+fixture.Timestamp, func(t *testing.T) {
			var timestamp int64
			if err := json.Unmarshal([]byte(fixture.Timestamp), &timestamp); err != nil {
				t.Fatal(err)
			}
			if got := SignWebhookPayload([]byte(fixture.Body), timestamp, fixture.Secret); got != fixture.Signature {
				t.Errorf("signature %s, want %s", got, fixture.Signature)
			}
		})
	}
	for _, fixture := range fixtures.Verification {
		t.Run(fixture.Name, func(t *testing.T) {
			options := []WebhookOption{WithNow(time.Unix(fixture.Now, 0)), WithTolerance(time.Duration(fixture.ToleranceSeconds) * time.Second)}
			if got := VerifyWebhookSignature([]byte(fixture.Body), fixture.Signature, fixture.Timestamp, fixture.Secret, options...); got != fixture.Valid {
				t.Errorf("got %v, want %v", got, fixture.Valid)
			}
		})
	}
	for _, fixture := range fixtures.Payloads {
		t.Run("payload of "+payloadName(fixture.Event), func(t *testing.T) {
			var event Event
			if err := json.Unmarshal(fixture.Event, &event); err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(ToWebhookEventPayload(event))
			if err != nil {
				t.Fatal(err)
			}
			var got any
			if err = json.Unmarshal(body, &got); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, fixture.Payload) {
				t.Errorf("payload %v, want %v", got, fixture.Payload)
			}
		})
	}
}

// payloadName names a payload fixture by its event's type and ID.
func payloadName(raw json.RawMessage) string {
	var event struct{ ID, Type string }
	_ = json.Unmarshal(raw, &event)
	return event.Type + " " + event.ID
}

// Typed options that cannot hold the fixture's value: Go's type already refuses the request.
var rejectedByType = map[string]string{
	"signed URL lifetime of a fraction of a second": "SignedURLOptions.ExpiresInSeconds is an int",
}

// TestRejections replays testdata/rejections.json (packages/sdk-contract/surface.ts): requests the
// API would reject fail with the recorded code before anything is sent.
func TestRejections(t *testing.T) {
	cases := readFixture[[]struct {
		Name      string
		Operation string
		Options   json.RawMessage
		Error     string
	}](t, "rejections.json")
	strict := func(raw json.RawMessage, out any) error {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		return decoder.Decode(out)
	}
	for _, rejection := range cases {
		t.Run(rejection.Name, func(t *testing.T) {
			c, h := setup(t)
			ctx := context.Background()
			var decodeErr, err error
			switch rejection.Operation {
			case "assets.createSignedUrl":
				var fixture struct {
					AssetID          string          `json:"assetId"`
					Resource         string          `json:"resource"`
					Lens             string          `json:"lens"`
					Transform        json.RawMessage `json:"transform"`
					ExpiresInSeconds int             `json:"expiresInSeconds"`
				}
				if decodeErr = strict(rejection.Options, &fixture); decodeErr == nil {
					options := SignedURLOptions{AssetID: fixture.AssetID, Resource: fixture.Resource, Lens: fixture.Lens, ExpiresInSeconds: fixture.ExpiresInSeconds}
					options.Transform, options.TransformSteps = contractTransform(t, fixture.Transform)
					_, err = c.Assets.CreateSignedURL(ctx, options)
				}
			case "cdn.serve":
				var fixture struct {
					AssetIdentifier    string          `json:"assetIdentifier"`
					Resource           string          `json:"resource"`
					Lens               string          `json:"lens"`
					Transform          json.RawMessage `json:"transform"`
					AllowAgeRestricted bool            `json:"allowAgeRestricted"`
				}
				if decodeErr = strict(rejection.Options, &fixture); decodeErr == nil {
					options := CDNServeOptions{CDNAssetURLOptions: CDNAssetURLOptions{AssetIdentifier: fixture.AssetIdentifier, Resource: fixture.Resource, Lens: fixture.Lens, AllowAgeRestricted: fixture.AllowAgeRestricted}}
					options.Transform, options.TransformSteps = contractTransform(t, fixture.Transform)
					_, err = c.CDN.Serve(ctx, options)
				}
			case "text.classify":
				_, err = c.Text.Classify(ctx, decodeOptions[ClassifyTextOptions](t, rejection.Options))
			case "assets.retrieve":
				_, err = c.Assets.Retrieve(ctx, decodeOptions[AssetIDOptions](t, rejection.Options))
			case "assets.waitForDecision":
				_, err = c.Assets.WaitForDecision(ctx, decodeOptions[WaitForDecisionOptions](t, rejection.Options))
			case "assets.delete":
				err = c.Assets.Delete(ctx, decodeOptions[AssetIDOptions](t, rejection.Options))
			case "folders.retrieve":
				_, err = c.Folders.Retrieve(ctx, decodeOptions[FolderIDOptions](t, rejection.Options))
			default:
				t.Fatal("unhandled operation", rejection.Operation)
			}
			if reason, typed := rejectedByType[rejection.Name]; typed {
				if decodeErr == nil {
					t.Fatalf("%s, yet the options decoded", reason)
				}
				t.Skip(reason)
			}
			if decodeErr != nil {
				t.Fatal(decodeErr)
			}
			got := fmt.Sprint(err)
			var e *Error
			if errors.As(err, &e) {
				got = e.Code
			}
			if got != rejection.Error || len(h.calls) != 0 {
				t.Fatalf("got %q after %d requests; want %q before any request", got, len(h.calls), rejection.Error)
			}
		})
	}
}
