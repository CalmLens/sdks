package calmlens

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type reply struct {
	status int
	result any
	header http.Header
	err    error
}

type harness struct {
	calls  []*http.Request
	bodies [][]byte
	result any
	status int
	header http.Header
	// next replies are used, in order, before falling back to result and status.
	next  []reply
	slept []time.Duration
	mu    sync.Mutex
}

func setup(t *testing.T) (*ServerClient, *harness) {
	t.Helper()
	h := &harness{result: JSON{"id": "a", "status": "allowed"}, status: 200}
	client, err := NewServerClient(Options{APIKey: "key", ProjectID: "p /?", HTTPClient: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		h.mu.Lock()
		defer h.mu.Unlock()
		var body []byte
		if r.Body != nil {
			body, _ = io.ReadAll(r.Body)
		}
		h.calls = append(h.calls, r)
		h.bodies = append(h.bodies, body)
		current := reply{status: h.status, result: h.result, header: h.header}
		if len(h.next) > 0 {
			current, h.next = h.next[0], h.next[1:]
		}
		if current.err != nil {
			return nil, current.err
		}
		data, _ := json.Marshal(current.result)
		if raw, ok := current.result.([]byte); ok {
			data = raw
		}
		header := current.header.Clone()
		if header == nil {
			header = http.Header{}
		}
		return &http.Response{StatusCode: current.status, Body: io.NopCloser(bytes.NewReader(data)), Header: header, Request: r}, nil
	})}})
	if err != nil {
		t.Fatal(err)
	}
	client.sleep = func(_ context.Context, d time.Duration) error {
		h.slept = append(h.slept, d)
		return nil
	}
	return client, h
}
func (h *harness) last() *http.Request { return h.calls[len(h.calls)-1] }
func (h *harness) body() JSON {
	var result JSON
	json.Unmarshal(h.bodies[len(h.bodies)-1], &result)
	return result
}
func TestTextAndRawUploads(t *testing.T) {
	c, h := setup(t)
	ctx := context.Background()
	_, err := c.Assets.Classify(ctx, SubmitAssetOptions{Name: "text", Content: &Content{Type: "text/plain", PlainText: Ptr("héllo 🌍")}, Metadata: []MetadataItem{{ID: "x", Value: false}}, ProcessingOptions: &ProcessingOptions{KeepContentAfterProcessing: Ptr(false)}})
	if err != nil {
		t.Fatal(err)
	}
	if string(h.bodies[0]) != "héllo 🌍" || h.last().Header.Get("X-Api-Key") != "key" || h.last().Header.Get("Content-Type") != "text/plain" {
		t.Fatal("incorrect body or headers")
	}
	q := h.last().URL.Query()
	if q.Get("queue") != "false" || q.Get("name") != "text" || q.Get("metadata") != `[{"id":"x","value":false}]` || q.Get("processingOptions") != `{"keepContentAfterProcessing":false}` {
		t.Fatal(q)
	}
	if !strings.Contains(h.last().URL.EscapedPath(), "p%20%2F%3F") {
		t.Fatal(h.last().URL)
	}
	forms := []Content{{PlainText: Ptr("abc")}, {Base64: Ptr("data:text/plain;base64,YWJj")}, {Bytes: []byte("abc")}, {Data: strings.NewReader("abc"), SizeInBytes: Ptr(int64(3))}}
	for _, content := range forms {
		content.Type = "text/plain"
		_, err = c.Assets.Create(ctx, SubmitAssetOptions{Name: "x", Content: &content})
		if err != nil {
			t.Fatal(err)
		}
		if string(h.bodies[len(h.bodies)-1]) != "abc" {
			t.Fatal("payload mismatch")
		}
	}
	_, err = c.Assets.Classify(ctx, SubmitAssetOptions{Name: "site", URL: "https://example.com", Metadata: []MetadataItem{{ID: "a", Value: 1}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := h.body()["metadata"].([]any); !ok {
		t.Fatal("JSON metadata must remain an array")
	}
}
func TestMultipartLeavesQueueModeToTheServer(t *testing.T) {
	c, h := setup(t)
	ctx := context.Background()
	size := int64(10 * 1024 * 1024)
	h.result = JSON{"id": "a", "status": "uploading", "sizeInBytes": 5 * 1024 * 1024}
	total := int64(12 * 1024 * 1024)
	_, err := c.Assets.Create(ctx, SubmitAssetOptions{Name: "x.png", TotalSizeInBytes: &total, Part: &Content{Type: "image/png", Bytes: make([]byte, 5*1024*1024)}})
	if err != nil {
		t.Fatal(err)
	}
	first := h.last().URL.Query()
	if first.Get("partNumber") != "1" || first.Get("queue") != "true" || first.Get("totalSizeInBytes") != "12582912" {
		t.Fatal(h.last().URL)
	}
	// A fresh client finishing an upload sends no queue mode: the server applies the saved one.
	other, h2 := setup(t)
	if _, err = other.Assets.UploadPart(ctx, UploadAssetPartOptions{AssetID: "a", Part: Content{PartNumber: 2, IsFinal: true, Data: bytes.NewReader(make([]byte, size)), SizeInBytes: &size}}); err != nil {
		t.Fatal(err)
	}
	if q := h2.last().URL.Query(); q.Has("queue") || q.Get("sizeInBytes") != "10485760" || h2.last().ContentLength != size {
		t.Fatal("part request", h2.last().URL, h2.last().ContentLength)
	}
	if _, err = other.Assets.UploadPart(ctx, UploadAssetPartOptions{AssetID: "a", Queue: Ptr(false), Part: Content{PartNumber: 2, IsFinal: true, Bytes: []byte("x")}}); err != nil {
		t.Fatal(err)
	}
	if h2.last().URL.Query().Get("queue") != "false" {
		t.Fatal("queue override not sent", h2.last().URL)
	}
	// A declared image total below the minimum is rejected before any byte is sent.
	small := int64(6 * 1024 * 1024)
	_, err = c.Assets.Create(ctx, SubmitAssetOptions{Name: "x.png", TotalSizeInBytes: &small, Part: &Content{Type: "image/png", Bytes: make([]byte, 5*1024*1024)}})
	if ErrorCode(err) != CodeMultipartImageTooSmall || len(h.calls) != 1 {
		t.Fatal(err)
	}
	// A refusal raised before sending has no HTTP status.
	var refused *Error
	if !errors.As(err, &refused) || refused.Status != 0 {
		t.Fatal("local refusal status", err)
	}
	// A part under 5 MiB that is not the last is refused before sending, as is a final image
	// part that is the whole upload but under 10 MiB.
	_, err = other.Assets.UploadPart(ctx, UploadAssetPartOptions{AssetID: "a", Part: Content{PartNumber: 2, Bytes: make([]byte, 1024)}})
	if ErrorCode(err) != CodeInvalidUploadPayload || len(h2.calls) != 2 {
		t.Fatal(err)
	}
	_, err = c.Assets.Create(ctx, SubmitAssetOptions{Name: "x.png", Part: &Content{Type: "image/png", IsFinal: true, Bytes: make([]byte, 1024)}})
	if ErrorCode(err) != CodeMultipartImageTooSmall || len(h.calls) != 1 {
		t.Fatal(err)
	}
}

func TestIdempotencyKeysAreSentAndReusedAcrossRetries(t *testing.T) {
	c, h := setup(t)
	ctx := context.Background()
	h.next = []reply{{status: 503, result: []byte("busy")}, {err: errors.New("connection reset")}}
	asset, err := c.Assets.Create(ctx, SubmitAssetOptions{Name: "x", Content: &Content{Type: "text/plain", PlainText: Ptr("hello")}})
	if err != nil || asset.ID != "a" || len(h.calls) != 3 {
		t.Fatal(asset, err, len(h.calls))
	}
	key := h.calls[0].Header.Get("Idempotency-Key")
	if len(key) != 36 || h.calls[1].Header.Get("Idempotency-Key") != key || h.calls[2].Header.Get("Idempotency-Key") != key {
		t.Fatal("key not reused", key)
	}
	for i := range h.bodies {
		if string(h.bodies[i]) != "hello" {
			t.Fatalf("attempt %d sent %q", i, h.bodies[i])
		}
	}
	if _, err = c.Assets.Create(ctx, SubmitAssetOptions{Name: "x", Content: &Content{Type: "text/plain", PlainText: Ptr("hello")}}); err != nil {
		t.Fatal(err)
	}
	if h.last().Header.Get("Idempotency-Key") == key {
		t.Fatal("a new call reused the previous key")
	}
	if _, err = c.Assets.UploadPart(ctx, UploadAssetPartOptions{AssetID: "a", IdempotencyKey: "mine", Part: Content{PartNumber: 2, IsFinal: true, Bytes: []byte("x")}}); err != nil || h.last().Header.Get("Idempotency-Key") != "mine" {
		t.Fatal("caller key not sent", err)
	}
}

func TestValidation(t *testing.T) {
	c, h := setup(t)
	ctx := context.Background()
	cases := []SubmitAssetOptions{
		{Name: "x"},
		{Name: "x", Content: &Content{Type: "application/octet-stream", Bytes: []byte("x")}},
		{Name: "x", Part: &Content{Type: "image/png", Bytes: []byte("x")}},
		{Name: "x", Part: &Content{Type: "text/plain", Base64: Ptr("YWJ"), IsFinal: true}},
		{Name: "x", Part: &Content{Type: "text/plain", Data: strings.NewReader("x"), IsFinal: true}},
		{Name: "x", Content: &Content{Type: "text/plain", Bytes: []byte("x"), SizeInBytes: Ptr(int64(2))}},
	}
	for _, options := range cases {
		if _, err := c.Assets.Create(ctx, options); err == nil {
			t.Fatal("expected validation error")
		}
	}
	if len(h.calls) != 0 {
		t.Fatal("validation sent requests")
	}
}

// The error message and helpers; the fields each response gives are in client-cases.json.
func TestErrors(t *testing.T) {
	c, h := setup(t)
	h.status = 404
	h.header = http.Header{"X-Request-Id": {"req_1"}}
	h.result = JSON{"code": "asset/not-found", "message": "Missing", "details": JSON{"x": 1}, "traceId": "trace"}
	asset, err := c.Assets.Retrieve(context.Background(), AssetIDOptions{AssetID: "x"})
	var failure *Error
	if asset != nil || !errors.As(err, &failure) || failure.Code != CodeAssetNotFound || failure.Status != 404 || failure.Details["traceId"] != "trace" || failure.RequestID != "req_1" || !IsNotFound(err) || IsRetryable(err) {
		t.Fatal(asset, err)
	}
	if message := err.Error(); !strings.Contains(message, CodeAssetNotFound) || !strings.Contains(message, "404") || !strings.Contains(message, "req_1") {
		t.Fatal(message)
	}
}

func TestLocalFailuresAreSDKErrors(t *testing.T) {
	c, h := setup(t)
	ctx := context.Background()
	asset, err := c.Assets.Update(ctx, UpdateAssetOptions{AssetID: "a", Metadata: Set([]MetadataItem{{ID: "bad", Value: make(chan int)}})})
	var failure *Error
	var unsupported *json.UnsupportedTypeError
	if asset != nil || !errors.As(err, &failure) || failure.Code != CodeSDKInvalidArgument || !errors.As(err, &unsupported) {
		t.Fatal(asset, err)
	}
	_, err = c.Assets.Create(ctx, SubmitAssetOptions{Name: "x", Metadata: []MetadataItem{{ID: "bad", Value: math.NaN()}}, Content: &Content{Type: "text/plain", PlainText: Ptr("x")}})
	if ErrorCode(err) != CodeSDKInvalidArgument || errors.Unwrap(err) == nil {
		t.Fatal(err)
	}
	if _, err = c.EnsureLens(ctx, EnsureLensOptions{Identifier: "x", Transforms: []LensTransform{{Type: "x", Options: JSON{"bad": math.Inf(1)}}}}); ErrorCode(err) != CodeSDKInvalidArgument {
		t.Fatal(err)
	}
	if len(h.calls) != 0 {
		t.Fatal("invalid arguments reached the network")
	}
}

func TestResponsesKeepUnknownFieldsAndIntegerPrecision(t *testing.T) {
	c, h := setup(t)
	h.result = JSON{"id": "a", "content": JSON{"image": JSON{"big": json.Number("9007199254740993")}}, "newField": "kept", "visibility": "unlisted", "classification": JSON{"moderation": JSON{"status": "future-status", "categories": JSON{"x": JSON{"status": "future-status"}}}}}
	asset, err := c.Assets.Retrieve(context.Background(), AssetIDOptions{AssetID: "a"})
	if err != nil {
		t.Fatal(err)
	}
	if asset.Raw["content"].(JSON)["image"].(JSON)["big"] != json.Number("9007199254740993") || asset.Raw["newField"] != "kept" || *asset.Visibility != "unlisted" || asset.Classification.Moderation.Status != "future-status" || asset.Classification.Moderation.Categories["x"].Status != "future-status" {
		t.Fatalf("%#v", asset.Raw)
	}
}

func TestRequestsIdentifyTheSDKAndHideTheKey(t *testing.T) {
	c, h := setup(t)
	c.options.APIKey = "sk_live_secret"
	if _, err := c.Folders.List(context.Background(), ListFoldersOptions{}); err != nil {
		t.Fatal(err)
	}
	if got := h.last().Header.Get("User-Agent"); !strings.HasPrefix(got, "calmlens-go/"+Version+" (go") {
		t.Fatal(got)
	}
	for _, text := range []string{fmt.Sprint(c), fmt.Sprintf("%+v", c), fmt.Sprintf("%#v", c), fmt.Sprint(c.options), fmt.Sprintf("%#v", c.options), fmt.Sprintf("%+v", c.options)} {
		if strings.Contains(text, "sk_live_secret") {
			t.Fatal("API key printed:", text)
		}
	}
}

func TestIteratorsFollowEveryPage(t *testing.T) {
	c, h := setup(t)
	ctx := context.Background()
	h.next = []reply{
		{status: 200, result: JSON{"items": []JSON{{"id": "1"}, {"id": "2"}}, "hasMore": true, "nextCursor": "next-token"}},
		{status: 200, result: JSON{"items": []JSON{{"id": "3"}}, "hasMore": false}},
	}
	it := c.Assets.ListAll(ListAssetsOptions{PageSize: 2, Filter: Ptr("classification.moderation.status==allowed")})
	ids := []string{}
	for it.Next(ctx) {
		ids = append(ids, it.Asset().ID)
	}
	if it.Err() != nil || fmt.Sprint(ids) != "[1 2 3]" || h.calls[1].URL.Query().Get("cursor") != "next-token" || h.calls[1].URL.Query().Get("filter") != "classification.moderation.status==allowed" {
		t.Fatal(ids, it.Err())
	}
	h.calls = nil
	h.next = []reply{
		{status: 200, result: JSON{"items": []JSON{{"id": "c1"}}, "hasMore": true, "nextCursor": "next-token"}},
		{status: 404, result: JSON{"code": CodeAssetNotFound}},
	}
	ids = nil
	children := c.Assets.ListChildrenAll(ListAssetChildrenOptions{AssetID: "p"})
	children.All(ctx)(func(asset Asset, err error) bool {
		if err != nil {
			ids = append(ids, ErrorCode(err))
		} else {
			ids = append(ids, asset.ID)
		}
		return true
	})
	if fmt.Sprint(ids) != "[c1 asset/not-found]" || !strings.HasSuffix(h.calls[0].URL.Path, "/assets/p/children") {
		t.Fatal(ids)
	}
	h.calls = nil
	h.next = []reply{
		{status: 200, result: JSON{"items": []JSON{{"id": "e1"}}, "nextCursor": "c1", "hasMore": true}},
		{status: 200, result: JSON{"items": []JSON{{"id": "e2"}}, "nextCursor": "c2", "hasMore": false}},
	}
	events := c.Events.ListAll(ListEventsOptions{Cursor: "c0"})
	ids = nil
	for events.Next(ctx) {
		ids = append(ids, events.Event().ID)
	}
	if fmt.Sprint(ids) != "[e1 e2]" || events.Cursor() != "c2" || h.calls[1].URL.Query().Get("cursor") != "c1" {
		t.Fatal(ids, events.Cursor())
	}
}

func TestLensCache(t *testing.T) {
	c, h := setup(t)
	ctx := context.Background()
	lens := EnsureLensOptions{Identifier: "thumb", Name: "Thumb", Type: "image", Active: true, Version: 1, Transforms: []LensTransform{ImageTransform(ImageTransformOptions{Width: Ptr(20)})}}
	h.result = JSON{"lenses": []Lens{{ID: "l", EnsureLensOptions: lens}}}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := c.EnsureLens(ctx, lens); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if len(h.calls) != 1 {
		t.Fatal(len(h.calls))
	}
	result, err := c.EnsureLenses(ctx, EnsureLensesOptions{Lenses: []EnsureLensOptions{lens, lens}})
	if err != nil || len(result) != 2 {
		t.Fatal(err)
	}
	result[0].Transforms[0].Options.(JSON)["width"] = "changed"
	again, _ := c.EnsureLens(ctx, lens)
	if again.Transforms[0].Type != TransformTypeImage || again.Transforms[0].Options.(JSON)["width"] != json.Number("20") {
		t.Fatal("cache mutated")
	}
	lens.Version = 2
	h.status = 409
	h.result = JSON{"code": "lens/version-conflict"}
	if _, err = c.EnsureLens(ctx, lens); err == nil {
		t.Fatal("expected conflict")
	}
	h.status = 200
	h.result = JSON{"lenses": []Lens{{ID: "l", EnsureLensOptions: lens}}}
	if _, err = c.EnsureLens(ctx, lens); err != nil {
		t.Fatal(err)
	}
	lens.Version = 1
	h.result = JSON{"lenses": []Lens{{ID: "l", EnsureLensOptions: lens}}}
	if _, err = c.EnsureLens(ctx, lens); err != nil {
		t.Fatal(err)
	}
	if len(h.calls) != 4 {
		t.Fatal(len(h.calls))
	}
}
func TestCDNURLsAndServeHeaders(t *testing.T) {
	c, h := setup(t)
	endpoint, err := c.CDN.GetAssetURL(CDNAssetURLOptions{AssetIdentifier: "a/b?", Lens: "my lens"})
	if err != nil || endpoint != "https://cdn.calmlens.com/v1/assets/p%20%2F%3F/a%2Fb%3F/rendered/@my%20lens" {
		t.Fatal(endpoint, err)
	}
	endpoint, _ = c.CDN.GetAssetURL(CDNAssetURLOptions{AssetIdentifier: "a", Transform: "/width=20/[x]"})
	if !strings.HasSuffix(endpoint, "/rendered/width=20/%5Bx%5D") {
		t.Fatal(endpoint)
	}
	endpoint, err = c.CDN.GetAssetURL(CDNAssetURLOptions{AssetIdentifier: "a", Lens: "x", Transform: "format=avif"})
	if err != nil || !strings.HasSuffix(endpoint, "/@x/format=avif") {
		t.Fatal(endpoint, err)
	}
	_, err = c.CDN.GetAssetURL(CDNAssetURLOptions{AssetIdentifier: "a", Transform: "width=1", TransformSteps: []LensTransform{{Type: "imageTransform"}}})
	if ErrorCode(err) != CodeSDKInvalidArgument {
		t.Fatal("expected Transform and TransformSteps error", err)
	}
	// Struct options are encoded through their JSON field names; numbers follow JavaScript's String(n).
	type resize struct {
		Width   float64  `json:"width"`
		Height  *float64 `json:"height"`
		Quality float64  `json:"quality"`
		Tiny    float64  `json:"tiny"`
	}
	endpoint, err = c.CDN.GetAssetURL(CDNAssetURLOptions{AssetIdentifier: "a", TransformSteps: []LensTransform{{Type: TransformTypeImage, Options: resize{Width: 1e21, Quality: -0.0, Tiny: 1.5e-7}}}})
	if err != nil || !strings.HasSuffix(endpoint, "/rendered/quality=0,tiny=1.5e-7,width=1e%2B21") {
		t.Fatal(endpoint, err)
	}
	_, err = c.CDN.GetAssetURL(CDNAssetURLOptions{AssetIdentifier: "a", TransformSteps: []LensTransform{{Type: "imageTransform", Options: JSON{"width": math.NaN()}}}})
	if ErrorCode(err) != CodeSDKInvalidArgument {
		t.Fatal("expected non-finite option error", err)
	}
	for _, options := range []JSON{{"Width": 1}, {"border": JSON{"bad-name": 1}}, {"quality": nil}} {
		_, err = c.CDN.GetAssetURL(CDNAssetURLOptions{AssetIdentifier: "a", TransformSteps: []LensTransform{{Type: "imageTransform", Options: options}}})
		if ErrorCode(err) != CodeSDKInvalidArgument {
			t.Fatal("expected invalid option error", options, err)
		}
	}
	res, err := c.CDN.Serve(context.Background(), CDNServeOptions{CDNAssetURLOptions: CDNAssetURLOptions{AssetIdentifier: "a"}, Headers: http.Header{"X-Api-Key": {"wrong"}, "Range": {"bytes=0-1"}}})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if h.last().Header.Get("X-Api-Key") != "key" || h.last().Header.Get("Range") != "bytes=0-1" {
		t.Fatal(h.last().Header)
	}
}
func TestUnknownCoverageAndReportFields(t *testing.T) {
	var a Asset
	err := json.Unmarshal([]byte(`{"classification": {"moderation": {"provider":"x","categories": {"violence": {"status": "not-evaluated", "reason": "unsupported"}}}}}`), &a)
	if err != nil || a.Classification.Moderation.Categories["violence"].Score != nil || a.Classification.Moderation.Raw["provider"] != "x" {
		t.Fatal(a, err)
	}
}

func TestReportFeatureResultsDecode(t *testing.T) {
	var a Asset
	err := json.Unmarshal([]byte(`{
  "classification": {
    "moderation": {
      "categories": {}
    },
    "personDetection": {
      "status": "not-evaluated",
      "stage": "beta",
      "reason": "unavailable"
    },
    "faceDetection": {
      "status": "evaluated",
      "stage": "beta",
      "faces": [
        {
          "box": {
            "left": -0.01,
            "top": 0.2,
            "width": 0.3,
            "height": 0.4
          },
          "confidence": 0.99,
          "ageRange": {
            "low": 21,
            "high": 30
          }
        },
        {
          "box": {
            "left": 0.5,
            "top": 0.5,
            "width": 0.1,
            "height": 0.1
          },
          "confidence": 0.8
        }
      ]
    }
  }
}`), &a)
	if err != nil {
		t.Fatal(err)
	}
	people, faces := a.Classification.PersonDetection, a.Classification.FaceDetection
	if people.Status != "not-evaluated" || people.Reason != "unavailable" || people.People != nil {
		t.Fatalf("person detection: %+v", people)
	}
	if faces.Status != "evaluated" || len(faces.Faces) != 2 || faces.Faces[0].Box.Left != -0.01 ||
		faces.Faces[0].AgeRange == nil || faces.Faces[0].AgeRange.High != 30 || faces.Faces[1].AgeRange != nil {
		t.Fatalf("face detection: %+v", faces)
	}
}

// fakeClock makes the client's decision deadline follow the waits its sleep records.
func fakeClock(c *ServerClient, h *harness) {
	clock := time.Unix(0, 0)
	c.now = func() time.Time { return clock }
	c.sleep = func(_ context.Context, d time.Duration) error {
		h.slept = append(h.slept, d)
		clock = clock.Add(d)
		return nil
	}
}

func TestWaitForDecisionTimesOutWithTheLastStatus(t *testing.T) {
	c, h := setup(t)
	fakeClock(c, h)
	h.result = JSON{"id": "a", "upload": JSON{"status": "completed"}, "classification": JSON{"status": ClassificationStatusProcessing, "moderation": JSON{"status": ModerationStatusPending}}}
	_, err := c.Assets.WaitForDecision(context.Background(), WaitForDecisionOptions{AssetID: "a", Timeout: Ptr(2 * time.Second)})
	var failure *Error
	if !errors.As(err, &failure) || failure.Code != CodeSDKTimeout || failure.Details["assetId"] != "a" || failure.Details["classificationStatus"] != ClassificationStatusProcessing || failure.Details["moderationStatus"] != ModerationStatusPending {
		t.Fatal(err)
	}
	// The last wait is cut short so the final check lands on the deadline.
	if len(h.calls) != 4 || fmt.Sprint(h.slept) != "[500ms 750ms 750ms]" {
		t.Fatal(len(h.calls), h.slept)
	}
	// The default timeout is 60s, and waits grow by 1.5 up to 5s.
	h.calls, h.slept = nil, nil
	_, err = c.Assets.WaitForDecision(context.Background(), WaitForDecisionOptions{AssetID: "a"})
	if ErrorCode(err) != CodeSDKTimeout {
		t.Fatal(err)
	}
	total := time.Duration(0)
	for _, d := range h.slept {
		total += d
	}
	if fmt.Sprint(h.slept[:8]) != "[500ms 750ms 1.125s 1.6875s 2.53125s 3.796875s 5s 5s]" || h.slept[len(h.slept)-1] != 4609375*time.Microsecond || total != 60*time.Second || len(h.calls) != len(h.slept)+1 {
		t.Fatal(h.slept, total, len(h.calls))
	}
	h.calls = nil
	if _, err = c.Assets.WaitForDecision(context.Background(), WaitForDecisionOptions{AssetID: "a", Timeout: Ptr(-time.Second)}); ErrorCode(err) != CodeSDKInvalidArgument || len(h.calls) != 0 {
		t.Fatal(err, len(h.calls))
	}
}

func TestWaitForDecisionStopsWhenCancelled(t *testing.T) {
	c, h := setup(t)
	h.result = JSON{"id": "a", "upload": JSON{"status": "completed"}, "classification": JSON{"status": ClassificationStatusProcessing, "moderation": JSON{"status": ModerationStatusPending}}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// Cancel while waiting between checks; the real sleep then returns the context error.
	c.sleep = func(ctx context.Context, d time.Duration) error {
		cancel()
		return sleep(ctx, d)
	}
	_, err := c.Assets.WaitForDecision(ctx, WaitForDecisionOptions{AssetID: "a"})
	if ErrorCode(err) != CodeSDKCancelled || !errors.Is(err, context.Canceled) || len(h.calls) != 1 {
		t.Fatal(err, len(h.calls))
	}
	h.calls = nil
	if _, err = c.Assets.WaitForDecision(ctx, WaitForDecisionOptions{AssetID: "a"}); ErrorCode(err) != CodeSDKCancelled || len(h.calls) != 0 {
		t.Fatal("cancelled context still checked", err, len(h.calls))
	}
}

func TestWithRequestOptionsChangesRetriesAndSharesTheLensCache(t *testing.T) {
	c, h := setup(t)
	ctx := context.Background()
	lens := EnsureLensOptions{Identifier: "thumb", Name: "Thumb", Type: "image", Active: true, Version: 1}
	h.result = JSON{"lenses": []Lens{{ID: "l", EnsureLensOptions: lens}}}
	if _, err := c.EnsureLens(ctx, lens); err != nil {
		t.Fatal(err)
	}
	once, err := c.WithRequestOptions(RequestOptions{MaxRetries: Ptr(0)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = once.EnsureLens(ctx, lens); err != nil || len(h.calls) != 1 {
		t.Fatal("the lens cache is not shared", err, len(h.calls))
	}
	h.next = []reply{{status: 503, result: []byte("busy")}, {status: 503, result: []byte("busy")}}
	if _, err = once.Assets.Retrieve(ctx, AssetIDOptions{AssetID: "a"}); ErrorCode(err) != CodeSDKHTTPError || len(h.calls) != 2 {
		t.Fatal("MaxRetries 0 retried", err, len(h.calls))
	}
	// The original client keeps its retries.
	h.next = []reply{{status: 503, result: []byte("busy")}}
	if _, err = c.Assets.Retrieve(ctx, AssetIDOptions{AssetID: "a"}); err != nil || len(h.calls) != 4 {
		t.Fatal("the original client changed", err, len(h.calls))
	}
	if _, err = c.WithRequestOptions(RequestOptions{Timeout: -time.Second}); ErrorCode(err) != CodeSDKInvalidConfig {
		t.Fatal(err)
	}
}

func TestUploadTimeoutBoundsBinaryUploadsOnly(t *testing.T) {
	hang := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Query().Get("contentType") == "text/plain" {
			return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"id":"a"}`)), Request: r}, nil
		}
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	c, err := NewServerClient(Options{APIKey: "key", ProjectID: "p", MaxRetries: Ptr(0), UploadTimeout: 20 * time.Millisecond, HTTPClient: &http.Client{Transport: hang}})
	if err != nil {
		t.Fatal(err)
	}
	// Without the upload deadline, the cancellation ends the call with sdk/cancelled instead.
	ctx, cancel := context.WithCancel(context.Background())
	defer time.AfterFunc(2*time.Second, cancel).Stop()
	_, err = c.Assets.Create(ctx, SubmitAssetOptions{Name: "clip", Content: &Content{Type: "audio/mpeg", Bytes: []byte("ID3")}})
	if ErrorCode(err) != CodeSDKTimeout {
		t.Fatal("binary upload not bounded", err)
	}
	if _, err = c.Assets.Create(context.Background(), SubmitAssetOptions{Name: "note", Content: &Content{Type: "text/plain", PlainText: Ptr("hi")}}); err != nil {
		t.Fatal(err)
	}
	if _, err = NewServerClient(Options{APIKey: "key", ProjectID: "p", UploadTimeout: -time.Second}); ErrorCode(err) != CodeSDKInvalidConfig {
		t.Fatal(err)
	}
}
