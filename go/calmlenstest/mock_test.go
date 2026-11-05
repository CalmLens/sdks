package calmlenstest

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	calmlens "github.com/CalmLens/sdks/go"
)

func TestMockLifecycle(t *testing.T) {
	c, err := NewServerClient(Options{Now: func() int64 { return 123 }})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	root, err := c.Folders.Create(ctx, calmlens.CreateFolderOptions{Name: "Root"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := c.Folders.Create(ctx, calmlens.CreateFolderOptions{Name: "Child", ParentID: &root.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.Folders.Move(ctx, calmlens.MoveFolderOptions{FolderID: root.ID, ParentID: &child.ID}); err == nil {
		t.Fatal("cycle allowed")
	}
	if err = c.Folders.Delete(ctx, calmlens.FolderIDOptions{FolderID: root.ID}); err == nil {
		t.Fatal("deleted nonempty folder")
	}
	if _, err = c.Folders.Create(ctx, calmlens.CreateFolderOptions{Name: "Root"}); err == nil {
		t.Fatal("duplicate allowed")
	}
	keep := &calmlens.ProcessingOptions{KeepContentAfterProcessing: calmlens.Ptr(true)}
	a, err := c.Assets.Classify(ctx, calmlens.SubmitAssetOptions{Name: "text", ProcessingOptions: keep, Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("hello")}})
	if err != nil || a.Classification.Status != calmlens.ClassificationStatusCompleted || a.Classification.Moderation.Status != calmlens.ModerationStatusAllowed || *a.Classification.CompletedAt != 123 ||
		a.Content.Status != calmlens.ContentStatusStored || *a.Content.Format != "text/plain" || *a.Content.SizeInBytes != 5 || a.CreatedAt != 123 {
		t.Fatal(a, err)
	}
	page, err := c.Assets.List(ctx, calmlens.ListAssetsOptions{})
	if err != nil || len(page.Items) != 1 {
		t.Fatal(page, err)
	}
	c.DatabaseStorage.Assets[a.ID]["classification"].(calmlens.JSON)["status"] = calmlens.ClassificationStatusFailed
	c.DatabaseStorage.Assets[a.ID]["classification"].(calmlens.JSON)["moderation"].(calmlens.JSON)["status"] = calmlens.ModerationStatusPending
	a, err = c.Assets.Retry(ctx, calmlens.AssetIDOptions{AssetID: a.ID})
	if err != nil || a.Classification.Status != calmlens.ClassificationStatusProcessing || a.Classification.Moderation.Status != calmlens.ModerationStatusPending || a.Classification.CompletedAt != nil {
		t.Fatal(a, err)
	}
	if _, err = c.Assets.Retry(ctx, calmlens.AssetIDOptions{AssetID: a.ID}); calmlens.ErrorCode(err) != calmlens.CodeAssetNotRetryable {
		t.Fatal("retried processing asset", err)
	}
	failing, err := NewServerClient(Options{Moderate: func(input ModerationInput) *Decision {
		if input.Trigger == TriggerUpload {
			return NewDecision(OutcomeFailed)
		}
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	failed, err := failing.Assets.Create(ctx, calmlens.SubmitAssetOptions{Name: "f", Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("f")}})
	if err != nil || failed.Classification.Status != calmlens.ClassificationStatusFailed || failed.Classification.FailureReason == nil ||
		*failed.Classification.FailureReason != calmlens.AssetFailureReasonProcessingError {
		t.Fatal(failed, err)
	}
	failed, err = failing.Assets.Retry(ctx, calmlens.AssetIDOptions{AssetID: failed.ID})
	if err != nil || failed.Classification.Status != calmlens.ClassificationStatusProcessing || failed.Classification.FailureReason != nil {
		t.Fatal(failed, err)
	}
	res, err := c.CDN.Serve(ctx, calmlens.CDNServeOptions{CDNAssetURLOptions: calmlens.CDNAssetURLOptions{AssetIdentifier: a.ID}})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal(res.StatusCode)
	}
	c.DatabaseStorage.Assets[a.ID]["visibility"] = "public"
	res, err = c.CDN.Serve(ctx, calmlens.CDNServeOptions{CDNAssetURLOptions: calmlens.CDNAssetURLOptions{AssetIdentifier: a.ID, Resource: calmlens.ResourceOriginal}})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(body) != "hello" || res.StatusCode != 200 {
		t.Fatal(string(body), res.StatusCode)
	}
	signed, err := c.Assets.CreateSignedURL(ctx, calmlens.SignedURLOptions{AssetID: a.ID, ExpiresInSeconds: 1})
	if err != nil || signed.ExpiresAt != 1123 {
		t.Fatal(signed, err)
	}
	signed, err = c.Assets.CreateSignedURL(ctx, calmlens.SignedURLOptions{AssetID: a.ID, TransformOptions: calmlens.JSON{"width": 64, "border": calmlens.JSON{"color": "#fff"}}})
	if err != nil {
		t.Fatal(err)
	}
	signedURL, err := url.Parse(signed.URL)
	if err != nil || signedURL.Query().Get("transform") != "border.color=fff,width=64" {
		t.Fatal(signed.URL, err)
	}
}
func TestMockCapturesRequestsAndAcceptsClientOptions(t *testing.T) {
	c, err := NewServerClient(Options{ProjectID: "my project", BaseURL: "http://localhost:8787/api/v1/", Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	folder, err := c.Folders.Create(ctx, calmlens.CreateFolderOptions{Name: "Inbox"})
	if err != nil {
		t.Fatal(err)
	}
	a, err := c.Assets.Create(ctx, calmlens.SubmitAssetOptions{Name: "note", FolderID: &folder.ID, Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("hi")}})
	if err != nil || a.Classification.Status != calmlens.ClassificationStatusProcessing || a.Classification.Moderation.Status != calmlens.ModerationStatusPending || a.Content.Status != calmlens.ContentStatusTemporary {
		t.Fatal(a, err)
	}
	if _, err = c.Assets.Retrieve(ctx, calmlens.AssetIDOptions{AssetID: a.ID}); err != nil {
		t.Fatal(err)
	}
	requests := c.Requests()
	if len(requests) != 3 {
		t.Fatalf("captured %d requests", len(requests))
	}
	create := requests[0]
	if create.Method != "POST" || create.Path != "/projects/my project/folders" || create.Body["name"] != "Inbox" {
		t.Fatalf("%+v", create)
	}
	upload := requests[1]
	if upload.Path != "/projects/my project/assets" || upload.Header.Get("X-CalmLens-Upload") != "content" || upload.Query.Get("queue") != "true" || upload.Query.Get("folderId") != folder.ID || string(upload.RawBody) != "hi" || upload.Body != nil {
		t.Fatalf("%+v", upload)
	}
	if requests[2].Method != "GET" || requests[2].Path != "/assets/"+a.ID || !reflect.DeepEqual(create.Status, calmlens.Ptr(http.StatusCreated)) || !reflect.DeepEqual(requests[2].Status, calmlens.Ptr(http.StatusOK)) {
		t.Fatalf("%+v", requests[2])
	}
	c.ClearRequests()
	if len(c.Requests()) != 0 {
		t.Fatal("requests not cleared")
	}
	if _, err = NewServerClient(Options{Timeout: -time.Second}); err == nil {
		t.Fatal("invalid timeout accepted")
	}
	if _, err = NewServerClient(Options{BaseURL: "localhost"}); err == nil {
		t.Fatal("invalid base URL accepted")
	}
}

func TestMockAppliesUploadTimeoutAndResponseSizeLimit(t *testing.T) {
	if _, err := NewServerClient(Options{UploadTimeout: -time.Second}); calmlens.ErrorCode(err) != calmlens.CodeSDKInvalidConfig {
		t.Fatal("invalid upload timeout accepted", err)
	}
	c, err := NewServerClient(Options{UploadTimeout: time.Minute, MaxResponseBytes: 64})
	if err != nil {
		t.Fatal(err)
	}
	// The limit applies to the mock's answers as to the API's.
	_, err = c.Assets.Create(context.Background(), calmlens.SubmitAssetOptions{Name: "note", Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("hi")}})
	if calmlens.ErrorCode(err) != calmlens.CodeSDKResponseTooLarge {
		t.Fatal("response size limit not applied", err)
	}
}

func TestMockSimulatesTransportFailures(t *testing.T) {
	c, err := NewServerClient(Options{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	offline := errors.New("connection reset by peer")
	if err = c.FailNextRequest(RequestFailure{Err: offline}, RequestFailure{Err: context.DeadlineExceeded}); err != nil {
		t.Fatal(err)
	}
	_, err = c.Folders.List(ctx, calmlens.ListFoldersOptions{})
	var sdk *calmlens.Error
	if !errors.As(err, &sdk) || sdk.Code != "sdk/transport-error" || !errors.Is(err, offline) {
		t.Fatalf("transport failure: %v", err)
	}
	_, err = c.Assets.Retrieve(ctx, calmlens.AssetIDOptions{AssetID: "missing"})
	if !errors.As(err, &sdk) || sdk.Code != "sdk/timeout" || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout: %v", err)
	}
	if _, err = c.Folders.List(ctx, calmlens.ListFoldersOptions{}); err != nil {
		t.Fatalf("failure queue not drained: %v", err)
	}
	requests := c.Requests()
	if len(requests) != 3 || requests[0].Status != nil || requests[1].Status != nil || !reflect.DeepEqual(requests[2].Status, calmlens.Ptr(http.StatusOK)) {
		t.Fatalf("failed requests should be captured without a status: %+v", requests)
	}
}

func TestMockRefusesFailuresItCannotInject(t *testing.T) {
	c, _ := NewServerClient(Options{})
	for name, failure := range map[string]RequestFailure{
		// The shared scenarios cover a misspelt operation and details or Retry-After on a timeout.
		"unknown code":                     {Code: "upload/no-such-error"},
		"no code or error":                 {Operation: "assets.create"},
		"code and error":                   {Code: FailureTimeout, Err: errors.New("offline")},
		"details on a transport error":     {Err: errors.New("offline"), Details: calmlens.JSON{"reason": "slow"}},
		"Retry-After on a transport error": {Err: errors.New("offline"), RetryAfter: calmlens.Ptr(time.Second)},
		"fractional Retry-After":           {Code: calmlens.CodeFreeUploadsExhausted, RetryAfter: calmlens.Ptr(1500 * time.Millisecond)},
	} {
		if err := c.FailNextRequest(RequestFailure{Code: FailureTimeout}, failure); calmlens.ErrorCode(err) != calmlens.CodeSDKInvalidArgument {
			t.Errorf("%s: got %v, want sdk/invalid-argument", name, err)
		}
	}
	// A refused call queues nothing, not even its valid failures.
	if _, err := c.Folders.List(context.Background(), calmlens.ListFoldersOptions{}); err != nil {
		t.Fatalf("a refused failure was queued: %v", err)
	}
}

func TestMockReturnsAnInvalidModerateDecisionFromTheRequest(t *testing.T) {
	c, _ := NewServerClient(Options{Moderate: func(ModerationInput) *Decision {
		return NewDecision(OutcomeBlocked).Flag("violence", 2, nil)
	}})
	_, err := c.Assets.Classify(context.Background(), calmlens.SubmitAssetOptions{Name: "n", Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("x")}})
	if calmlens.ErrorCode(err) != calmlens.CodeSDKInvalidArgument {
		t.Fatalf("got %v, want sdk/invalid-argument", err)
	}
	if len(c.DatabaseStorage.Assets) != 0 {
		t.Fatal("the refused upload was stored")
	}
}

func TestMockErrorsUseAPIStatusesAndShape(t *testing.T) {
	c, _ := NewServerClient(Options{})
	ctx := context.Background()
	_, err := c.Assets.Retrieve(ctx, calmlens.AssetIDOptions{AssetID: "missing"})
	var apiErr *calmlens.Error
	if !errors.As(err, &apiErr) || apiErr.Status != 404 || apiErr.Code != calmlens.CodeAssetNotFound || apiErr.Details == nil || len(apiErr.Details) != 0 || apiErr.RequestID == "" || !calmlens.IsNotFound(err) {
		t.Fatalf("%#v", apiErr)
	}
	folder, _ := c.Folders.Create(ctx, calmlens.CreateFolderOptions{Name: "Box"})
	if _, err = c.Assets.Create(ctx, calmlens.SubmitAssetOptions{Name: "n", FolderID: &folder.ID, Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("x")}}); err != nil {
		t.Fatal(err)
	}
	err = c.Folders.Delete(ctx, calmlens.FolderIDOptions{FolderID: folder.ID})
	if !errors.As(err, &apiErr) || apiErr.Status != 409 || apiErr.Code != calmlens.CodeFolderNotEmpty {
		t.Fatal(err)
	}
}

func TestMockListHonoursFilterOrderingAndFolder(t *testing.T) {
	now := int64(0)
	c, _ := NewServerClient(Options{Now: func() int64 { now++; return now }})
	ctx := context.Background()
	folder, _ := c.Folders.Create(ctx, calmlens.CreateFolderOptions{Name: "Inbox"})
	create := func(name string, folderID *string) string {
		a, err := c.Assets.Create(ctx, calmlens.SubmitAssetOptions{Name: name, FolderID: folderID, Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr(name)}})
		if err != nil {
			t.Fatal(err)
		}
		return a.ID
	}
	create("b", nil)
	blocked := create("a", &folder.ID)
	create("c", &folder.ID)
	c.DatabaseStorage.Assets[blocked]["classification"].(calmlens.JSON)["moderation"].(calmlens.JSON)["status"] = calmlens.ModerationStatusBlocked
	names := func(options calmlens.ListAssetsOptions) string {
		page, err := c.Assets.List(ctx, options)
		if err != nil {
			t.Fatal(err)
		}
		out := []string{}
		for _, a := range page.Items {
			out = append(out, a.Name)
		}
		return fmt.Sprint(out)
	}
	desc := []calmlens.Order{{Field: "createdAt", Direction: calmlens.OrderDescending}}
	if got := names(calmlens.ListAssetsOptions{Ordering: desc}); got != "[c a b]" {
		t.Fatal(got)
	}
	if got := names(calmlens.ListAssetsOptions{Filter: calmlens.Ptr("classification.moderation.status==pending"), Ordering: desc}); got != "[c b]" {
		t.Fatal(got)
	}
	if got := names(calmlens.ListAssetsOptions{Filter: calmlens.Ptr("classification.moderation.status==blocked,name=in=(b,x)"), Ordering: desc}); got != "[a b]" {
		t.Fatal(got)
	}
	if got := names(calmlens.ListAssetsOptions{Filter: calmlens.Ptr("classification.status==processing;content.format==text/plain"), Ordering: []calmlens.Order{{Field: "createdAt", Direction: calmlens.OrderAscending}}}); got != "[b a c]" {
		t.Fatal(got)
	}
	if got := names(calmlens.ListAssetsOptions{FolderID: &folder.ID}); got != "[c a]" {
		t.Fatal(got)
	}
}

func TestMockRendersEachTypeAtUploadAndAtDecision(t *testing.T) {
	c, _ := NewServerClient(Options{})
	ctx := context.Background()
	keep := &calmlens.ProcessingOptions{KeepContentAfterProcessing: calmlens.Ptr(true)}
	submit := func(queued bool, options calmlens.SubmitAssetOptions) *calmlens.Asset {
		t.Helper()
		options.ProcessingOptions, options.Visibility = keep, calmlens.VisibilityPublic
		submit := c.Assets.Classify
		if queued {
			submit = c.Assets.Create
		}
		a, err := submit(ctx, options)
		if err != nil {
			t.Fatal(options.Name, err)
		}
		return a
	}
	file := func(name, mime string) calmlens.SubmitAssetOptions {
		return calmlens.SubmitAssetOptions{Name: name, Content: &calmlens.Content{Type: mime, Bytes: []byte("hello")}}
	}
	type rendering struct {
		kind, format string
		peaks        bool
		preview      bool
	}
	check := func(a *calmlens.Asset, want *rendering, decided bool) {
		t.Helper()
		r, p := a.Content.Rendered, a.Content.Preview
		if want == nil {
			if r != nil || p != nil {
				t.Fatalf("%s: rendered %+v, preview %+v", a.Name, r, p)
			}
			return
		}
		if r == nil || string(r.Kind) != want.kind || r.Format != want.format || (r.Peaks != nil) != want.peaks || len(r.Peaks) != 0 {
			t.Fatalf("%s: rendered %+v", a.Name, r)
		}
		if (p != nil) != want.preview {
			t.Fatalf("%s: preview %+v", a.Name, p)
		}
		if p != nil && (p.Thumbhash != nil) != decided || p != nil && decided && *p.AverageColor != mockAverageColor {
			t.Fatalf("%s: preview %+v", a.Name, p)
		}
	}
	// At upload: an image, a PDF and browser-safe media render as uploaded; nothing else yet.
	for _, tc := range []struct {
		options calmlens.SubmitAssetOptions
		want    *rendering
	}{
		{file("a.png", "image/png"), &rendering{kind: "image", format: "image/png", preview: true}},
		{file("a.pdf", "application/pdf"), &rendering{kind: "pdf", format: "application/pdf"}},
		{file("a.ogg", "audio/ogg"), &rendering{kind: "audio", format: "audio/ogg"}},
		{file("a.mov", "video/quicktime"), nil},
		{file("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), nil},
		{calmlens.SubmitAssetOptions{Name: "site", URL: "https://example.com"}, nil},
	} {
		check(submit(true, tc.options), tc.want, false)
	}
	// At decision, every type has its rendered file and preview, with the preview's ThumbHash.
	for _, tc := range []struct {
		options calmlens.SubmitAssetOptions
		want    *rendering
	}{
		{file("b.png", "image/png"), &rendering{kind: "image", format: "image/png", preview: true}},
		{calmlens.SubmitAssetOptions{Name: "site", URL: "https://example.com"}, &rendering{kind: "image", format: "image/png", preview: true}},
		{file("b.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), &rendering{kind: "pdf", format: "application/pdf", preview: true}},
		{file("b.xlsx", "application/vnd.ms-excel"), nil},
		{file("b.mov", "video/quicktime"), &rendering{kind: "video", format: "video/mp4"}},
		{file("b.mp4", "video/mp4"), &rendering{kind: "video", format: "video/mp4"}},
		{file("b.wav", "audio/wav"), &rendering{kind: "audio", format: "audio/mp4", peaks: true, preview: true}},
		{file("b.txt", "text/plain"), nil},
		{file("b.bin", "application/json"), nil},
	} {
		a := submit(false, tc.options)
		check(a, tc.want, true)
		if a.Type == calmlens.AssetTypeAudio && (*a.Content.Preview.Width != waveformWidth || *a.Content.Preview.Height != waveformHeight) {
			t.Fatalf("waveform preview: %+v", a.Content.Preview)
		}
	}
}

func TestMockServesStandInBytesForRenderedFilesAndPreviews(t *testing.T) {
	c, _ := NewServerClient(Options{})
	ctx := context.Background()
	a, err := c.Assets.Classify(ctx, calmlens.SubmitAssetOptions{Name: "b.wav", Visibility: calmlens.VisibilityPublic,
		ProcessingOptions: &calmlens.ProcessingOptions{KeepContentAfterProcessing: calmlens.Ptr(true)},
		Content:           &calmlens.Content{Type: "audio/wav", Bytes: []byte("hello")}})
	if err != nil {
		t.Fatal(err)
	}
	placeholder, err := placeholderPNG(mockThumbHash)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		resource, transform, contentType, body, cache string
	}{
		{calmlens.ResourceOriginal, "", "audio/wav", "hello", "public, max-age=3600"},
		{calmlens.ResourceRendered, "", "audio/mp4", "hello", "public, max-age=3600"},
		{calmlens.ResourcePreview, "width=10", "image/png", string(placeholder), "public, max-age=31536000, immutable"},
	} {
		res, err := c.CDN.Serve(ctx, calmlens.CDNServeOptions{CDNAssetURLOptions: calmlens.CDNAssetURLOptions{AssetIdentifier: a.ID, Resource: tc.resource, Transform: tc.transform}})
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 200 || res.Header.Get("Content-Type") != tc.contentType || string(body) != tc.body || res.Header.Get("Cache-Control") != tc.cache {
			t.Fatalf("%s: %d %s %q %s", tc.resource, res.StatusCode, res.Header.Get("Content-Type"), body, res.Header.Get("Cache-Control"))
		}
		if immutable := strings.Contains(tc.cache, "immutable"); (res.Header.Get("ETag") != "") != immutable || (res.Header.Get("Expires") != "") != immutable {
			t.Fatalf("%s: ETag %q, Expires %q", tc.resource, res.Header.Get("ETag"), res.Header.Get("Expires"))
		}
	}
	if _, err = c.Assets.CreateSignedURL(ctx, calmlens.SignedURLOptions{AssetID: a.ID, Resource: calmlens.ResourcePreview, Lens: "thumb"}); err != nil {
		t.Fatal("signed preview:", err)
	}
	// Like the API, a resource outside the signed list is refused before the asset is looked up.
	_, err = c.dispatch("POST", []string{"assets", "asset_00000000000000000000", "signed-url"}, nil, []byte(`{"resource":"placeholder"}`), http.Header{"Content-Type": {"application/json"}})
	if refused, ok := err.(*apiError); !ok || refused.code != calmlens.CodeInvalidRequest || !reflect.DeepEqual(withoutIssueMessages(refused.details), issue("validation/invalid-value", "resource")) {
		t.Fatal(err)
	}
}

func TestMockSafetyHoldWithholdsEveryResourceAndTheTimeline(t *testing.T) {
	c, _ := NewServerClient(Options{})
	ctx := context.Background()
	a, err := c.Assets.Classify(ctx, calmlens.SubmitAssetOptions{Name: "a.png", Visibility: calmlens.VisibilityPublic,
		ProcessingOptions: &calmlens.ProcessingOptions{KeepContentAfterProcessing: calmlens.Ptr(true)},
		Content:           &calmlens.Content{Type: "image/png", Bytes: []byte("hello")}})
	if err != nil || a.Content.Preview == nil || a.Content.Preview.Thumbhash == nil {
		t.Fatal(a, err)
	}
	c.WithStorage(func(db *InMemoryDatabaseStorage, _ *InMemoryImageStorage) {
		db.Assets[a.ID]["content"].(calmlens.JSON)["safetyHold"] = calmlens.JSON{"placedAt": 1, "reason": calmlens.SafetyHoldReasonSuspectedIllegalContent}
	})
	for _, resource := range []string{calmlens.ResourceOriginal, calmlens.ResourceRendered, calmlens.ResourcePreview, calmlens.ResourcePlaceholder} {
		res, err := c.CDN.Serve(ctx, calmlens.CDNServeOptions{CDNAssetURLOptions: calmlens.CDNAssetURLOptions{AssetIdentifier: a.ID, Resource: resource}})
		if err != nil {
			t.Fatal(err)
		}
		var body struct{ Code string }
		_ = json.NewDecoder(res.Body).Decode(&body)
		res.Body.Close()
		if res.StatusCode != http.StatusForbidden || body.Code != "asset/not-available" {
			t.Fatalf("%s: %d %s", resource, res.StatusCode, body.Code)
		}
	}
	// The page size is checked first, then the hold.
	if _, err = c.Assets.ListTimeline(ctx, calmlens.ListAssetTimelineOptions{AssetID: a.ID, PageSize: 101}); calmlens.ErrorCode(err) != calmlens.CodeInvalidRequest {
		t.Fatal(err)
	}
	var held *calmlens.Error
	if _, err = c.Assets.ListTimeline(ctx, calmlens.ListAssetTimelineOptions{AssetID: a.ID}); !errors.As(err, &held) || held.Code != calmlens.CodeAssetHeld || held.Status != http.StatusLocked || held.Details["hold"] != "safety" {
		t.Fatal(err)
	}
	// A decision while held keeps the rendered file and preview withheld.
	if a, err = c.Assets.Decide(ctx, calmlens.DecideAssetOptions{AssetID: a.ID, Decision: calmlens.ModerationStatusBlocked, Note: "Held"}); err != nil || a.Content.Rendered != nil || a.Content.Preview != nil {
		t.Fatal(a, err)
	}
}

func TestMockEventsFeedRefusesMalformedFiltersAndEnqueuedEventsHaveActors(t *testing.T) {
	c, _ := NewServerClient(Options{})
	ctx := context.Background()
	refused := func(options calmlens.ListEventsOptions, code, path string) {
		t.Helper()
		_, err := c.Events.List(ctx, options)
		var apiErr *calmlens.Error
		if !errors.As(err, &apiErr) || apiErr.Code != calmlens.CodeInvalidRequest || !reflect.DeepEqual(withoutIssueMessages(apiErr.Details), issue(code, path)) {
			t.Fatalf("%+v: got %v, want %s at %s", options, err, code, path)
		}
	}
	refused(calmlens.ListEventsOptions{Types: []string{calmlens.EventAssetBlocked, "blocked"}}, "validation/invalid-value", "types")
	refused(calmlens.ListEventsOptions{AssetID: "asset-1"}, "validation/invalid-format", "assetId")
	start, err := c.Events.List(ctx, calmlens.ListEventsOptions{})
	if err != nil {
		t.Fatal(err)
	}
	keyID := "key_1"
	stored := c.EnqueueEvent(calmlens.Event{Type: calmlens.EventConnectorDisabled}, calmlens.Event{Type: calmlens.EventAPIKeyDeleted, Actor: calmlens.Actor{Type: calmlens.ActorUser, ID: &keyID}})
	page, err := c.Events.List(ctx, calmlens.ListEventsOptions{Cursor: start.NextCursor})
	if err != nil || len(page.Items) != 2 {
		t.Fatal(page, err)
	}
	// An event enqueued without an actor is the mock API key's, which has no ID; a given one is kept.
	if stored[0].Actor != (calmlens.Actor{Type: calmlens.ActorAPIKey}) || page.Items[0].Actor != stored[0].Actor ||
		page.Items[1].Actor.Type != calmlens.ActorUser || *page.Items[1].Actor.ID != keyID {
		t.Fatalf("actors %+v %+v", stored, page.Items)
	}
}

func TestMockSignsUploadTokensWithItsKeyWithoutARequest(t *testing.T) {
	key := CreateMockAPIKey(nil)
	c, err := NewServerClient(Options{APIKey: key})
	if err != nil {
		t.Fatal(err)
	}
	signed, err := c.UploadTokens.Sign(context.Background(), calmlens.SignUploadTokenOptions{UploadPresetID: "preset-1"})
	if err != nil {
		t.Fatal(err)
	}
	rest, _ := strings.CutPrefix(signed.Token, "clut_")
	body, signature, _ := strings.Cut(rest, ".")
	hash := sha256.Sum256([]byte(key))
	mac := hmac.New(sha256.New, []byte(hex.EncodeToString(hash[:])))
	mac.Write([]byte("calmlens-upload-token:v1:" + body))
	if signature != hex.EncodeToString(mac.Sum(nil)) || len(c.Requests()) != 0 {
		t.Fatalf("signature %q, %d requests", signature, len(c.Requests()))
	}
}

func TestMockWaitForDecisionReadsStorage(t *testing.T) {
	c, err := NewServerClient(Options{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	queued, err := c.Assets.Create(ctx, calmlens.SubmitAssetOptions{Name: "note", Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("hi")}})
	if err != nil || queued.Classification.Moderation.Status != calmlens.ModerationStatusPending {
		t.Fatal(queued, err)
	}
	c.ClearRequests()
	// The hour passes at once: mock waits only advance the client's clock.
	started := time.Now()
	_, err = c.Assets.WaitForDecision(ctx, calmlens.WaitForDecisionOptions{AssetID: queued.ID, Timeout: calmlens.Ptr(time.Hour)})
	var timeout *calmlens.Error
	if !errors.As(err, &timeout) || timeout.Code != calmlens.CodeSDKTimeout || timeout.Details["moderationStatus"] != calmlens.ModerationStatusPending || time.Since(started) > 5*time.Second {
		t.Fatal(err, time.Since(started))
	}
	// Every check read the asset again.
	requests := c.Requests()
	if len(requests) < 2 || requests[1].Method != http.MethodGet || requests[1].Path != "/assets/"+queued.ID {
		t.Fatal(requests)
	}
	// A decided asset still processing isn't settled yet.
	c.WithStorage(func(db *InMemoryDatabaseStorage, _ *InMemoryImageStorage) {
		db.Assets[queued.ID]["classification"].(calmlens.JSON)["moderation"].(calmlens.JSON)["status"] = calmlens.ModerationStatusBlocked
	})
	_, err = c.Assets.WaitForDecision(ctx, calmlens.WaitForDecisionOptions{AssetID: queued.ID, Timeout: calmlens.Ptr(time.Duration(0))})
	if !errors.As(err, &timeout) || timeout.Code != calmlens.CodeSDKTimeout || timeout.Details["classificationStatus"] != calmlens.ClassificationStatusProcessing {
		t.Fatal(err)
	}
	c.WithStorage(func(db *InMemoryDatabaseStorage, _ *InMemoryImageStorage) {
		db.Assets[queued.ID]["classification"].(calmlens.JSON)["status"] = calmlens.ClassificationStatusCompleted
	})
	got, err := c.Assets.WaitForDecision(ctx, calmlens.WaitForDecisionOptions{AssetID: queued.ID})
	if err != nil || got.ID != queued.ID || got.Classification.Moderation.Status != calmlens.ModerationStatusBlocked {
		t.Fatal(got, err)
	}
	if _, err = c.Assets.WaitForDecision(ctx, calmlens.WaitForDecisionOptions{AssetID: "missing"}); calmlens.ErrorCode(err) != calmlens.CodeAssetNotFound {
		t.Fatal(err)
	}
}

func TestMockExplainCompletesEvidenceOrReruns(t *testing.T) {
	c, err := NewServerClient(Options{Now: func() int64 { return 123 }})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	keep := &calmlens.ProcessingOptions{KeepContentAfterProcessing: calmlens.Ptr(true)}
	a, err := c.Assets.Classify(ctx, calmlens.SubmitAssetOptions{Name: "text", ProcessingOptions: keep, Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("hello")}})
	if err != nil {
		t.Fatal(err)
	}
	moderation := c.DatabaseStorage.Assets[a.ID]["classification"].(calmlens.JSON)["moderation"].(calmlens.JSON)
	moderation["explanationComplete"] = false
	explained, err := c.Assets.Explain(ctx, calmlens.ExplainAssetOptions{AssetID: a.ID})
	if err != nil || explained.Classification.Moderation.ExplanationComplete == nil || !*explained.Classification.Moderation.ExplanationComplete || explained.Classification.Moderation.Status != calmlens.ModerationStatusAllowed {
		t.Fatal(explained, err)
	}
	moderation["manualReviews"] = []any{calmlens.JSON{"status": "allowed"}}
	if _, err = c.Assets.Explain(ctx, calmlens.ExplainAssetOptions{AssetID: a.ID, Rerun: true}); calmlens.ErrorCode(err) != calmlens.CodeAssetReviewed {
		t.Fatal("reran a reviewed asset", err)
	}
	moderation["manualReviews"] = []any{}
	rerun, err := c.Assets.Explain(ctx, calmlens.ExplainAssetOptions{AssetID: a.ID, Rerun: true})
	if err != nil || rerun.Classification.Status != calmlens.ClassificationStatusProcessing || rerun.Classification.Moderation.Status != calmlens.ModerationStatusPending {
		t.Fatal(rerun, err)
	}
	if _, err = c.Assets.Explain(ctx, calmlens.ExplainAssetOptions{AssetID: a.ID}); calmlens.ErrorCode(err) != calmlens.CodeAssetNotDecided {
		t.Fatal("explained an undecided asset", err)
	}
}

func TestMockHashListEntriesFromAssetsPagesAndCascade(t *testing.T) {
	c, err := NewServerClient(Options{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	list, err := c.HashLists.Create(ctx, calmlens.CreateHashListOptions{Name: "Removed", Action: calmlens.HashListActionBlock})
	if err != nil {
		t.Fatal(err)
	}
	a, err := c.Assets.Classify(ctx, calmlens.SubmitAssetOptions{Name: "text", Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("hello")}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.HashLists.AddEntry(ctx, calmlens.AddHashListEntryOptions{HashListID: list.ID, AssetID: a.ID}); calmlens.ErrorCode(err) != calmlens.CodeHashListAssetNotHashed {
		t.Fatalf("added an asset without a perceptual hash: %v", err)
	}
	hash := strings.Repeat("ab", 32)
	c.WithStorage(func(db *InMemoryDatabaseStorage, _ *InMemoryImageStorage) {
		content := db.Assets[a.ID]["content"].(calmlens.JSON)
		content["perceptualHash"], content["perceptualHashQuality"] = hash, float64(73)
	})
	fromAsset, err := c.HashLists.AddEntry(ctx, calmlens.AddHashListEntryOptions{HashListID: list.ID, AssetID: a.ID, Label: calmlens.Ptr("Report 1")})
	if err != nil || fromAsset.Hash != hash || fromAsset.Quality == nil || *fromAsset.Quality != 73 || fromAsset.AssetID == nil || *fromAsset.AssetID != a.ID || *fromAsset.Label != "Report 1" || c.lastStatus != http.StatusCreated {
		t.Fatalf("entry from asset: %+v, status %d, %v", fromAsset, c.lastStatus, err)
	}
	again, err := c.HashLists.AddEntry(ctx, calmlens.AddHashListEntryOptions{HashListID: list.ID, Hash: strings.ToUpper(hash)})
	if err != nil || again.ID != fromAsset.ID || c.lastStatus != http.StatusOK {
		t.Fatalf("re-adding a listed hash: %+v, status %d, %v", again, c.lastStatus, err)
	}
	second, err := c.HashLists.AddEntry(ctx, calmlens.AddHashListEntryOptions{HashListID: list.ID, Hash: strings.Repeat("0", 64)})
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for cursor := ""; ; {
		page, err := c.HashLists.ListEntries(ctx, calmlens.ListHashListEntriesOptions{HashListID: list.ID, Cursor: cursor, PageSize: 1})
		if err != nil || len(page.Items) != 1 {
			t.Fatalf("page after %q: %+v, %v", cursor, page, err)
		}
		ids = append(ids, page.Items[0].ID)
		if !page.HasMore {
			break
		}
		cursor = page.NextCursor
	}
	if len(ids) != 2 || !slices.Contains(ids, fromAsset.ID) || !slices.Contains(ids, second.ID) {
		t.Fatalf("paged entries %v, want %s and %s", ids, fromAsset.ID, second.ID)
	}
	if err = c.HashLists.Delete(ctx, calmlens.HashListIDOptions{HashListID: list.ID}); err != nil {
		t.Fatal(err)
	}
	if err = c.HashLists.RemoveEntry(ctx, calmlens.HashListEntryIDOptions{EntryID: second.ID}); calmlens.ErrorCode(err) != calmlens.CodeHashListEntryNotFound {
		t.Fatalf("entry outlived its list: %v", err)
	}
	if _, err = c.HashLists.ListEntries(ctx, calmlens.ListHashListEntriesOptions{HashListID: list.ID}); calmlens.ErrorCode(err) != calmlens.CodeHashListNotFound {
		t.Fatalf("listed entries of a deleted list: %v", err)
	}
}

func TestMockDecideValidatesLikeTheAPI(t *testing.T) {
	c, _ := NewServerClient(Options{})
	ctx := context.Background()
	asset, err := c.Assets.Classify(ctx, calmlens.SubmitAssetOptions{Name: "n", Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("x")}})
	if err != nil {
		t.Fatal(err)
	}
	refused := func(options calmlens.DecideAssetOptions, code, path string) {
		t.Helper()
		options.AssetID = asset.ID
		_, err := c.Assets.Decide(ctx, options)
		var apiErr *calmlens.Error
		if path == "" {
			if !errors.As(err, &apiErr) || apiErr.Code != code {
				t.Fatalf("%+v: got %v, want %s", options, err, code)
			}
			return
		}
		if !errors.As(err, &apiErr) || apiErr.Code != calmlens.CodeInvalidRequest || !reflect.DeepEqual(withoutIssueMessages(apiErr.Details), issue(code, path)) {
			t.Fatalf("%+v: got %v %v, want %s at %q", options, err, apiErr, code, path)
		}
	}
	refused(calmlens.DecideAssetOptions{Decision: "approved", Note: "x"}, "validation/invalid-value", "decision")
	refused(calmlens.DecideAssetOptions{Decision: calmlens.ModerationStatusBlocked, Note: "  "}, "validation/too-small", "note")
	refused(calmlens.DecideAssetOptions{Decision: calmlens.ModerationStatusBlocked, Note: strings.Repeat("x", 1500)}, "validation/too-big", "note")
	refused(calmlens.DecideAssetOptions{Decision: calmlens.ModerationStatusPurged, Note: "x"}, "validation/invalid-value", "confirmPurge")
	purged, err := c.Assets.Decide(ctx, calmlens.DecideAssetOptions{AssetID: asset.ID, Decision: calmlens.ModerationStatusPurged, Note: " Illegal ", ConfirmPurge: true})
	if err != nil {
		t.Fatal(err)
	}
	// The review names the API key that decided (mock keys have no ID), never a person.
	reviews := purged.Classification.Moderation.ManualReviews
	if len(reviews) != 1 || reviews[0].Note == nil || *reviews[0].Note != "Illegal" || !reviews[0].Applied ||
		reviews[0].DecidedBy != (calmlens.ReviewActor{Type: calmlens.ReviewActorAPIKey}) {
		t.Fatalf("reviews %+v", reviews)
	}
	refused(calmlens.DecideAssetOptions{Decision: calmlens.ModerationStatusAllowed, Note: "x"}, calmlens.CodeAssetContentPurged, "")
	if blocked, err := c.Assets.Decide(ctx, calmlens.DecideAssetOptions{AssetID: asset.ID, Decision: calmlens.ModerationStatusBlocked, Note: "x"}); err != nil || blocked.Classification.Moderation.Status != calmlens.ModerationStatusBlocked {
		t.Fatalf("blocking purged content: %v", err)
	}
}

// issue is the details of a validation/invalid-request error for one issue, without its message.
func issue(code, path string) map[string]any {
	return map[string]any{"issues": []any{map[string]any{"path": path, "code": code}}}
}

// withoutIssueMessages drops each issue's message from a validation error's details, to compare
// the rest with issue.
func withoutIssueMessages(details map[string]any) map[string]any {
	issues, ok := details["issues"].([]any)
	if !ok {
		return details
	}
	stripped := make([]any, len(issues))
	for i, item := range issues {
		copied := map[string]any{}
		for key, value := range item.(map[string]any) {
			if key != "message" {
				copied[key] = value
			}
		}
		stripped[i] = copied
	}
	return map[string]any{"issues": stripped}
}

// The mock refuses, like the API's schema and before looking up the asset, what the typed client
// can't send: metadata that isn't a list of { id, value } items, null for fields that don't take
// null, and uploads of types CalmLens can't moderate.
func TestMockValidatesRequestsTheClientCannotSend(t *testing.T) {
	m, err := NewServerClient(Options{})
	if err != nil {
		t.Fatal(err)
	}
	upload := func(mode string) http.Header {
		return http.Header{"X-Calmlens-Upload": {mode}, "Content-Type": {"text/plain"}}
	}
	jsonHeader := http.Header{"Content-Type": {"application/json"}}
	assets := "/projects/project-1/assets"
	cases := []struct {
		name, method, path, query string
		header                    http.Header
		body                      string
		code                      string
		details                   map[string]any
	}{
		{"JSON metadata object", "POST", assets, "queue=false", jsonHeader, `{"name":"x","url":"https://example.com","metadata":{"a":1}}`, calmlens.CodeInvalidRequest, issue("validation/invalid-type", "metadata")},
		{"raw upload metadata item not an object", "POST", assets, "name=x&contentType=text%2Fplain&metadata=" + url.QueryEscape(`["source"]`), upload("content"), "hello", calmlens.CodeInvalidRequest, issue("validation/invalid-type", "metadata.0")},
		{"raw upload metadata id not a string", "POST", assets, "name=x&contentType=text%2Fplain&metadata=" + url.QueryEscape(`[{"id":7,"value":1}]`), upload("content"), "hello", calmlens.CodeInvalidRequest, issue("validation/invalid-type", "metadata.0.id")},
		{"raw upload metadata without a value", "POST", assets, "name=x&contentType=text%2Fplain&metadata=" + url.QueryEscape(`[{"id":"source"}]`), upload("content"), "hello", calmlens.CodeInvalidRequest, issue("validation/invalid-value", "metadata.0.value")},
		{"update metadata object", "PATCH", "/assets/missing", "", jsonHeader, `{"metadata":{"a":1}}`, calmlens.CodeInvalidRequest, issue("validation/invalid-type", "metadata")},
		{"update null name", "PATCH", "/assets/missing", "", jsonHeader, `{"name":null}`, calmlens.CodeInvalidRequest, issue("validation/invalid-type", "name")},
		{"signed URL null viewerClaims", "POST", "/assets/missing/signed-url", "", jsonHeader, `{"viewerClaims":null}`, calmlens.CodeInvalidRequest, issue("validation/invalid-type", "viewerClaims")},
		{"signed URL null resource", "POST", "/assets/missing/signed-url", "", jsonHeader, `{"resource":null}`, calmlens.CodeInvalidRequest, issue("validation/invalid-value", "resource")},
		{"signed URL null lens", "POST", "/assets/missing/signed-url", "", jsonHeader, `{"lens":null}`, calmlens.CodeInvalidRequest, issue("validation/invalid-type", "lens")},
		{"signed URL null transform", "POST", "/assets/missing/signed-url", "", jsonHeader, `{"transform":null}`, calmlens.CodeInvalidRequest, issue("validation/invalid-type", "transform")},
		{"signed URL null expiresInSeconds", "POST", "/assets/missing/signed-url", "", jsonHeader, `{"expiresInSeconds":null}`, calmlens.CodeInvalidRequest, issue("validation/invalid-type", "expiresInSeconds")},
		{"raw upload of a refused type", "POST", assets, "name=x&contentType=application%2Fzip", upload("content"), "hello", calmlens.CodeUnsupportedUploadType, map[string]any{"mimeType": "application/zip", "source": "calmlens"}},
		{"first part of a refused type", "POST", assets, "name=x&isFinal=true&contentType=application%2Fx-made-up", upload("part"), "hello", calmlens.CodeUnsupportedUploadType, map[string]any{"mimeType": "application/x-made-up", "source": "calmlens"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req, err := http.NewRequest(c.method, "https://api.calmlens.com/v1"+c.path+"?"+c.query, strings.NewReader(c.body))
			if err != nil {
				t.Fatal(err)
			}
			req.Header = c.header.Clone()
			req.Header.Set("X-Api-Key", m.options.APIKey)
			res, err := transport{m}.RoundTrip(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			var body struct {
				Code    string
				Details map[string]any
			}
			if err = json.NewDecoder(res.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			status, _ := calmlens.PublicErrorStatus(c.code)
			if res.StatusCode != status || body.Code != c.code || !reflect.DeepEqual(withoutIssueMessages(body.Details), c.details) {
				t.Fatalf("got %d %s %v; want %d %s %v", res.StatusCode, body.Code, body.Details, status, c.code, c.details)
			}
		})
	}
	if len(m.DatabaseStorage.Assets) != 0 {
		t.Fatalf("stored %d assets", len(m.DatabaseStorage.Assets))
	}
}

func TestMockStoresUploadTagsAndKeepsProcessingOptionsOutOfTheAsset(t *testing.T) {
	c, err := NewServerClient(Options{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	keep := &calmlens.ProcessingOptions{KeepContentAfterProcessing: calmlens.Ptr(true)}
	uploaded, err := c.Assets.Create(ctx, calmlens.SubmitAssetOptions{Name: "photo.png", Content: &calmlens.Content{Type: "image/png", Bytes: []byte{1, 2, 3}}, Tags: []string{"catalogue", "backpacks"}, ProcessingOptions: keep})
	if err != nil {
		t.Fatal(err)
	}
	site, err := c.Assets.Create(ctx, calmlens.SubmitAssetOptions{Name: "site", URL: "https://example.com", Tags: []string{"landing"}})
	if err != nil {
		t.Fatal(err)
	}
	text, err := c.Text.Classify(ctx, calmlens.ClassifyTextOptions{Text: "hello", Tags: []string{"comment"}})
	if err != nil {
		t.Fatal(err)
	}
	retrieved, err := c.Assets.Retrieve(ctx, calmlens.AssetIDOptions{AssetID: site.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(uploaded.Tags, []string{"catalogue", "backpacks"}) || !reflect.DeepEqual(retrieved.Tags, []string{"landing"}) || !reflect.DeepEqual(text.Tags, []string{"comment"}) {
		t.Fatal(uploaded.Tags, retrieved.Tags, text.Tags)
	}
	// The upload's processing options still apply, though the asset doesn't return them.
	if _, ok := uploaded.Raw["processingOptions"]; ok || uploaded.Content.Status != calmlens.ContentStatusStored {
		t.Fatal(uploaded.Raw["processingOptions"], uploaded.Content.Status)
	}
}
