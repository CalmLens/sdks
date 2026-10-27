package calmlens

// Replays the shared fixtures that drive the real client through a scripted HTTP transport
// (format in packages/sdk-contract/README.md): requests.json, paths.json, errors.json,
// client-cases.json and surface.json's defaults. Each fixture case is its own subtest.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/CalmLens/sdks/go/internal/fixtures"
)

// scriptedResponse is one canned answer of a fixture.
type scriptedResponse struct {
	Status         int               `json:"status"`
	Headers        map[string]string `json:"headers"`
	Body           json.RawMessage   `json:"body"`
	BodyText       *string           `json:"bodyText"`
	BodyBase64     *string           `json:"bodyBase64"`
	TransportError bool              `json:"transportError"`
	Hang           bool              `json:"hang"`
}

// recordedRequest is a request the scripted transport received.
type recordedRequest struct {
	method string
	url    *url.URL
	header http.Header
	body   []byte
}

// scriptedTransport answers requests with responses in order and records them. cancel runs
// once cancelAfter requests have been sent.
type scriptedTransport struct {
	responses   []scriptedResponse
	cancelAfter int
	cancel      context.CancelFunc
	mu          sync.Mutex
	received    []recordedRequest
}

var errConnectionReset = errors.New("connection reset by peer")

func (s *scriptedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	var body []byte
	if req.Body != nil {
		body, _ = io.ReadAll(req.Body)
		req.Body.Close()
	}
	s.mu.Lock()
	s.received = append(s.received, recordedRequest{method: req.Method, url: req.URL, header: req.Header.Clone(), body: body})
	count := len(s.received)
	s.mu.Unlock()
	if count > len(s.responses) {
		return nil, fmt.Errorf("request %d has no scripted response", count)
	}
	scripted := s.responses[count-1]
	if s.cancelAfter == count && s.cancel != nil {
		s.cancel()
	}
	if scripted.Hang {
		<-req.Context().Done()
		return nil, req.Context().Err()
	}
	if scripted.TransportError {
		return nil, errConnectionReset
	}
	return scripted.response(req), nil
}

func (scripted scriptedResponse) response(req *http.Request) *http.Response {
	status := scripted.Status
	if status == 0 {
		status = 200
	}
	var data []byte
	switch {
	case len(scripted.Body) > 0:
		var value any
		_ = json.Unmarshal(scripted.Body, &value)
		data, _ = json.Marshal(value)
	case scripted.BodyBase64 != nil:
		data, _ = base64.StdEncoding.DecodeString(*scripted.BodyBase64)
	case scripted.BodyText != nil:
		data = []byte(*scripted.BodyText)
	}
	header := http.Header{}
	for name, value := range scripted.Headers {
		header.Set(name, value)
	}
	length := int64(len(data))
	if declared, err := strconv.ParseInt(header.Get("Content-Length"), 10, 64); err == nil {
		length = declared
	}
	if req.Method == http.MethodHead || status == http.StatusNoContent {
		data = nil
	}
	return &http.Response{StatusCode: status, Status: strconv.Itoa(status) + " " + http.StatusText(status), Proto: "HTTP/1.1", ProtoMajor: 1, ProtoMinor: 1,
		Header: header, Body: io.NopCloser(bytes.NewReader(data)), ContentLength: length, Request: req}
}

// fixtureArgs decodes a fixture's JavaScript-style arguments, resolving the $bytes, $stream and
// $fill markers, into Go values.
type fixtureArgs map[string]any

func decodeArgs(t *testing.T, raw json.RawMessage) fixtureArgs {
	t.Helper()
	args := fixtureArgs{}
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &args); err != nil {
			t.Fatal(err)
		}
	}
	return args
}

// into decodes the arguments into a Go option struct; field names match case-insensitively.
func into[T any](t *testing.T, args fixtureArgs) T {
	t.Helper()
	data, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	var v T
	if err = json.Unmarshal(data, &v); err != nil {
		t.Fatalf("decode %s into %T: %v", data, v, err)
	}
	return v
}

func markerValue(value any, key string) (any, bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	inner, ok := object[key]
	return inner, ok
}

// oneShot is a stream that can be read once and cannot be rewound.
type oneShot struct{ io.Reader }

// fixtureContent decodes a content or part object.
func fixtureContent(t *testing.T, value any) *Content {
	t.Helper()
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	content := &Content{}
	if text, ok := object["type"].(string); ok {
		content.Type = text
	}
	if text, ok := object["plainText"].(string); ok {
		content.PlainText = &text
	}
	if text, ok := object["base64"].(string); ok {
		content.Base64 = &text
	}
	for _, key := range []string{"uint8Array", "buffer"} {
		if raw, ok := object[key]; ok {
			content.Bytes = fixtureBytes(t, raw)
		}
	}
	if raw, ok := object["data"]; ok {
		encoded, _ := markerValue(raw, "$stream")
		data, err := base64.StdEncoding.DecodeString(encoded.(string))
		if err != nil {
			t.Fatal(err)
		}
		content.Data = oneShot{bytes.NewReader(data)}
	}
	if size, ok := object["sizeInBytes"].(float64); ok {
		content.SizeInBytes = Ptr(int64(size))
	}
	if part, ok := object["partNumber"].(float64); ok {
		content.PartNumber = int(part)
	}
	if final, ok := object["isFinal"].(bool); ok {
		content.IsFinal = final
	}
	return content
}

func fixtureBytes(t *testing.T, value any) []byte {
	t.Helper()
	if encoded, ok := markerValue(value, "$bytes"); ok {
		data, err := base64.StdEncoding.DecodeString(encoded.(string))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	if fill, ok := markerValue(value, "$fill"); ok {
		spec := fill.(map[string]any)
		return bytes.Repeat([]byte{byte(spec["byte"].(float64))}, int(spec["length"].(float64)))
	}
	t.Fatalf("unknown byte marker %v", value)
	return nil
}

func fixtureSubmit(t *testing.T, args fixtureArgs) SubmitAssetOptions {
	t.Helper()
	plain := fixtureArgs{}
	for key, value := range args {
		if key != "content" && key != "part" {
			plain[key] = value
		}
	}
	options := into[SubmitAssetOptions](t, plain)
	options.Content, options.Part = fixtureContent(t, args["content"]), fixtureContent(t, args["part"])
	options.IdempotencyKey, _ = args["idempotencyKey"].(string)
	return options
}

// fixtureTransform maps a fixture transform (a selector string, one step or a list of steps) to
// Transform or TransformSteps.
func fixtureTransform(t *testing.T, value any) (string, []LensTransform) {
	t.Helper()
	switch value := value.(type) {
	case nil:
		return "", nil
	case string:
		return value, nil
	case []any:
		data, _ := json.Marshal(value)
		steps := []LensTransform{}
		if err := json.Unmarshal(data, &steps); err != nil {
			t.Fatal(err)
		}
		return "", steps
	default:
		data, _ := json.Marshal(value)
		var step LensTransform
		if err := json.Unmarshal(data, &step); err != nil {
			t.Fatal(err)
		}
		return "", []LensTransform{step}
	}
}

func fixtureCDN(t *testing.T, args fixtureArgs) CDNAssetURLOptions {
	t.Helper()
	options := CDNAssetURLOptions{}
	options.ViewerRegion, _ = args["viewerRegion"].(string)
	options.AssetIdentifier, _ = args["assetIdentifier"].(string)
	options.Resource, _ = args["resource"].(string)
	options.Lens, _ = args["lens"].(string)
	options.AgeConfirmed, _ = args["ageConfirmed"].(bool)
	options.Transform, options.TransformSteps = fixtureTransform(t, args["transform"])
	return options
}

// fixtureCall is an operation's result: a typed value, or the collected items of an iterator
// (with partial holding what was yielded before a failure).
type fixtureCall struct {
	result  any
	partial any
}

// invoke runs a request-fixture operation with JavaScript-style arguments.
func invoke(t *testing.T, ctx context.Context, c *ServerClient, operation string, args fixtureArgs) (fixtureCall, error) {
	t.Helper()
	one := func(result any, err error) (fixtureCall, error) { return fixtureCall{result: result}, err }
	switch operation {
	case "assets.create":
		return one(c.Assets.Create(ctx, fixtureSubmit(t, args)))
	case "assets.classify":
		return one(c.Assets.Classify(ctx, fixtureSubmit(t, args)))
	case "text.classify":
		options := into[ClassifyTextOptions](t, args)
		options.IdempotencyKey, _ = args["idempotencyKey"].(string)
		return one(c.Text.Classify(ctx, options))
	case "assets.retrieve":
		return one(c.Assets.Retrieve(ctx, into[AssetIDOptions](t, args)))
	case "assets.update":
		return one(c.Assets.Update(ctx, into[UpdateAssetOptions](t, args)))
	case "assets.move":
		return one(c.Assets.Move(ctx, into[MoveAssetOptions](t, args)))
	case "assets.list":
		return one(c.Assets.List(ctx, into[ListAssetsOptions](t, args)))
	case "assets.listChildren":
		return one(c.Assets.ListChildren(ctx, into[ListAssetChildrenOptions](t, args)))
	case "assets.search":
		return one(c.Assets.Search(ctx, into[SearchAssetsOptions](t, args)))
	case "assets.uploadPart":
		plain := fixtureArgs{}
		for key, value := range args {
			if key != "part" {
				plain[key] = value
			}
		}
		options := into[UploadAssetPartOptions](t, plain)
		if part := fixtureContent(t, args["part"]); part != nil {
			options.Part = *part
		}
		return one(c.Assets.UploadPart(ctx, options))
	case "assets.createSignedUrl":
		plain := fixtureArgs{}
		for key, value := range args {
			if key != "transform" {
				plain[key] = value
			}
		}
		options := into[SignedURLOptions](t, plain)
		options.AssetID, _ = args["assetId"].(string)
		options.Transform, options.TransformSteps = fixtureTransform(t, args["transform"])
		return one(c.Assets.CreateSignedURL(ctx, options))
	case "assets.retry":
		return one(c.Assets.Retry(ctx, into[AssetIDOptions](t, args)))
	case "assets.explain":
		return one(c.Assets.Explain(ctx, into[ExplainAssetOptions](t, args)))
	case "assets.deleteContent":
		return one(c.Assets.DeleteContent(ctx, into[AssetIDOptions](t, args)))
	case "assets.delete":
		return fixtureCall{}, c.Assets.Delete(ctx, into[AssetIDOptions](t, args))
	case "assets.batch":
		return one(c.Assets.Batch(ctx, into[BatchAssetsOptions](t, args)))
	case "assets.waitForDecision":
		options := WaitForDecisionOptions{}
		options.AssetID, _ = args["assetId"].(string)
		if ms, ok := args["timeoutMs"].(float64); ok {
			options.Timeout = Ptr(time.Duration(ms * float64(time.Millisecond)))
		}
		return one(c.Assets.WaitForDecision(ctx, options))
	case "events.list":
		return one(c.Events.List(ctx, into[ListEventsOptions](t, args)))
	case "folders.list":
		return one(c.Folders.List(ctx, into[ListFoldersOptions](t, args)))
	case "folders.create":
		return one(c.Folders.Create(ctx, into[CreateFolderOptions](t, args)))
	case "folders.retrieve":
		return one(c.Folders.Retrieve(ctx, into[FolderIDOptions](t, args)))
	case "folders.update":
		options := into[UpdateFolderOptions](t, args)
		options.FolderID, _ = args["folderId"].(string)
		return one(c.Folders.Update(ctx, options))
	case "folders.move":
		return one(c.Folders.Move(ctx, into[MoveFolderOptions](t, args)))
	case "folders.delete":
		return fixtureCall{}, c.Folders.Delete(ctx, into[FolderIDOptions](t, args))
	case "hashLists.list":
		return one(c.HashLists.List(ctx, into[ListHashListsOptions](t, args)))
	case "hashLists.retrieve":
		return one(c.HashLists.Retrieve(ctx, into[HashListIDOptions](t, args)))
	case "hashLists.create":
		return one(c.HashLists.Create(ctx, into[CreateHashListOptions](t, args)))
	case "hashLists.update":
		return one(c.HashLists.Update(ctx, into[UpdateHashListOptions](t, args)))
	case "hashLists.delete":
		return fixtureCall{}, c.HashLists.Delete(ctx, into[HashListIDOptions](t, args))
	case "hashLists.listEntries":
		return one(c.HashLists.ListEntries(ctx, into[ListHashListEntriesOptions](t, args)))
	case "hashLists.addEntry":
		return one(c.HashLists.AddEntry(ctx, into[AddHashListEntryOptions](t, args)))
	case "hashLists.removeEntry":
		return fixtureCall{}, c.HashLists.RemoveEntry(ctx, into[HashListEntryIDOptions](t, args))
	case "ensureLens":
		return one(c.EnsureLens(ctx, into[EnsureLensOptions](t, args)))
	case "ensureLenses":
		return one(c.EnsureLenses(ctx, into[EnsureLensesOptions](t, args)))
	case "assets.iterate", "assets.iterateChildren":
		var it *AssetIterator
		if operation == "assets.iterate" {
			it = c.Assets.ListAll(into[ListAssetsOptions](t, args))
		} else {
			it = c.Assets.ListChildrenAll(into[ListAssetChildrenOptions](t, args))
		}
		items := []Asset{}
		for it.Next(ctx) {
			items = append(items, it.Asset())
		}
		return fixtureCall{result: items, partial: items}, it.Err()
	case "events.iterate":
		it := c.Events.ListAll(into[ListEventsOptions](t, args))
		pages := []EventsPage{}
		for it.NextPage(ctx) {
			pages = append(pages, *it.Page())
		}
		return fixtureCall{result: pages, partial: pages}, it.Err()
	case "cdn.serve":
		options := CDNServeOptions{CDNAssetURLOptions: fixtureCDN(t, args)}
		if init, ok := args["init"].(map[string]any); ok {
			options.Method, _ = init["method"].(string)
			if headers, ok := init["headers"].(map[string]any); ok {
				options.Headers = http.Header{}
				for name, value := range headers {
					options.Headers.Set(name, value.(string))
				}
			}
		}
		return one(c.CDN.Serve(ctx, options))
	}
	t.Fatalf("unhandled operation %s", operation)
	return fixtureCall{}, nil
}

// plain turns a value into plain JSON values (float64 numbers) for comparison.
func plain(t *testing.T, value any) any {
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

// checkResult compares a typed result with the API JSON it should hold: the JSON decoded into
// the result's own type (so Raw fields compare too) must equal it. A nil result is null.
func checkResult(t *testing.T, label string, result any, want json.RawMessage) {
	t.Helper()
	value := reflect.ValueOf(result)
	if result == nil || value.Kind() == reflect.Pointer && value.IsNil() {
		if string(want) != "null" && len(want) != 0 {
			t.Fatalf("%s: got no result, want %s", label, want)
		}
		return
	}
	if string(want) == "null" {
		t.Fatalf("%s: got %#v, want null", label, result)
	}
	typ := value.Type()
	expected := reflect.New(typ)
	if typ.Kind() == reflect.Pointer {
		expected = reflect.New(typ.Elem())
	}
	if err := decodeJSON(want, expected.Interface()); err != nil {
		t.Fatalf("%s: decode %s: %v", label, want, err)
	}
	if typ.Kind() != reflect.Pointer {
		expected = expected.Elem()
	}
	if !reflect.DeepEqual(result, expected.Interface()) {
		got, _ := json.Marshal(result)
		t.Fatalf("%s: got %s\nwant %s", label, got, want)
	}
}

// errorFields are the fields every runner compares, nil where there is none.
func errorFields(t *testing.T, err error) map[string]any {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) {
		t.Fatalf("got %v, want a *calmlens.Error", err)
	}
	fields := map[string]any{"code": e.Code, "status": nil, "requestId": nil, "retryAfter": nil, "details": nil}
	if e.Status != 0 {
		fields["status"] = float64(e.Status)
	}
	if e.RequestID != "" {
		fields["requestId"] = e.RequestID
	}
	if e.RetryAfter != nil {
		fields["retryAfter"] = e.RetryAfter.Seconds()
	}
	if e.Details != nil {
		fields["details"] = plain(t, e.Details)
	}
	return fields
}

func checkError(t *testing.T, label string, err error, want map[string]any) {
	t.Helper()
	got := errorFields(t, err)
	if minimum, ok := markerValue(want["retryAfter"], "$gte"); ok {
		if seconds, _ := got["retryAfter"].(float64); seconds < minimum.(float64) {
			t.Fatalf("%s: retryAfter %v, want at least %v", label, got["retryAfter"], minimum)
		}
		want = clone(want)
		want["retryAfter"], got["retryAfter"] = nil, nil
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%s: error %v, want %v (%v)", label, got, want, err)
	}
}

func clone(value map[string]any) map[string]any {
	out := make(map[string]any, len(value))
	for key, item := range value {
		out[key] = item
	}
	return out
}

// ---- requests.json -------------------------------------------------------------------------

func TestRequestFixtures(t *testing.T) {
	fixtures := fixtures.Read[[]struct {
		Operation string
		Options   json.RawMessage
		Request   struct {
			Method string
			Path   string
			Query  map[string]string
			Body   any
		}
		Response json.RawMessage
		// FullModel marks a response holding every field of the model its endpoint returns.
		FullModel bool
	}](t, "requests.json")
	for index, fixture := range fixtures {
		t.Run(fmt.Sprintf("%d %s", index+1, fixture.Operation), func(t *testing.T) {
			transport := &scriptedTransport{responses: []scriptedResponse{{Body: fixture.Response, Headers: map[string]string{"content-type": "application/json"}}}}
			c, err := NewServerClient(Options{APIKey: "key", ProjectID: "project-1", MaxRetries: Ptr(0), HTTPClient: &http.Client{Transport: transport}})
			if err != nil {
				t.Fatal(err)
			}
			called, err := invoke(t, context.Background(), c, fixture.Operation, decodeArgs(t, fixture.Options))
			if err != nil {
				t.Fatal(err)
			}
			if len(transport.received) != 1 {
				t.Fatalf("sent %d requests", len(transport.received))
			}
			r := transport.received[0]
			var body any
			if len(r.body) > 0 {
				body = string(r.body)
				if r.header.Get("Content-Type") == "application/json" {
					if err = json.Unmarshal(r.body, &body); err != nil {
						t.Fatal(err)
					}
				}
			}
			params := map[string]string{}
			for key, values := range r.url.Query() {
				params[key] = values[0]
			}
			if r.method != fixture.Request.Method || r.url.EscapedPath() != fixture.Request.Path || !reflect.DeepEqual(normalizeJSONQuery(params), normalizeJSONQuery(fixture.Request.Query)) || !reflect.DeepEqual(body, fixture.Request.Body) {
				t.Fatalf("got %s %s %v %#v; want %+v", r.method, r.url.EscapedPath(), params, body, fixture.Request)
			}
			// Deletes and removals return nothing; ensureLenses returns the lenses; everything
			// else the body.
			want := fixture.Response
			switch {
			case strings.HasSuffix(fixture.Operation, ".delete"), fixture.Operation == "hashLists.removeEntry":
				want = json.RawMessage("null")
			case fixture.Operation == "ensureLenses":
				var response struct{ Lenses json.RawMessage }
				_ = json.Unmarshal(fixture.Response, &response)
				want = response.Lenses
			}
			checkResult(t, "result", called.result, want)
			if fixture.FullModel {
				checkCarriesEveryField(t, called.result, want)
			}
		})
	}
}

// checkCarriesEveryField requires that result, encoded back to JSON, holds every leaf of want
// with an equal value. checkResult decodes want into result's own type, so it cannot see a
// field the Go models drop; a full-model fixture fills every field the API can send.
func checkCarriesEveryField(t *testing.T, result any, want json.RawMessage) {
	t.Helper()
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var got, expected any
	if err = json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(want, &expected); err != nil {
		t.Fatal(err)
	}
	gotLeaves, wantLeaves := map[string]any{}, map[string]any{}
	jsonLeaves(got, "$", gotLeaves)
	jsonLeaves(expected, "$", wantLeaves)
	paths := make([]string, 0, len(wantLeaves))
	for path := range wantLeaves {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		value, ok := gotLeaves[path]
		if !ok {
			t.Errorf("result drops %s", path)
		} else if !reflect.DeepEqual(value, wantLeaves[path]) {
			t.Errorf("result has %s = %#v, want %#v", path, value, wantLeaves[path])
		}
	}
}

// jsonLeaves records each scalar, null, empty object and empty array in value by its path.
// Numbers decode as float64, so they compare numerically.
func jsonLeaves(value any, path string, out map[string]any) {
	switch v := value.(type) {
	case map[string]any:
		if len(v) == 0 {
			out[path] = v
		}
		for key, item := range v {
			jsonLeaves(item, path+"."+key, out)
		}
	case []any:
		if len(v) == 0 {
			out[path] = v
		}
		for index, item := range v {
			jsonLeaves(item, fmt.Sprintf("%s[%d]", path, index), out)
		}
	default:
		out[path] = v
	}
}

// normalizeJSONQuery decodes JSON-valued query parameters (metadata, processingOptions), so
// they compare by value: the API parses them.
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

// ---- paths.json -----------------------------------------------------------------------------

func TestPathFixtures(t *testing.T) {
	paths := fixtures.Read[struct {
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
	for _, rejection := range paths.Rejections {
		t.Run(rejection.Operation+" "+string(rejection.Options), func(t *testing.T) {
			transport := &scriptedTransport{}
			c, err := NewServerClient(Options{APIKey: "key", ProjectID: "project-1", HTTPClient: &http.Client{Transport: transport}})
			if err != nil {
				t.Fatal(err)
			}
			_, err = invoke(t, context.Background(), c, rejection.Operation, decodeArgs(t, rejection.Options))
			if got := ErrorCode(err); got != rejection.Error || len(transport.received) != 0 {
				t.Fatalf("got %q (%v) after %d requests; want %q before any request", got, err, len(transport.received), rejection.Error)
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
			args := decodeArgs(t, cdn.Options)
			for key := range args {
				if !strings.Contains(" assetIdentifier resource lens transform ageConfirmed viewerRegion ", " "+key+" ") {
					t.Fatalf("unknown CDN URL option %s", key)
				}
			}
			got, err := c.CDN.GetAssetURL(fixtureCDN(t, args))
			if got != cdn.URL || cdn.Error != "" && ErrorCode(err) != cdn.Error || cdn.Error == "" && err != nil {
				t.Errorf("%s: got %q, %v; want %q, %q", cdn.Options, got, err, cdn.URL, cdn.Error)
			}
		})
	}
}

// ---- errors.json ----------------------------------------------------------------------------

func TestAPIErrorFixtures(t *testing.T) {
	fixtures := fixtures.Read[[]struct {
		Code      string
		Operation string
		Args      json.RawMessage
		Response  scriptedResponse
		Expected  map[string]any
	}](t, "errors.json")
	for _, fixture := range fixtures {
		t.Run(fixture.Code, func(t *testing.T) {
			transport := &scriptedTransport{responses: []scriptedResponse{fixture.Response}}
			c, err := NewServerClient(Options{APIKey: "key", ProjectID: "project-1", MaxRetries: Ptr(0), HTTPClient: &http.Client{Transport: transport}})
			if err != nil {
				t.Fatal(err)
			}
			_, err = invoke(t, context.Background(), c, fixture.Operation, decodeArgs(t, fixture.Args))
			checkError(t, fixture.Code, err, fixture.Expected)
			// The code constant and the status the SDK knows for it match the API's.
			if status, ok := PublicErrorStatus(fixture.Code); !ok || float64(status) != fixture.Expected["status"] {
				t.Fatalf("PublicErrorStatus(%q) = %d, %v", fixture.Code, status, ok)
			}
		})
	}
}

// ---- client-cases.json ----------------------------------------------------------------------

type clientCase struct {
	Name                string
	Area                string
	Requires            string
	Client              map[string]any
	CancelAfterRequests int
	Responses           []scriptedResponse
	Steps               []struct {
		Operation string
		Args      json.RawMessage
		Expect    struct {
			Result        json.RawMessage
			Error         map[string]any
			PartialResult json.RawMessage
			CDN           *struct {
				Status     int
				Headers    map[string]*string
				BodyBase64 string
			} `json:"cdn"`
		}
	}
	Requests []struct {
		Method     string
		Origin     string
		Path       string
		RawQuery   string
		Query      [][2]string
		Headers    map[string]any
		Body       json.RawMessage
		BodyLength *int
		BodySha256 string
		BodyBase64 *string
	}
	SleepsMs []any
}

// clientOptions maps a case's JavaScript client options to Options.
func clientOptions(t *testing.T, values map[string]any) (Options, error) {
	t.Helper()
	options := Options{}
	for key, value := range values {
		switch key {
		case "apiKey":
			options.APIKey = value.(string)
		case "projectId":
			options.ProjectID = value.(string)
		case "baseUrl":
			options.BaseURL = value.(string)
		case "cdnBaseUrl":
			options.CDNBaseURL = value.(string)
		case "maxRetries":
			n := value.(float64)
			if n != float64(int(n)) {
				return options, fmt.Errorf("maxRetries %v is not an int", n)
			}
			options.MaxRetries = Ptr(int(n))
		case "timeoutMs":
			options.Timeout = time.Duration(value.(float64) * float64(time.Millisecond))
		case "maxResponseBytes":
			options.MaxResponseBytes = int64(value.(float64))
		default:
			t.Fatalf("unknown client option %s", key)
		}
	}
	return options, nil
}

// Cases whose client options Go's types cannot express: the option's zero value means "use the
// default", and a fractional count does not fit an int. Each is checked to be inexpressible.
var inexpressibleClientCases = map[string]string{
	"a fractional maxRetries is refused before any request":  "Options.MaxRetries is an *int, which cannot hold 1.5",
	"a timeoutMs of 0 is refused before any request":         "Options.Timeout zero means DefaultTimeout",
	"a maxResponseBytes of 0 is refused before any request":  "Options.MaxResponseBytes zero means DefaultMaxResponseBytes",
	"create from a URL sends JSON with every optional field": "SubmitAssetOptions.FolderID nil is the same as no folder, so the body leaves out folderId: null",
	"JSON request bodies are sent as application/json":       "CreateFolderOptions.ParentID nil is the same as the root, so the body leaves out parentId: null",
}

// nullFields are the body fields the cases above send as null and Go leaves out.
var nullFields = map[string]string{
	"create from a URL sends JSON with every optional field": "folderId",
	"JSON request bodies are sent as application/json":       "parentId",
}

var uuidV4 = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestClientCases(t *testing.T) {
	fixture := fixtures.Read[struct {
		Client       map[string]any
		EveryRequest struct{ Headers map[string]any }
		Cases        []clientCase
	}](t, "client-cases.json")
	notApplicable := surfaceNotApplicable(t)
	for _, clientCase := range fixture.Cases {
		t.Run(clientCase.Area+": "+clientCase.Name, func(t *testing.T) {
			if clientCase.Requires != "" {
				reason, known := notApplicable[clientCase.Requires]
				if !known {
					t.Fatalf("requires unknown capability %s", clientCase.Requires)
				}
				if reason != "" {
					t.Skip("not applicable: " + reason)
				}
			}
			values := clone(fixture.Client)
			for key, value := range clientCase.Client {
				values[key] = value
			}
			options, optionsErr := clientOptions(t, values)
			if reason, ok := inexpressibleClientCases[clientCase.Name]; ok {
				checkInexpressible(t, clientCase, options, optionsErr)
				if _, nullField := nullFields[clientCase.Name]; !nullField {
					t.Skip(reason)
				}
				t.Log(reason)
			} else if optionsErr != nil {
				t.Fatal(optionsErr)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			transport := &scriptedTransport{responses: clientCase.Responses, cancelAfter: clientCase.CancelAfterRequests, cancel: cancel}
			options.HTTPClient = &http.Client{Transport: transport}
			client, constructionErr := NewServerClient(options)
			var slept []time.Duration
			if client != nil {
				client.sleep = func(ctx context.Context, d time.Duration) error {
					slept = append(slept, d)
					return ctx.Err()
				}
			}
			for index, step := range clientCase.Steps {
				label := fmt.Sprintf("step %d (%s)", index+1, step.Operation)
				var called fixtureCall
				err := constructionErr
				if err == nil {
					called, err = invoke(t, ctx, client, step.Operation, decodeArgs(t, step.Args))
				}
				if want := step.Expect.Error; want != nil {
					checkError(t, label, err, want)
					if len(step.Expect.PartialResult) > 0 {
						checkResult(t, label+" yielded", called.partial, step.Expect.PartialResult)
					}
					break
				}
				if err != nil {
					t.Fatalf("%s: %v", label, err)
				}
				if want := step.Expect.CDN; want != nil {
					response := called.result.(*http.Response)
					data, _ := io.ReadAll(response.Body)
					response.Body.Close()
					headers := map[string]*string{}
					for name := range want.Headers {
						if values := response.Header.Values(name); len(values) > 0 {
							headers[name] = &values[0]
						} else {
							headers[name] = nil
						}
					}
					got := map[string]any{"status": response.StatusCode, "headers": plain(t, headers), "bodyBase64": base64.StdEncoding.EncodeToString(data)}
					expected := map[string]any{"status": want.Status, "headers": plain(t, want.Headers), "bodyBase64": want.BodyBase64}
					if !reflect.DeepEqual(got, expected) {
						t.Fatalf("%s: got %v, want %v", label, got, expected)
					}
					continue
				}
				result := step.Expect.Result
				if len(result) == 0 {
					result = json.RawMessage("null")
				}
				checkResult(t, label, called.result, result)
			}
			checkRequests(t, clientCase, fixture.EveryRequest.Headers, transport.received)
			checkSleeps(t, clientCase.SleepsMs, slept)
		})
	}
}

// checkInexpressible checks that a case's client options really cannot be expressed in Go.
func checkInexpressible(t *testing.T, clientCase clientCase, options Options, optionsErr error) {
	t.Helper()
	switch {
	case strings.Contains(clientCase.Name, "maxRetries"):
		if optionsErr == nil {
			t.Fatal("maxRetries 1.5 decoded")
		}
	case strings.Contains(clientCase.Name, "timeoutMs"):
		if options.Timeout != 0 {
			t.Fatal("timeoutMs 0 became", options.Timeout)
		}
	case strings.Contains(clientCase.Name, "maxResponseBytes"):
		if options.MaxResponseBytes != 0 {
			t.Fatal("maxResponseBytes 0 became", options.MaxResponseBytes)
		}
	default:
		field := nullFields[clientCase.Name]
		args := decodeArgs(t, clientCase.Steps[0].Args)
		var body map[string]any
		_ = json.Unmarshal(clientCase.Requests[0].Body, &body)
		if value, present := args[field]; !present || value != nil || body[field] != nil {
			t.Fatalf("the case no longer sends %s: null", field)
		}
		if typed, _ := json.Marshal(map[string]any{"submit": fixtureSubmit(t, args), "folder": into[CreateFolderOptions](t, args)}); strings.Contains(string(typed), `"`+field+`":null`) {
			t.Fatalf("%s: null is expressible: %s", field, typed)
		}
		delete(body, field)
		clientCase.Requests[0].Body, _ = json.Marshal(body)
	}
}

func checkRequests(t *testing.T, clientCase clientCase, every map[string]any, received []recordedRequest) {
	t.Helper()
	if len(received) != len(clientCase.Requests) {
		t.Fatalf("sent %d requests, want %d", len(received), len(clientCase.Requests))
	}
	uuids := map[string]string{}
	for index, want := range clientCase.Requests {
		got := received[index]
		label := fmt.Sprintf("request %d", index+1)
		origin := got.url.Scheme + "://" + got.url.Host
		if got.method != want.Method || origin != want.Origin || got.url.EscapedPath() != want.Path {
			t.Fatalf("%s: %s %s%s, want %s %s%s", label, got.method, origin, got.url.EscapedPath(), want.Method, want.Origin, want.Path)
		}
		gotQuery, err := url.ParseQuery(got.url.RawQuery)
		if err != nil {
			t.Fatal(err)
		}
		rawQuery, _ := url.ParseQuery(want.RawQuery)
		if pairs(gotQuery) != sortedPairs(want.Query) || pairs(rawQuery) != sortedPairs(want.Query) {
			t.Fatalf("%s: query %s, want %s (%s)", label, pairs(gotQuery), sortedPairs(want.Query), want.RawQuery)
		}
		headers := clone(every)
		for name, value := range want.Headers {
			headers[name] = value
		}
		for name, expected := range headers {
			checkHeader(t, label, name, got.header.Values(name), expected, uuids)
		}
		if want.Body != nil {
			if string(want.Body) == "null" {
				if len(got.body) != 0 {
					t.Fatalf("%s: body %q, want none", label, got.body)
				}
				continue
			}
			var gotBody, wantBody any
			if err := json.Unmarshal(got.body, &gotBody); err != nil {
				t.Fatalf("%s: body %q: %v", label, got.body, err)
			}
			_ = json.Unmarshal(want.Body, &wantBody)
			if !reflect.DeepEqual(gotBody, wantBody) {
				t.Fatalf("%s: body %s, want %s", label, got.body, want.Body)
			}
			continue
		}
		sum := sha256.Sum256(got.body)
		if want.BodyLength == nil || len(got.body) != *want.BodyLength || hex.EncodeToString(sum[:]) != want.BodySha256 || want.BodyBase64 != nil && base64.StdEncoding.EncodeToString(got.body) != *want.BodyBase64 {
			t.Fatalf("%s: raw body of %d bytes (%x), want %v bytes (%s)", label, len(got.body), sum, want.BodyLength, want.BodySha256)
		}
	}
}

func checkHeader(t *testing.T, label, name string, values []string, expected any, uuids map[string]string) {
	t.Helper()
	if _, ok := markerValue(expected, "$absent"); ok {
		if len(values) != 0 {
			t.Fatalf("%s: %s is %q, want it absent", label, name, values)
		}
		return
	}
	if len(values) != 1 {
		t.Fatalf("%s: %s is %q, want one value", label, name, values)
	}
	actual := values[0]
	if pattern, ok := markerValue(expected, "$regex"); ok {
		if !regexp.MustCompile(pattern.(string)).MatchString(actual) {
			t.Fatalf("%s: %s is %q, want it to match %s", label, name, actual, pattern)
		}
		return
	}
	if uuidLabel, ok := markerValue(expected, "$uuid"); ok {
		if !uuidV4.MatchString(actual) {
			t.Fatalf("%s: %s is %q, want a v4 UUID", label, name, actual)
		}
		key := uuidLabel.(string)
		if known, seen := uuids[key]; seen {
			if known != actual {
				t.Fatalf("%s: %s is %q, want %s (%q) again", label, name, actual, key, known)
			}
			return
		}
		for other, value := range uuids {
			if value == actual {
				t.Fatalf("%s: %s reuses %s", label, name, other)
			}
		}
		uuids[key] = actual
		return
	}
	if actual != expected {
		t.Fatalf("%s: %s is %q, want %q", label, name, actual, expected)
	}
}

func pairs(values url.Values) string {
	list := [][2]string{}
	for key, items := range values {
		for _, item := range items {
			list = append(list, [2]string{key, item})
		}
	}
	return sortedPairs(list)
}

func sortedPairs(list [][2]string) string {
	out := make([]string, len(list))
	for i, pair := range list {
		out[i] = pair[0] + "=" + pair[1]
	}
	sort.Strings(out)
	return strings.Join(out, "&")
}

// checkSleeps compares the waits the client asked for, exact or within [min, max] milliseconds.
func checkSleeps(t *testing.T, want []any, slept []time.Duration) {
	t.Helper()
	if len(slept) != len(want) {
		t.Fatalf("slept %v, want %v", slept, want)
	}
	for i, expected := range want {
		ms := float64(slept[i]) / float64(time.Millisecond)
		switch expected := expected.(type) {
		case float64:
			if ms != expected {
				t.Fatalf("sleep %d is %vms, want %vms", i+1, ms, expected)
			}
		case []any:
			if ms < expected[0].(float64) || ms > expected[1].(float64) {
				t.Fatalf("sleep %d is %vms, want %v", i+1, ms, expected)
			}
		}
	}
}

// surfaceNotApplicable maps every capability id to its Go notApplicable reason ("" when it
// applies).
func surfaceNotApplicable(t *testing.T) map[string]string {
	t.Helper()
	surface := fixtures.Read[struct {
		Capabilities []struct {
			ID            string
			NotApplicable map[string]string
		}
	}](t, "surface.json")
	out := map[string]string{}
	for _, capability := range surface.Capabilities {
		out[capability.ID] = capability.NotApplicable["go"]
	}
	return out
}

// ---- surface.json defaults ------------------------------------------------------------------

func TestClientDefaults(t *testing.T) {
	surface := fixtures.Read[struct {
		Defaults []struct {
			ID         string
			Value      any
			ObservedBy []string
		}
	}](t, "surface.json")
	cases := fixtures.Read[struct{ Cases []struct{ Name string } }](t, "client-cases.json")
	names := map[string]bool{}
	for _, c := range cases.Cases {
		names[c.Name] = true
	}
	c, err := NewServerClient(Options{APIKey: "key", ProjectID: "project-1"})
	if err != nil {
		t.Fatal(err)
	}
	ms := func(d time.Duration) any { return float64(d) / float64(time.Millisecond) }
	var uploadTimeout any
	if c.options.UploadTimeout != 0 {
		uploadTimeout = ms(c.options.UploadTimeout)
	}
	values := map[string]any{
		"baseUrl":                        c.options.BaseURL,
		"cdnBaseUrl":                     c.options.CDNBaseURL,
		"timeoutMs":                      ms(c.options.Timeout),
		"uploadTimeoutMs":                uploadTimeout,
		"maxRetries":                     float64(c.maxRetries),
		"retryBaseDelayMs":               ms(RetryBaseDelay),
		"retryMaxDelayMs":                ms(RetryMaxDelay),
		"retryAfterMaxMs":                ms(RetryAfterMax),
		"maxResponseBytes":               float64(c.options.MaxResponseBytes),
		"signedUrlExpiresInSeconds":      float64(DefaultSignedURLSeconds),
		"uploadTokenExpiresInSeconds":    float64(uploadTokenDefaultTTLSeconds),
		"waitForDecisionTimeoutMs":       ms(DefaultDecisionTimeout),
		"waitForDecisionFirstIntervalMs": ms(decisionPollFirstDelay),
		"waitForDecisionIntervalFactor":  decisionPollFactor,
		"waitForDecisionMaxIntervalMs":   ms(decisionPollMaxDelay),
		"ensureLensesBatchSize":          float64(EnsureLensesMaxPerRequest),
	}
	for _, d := range surface.Defaults {
		t.Run(d.ID, func(t *testing.T) {
			value, known := values[d.ID]
			if !known {
				t.Fatalf("%s is not a known default", d.ID)
			}
			if !reflect.DeepEqual(value, d.Value) {
				t.Fatalf("%s is %v, want %v", d.ID, value, d.Value)
			}
			for _, name := range d.ObservedBy {
				if !names[name] {
					t.Fatalf("no client case %q", name)
				}
			}
		})
	}
}
