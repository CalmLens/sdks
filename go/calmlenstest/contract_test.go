package calmlenstest

// Replays the shared SDK contract fixtures that need this package (format in
// packages/sdk-contract/README.md): the mock behaviour scenarios and the server SDK surface. The
// other fixtures are replayed by the root package's contract_test.go. Each fixture case is its
// own subtest.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	calmlens "github.com/CalmLens/sdks/go"
)

// readFixture decodes ../testdata/<name>.
func readFixture[T any](t *testing.T, name string) T {
	t.Helper()
	data, err := os.ReadFile("../testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	var v T
	if err = json.Unmarshal(data, &v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return v
}

// Every capability a server SDK must offer (testdata/surface.json, packages/sdk-contract/surface.ts)
// exists under its Go name. Client methods are found by reflection; package-level functions,
// constants and types are compile-time references below, keyed by their Go names.
var surfaceFunctions = map[string]any{
	"VerifyWebhookSignature":        calmlens.VerifyWebhookSignature,
	"ParseWebhookEvent":             calmlens.ParseWebhookEvent,
	"SignWebhookPayload":            calmlens.SignWebhookPayload,
	"CreateWebhookHeaders":          calmlens.CreateWebhookHeaders,
	"ToWebhookEventPayload":         calmlens.ToWebhookEventPayload,
	"calmlenstest.NewServerClient":  NewServerClient,
	"calmlenstest.CreateMockAPIKey": CreateMockAPIKey,
}

var surfaceConstants = map[string]string{
	"WebhookDeliveryHeader":  calmlens.WebhookDeliveryHeader,
	"WebhookTimestampHeader": calmlens.WebhookTimestampHeader,
	"WebhookSignatureHeader": calmlens.WebhookSignatureHeader,
	"CodeAssetNotFound":      calmlens.CodeAssetNotFound,
	"CodeSDKInvalidArgument": calmlens.CodeSDKInvalidArgument,
	"ResourceOriginal":       calmlens.ResourceOriginal,
	"ResourceRendered":       calmlens.ResourceRendered,
	"ResourcePlaceholder":    calmlens.ResourcePlaceholder,
}

var surfaceTypes = map[string]reflect.Type{
	"CDNAssetURLOptions":            reflect.TypeOf(calmlens.CDNAssetURLOptions{}),
	"Options":                       reflect.TypeOf(Options{}),
	"calmlenstest.MockServerClient": reflect.TypeOf(&MockServerClient{}),
}

type surfaceCapability struct {
	ID    string
	Kind  string
	Value string
	Names struct{ Go string }
}

type surfaceFixture struct {
	Capabilities  []surfaceCapability
	ErrorResponse struct {
		Status   int
		Headers  map[string]string
		Body     json.RawMessage
		Expected struct {
			Code              string
			Status            int
			RequestID         string `json:"requestId"`
			RetryAfterSeconds int
		}
	}
}

type surfaceTransport func(*http.Request) (*http.Response, error)

func (f surfaceTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func surfaceClient(t *testing.T, transport surfaceTransport) *calmlens.ServerClient {
	t.Helper()
	retries := 0
	client, err := calmlens.NewServerClient(calmlens.Options{APIKey: "key", ProjectID: "project-1", MaxRetries: &retries, HTTPClient: &http.Client{Transport: transport}})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

// lookupMethod reports whether value has the method at path, such as "Assets.Create".
func lookupMethod(value reflect.Value, path string) bool {
	parts := strings.Split(path, ".")
	for _, part := range parts[:len(parts)-1] {
		value = reflect.Indirect(value).FieldByName(part)
		if !value.IsValid() {
			return false
		}
	}
	return value.MethodByName(parts[len(parts)-1]).IsValid()
}

func TestSurface(t *testing.T) {
	surface := readFixture[surfaceFixture](t, "surface.json")
	refuse := func(r *http.Request) (*http.Response, error) { return nil, errors.New("sent " + r.URL.String()) }
	client := surfaceClient(t, refuse)
	spec := surface.ErrorResponse
	failing := surfaceClient(t, func(r *http.Request) (*http.Response, error) {
		header := http.Header{}
		for name, value := range spec.Headers {
			header.Set(name, value)
		}
		return &http.Response{StatusCode: spec.Status, Header: header, Body: io.NopCloser(bytes.NewReader(spec.Body)), Request: r}, nil
	})
	_, apiErr := failing.Assets.Retrieve(context.Background(), calmlens.AssetIDOptions{AssetID: "asset-1"})
	var raised *calmlens.Error
	if !errors.As(apiErr, &raised) {
		t.Fatal("no API error", apiErr)
	}
	wantField := map[string]any{
		"errors.code":       spec.Expected.Code,
		"errors.status":     spec.Expected.Status,
		"errors.requestId":  spec.Expected.RequestID,
		"errors.retryAfter": time.Duration(spec.Expected.RetryAfterSeconds) * time.Second,
	}
	used := map[string]bool{}
	for _, capability := range surface.Capabilities {
		name := capability.Names.Go
		used[name] = true
		var present bool
		switch capability.Kind {
		case "method":
			present = lookupMethod(reflect.ValueOf(client), name)
		case "function", "mock-client", "mock-function":
			_, present = surfaceFunctions[name]
		case "constant":
			present = surfaceConstants[name] == capability.Value
		case "cdn-resource":
			value, ok := surfaceConstants[name]
			if ok && value == capability.Value {
				url, err := client.CDN.GetAssetURL(calmlens.CDNAssetURLOptions{AssetIdentifier: "asset-1", Resource: value})
				present = err == nil && strings.HasSuffix(url, "/asset-1/"+value)
			}
		case "error-field":
			field := reflect.ValueOf(raised).Elem().FieldByName(name)
			present = field.IsValid() && reflect.DeepEqual(field.Interface(), wantField[capability.ID])
		case "cdn-option", "mock-option":
			typeName, fieldName, _ := strings.Cut(name, ".")
			if typ, ok := surfaceTypes[typeName]; ok {
				used[typeName] = true
				_, present = typ.FieldByName(fieldName)
			}
		case "mock-method":
			used["calmlenstest.MockServerClient"] = true
			_, present = surfaceTypes["calmlenstest.MockServerClient"].MethodByName(name)
		default:
			t.Fatalf("unknown capability kind %q", capability.Kind)
		}
		t.Run(capability.ID, func(t *testing.T) {
			if !present {
				t.Errorf("missing %s (%s)", capability.ID, name)
			}
		})
	}
	// A reference the manifest no longer lists is stale.
	var stale []string
	for _, names := range []map[string]any{surfaceFunctions, toAny(surfaceConstants), toAny(surfaceTypes)} {
		for name := range names {
			if !used[name] {
				stale = append(stale, name)
			}
		}
	}
	sort.Strings(stale)
	if len(stale) > 0 {
		t.Errorf("references not in surface.json: %v", stale)
	}
}

func toAny[T any](values map[string]T) map[string]any {
	out := make(map[string]any, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

// The shared mock behaviour scenarios (packages/sdk-contract/mockScenarios.ts), replayed by every
// SDK's offline mock.
type mockScenario struct {
	Name string
	Mock struct {
		QueuedOutcome   string
		AnalyzedOutcome string
		APIKeyGrants    []Grant `json:"apiKeyGrants"`
	}
	Steps []struct {
		Operation string
		Args      json.RawMessage
		Save      string
		Expect    struct {
			Result map[string]any
			Error  *struct {
				Code   string
				Status *int
			}
			CDN map[string]any `json:"cdn"`
		}
	}
}

// at follows a dotted path: numeric segments index arrays, "length" is an array's length.
func at(value any, path string) any {
	for _, segment := range strings.Split(path, ".") {
		switch current := value.(type) {
		case []any:
			if segment == "length" {
				value = float64(len(current))
				continue
			}
			index, err := strconv.Atoi(segment)
			if err != nil || index >= len(current) {
				return nil
			}
			value = current[index]
		case map[string]any:
			value = current[segment]
		default:
			return nil
		}
	}
	return value
}

func marker(value any, key string) (any, bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	inner, ok := object[key]
	return inner, ok
}

func resolve(value any, saved map[string]any) any {
	if path, ok := marker(value, "$ref"); ok {
		name, rest, _ := strings.Cut(path.(string), ".")
		return at(saved[name], rest)
	}
	switch current := value.(type) {
	case []any:
		out := make([]any, len(current))
		for i, item := range current {
			out[i] = resolve(item, saved)
		}
		return out
	case map[string]any:
		out := map[string]any{}
		for key, item := range current {
			out[key] = resolve(item, saved)
		}
		return out
	}
	return value
}

// normalize turns a typed result into plain JSON values.
func normalize(t *testing.T, value any) any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err = json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func decode[T any](t *testing.T, args map[string]any) T {
	t.Helper()
	data, _ := json.Marshal(args)
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func submit(t *testing.T, args map[string]any) calmlens.SubmitAssetOptions {
	options := decode[calmlens.SubmitAssetOptions](t, args)
	if content, ok := args["content"]; ok {
		options.Content = calmlens.Ptr(decode[calmlens.Content](t, content.(map[string]any)))
	}
	if key, ok := args["idempotencyKey"].(string); ok {
		options.IdempotencyKey = key
	}
	return options
}

func runStep(t *testing.T, ctx context.Context, m *MockServerClient, operation string, args map[string]any) (any, error) {
	t.Helper()
	var result any
	var err error
	switch operation {
	case "mock.decide":
		result, err = m.Decide(args["assetId"].(string), args["outcome"].(string))
	case "mock.enqueueEvent":
		m.EnqueueEvent(decode[calmlens.Event](t, args))
	case "cdn.serve":
		options := calmlens.CDNServeOptions{CDNAssetURLOptions: decode[calmlens.CDNAssetURLOptions](t, args)}
		response, serveErr := m.CDN.Serve(ctx, options)
		if serveErr != nil {
			return nil, serveErr
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		served := map[string]any{"status": float64(response.StatusCode), "body": string(body)}
		if response.Header.Get("Content-Type") == "application/json" {
			var errorBody struct{ Code string }
			_ = json.Unmarshal(body, &errorBody)
			served["code"] = errorBody.Code
		}
		return served, nil
	case "assets.create":
		result, err = m.Assets.Create(ctx, submit(t, args))
	case "assets.classify":
		result, err = m.Assets.Classify(ctx, submit(t, args))
	case "text.classify":
		result, err = m.Text.Classify(ctx, decode[calmlens.ClassifyTextOptions](t, args))
	case "assets.retrieve":
		result, err = m.Assets.Retrieve(ctx, decode[calmlens.AssetIDOptions](t, args))
	case "assets.list":
		result, err = m.Assets.List(ctx, decode[calmlens.ListAssetsOptions](t, args))
	case "assets.search":
		result, err = m.Assets.Search(ctx, decode[calmlens.SearchAssetsOptions](t, args))
	case "assets.deleteContent":
		result, err = m.Assets.DeleteContent(ctx, decode[calmlens.AssetIDOptions](t, args))
	case "assets.delete":
		err = m.Assets.Delete(ctx, decode[calmlens.AssetIDOptions](t, args))
	case "assets.waitForDecision":
		options := calmlens.WaitForDecisionOptions{AssetID: args["assetId"].(string), Timeout: time.Duration(args["timeoutMs"].(float64)) * time.Millisecond}
		result, err = m.Assets.WaitForDecision(ctx, options)
	case "events.list":
		result, err = m.Events.List(ctx, decode[calmlens.ListEventsOptions](t, args))
	case "folders.create":
		result, err = m.Folders.Create(ctx, decode[calmlens.CreateFolderOptions](t, args))
	case "folders.retrieve":
		result, err = m.Folders.Retrieve(ctx, decode[calmlens.FolderIDOptions](t, args))
	case "folders.delete":
		err = m.Folders.Delete(ctx, decode[calmlens.FolderIDOptions](t, args))
	default:
		t.Fatalf("unhandled operation %s", operation)
	}
	if err != nil {
		return nil, err
	}
	return normalize(t, result), nil
}

func TestSharedMockScenarios(t *testing.T) {
	fixture := readFixture[struct{ Scenarios []mockScenario }](t, "mock-scenarios.json")
	for _, scenario := range fixture.Scenarios {
		t.Run(scenario.Name, func(t *testing.T) {
			m, err := NewServerClient(Options{
				ProjectID: "project-1", APIKey: CreateMockAPIKey(scenario.Mock.APIKeyGrants),
				QueuedOutcome: scenario.Mock.QueuedOutcome, AnalyzedOutcome: scenario.Mock.AnalyzedOutcome,
			})
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			saved := map[string]any{}
			started := time.Now()
			for index, step := range scenario.Steps {
				label := fmt.Sprintf("step %d (%s)", index+1, step.Operation)
				var raw any = map[string]any{}
				if len(step.Args) > 0 {
					if err = json.Unmarshal(step.Args, &raw); err != nil {
						t.Fatal(err)
					}
				}
				args := resolve(raw, saved).(map[string]any)
				result, err := runStep(t, ctx, m, step.Operation, args)
				if want := step.Expect.Error; want != nil {
					var apiErr *calmlens.Error
					if !errors.As(err, &apiErr) {
						t.Fatalf("%s: got %v, want error %s", label, err, want.Code)
					}
					var status *int
					if apiErr.Status != 0 {
						status = &apiErr.Status
					}
					if apiErr.Code != want.Code || !reflect.DeepEqual(status, want.Status) {
						t.Fatalf("%s: got %s (status %v), want %s (status %v)", label, apiErr.Code, apiErr.Status, want.Code, want.Status)
					}
					continue
				}
				if err != nil {
					t.Fatalf("%s: %v", label, err)
				}
				for key, want := range step.Expect.CDN {
					if got := result.(map[string]any)[key]; !reflect.DeepEqual(got, want) {
						t.Fatalf("%s: cdn %s is %#v, want %#v", label, key, got, want)
					}
				}
				for path, raw := range step.Expect.Result {
					got := at(result, path)
					if inner, ok := marker(raw, "$contains"); ok {
						wanted := resolve(inner, saved)
						items, _ := got.([]any)
						found := false
						for _, item := range items {
							found = found || reflect.DeepEqual(item, wanted)
						}
						if !found {
							t.Fatalf("%s: %s is %#v, want it to contain %#v", label, path, got, wanted)
						}
					} else if want := resolve(raw, saved); !reflect.DeepEqual(got, want) {
						t.Fatalf("%s: %s is %#v, want %#v", label, path, got, want)
					}
				}
				if step.Save != "" {
					saved[step.Save] = result
				}
			}
			// Mock waits take no real time.
			if elapsed := time.Since(started); elapsed > 5*time.Second {
				t.Fatalf("scenario took %s", elapsed)
			}
		})
	}
}
