package calmlenstest

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
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
	res, err := c.CDN.Serve(ctx, calmlens.CDNServeOptions{CDNAssetURLOptions: calmlens.CDNAssetURLOptions{AssetIdentifier: a.ID}})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal(res.StatusCode)
	}
	c.DatabaseStorage.Assets[a.ID]["visibility"] = "public"
	res, err = c.CDN.Serve(ctx, calmlens.CDNServeOptions{CDNAssetURLOptions: calmlens.CDNAssetURLOptions{AssetIdentifier: a.ID}})
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
	signed, err = c.Assets.CreateSignedURL(ctx, calmlens.SignedURLOptions{AssetID: a.ID, TransformSteps: []calmlens.LensTransform{{Type: "imageTransform", Options: calmlens.JSON{"width": 64, "border": calmlens.JSON{"color": "#fff"}}}}})
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
	if requests[2].Method != "GET" || requests[2].Path != "/assets/"+a.ID {
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
	if _, err = NewServerClient(Options{AnalyzedOutcome: "error"}); calmlens.ErrorCode(err) != calmlens.CodeSDKInvalidArgument {
		t.Fatal("unknown outcome accepted", err)
	}
}

func TestMockSimulatesTransportFailures(t *testing.T) {
	c, err := NewServerClient(Options{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	offline := errors.New("connection reset by peer")
	c.FailNext(offline, context.DeadlineExceeded)
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
	if got := len(c.Requests()); got != 3 {
		t.Fatalf("failed requests should be captured, got %d", got)
	}
}

func TestMockErrorsUseAPIStatusesAndShape(t *testing.T) {
	c, _ := NewServerClient(Options{})
	ctx := context.Background()
	_, err := c.Assets.Retrieve(ctx, calmlens.AssetIDOptions{AssetID: "missing"})
	var apiErr *calmlens.Error
	if !errors.As(err, &apiErr) || apiErr.Status != 404 || apiErr.Code != calmlens.CodeAssetNotFound || apiErr.Details != nil || apiErr.RequestID == "" || !calmlens.IsNotFound(err) {
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
	desc := []calmlens.Order{{Field: "createdAt", Direction: "DESC"}}
	if got := names(calmlens.ListAssetsOptions{Ordering: desc}); got != "[c a b]" {
		t.Fatal(got)
	}
	if got := names(calmlens.ListAssetsOptions{Filter: calmlens.Ptr("classification.moderation.status==pending"), Ordering: desc}); got != "[c b]" {
		t.Fatal(got)
	}
	if got := names(calmlens.ListAssetsOptions{Filter: calmlens.Ptr("classification.moderation.status==blocked,name=in=(b,x)"), Ordering: desc}); got != "[a b]" {
		t.Fatal(got)
	}
	if got := names(calmlens.ListAssetsOptions{Filter: calmlens.Ptr("classification.status==processing;content.format==text/plain"), Ordering: []calmlens.Order{{Field: "createdAt", Direction: "ASC"}}}); got != "[b a c]" {
		t.Fatal(got)
	}
	if got := names(calmlens.ListAssetsOptions{FolderID: &folder.ID}); got != "[c a]" {
		t.Fatal(got)
	}
	for _, filter := range []string{"secret==1", "status==pending"} {
		_, err := c.Assets.List(ctx, calmlens.ListAssetsOptions{Filter: calmlens.Ptr(filter)})
		var apiErr *calmlens.Error
		if !errors.As(err, &apiErr) || apiErr.Status != 400 {
			t.Fatal("unknown filter field accepted", filter, err)
		}
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
	c.WithStorage(func(db *InMemoryDatabaseStorage, _ *InMemoryImageStorage) {
		db.Assets[queued.ID]["classification"].(calmlens.JSON)["moderation"].(calmlens.JSON)["status"] = calmlens.ModerationStatusBlocked
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
	moderation["policy"] = calmlens.JSON{"score": 0.1, "categories": calmlens.JSON{}, "evidence": calmlens.PolicyEvidenceDecision}
	explained, err := c.Assets.Explain(ctx, calmlens.ExplainAssetOptions{AssetID: a.ID})
	if err != nil || explained.Classification.Moderation.Policy.Evidence != calmlens.PolicyEvidenceFull || explained.Classification.Moderation.Status != calmlens.ModerationStatusAllowed {
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
