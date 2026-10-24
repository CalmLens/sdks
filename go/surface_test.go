package calmlens_test

// Replays testdata/surface.json (packages/sdk-contract/surface.ts): every capability a server SDK
// must offer exists under its Go name. Client methods are found by reflection; package-level
// functions, constants and types are compile-time references below, keyed by their Go names.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	calmlens "github.com/CalmLens/sdks/go"
	"github.com/CalmLens/sdks/go/calmlenstest"
)

var surfaceFunctions = map[string]any{
	"VerifyWebhookSignature":        calmlens.VerifyWebhookSignature,
	"ParseWebhookEvent":             calmlens.ParseWebhookEvent,
	"SignWebhookPayload":            calmlens.SignWebhookPayload,
	"CreateWebhookHeaders":          calmlens.CreateWebhookHeaders,
	"ToWebhookEventPayload":         calmlens.ToWebhookEventPayload,
	"calmlenstest.NewServerClient":  calmlenstest.NewServerClient,
	"calmlenstest.CreateMockAPIKey": calmlenstest.CreateMockAPIKey,
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
	"Options":                       reflect.TypeOf(calmlenstest.Options{}),
	"calmlenstest.MockServerClient": reflect.TypeOf(&calmlenstest.MockServerClient{}),
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

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func surfaceClient(t *testing.T, transport roundTrip) *calmlens.ServerClient {
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
	data, err := os.ReadFile("testdata/surface.json")
	if err != nil {
		t.Fatal(err)
	}
	var surface surfaceFixture
	if err = json.Unmarshal(data, &surface); err != nil {
		t.Fatal(err)
	}
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
	var missing []string
	for _, capability := range surface.Capabilities {
		name := capability.Names.Go
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
		used[name] = true
		if !present {
			missing = append(missing, capability.ID+" ("+name+")")
		}
	}
	if len(missing) > 0 {
		t.Errorf("missing capabilities: %v", missing)
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
