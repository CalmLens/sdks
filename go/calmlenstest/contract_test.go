package calmlenstest

// Replays the shared SDK contract fixtures that need this package (format in
// packages/sdk-contract/README.md): the mock behaviour scenarios and the server SDK surface
// (surface.json's capabilities, errorResponse and retryable errors; its defaults are replayed with
// the client cases). The other fixtures are replayed by the root package's contract tests, all
// read through internal/fixtures. Each fixture case is its own subtest.

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	calmlens "github.com/CalmLens/sdks/go"
	"github.com/CalmLens/sdks/go/internal/fixtures"
)

// Every capability a server SDK must offer (testdata/surface.json, packages/sdk-contract/surface.ts)
// exists under its Go name. Client methods are found by reflection; package-level functions,
// constants and types are compile-time references below, keyed by their Go names.
var surfaceFunctions = map[string]any{
	"VerifyWebhookSignature":        calmlens.VerifyWebhookSignature,
	"ParseWebhookEvent":             calmlens.ParseWebhookEvent,
	"SignWebhookPayload":            calmlens.SignWebhookPayload,
	"CreateWebhookHeaders":          calmlens.CreateWebhookHeaders,
	"ToWebhookEventPayload":         calmlens.ToWebhookEventPayload,
	"VerifyWebhookRequest":          calmlens.VerifyWebhookRequest,
	"EventFacts.IsTest":             calmlens.EventFacts.IsTest,
	"calmlenstest.SignUploadToken":  SignUploadToken,
	"calmlenstest.NewServerClient":  NewServerClient,
	"calmlenstest.CreateMockAPIKey": CreateMockAPIKey,
}

var surfaceConstants = map[string]string{
	"WebhookDeliveryHeader":          calmlens.WebhookDeliveryHeader,
	"WebhookTimestampHeader":         calmlens.WebhookTimestampHeader,
	"WebhookSignatureHeader":         calmlens.WebhookSignatureHeader,
	"CodeAssetNotFound":              calmlens.CodeAssetNotFound,
	"CodeSDKTransportError":          calmlens.CodeSDKTransportError,
	"CodeSDKTimeout":                 calmlens.CodeSDKTimeout,
	"CodeSDKCancelled":               calmlens.CodeSDKCancelled,
	"CodeSDKInvalidResponse":         calmlens.CodeSDKInvalidResponse,
	"CodeSDKHTTPError":               calmlens.CodeSDKHTTPError,
	"CodeSDKResponseTooLarge":        calmlens.CodeSDKResponseTooLarge,
	"CodeSDKInvalidArgument":         calmlens.CodeSDKInvalidArgument,
	"CodeSDKInvalidConfig":           calmlens.CodeSDKInvalidConfig,
	"CodeSDKInvalidWebhookSignature": calmlens.CodeSDKInvalidWebhookSignature,
	"CodeSDKInvalidWebhookPayload":   calmlens.CodeSDKInvalidWebhookPayload,
	"ResourceOriginal":               calmlens.ResourceOriginal,
	"ResourceRendered":               calmlens.ResourceRendered,
	"ResourcePlaceholder":            calmlens.ResourcePlaceholder,
}

var surfaceTypes = map[string]reflect.Type{
	"CDNAssetURLOptions":            reflect.TypeOf(calmlens.CDNAssetURLOptions{}),
	"Options":                       reflect.TypeOf(Options{}),
	"calmlenstest.MockServerClient": reflect.TypeOf(&MockServerClient{}),
}

type surfaceCapability struct {
	ID            string
	Kind          string
	Value         string
	Names         struct{ Go string }
	NotApplicable map[string]string
}

type surfaceFixture struct {
	Capabilities  []surfaceCapability
	ErrorResponse struct {
		Operation string
		Options   map[string]any
		Status    int
		Headers   map[string]string
		Body      json.RawMessage
		Expected  struct {
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

// mockOutcome is the moderation status a mock with option set to blocked gives an upload.
func mockOutcome(t *testing.T, option string) string {
	t.Helper()
	options := Options{}
	field := reflect.ValueOf(&options).Elem().FieldByName(option)
	if !field.IsValid() {
		return ""
	}
	field.SetString(OutcomeBlocked)
	m, err := NewServerClient(options)
	if err != nil {
		t.Fatal(err)
	}
	submit := calmlens.SubmitAssetOptions{Name: "note.txt", Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("hello")}}
	var asset *calmlens.Asset
	if option == "QueuedOutcome" {
		asset, err = m.Assets.Create(context.Background(), submit)
	} else {
		asset, err = m.Assets.Classify(context.Background(), submit)
	}
	if err != nil {
		t.Fatal(err)
	}
	return asset.Classification.Moderation.Status
}

// TestRetryableContract replays surface.json's retryable cases: which error codes and HTTP
// statuses every SDK treats as worth repeating.
func TestRetryableContract(t *testing.T) {
	fixture := fixtures.Read[struct {
		Retryable []struct {
			Code      string
			Status    *int
			Retryable bool
		}
	}](t, "surface.json")
	if len(fixture.Retryable) == 0 {
		t.Fatal("surface.json has no retryable cases")
	}
	for _, c := range fixture.Retryable {
		status := 0
		if c.Status != nil {
			status = *c.Status
		}
		t.Run(fmt.Sprintf("%s %d", c.Code, status), func(t *testing.T) {
			e := &calmlens.Error{Code: c.Code, Status: status}
			if got := e.Retryable(); got != c.Retryable {
				t.Fatalf("Retryable() = %v, want %v", got, c.Retryable)
			}
			if got := calmlens.IsRetryable(fmt.Errorf("wrapped: %w", e)); got != c.Retryable {
				t.Fatalf("IsRetryable = %v, want %v", got, c.Retryable)
			}
		})
	}
}

func TestSurface(t *testing.T) {
	surface := fixtures.Read[surfaceFixture](t, "surface.json")
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
	if spec.Operation != "assets.retrieve" {
		t.Fatalf("errorResponse operation %s is not replayed", spec.Operation)
	}
	assetID, _ := spec.Options["assetId"].(string)
	_, apiErr := failing.Assets.Retrieve(context.Background(), calmlens.AssetIDOptions{AssetID: assetID})
	var raised *calmlens.Error
	if !errors.As(apiErr, &raised) {
		t.Fatal("no API error", apiErr)
	}
	wantField := map[string]any{
		"errors.code":       spec.Expected.Code,
		"errors.status":     spec.Expected.Status,
		"errors.requestId":  spec.Expected.RequestID,
		"errors.retryAfter": calmlens.Ptr(time.Duration(spec.Expected.RetryAfterSeconds) * time.Second),
	}
	used := map[string]bool{}
	for _, capability := range surface.Capabilities {
		name := capability.Names.Go
		if reason := capability.NotApplicable["go"]; reason != "" {
			t.Run(capability.ID, func(t *testing.T) { t.Skip("not applicable: " + reason) })
			continue
		}
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
		case "cdn-option":
			typeName, fieldName, _ := strings.Cut(name, ".")
			used[typeName] = true
			if _, ok := surfaceTypes[typeName].FieldByName(fieldName); ok {
				url, err := client.CDN.GetAssetURL(calmlens.CDNAssetURLOptions{AssetIdentifier: "asset-1", AllowAgeRestricted: true})
				present = err == nil && strings.HasSuffix(url, "?allowAgeRestricted=true")
			}
		case "mock-option":
			typeName, fieldName, _ := strings.Cut(name, ".")
			used[typeName] = true
			present = mockOutcome(t, fieldName) == OutcomeBlocked
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

// ---- Shared mock behaviour scenarios --------------------------------------------------------
// packages/sdk-contract/mockScenarios.ts writes them and every SDK's offline mock replays them.

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
		Repeat    int
		Expect    struct {
			Result     map[string]any
			SameAs     string
			HTTPStatus *int `json:"httpStatus"`
			Error      *struct {
				Code    string
				Status  *int
				Details map[string]any
			}
			CDN *struct {
				Status           int
				Code             *string
				Body             *string
				BodyPrefixBase64 *string
				Headers          map[string]any
				HeadersPresent   []string
			} `json:"cdn"`
		}
	}
}

// at follows a dotted path: numeric segments index arrays, "length" is an array's length.
func at(value any, path string) any {
	if path == "" {
		return value
	}
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

// resolve replaces $ref, $concat and $base64Repeat markers.
func resolve(value any, saved map[string]any) any {
	if path, ok := marker(value, "$ref"); ok {
		name, rest, _ := strings.Cut(path.(string), ".")
		return at(saved[name], rest)
	}
	if parts, ok := marker(value, "$concat"); ok {
		var out strings.Builder
		for _, part := range parts.([]any) {
			fmt.Fprint(&out, resolve(part, saved))
		}
		return out.String()
	}
	if spec, ok := marker(value, "$base64Repeat"); ok {
		repeat := spec.(map[string]any)
		return base64.StdEncoding.EncodeToString([]byte(strings.Repeat(repeat["text"].(string), int(repeat["count"].(float64)))))
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

// normalize turns a typed result into plain JSON values with the API's field names. Assets and
// events are their Raw JSON; AssetPage reports "no next page" as an empty NextCursor, which the
// API sends as null.
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
	switch typed := value.(type) {
	case *calmlens.Asset:
		return normalize(t, typed.Raw)
	case []calmlens.Asset:
		items := []any{}
		for _, asset := range typed {
			items = append(items, normalize(t, asset.Raw))
		}
		return items
	case *calmlens.AssetPage:
		page := out.(map[string]any)
		page["items"] = normalize(t, typed.Items)
		if typed.NextCursor == "" {
			page["nextCursor"] = nil
		}
	case *calmlens.AssetSearchResponse:
		for i, item := range typed.Items {
			out.(map[string]any)["items"].([]any)[i].(map[string]any)["asset"] = normalize(t, item.Asset.Raw)
		}
	case *calmlens.EventsPage:
		events := []any{}
		for _, event := range typed.Events {
			events = append(events, normalize(t, event.Raw))
		}
		out.(map[string]any)["events"] = events
	case []calmlens.EventsPage:
		pages := []any{}
		for i := range typed {
			pages = append(pages, normalize(t, &typed[i]))
		}
		return pages
	}
	return out
}

func decode[T any](t *testing.T, args map[string]any) T {
	t.Helper()
	data, _ := json.Marshal(args)
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("decode %s into %T: %v", data, v, err)
	}
	return v
}

// content decodes a scenario's content or part object.
func content(t *testing.T, value any) *calmlens.Content {
	t.Helper()
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	result := &calmlens.Content{}
	result.Type, _ = object["type"].(string)
	if text, ok := object["plainText"].(string); ok {
		result.PlainText = &text
	}
	if text, ok := object["base64"].(string); ok {
		result.Base64 = &text
	}
	if part, ok := object["partNumber"].(float64); ok {
		result.PartNumber = int(part)
	}
	result.IsFinal, _ = object["isFinal"].(bool)
	return result
}

func without(args map[string]any, keys ...string) map[string]any {
	out := map[string]any{}
	for key, value := range args {
		out[key] = value
	}
	for _, key := range keys {
		delete(out, key)
	}
	return out
}

func submit(t *testing.T, args map[string]any) calmlens.SubmitAssetOptions {
	t.Helper()
	options := decode[calmlens.SubmitAssetOptions](t, without(args, "content", "part"))
	options.Content, options.Part = content(t, args["content"]), content(t, args["part"])
	options.IdempotencyKey, _ = args["idempotencyKey"].(string)
	return options
}

// inexpressible names a step whose arguments Go's types cannot express: an int option of 0
// means "use the default", so the request carries no value for the API to refuse.
func inexpressible(t *testing.T, operation string, args map[string]any) string {
	t.Helper()
	for _, key := range []string{"pageSize", "limit"} {
		if value, ok := args[key]; ok && value == float64(0) {
			return fmt.Sprintf("%s's %s of 0 means the default in Go", operation, key)
		}
	}
	return ""
}

func runStep(t *testing.T, ctx context.Context, m *MockServerClient, operation string, args map[string]any) (any, error) {
	t.Helper()
	var result any
	var err error
	switch operation {
	case "mock.decide":
		result, err = m.Decide(args["assetId"].(string), args["outcome"].(string))
	case "mock.enqueueEvent":
		event := m.EnqueueEvent(decode[calmlens.Event](t, args))[0]
		result = &event
	case "mock.grant":
		data, _ := json.Marshal(args["grants"])
		var grants []Grant
		if err := json.Unmarshal(data, &grants); err != nil {
			t.Fatal(err)
		}
		m.SetAPIKeyGrants(grants)
		return nil, nil
	case "mock.failNext":
		operation, _ := args["operation"].(string)
		m.FailNextRequest(args["failure"].(string), operation)
		return nil, nil
	case "assets.create":
		result, err = m.Assets.Create(ctx, submit(t, args))
	case "assets.classify":
		result, err = m.Assets.Classify(ctx, submit(t, args))
	case "text.classify":
		result, err = m.Text.Classify(ctx, decode[calmlens.ClassifyTextOptions](t, args))
	case "assets.retrieve":
		result, err = m.Assets.Retrieve(ctx, decode[calmlens.AssetIDOptions](t, args))
	case "assets.update":
		result, err = m.Assets.Update(ctx, decode[calmlens.UpdateAssetOptions](t, args))
	case "assets.move":
		result, err = m.Assets.Move(ctx, decode[calmlens.MoveAssetOptions](t, args))
	case "assets.list":
		result, err = m.Assets.List(ctx, decode[calmlens.ListAssetsOptions](t, args))
	case "assets.listChildren":
		result, err = m.Assets.ListChildren(ctx, decode[calmlens.ListAssetChildrenOptions](t, args))
	case "assets.search":
		result, err = m.Assets.Search(ctx, decode[calmlens.SearchAssetsOptions](t, args))
	case "assets.uploadPart":
		options := decode[calmlens.UploadAssetPartOptions](t, without(args, "part"))
		if part := content(t, args["part"]); part != nil {
			options.Part = *part
		}
		result, err = m.Assets.UploadPart(ctx, options)
	case "assets.createSignedUrl":
		options := decode[calmlens.SignedURLOptions](t, args)
		options.AssetID, _ = args["assetId"].(string)
		result, err = m.Assets.CreateSignedURL(ctx, options)
	case "assets.retry":
		result, err = m.Assets.Retry(ctx, decode[calmlens.AssetIDOptions](t, args))
	case "assets.explain":
		result, err = m.Assets.Explain(ctx, decode[calmlens.ExplainAssetOptions](t, args))
	case "assets.deleteContent":
		result, err = m.Assets.DeleteContent(ctx, decode[calmlens.AssetIDOptions](t, args))
	case "assets.delete":
		err = m.Assets.Delete(ctx, decode[calmlens.AssetIDOptions](t, args))
	case "assets.batch":
		result, err = m.Assets.Batch(ctx, decode[calmlens.BatchAssetsOptions](t, args))
	case "assets.waitForDecision":
		options := calmlens.WaitForDecisionOptions{AssetID: args["assetId"].(string)}
		if ms, ok := args["timeoutMs"].(float64); ok {
			options.Timeout = calmlens.Ptr(time.Duration(ms) * time.Millisecond)
		}
		result, err = m.Assets.WaitForDecision(ctx, options)
	case "assets.iterate", "assets.iterateChildren":
		var it *calmlens.AssetIterator
		if operation == "assets.iterate" {
			it = m.Assets.ListAll(decode[calmlens.ListAssetsOptions](t, args))
		} else {
			it = m.Assets.ListChildrenAll(decode[calmlens.ListAssetChildrenOptions](t, args))
		}
		items := []calmlens.Asset{}
		for it.Next(ctx) {
			items = append(items, it.Asset())
		}
		result, err = items, it.Err()
	case "events.list":
		result, err = m.Events.List(ctx, decode[calmlens.ListEventsOptions](t, args))
	case "events.pages":
		it := m.Events.ListAll(decode[calmlens.ListEventsOptions](t, args))
		pages := []calmlens.EventsPage{}
		for it.NextPage(ctx) {
			pages = append(pages, *it.Page())
		}
		result, err = pages, it.Err()
	case "folders.list":
		result, err = m.Folders.List(ctx, decode[calmlens.ListFoldersOptions](t, args))
	case "folders.create":
		result, err = m.Folders.Create(ctx, decode[calmlens.CreateFolderOptions](t, args))
	case "folders.retrieve":
		result, err = m.Folders.Retrieve(ctx, decode[calmlens.FolderIDOptions](t, args))
	case "folders.update":
		options := decode[calmlens.UpdateFolderOptions](t, args)
		options.FolderID, _ = args["folderId"].(string)
		result, err = m.Folders.Update(ctx, options)
	case "folders.move":
		result, err = m.Folders.Move(ctx, decode[calmlens.MoveFolderOptions](t, args))
	case "folders.delete":
		err = m.Folders.Delete(ctx, decode[calmlens.FolderIDOptions](t, args))
	case "hashLists.list":
		result, err = m.HashLists.List(ctx, decode[calmlens.ListHashListsOptions](t, args))
	case "hashLists.retrieve":
		result, err = m.HashLists.Retrieve(ctx, decode[calmlens.HashListIDOptions](t, args))
	case "hashLists.create":
		result, err = m.HashLists.Create(ctx, decode[calmlens.CreateHashListOptions](t, args))
	case "hashLists.update":
		result, err = m.HashLists.Update(ctx, decode[calmlens.UpdateHashListOptions](t, args))
	case "hashLists.delete":
		err = m.HashLists.Delete(ctx, decode[calmlens.HashListIDOptions](t, args))
	case "hashLists.listEntries":
		result, err = m.HashLists.ListEntries(ctx, decode[calmlens.ListHashListEntriesOptions](t, args))
	case "hashLists.addEntry":
		result, err = m.HashLists.AddEntry(ctx, decode[calmlens.AddHashListEntryOptions](t, args))
	case "hashLists.removeEntry":
		err = m.HashLists.RemoveEntry(ctx, decode[calmlens.HashListEntryIDOptions](t, args))
	case "ensureLens":
		result, err = m.EnsureLens(ctx, decode[calmlens.EnsureLensOptions](t, args))
	case "ensureLenses":
		result, err = m.EnsureLenses(ctx, decode[calmlens.EnsureLensesOptions](t, args))
	default:
		t.Fatalf("unhandled operation %s", operation)
	}
	if err != nil {
		return nil, err
	}
	if result == nil || reflect.ValueOf(result).Kind() == reflect.Pointer && reflect.ValueOf(result).IsNil() {
		return nil, nil
	}
	return normalize(t, result), nil
}

// served is what a cdn.serve step returns.
type served struct {
	status int
	header http.Header
	body   []byte
}

func checkCDN(t *testing.T, label string, got served, want *struct {
	Status           int
	Code             *string
	Body             *string
	BodyPrefixBase64 *string
	Headers          map[string]any
	HeadersPresent   []string
}, saved map[string]any) {
	t.Helper()
	if got.status != want.Status {
		t.Fatalf("%s: status %d, want %d (%s)", label, got.status, want.Status, got.body)
	}
	if want.Code != nil {
		var errorBody struct{ Code string }
		_ = json.Unmarshal(got.body, &errorBody)
		if !strings.HasPrefix(got.header.Get("Content-Type"), "application/json") || errorBody.Code != *want.Code {
			t.Fatalf("%s: code %q, want %q", label, errorBody.Code, *want.Code)
		}
	}
	if want.Body != nil && string(got.body) != *want.Body {
		t.Fatalf("%s: body %q, want %q", label, got.body, *want.Body)
	}
	if want.BodyPrefixBase64 != nil {
		prefix, _ := base64.StdEncoding.DecodeString(*want.BodyPrefixBase64)
		if !bytes.HasPrefix(got.body, prefix) {
			t.Fatalf("%s: body starts %x, want %x", label, got.body[:min(len(got.body), len(prefix))], prefix)
		}
	}
	for name, value := range want.Headers {
		// Header names are case-insensitive: http.Header.Get canonicalizes them.
		if expected := resolve(value, saved); got.header.Get(name) != expected {
			t.Fatalf("%s: header %s is %q, want %q", label, name, got.header.Get(name), expected)
		}
	}
	for _, name := range want.HeadersPresent {
		if len(got.header.Values(name)) == 0 {
			t.Fatalf("%s: no %s header", label, name)
		}
	}
}

func TestSharedMockScenarios(t *testing.T) {
	fixture := fixtures.Read[struct{ Scenarios []mockScenario }](t, "mock-scenarios.json")
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
				runs := max(step.Repeat, 1)
				for run := 0; run < runs; run++ {
					label := fmt.Sprintf("step %d (%s)", index+1, step.Operation)
					if step.Repeat > 0 {
						label = fmt.Sprintf("step %d run %d (%s)", index+1, run+1, step.Operation)
					}
					var raw any = map[string]any{}
					if len(step.Args) > 0 {
						if err = json.Unmarshal(step.Args, &raw); err != nil {
							t.Fatal(err)
						}
					}
					args := resolve(raw, saved).(map[string]any)
					if reason := inexpressible(t, step.Operation, args); reason != "" {
						t.Logf("%s: skipped, %s", label, reason)
						continue
					}
					m.mu.Lock()
					m.lastStatus = 0
					m.mu.Unlock()
					var result any
					var servedResponse served
					if step.Operation == "cdn.serve" {
						response, serveErr := m.CDN.Serve(ctx, calmlens.CDNServeOptions{CDNAssetURLOptions: decode[calmlens.CDNAssetURLOptions](t, args)})
						err = serveErr
						if err == nil {
							body, _ := io.ReadAll(response.Body)
							response.Body.Close()
							servedResponse = served{status: response.StatusCode, header: response.Header, body: body}
						}
					} else {
						result, err = runStep(t, ctx, m, step.Operation, args)
					}
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
							t.Fatalf("%s: got %s (status %v), want %s (status %v): %v", label, apiErr.Code, apiErr.Status, want.Code, want.Status, err)
						}
						details := normalize(t, apiErr.Details)
						for key, value := range want.Details {
							if got := at(details, key); !reflect.DeepEqual(got, resolve(value, saved)) {
								t.Fatalf("%s: details.%s is %#v, want %#v", label, key, got, value)
							}
						}
						continue
					}
					if err != nil {
						t.Fatalf("%s: %v", label, err)
					}
					if want := step.Expect.HTTPStatus; want != nil {
						m.mu.Lock()
						got := m.lastStatus
						m.mu.Unlock()
						if got != *want {
							t.Fatalf("%s: final response status is %d, want %d", label, got, *want)
						}
					}
					if want := step.Expect.CDN; want != nil {
						checkCDN(t, label, servedResponse, want, saved)
					}
					if name := step.Expect.SameAs; name != "" {
						if want, ok := saved[name]; !ok || !reflect.DeepEqual(result, want) {
							t.Fatalf("%s: result is %#v, want the same as %s: %#v", label, result, name, want)
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
			}
			// Mock waits take no real time.
			if elapsed := time.Since(started); elapsed > 5*time.Second {
				t.Fatalf("scenario took %s", elapsed)
			}
		})
	}
}
