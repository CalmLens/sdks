package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/CalmLens/sdks/examples/voice-clips-go/demo"
	calmlens "github.com/CalmLens/sdks/go"
	"github.com/CalmLens/sdks/go/calmlenstest"
)

var clipBytes = []byte("ID3\x04\x00\x00\x00\x00\x00\x00simulated mp3 frames")

func demoApp(t *testing.T) *app {
	t.Helper()
	a, err := newApp(config{Demo: true, WebhookSecret: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

type upload struct {
	choice, token, contentType, name string
	data                             []byte
}

func uploadRequest(t *testing.T, a *app, u upload) *httptest.ResponseRecorder {
	t.Helper()
	if u.contentType == "" {
		u.contentType = "audio/mpeg"
	}
	if u.name == "" {
		u.name = "note.mp3"
	}
	if u.data == nil {
		u.data = clipBytes
	}
	if u.choice == "" {
		u.choice = "approved"
	}
	if u.token == "" {
		u.token = a.csrf
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for key, value := range map[string]string{"csrf": u.token, "demo_result": u.choice} {
		if err := form.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="clip"; filename=%q`, u.name))
	header.Set("Content-Type", u.contentType)
	file, err := form.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = file.Write(u.data); err != nil {
		t.Fatal(err)
	}
	if err = form.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/upload", &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	rec := httptest.NewRecorder()
	a.handler().ServeHTTP(rec, req)
	return rec
}
func post(a *app, path string, values url.Values) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", path, strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	a.handler().ServeHTTP(rec, req)
	return rec
}
func get(a *app, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	a.handler().ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
	return rec
}

// decide moves a demo clip past the simulated pending period.
// decideAsset writes a clip state into a stored asset, as CalmLens would record it: a decision
// once processing is done, or failed processing.
func decideAsset(stored calmlens.JSON, status string) {
	processing, moderation := demo.Section(stored, "processing"), demo.Section(stored, "moderation")
	switch status {
	case clipError:
		processing["status"] = calmlens.ProcessingStatusFailed
	case clipRejected:
		processing["status"], moderation["status"], moderation["action"] = calmlens.ProcessingStatusDone, calmlens.ModerationStatusRejected, calmlens.ModerationActionHide
	default:
		processing["status"], moderation["status"], moderation["action"] = calmlens.ProcessingStatusDone, calmlens.ModerationStatusApproved, nil
	}
}

func decide(item *entry) { item.PendingSince = time.Now().Add(-demoDelay - time.Second) }

func mustUpload(t *testing.T, a *app, u upload) *entry {
	t.Helper()
	if rec := uploadRequest(t, a, u); rec.Code != 303 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	return a.entries[0]
}

func TestClipTypeAllowList(t *testing.T) {
	accepted := map[string]string{
		"audio/mpeg": "audio/mpeg", "AUDIO/OGG": "audio/ogg", "video/webm; codecs=vp9": "video/webm",
		"video/quicktime": "video/quicktime", "audio/x-m4a": "audio/x-m4a",
	}
	for declared, normalized := range accepted {
		a := demoApp(t)
		item := mustUpload(t, a, upload{contentType: declared})
		if item.Type != normalized || a.demo.Mock.ImageStorage.Content[item.ID].Type != normalized {
			t.Fatalf("%s stored as %q", declared, item.Type)
		}
		if item.Video != strings.HasPrefix(normalized, "video/") {
			t.Fatal("wrong player kind for", declared)
		}
	}
	for _, declared := range []string{"image/png", "application/octet-stream", "text/plain", "audio/midi", "video/x-flv", "audio"} {
		a := demoApp(t)
		if rec := uploadRequest(t, a, upload{contentType: declared}); rec.Code != 415 {
			t.Fatalf("%s: got %d", declared, rec.Code)
		}
		if len(a.entries) != 0 || len(a.demo.Mock.Requests()) != 0 {
			t.Fatal("rejected type reached CalmLens:", declared)
		}
	}
}

func TestClipSizeLimit(t *testing.T) {
	a := demoApp(t)
	for _, data := range [][]byte{{}, make([]byte, maxClipBytes+1)} {
		if rec := uploadRequest(t, a, upload{data: data}); rec.Code != 413 {
			t.Fatal(len(data), rec.Code)
		}
	}
	if len(a.entries) != 0 || len(a.demo.Mock.Requests()) != 0 {
		t.Fatal("invalid clip reached CalmLens")
	}
	item := mustUpload(t, a, upload{data: make([]byte, maxClipBytes), contentType: "video/mp4"})
	if item.Size != maxClipBytes || item.Parts != 10 {
		t.Fatal("clip at the limit rejected or mis-split", item.Size, item.Parts)
	}
}

func TestMultipartAboveThreshold(t *testing.T) {
	a := demoApp(t)
	small := mustUpload(t, a, upload{data: bytes.Repeat([]byte{1}, multipartThreshold)})
	requests := a.demo.Mock.Requests()
	if small.Parts != 1 || len(requests) != 1 || requests[0].Path != "/projects/mock-project/assets" || requests[0].Header.Get("X-CalmLens-Upload") != "content" {
		t.Fatalf("clip at the threshold should be one request: %d %+v", small.Parts, requests)
	}
	a.demo.Mock.ClearRequests()
	data := make([]byte, 2*partSize+123)
	for i := range data {
		data[i] = byte(i % 251)
	}
	item := mustUpload(t, a, upload{data: data, contentType: "video/mp4"})
	if item.Parts != 3 || item.Status != "pending" {
		t.Fatal(item.Parts, item.Status)
	}
	requests = a.demo.Mock.Requests()
	if len(requests) != 3 || requests[0].Path != "/projects/mock-project/assets" || requests[0].Header.Get("X-CalmLens-Upload") != "part" {
		t.Fatalf("unexpected requests: %+v", requests)
	}
	first := requests[0].Query
	if first.Get("partNumber") != "1" || first.Get("isFinal") != "false" || first.Get("visibility") != "private" || first.Get("contentType") != "video/mp4" || !strings.Contains(first.Get("processingOptions"), `"keepContentAfterProcessing":true`) {
		t.Fatalf("first part: %v", first)
	}
	for i, r := range requests[1:] {
		final := strconv.FormatBool(i == 1)
		if r.Path != "/assets/"+item.ID+"/part" || r.Query.Get("partNumber") != strconv.Itoa(i+2) || r.Query.Get("isFinal") != final {
			t.Fatalf("part %d: %s %v", i+2, r.Path, r.Query)
		}
	}
	stored := a.demo.Mock.ImageStorage.Content[item.ID]
	joined := append(append(append([]byte{}, stored.Parts[1]...), stored.Parts[2]...), stored.Parts[3]...)
	if len(stored.Parts[1]) != partSize || !bytes.Equal(joined, data) {
		t.Fatal("stored parts do not reassemble the clip")
	}
}

func TestOnlyApprovedClipsPlay(t *testing.T) {
	for _, choice := range []string{"approved", "flagged", "rejected", "error"} {
		t.Run(choice, func(t *testing.T) {
			a := demoApp(t)
			item := mustUpload(t, a, upload{choice: choice})
			mediaURL := "/media?id=" + item.ID
			if item.Status != "pending" || get(a, mediaURL).Code != 403 || strings.Contains(get(a, "/").Body.String(), mediaURL) {
				t.Fatal("pending clip exposed")
			}
			if a.demo.Mock.DatabaseStorage.Assets[item.ID]["visibility"] != "private" {
				t.Fatal("clip not uploaded privately")
			}
			decide(item)
			page := get(a, "/").Body.String()
			media := get(a, mediaURL)
			if choice == "approved" || choice == "flagged" {
				if media.Code != 200 || !bytes.Equal(media.Body.Bytes(), clipBytes) || media.Header().Get("Content-Type") != "audio/mpeg" || !strings.Contains(page, mediaURL) {
					t.Fatal(media.Code, page)
				}
				if item.Flagged != (choice == "flagged") {
					t.Fatal("review flag", item.Flagged)
				}
			} else if media.Code != 403 || strings.Contains(page, mediaURL) || item.Status != choice {
				t.Fatal("unapproved clip exposed", item.Status, media.Code)
			}
		})
	}
}

func TestDemoPlaybackSupportsRanges(t *testing.T) {
	a := demoApp(t)
	item := mustUpload(t, a, upload{})
	decide(item)
	req := httptest.NewRequest("GET", "/media?id="+item.ID, nil)
	req.Header.Set("Range", "bytes=0-2")
	rec := httptest.NewRecorder()
	a.handler().ServeHTTP(rec, req)
	if rec.Code != 206 || rec.Body.String() != "ID3" {
		t.Fatal(rec.Code, rec.Body.String())
	}
}

const testPreset = "preset-clips"

// sdkDir writes a stand-in for the JavaScript SDK's ESM build.
func sdkDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range map[string]string{
		"index.js": "export class CalmLensError {}\n",
		"app.js":   "export class CalmLensAppClient {}\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// live swaps the demo app onto a mock client that the app treats as a live API, uploading
// through testPreset.
func live(t *testing.T, a *app) *calmlenstest.MockServerClient {
	t.Helper()
	mock, err := calmlenstest.NewServerClient(calmlenstest.Options{})
	if err != nil {
		t.Fatal(err)
	}
	a.demo, a.client = nil, mock.ServerClient
	a.preset, a.apiURL, a.sdkDir = testPreset, "https://api.example.test/v1", sdkDir(t)
	return mock
}

type started struct {
	Clip, Token, Type string
	ExpiresAt         int64
	Parts, PartSize   int
}

func startUpload(t *testing.T, a *app, name, contentType string, size int64) (*httptest.ResponseRecorder, started) {
	t.Helper()
	rec := post(a, "/uploads/start", url.Values{"csrf": {a.csrf}, "name": {name}, "type": {contentType}, "size": {strconv.FormatInt(size, 10)}})
	var body started
	if rec.Code == 200 {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
	}
	return rec, body
}

// tokenClaims decodes the claims of a signed upload token.
func tokenClaims(t *testing.T, token string) map[string]any {
	t.Helper()
	body, _, ok := strings.Cut(strings.TrimPrefix(token, "clut_"), ".")
	raw, err := base64.RawURLEncoding.DecodeString(body)
	claims := map[string]any{}
	if !ok || !strings.HasPrefix(token, "clut_") || err != nil || json.Unmarshal(raw, &claims) != nil {
		t.Fatalf("not an upload token: %q", token)
	}
	return claims
}

// browserUpload stands in for the page's upload through the preset: the asset gets the
// externalId the upload token carries.
func browserUpload(t *testing.T, mock *calmlenstest.MockServerClient, token string) *calmlens.Asset {
	t.Helper()
	externalID, _ := tokenClaims(t, token)["x"].(string)
	size := int64(len(clipBytes))
	asset, err := mock.ServerClient.Assets.Create(context.Background(), calmlens.SubmitAssetOptions{
		Name: "note.mp3", Visibility: calmlens.VisibilityPrivate, ExternalID: &externalID,
		Content: &calmlens.Content{Type: "audio/mpeg", Data: bytes.NewReader(clipBytes), SizeInBytes: &size},
	})
	if err != nil {
		t.Fatal(err)
	}
	return asset
}

func finish(a *app, clip, assetID string) *httptest.ResponseRecorder {
	return post(a, "/uploads/finish", url.Values{"csrf": {a.csrf}, "clip": {clip}, "assetId": {assetID}})
}

// liveClip runs the whole browser upload: start, upload through the preset, finish.
func liveClip(t *testing.T, a *app, mock *calmlenstest.MockServerClient) *entry {
	t.Helper()
	rec, body := startUpload(t, a, "note.mp3", "audio/mpeg", int64(len(clipBytes)))
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	asset := browserUpload(t, mock, body.Token)
	if rec := finish(a, body.Clip, asset.ID); rec.Code != 204 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	mock.ClearRequests()
	return a.entries[0]
}

func TestSignedURLOnlyAfterFreshApprovedRetrieve(t *testing.T) {
	a := demoApp(t)
	mock := live(t, a)
	item := liveClip(t, a, mock)
	stored := mock.DatabaseStorage.Assets[item.ID]

	decideAsset(stored, "approved")
	rec := get(a, "/media?id="+item.ID)
	location, _ := url.Parse(rec.Header().Get("Location"))
	if rec.Code != 303 || location.Scheme != "https" || location.Query().Get("expiresInSeconds") != strconv.Itoa(signedURLSeconds) {
		t.Fatal(rec.Code, rec.Header().Get("Location"))
	}
	requests := mock.Requests()
	if len(requests) != 2 || requests[0].Method != "GET" || requests[0].Path != "/assets/"+item.ID || requests[1].Path != "/assets/"+item.ID+"/signed-url" {
		t.Fatalf("signature not preceded by a retrieve: %+v", requests)
	}

	// The signed URL is reused while it has plenty of life left, without calling CalmLens.
	mock.ClearRequests()
	if again := get(a, "/media?id="+item.ID); again.Code != 303 || again.Header().Get("Location") != location.String() || len(mock.Requests()) != 0 {
		t.Fatal("signed URL not reused", again.Code, mock.Requests())
	}

	// A webhook reports a new decision: the cached URL is dropped and playback refused.
	decideAsset(stored, "rejected")
	body := event("event-revoked", "asset.rejected", item.ID, "[]")
	if webhook(a, body, sign(body)).Code != 204 {
		t.Fatal("webhook failed")
	}
	mock.ClearRequests()
	if get(a, "/media?id="+item.ID).Code != 403 {
		t.Fatal("signed a clip that is no longer approved")
	}
	decideAsset(stored, "approved")
	mock.FailNext(errors.New("offline"))
	if get(a, "/media?id="+item.ID).Code != 502 {
		t.Fatal("served a stale approval after a failed retrieve")
	}
	for _, r := range mock.Requests() {
		if strings.HasSuffix(r.Path, "/signed-url") {
			t.Fatal("signed URL created without a fresh approval")
		}
	}
	if get(a, "/media?id=unknown").Code != 404 {
		t.Fatal("unknown clip not rejected")
	}
}

func score(v float64) *float64 { return &v }

func TestTimelineFromReportMedia(t *testing.T) {
	a := demoApp(t)
	mock := live(t, a)
	item := liveClip(t, a, mock)
	stored := mock.DatabaseStorage.Assets[item.ID]
	decideAsset(stored, "rejected")
	demo.Section(stored, "moderation")["report"] = calmlens.JSON{"score": 0.91, "categories": calmlens.JSON{}, "media": calmlens.JSON{
		"durationSeconds": 60, "sampledFrames": 0, "audioTranscribed": false,
		"segments": []any{
			calmlens.JSON{"source": "clip", "startSeconds": 29, "endSeconds": 60, "categories": calmlens.JSON{
				"hate":     calmlens.JSON{"status": "evaluated", "score": 0.1, "likelihood": "very-unlikely"},
				"violence": calmlens.JSON{"status": "not-evaluated", "reason": "unavailable"},
			}},
			calmlens.JSON{"source": "clip", "startSeconds": 0, "endSeconds": 30, "categories": calmlens.JSON{
				"violence":   calmlens.JSON{"status": "evaluated", "score": 0.91, "likelihood": "very-likely"},
				"harassment": calmlens.JSON{"status": "partial", "score": 0.45, "likelihood": "possible"},
			}},
		},
	}}
	page := get(a, "/").Body.String()
	if item.Duration != 60 || len(item.Segments) != 2 {
		t.Fatal(item.Duration, item.Segments)
	}
	first, second := item.Segments[0], item.Segments[1]
	if first.Start != 0 || first.End != 30 || second.Start != 29 || second.End != 60 {
		t.Fatal("segments not ordered by start", item.Segments)
	}
	got := []string{}
	for _, f := range first.Findings {
		got = append(got, f.Category+":"+f.Likelihood)
	}
	if !reflect.DeepEqual(got, []string{"violence:very-likely", "harassment:possible"}) || len(second.Findings) != 0 {
		t.Fatal("findings", got, second.Findings)
	}
	if !strings.Contains(page, "0:00–0:30") || !strings.Contains(page, "0:29–1:00") {
		t.Fatal("segment ranges not rendered")
	}
}

func TestDemoOutcomesProduceClipSegments(t *testing.T) {
	a := demoApp(t)
	item := mustUpload(t, a, upload{choice: "rejected", contentType: "video/mp4"})
	decide(item)
	get(a, "/")
	if item.Status != "rejected" || item.Duration != demo.Duration || len(item.Segments) != 2 || len(item.Segments[0].Findings) == 0 || item.Segments[0].Findings[0].Category != "violence" {
		t.Fatalf("%+v", item)
	}
}

func TestRetryFailedClip(t *testing.T) {
	a := demoApp(t)
	item := mustUpload(t, a, upload{choice: "error"})
	decide(item)
	get(a, "/")
	if item.Status != "error" {
		t.Fatal(item.Status)
	}
	form := url.Values{"csrf": {a.csrf}, "id": {item.ID}, "demo_result": {"approved"}}
	if post(a, "/retry", url.Values{"csrf": {"wrong"}, "id": {item.ID}, "demo_result": {"approved"}}).Code != 403 {
		t.Fatal("retry without CSRF token")
	}
	if rec := post(a, "/retry", form); rec.Code != 303 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	if item.Status != "pending" || demo.Section(a.demo.Mock.DatabaseStorage.Assets[item.ID], "processing")["status"] != calmlens.ProcessingStatusProcessing {
		t.Fatal("retry did not return the clip to pending")
	}
	decide(item)
	if get(a, "/media?id="+item.ID).Code != 200 || item.Status != "approved" {
		t.Fatal("retried clip not approved", item.Status)
	}
	a.demo.Mock.ClearRequests()
	if post(a, "/retry", form).Code != 409 || len(a.demo.Mock.Requests()) != 0 {
		t.Fatal("retried an approved clip")
	}
}

func TestDeleteClip(t *testing.T) {
	a := demoApp(t)
	keep := mustUpload(t, a, upload{name: "keep.mp3"})
	item := mustUpload(t, a, upload{})
	if post(a, "/delete", url.Values{"csrf": {"wrong"}, "clip": {item.Key}}).Code != 403 || len(a.entries) != 2 {
		t.Fatal("delete without CSRF token")
	}
	a.demo.Mock.FailNext(errors.New("offline"))
	if post(a, "/delete", url.Values{"csrf": {a.csrf}, "clip": {item.Key}}).Code != 502 || a.find(item.ID) == nil {
		t.Fatal("failed delete forgot the clip")
	}
	a.demo.Mock.ClearRequests()
	if rec := post(a, "/delete", url.Values{"csrf": {a.csrf}, "clip": {item.Key}}); rec.Code != 303 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	requests := a.demo.Mock.Requests()
	if len(requests) != 1 || requests[0].Method != "DELETE" || requests[0].Path != "/assets/"+item.ID {
		t.Fatalf("%+v", requests)
	}
	if a.demo.Mock.DatabaseStorage.Assets[item.ID] != nil || a.demo.Mock.ImageStorage.Content[item.ID] != nil {
		t.Fatal("asset or content still stored")
	}
	if len(a.entries) != 1 || a.entries[0] != keep || get(a, "/media?id="+item.ID).Code != 404 {
		t.Fatal("deleted clip still listed")
	}
}

func TestConfiguration(t *testing.T) {
	// Fail closed: no credentials means no app, unless the demo is requested explicitly.
	dir := sdkDir(t)
	for _, cfg := range []config{
		{}, {APIKey: "key"}, {ProjectID: "project"}, {Demo: true, APIKey: "key", ProjectID: "project"},
		// Live mode needs the upload preset and the SDK build the page imports; the demo has no preset.
		{APIKey: "key", ProjectID: "project", SDKDir: dir},
		{APIKey: "key", ProjectID: "project", UploadPresetID: testPreset, SDKDir: t.TempDir()},
		{Demo: true, UploadPresetID: testPreset},
	} {
		if a, err := newApp(cfg); err == nil || a != nil {
			t.Fatalf("started with %+v", cfg)
		}
	}
	if a, err := newApp(config{APIKey: "key", ProjectID: "project", UploadPresetID: testPreset, SDKDir: dir}); err != nil || a.demo != nil || a.preset != testPreset {
		t.Fatal("live config rejected or ran the demo", err)
	}
}

func TestAssetsAreTiedToTheirClip(t *testing.T) {
	a := demoApp(t)
	mock := live(t, a)
	item := liveClip(t, a, mock)
	stored := mock.DatabaseStorage.Assets[item.ID]
	if !strings.HasPrefix(item.Key, "clip_") || stored["externalId"] != item.Key {
		t.Fatal("asset not tagged with the clip key", item.Key, stored["externalId"])
	}
	decideAsset(stored, "approved")
	stored["externalId"] = "someone-else"
	if get(a, "/media?id="+item.ID).Code != 502 || item.Status != "pending" {
		t.Fatal("applied a decision for an asset this clip did not create")
	}
}

func TestSlowCalmLensCallsDoNotBlockOtherRequests(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"slow","processing":{"status":"done"},"moderation":{"status":"approved","action":null},"externalId":"clip_slow"}`))
	}))
	defer server.Close()
	a, err := newApp(config{APIKey: "key", ProjectID: "project", UploadPresetID: testPreset, SDKDir: sdkDir(t), BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	a.entries = []*entry{{ID: "slow", Key: "clip_slow", Status: "pending"}}
	done := make(chan int)
	go func() { done <- get(a, "/media?id=slow").Code }()
	<-entered
	finished := make(chan int)
	go func() { finished <- get(a, "/media?id=unknown").Code }()
	select {
	case code := <-finished:
		if code != 404 {
			t.Fatal(code)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("a request waited for another request's CalmLens call")
	}
	close(release)
	<-done
}

func TestLiveHasNoServerUploadOrDemoSelector(t *testing.T) {
	a := demoApp(t)
	mock := live(t, a)
	// Clips never stream through the server in live mode.
	if rec := uploadRequest(t, a, upload{choice: "rejected"}); rec.Code != 404 && rec.Code != 405 {
		t.Fatal("live mode accepted a server upload", rec.Code)
	}
	if len(a.entries) != 0 || len(mock.Requests()) != 0 {
		t.Fatal("server upload had an effect")
	}
	item := liveClip(t, a, mock)
	decide(item)
	get(a, "/")
	if item.DemoResult != "" || item.Status != "pending" {
		t.Fatal("live clip decided by the demo selector", item.Status)
	}
}

func TestUploadTokenIsSignedForTheClip(t *testing.T) {
	a := demoApp(t)
	mock := live(t, a)
	before := time.Now().UnixMilli()
	rec, body := startUpload(t, a, "../../voice.ogg", "audio/ogg; codecs=opus", maxClipBytes)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	claims := tokenClaims(t, body.Token)
	if claims["u"] != testPreset || claims["x"] != body.Clip || !strings.HasPrefix(body.Clip, "clip_") {
		t.Fatalf("token not bound to the preset and clip: %v", claims)
	}
	expires := int64(claims["e"].(float64))
	if body.ExpiresAt != expires || expires < before+uploadTokenSeconds*1000 || expires > time.Now().UnixMilli()+uploadTokenSeconds*1000 {
		t.Fatal("token lifetime", expires-before)
	}
	if len(mock.Requests()) != 0 {
		t.Fatal("signing a token called CalmLens", mock.Requests())
	}
	item := a.entries[0]
	if item.Key != body.Clip || item.ID != "" || item.Status != clipUploading || item.Name != "voice.ogg" || item.Type != "audio/ogg" || body.Type != "audio/ogg" {
		t.Fatalf("clip slot: %+v", item)
	}
	// The browser splits the clip the same way as the demo's server upload.
	if body.Parts != 10 || body.PartSize != partSize {
		t.Fatal("parts", body.Parts, body.PartSize)
	}
	for size, parts := range map[int64]int{1: 1, multipartThreshold: 1, multipartThreshold + 1: 2, 2*partSize + 123: 3} {
		if _, body := startUpload(t, a, "clip.mp4", "video/mp4", size); body.Parts != parts {
			t.Fatal(size, body.Parts)
		}
	}
	if _, other := startUpload(t, a, "clip.mp4", "video/mp4", 1); tokenClaims(t, other.Token)["n"] == claims["n"] {
		t.Fatal("tokens are not single-use")
	}
}

func TestUploadStartRejectsInvalidClips(t *testing.T) {
	a := demoApp(t)
	mock := live(t, a)
	for _, c := range []struct {
		csrf, contentType, size string
		code                    int
	}{
		{"wrong", "audio/mpeg", "100", 403},
		{"", "image/png", "100", 415},
		{"", "audio/mpeg", "0", 413},
		{"", "audio/mpeg", strconv.Itoa(maxClipBytes + 1), 413},
		{"", "audio/mpeg", "lots", 400},
	} {
		if c.csrf == "" {
			c.csrf = a.csrf
		}
		rec := post(a, "/uploads/start", url.Values{"csrf": {c.csrf}, "name": {"x"}, "type": {c.contentType}, "size": {c.size}})
		if rec.Code != c.code || strings.Contains(rec.Body.String(), "clut_") {
			t.Fatal(c, rec.Code)
		}
	}
	if len(a.entries) != 0 || len(mock.Requests()) != 0 {
		t.Fatal("invalid clip got a slot")
	}
	for range maxEntries {
		startUpload(t, a, "clip.mp3", "audio/mpeg", 10)
	}
	if rec, _ := startUpload(t, a, "clip.mp3", "audio/mpeg", 10); rec.Code != 409 || len(a.entries) != maxEntries {
		t.Fatal("slot limit not enforced", rec.Code)
	}
}

func TestFinishLinksOnlyTheClipsOwnAsset(t *testing.T) {
	a := demoApp(t)
	mock := live(t, a)
	_, mine := startUpload(t, a, "mine.mp3", "audio/mpeg", int64(len(clipBytes)))
	_, theirs := startUpload(t, a, "theirs.mp3", "audio/mpeg", int64(len(clipBytes)))
	item := a.findKey(mine.Clip)
	other := browserUpload(t, mock, theirs.Token)
	decideAsset(mock.DatabaseStorage.Assets[other.ID], "approved")

	// Another clip's asset, or one that doesn't exist, is refused after a retrieve.
	for _, id := range []string{other.ID, "missing"} {
		if rec := finish(a, mine.Clip, id); rec.Code != 502 || item.ID != "" || item.Status != clipUploading {
			t.Fatal("linked an asset this clip did not upload", id, rec.Code, item.ID)
		}
	}
	if finish(a, "clip_unknown", other.ID).Code != 404 {
		t.Fatal("finished an unknown clip")
	}
	asset := browserUpload(t, mock, mine.Token)
	mock.ClearRequests()
	if rec := finish(a, mine.Clip, asset.ID); rec.Code != 204 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	requests := mock.Requests()
	if item.ID != asset.ID || item.Status != clipPending || len(requests) != 1 || requests[0].Method != "GET" || requests[0].Path != "/assets/"+asset.ID {
		t.Fatalf("not linked from a retrieve: %+v %+v", item, requests)
	}
	// A linked clip can't be relinked, and an asset can't be linked to two clips.
	if finish(a, mine.Clip, other.ID).Code != 409 || item.ID != asset.ID {
		t.Fatal("relinked a clip")
	}
	if finish(a, theirs.Clip, asset.ID).Code != 409 {
		t.Fatal("linked one asset to two clips")
	}
}

func TestUnfinishedBrowserUploads(t *testing.T) {
	a := demoApp(t)
	mock := live(t, a)
	_, body := startUpload(t, a, "note.mp3", "audio/mpeg", 10)
	rec := get(a, "/")
	if rec.Code != 200 || rec.Header().Get("Refresh") != "" || len(mock.Requests()) != 0 {
		t.Fatal("an unfinished upload was refreshed or reloads the page", rec.Header(), mock.Requests())
	}
	if get(a, "/media?id=").Code != 404 {
		t.Fatal("an unfinished upload is playable")
	}
	if rec := post(a, "/delete", url.Values{"csrf": {a.csrf}, "clip": {body.Clip}}); rec.Code != 303 || len(a.entries) != 0 || len(mock.Requests()) != 0 {
		t.Fatal("unfinished upload not removed locally", rec.Code, mock.Requests())
	}
}

func TestLivePageLoadsTheSDKFromThisServer(t *testing.T) {
	a := demoApp(t)
	if get(a, "/sdk/app.js").Code != 404 || get(a, "/upload.js").Code != 404 {
		t.Fatal("the demo serves the browser upload")
	}
	live(t, a)
	policy := get(a, "/").Header().Get("Content-Security-Policy")
	if !strings.Contains(policy, "script-src 'self'") || !strings.Contains(policy, "connect-src 'self' https://api.example.test") {
		t.Fatal("page cannot load its script or reach the API", policy)
	}
	for _, path := range []string{"/sdk/app.js", "/upload.js"} {
		rec := get(a, path)
		if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/javascript") {
			t.Fatal(path, rec.Code, rec.Header())
		}
	}
	if !strings.Contains(get(a, "/upload.js").Body.String(), `from "/sdk/app.js"`) {
		t.Fatal("upload script does not import the served SDK")
	}
	if err := os.WriteFile(filepath.Join(a.sdkDir, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/sdk/notes.txt", "/sdk/..%2Fmain.js", "/sdk/missing.js"} {
		if get(a, path).Code != 404 {
			t.Fatal("served", path)
		}
	}
}

var webhookTimestamp = time.Now().Unix()

func webhook(a *app, body, signature string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/webhooks/calmlens", strings.NewReader(body))
	req.Header.Set(calmlens.WebhookTimestampHeader, strconv.FormatInt(webhookTimestamp, 10))
	req.Header.Set(calmlens.WebhookSignatureHeader, signature)
	rec := httptest.NewRecorder()
	a.handler().ServeHTTP(rec, req)
	return rec
}
func sign(body string) string {
	return calmlens.SignWebhookPayload([]byte(body), webhookTimestamp, "secret")
}
func event(id, kind, assetID, facts string) string {
	return fmt.Sprintf(`{ "id": %q, "type": %q, "data": { "assetId": %q, "asset": {"id": %q, "processing": {"status": "done"}, "moderation": {"status": "approved", "action": null}, "content": {"status": "stored"}}, "facts": %s } }`, id, kind, assetID, assetID, facts)
}
func retrieves(mock *calmlenstest.MockServerClient) int {
	n := 0
	for _, r := range mock.Requests() {
		if r.Method == "GET" {
			n++
		}
	}
	return n
}

func TestWebhookTamperReplayAndRetry(t *testing.T) {
	a := demoApp(t)
	mock := live(t, a)
	item := liveClip(t, a, mock)
	decideAsset(mock.DatabaseStorage.Assets[item.ID], "rejected")
	body := event("event-1", "asset.rejected", item.ID, `[{"key":"decided-by","value":"automated"}]`)
	if webhook(a, body, "bad").Code != 401 || webhook(a, strings.ReplaceAll(body, " ", ""), sign(body)).Code != 401 {
		t.Fatal("forged or altered webhook accepted")
	}
	if item.Status != "pending" || len(mock.Requests()) != 0 {
		t.Fatal("unverified webhook had an effect")
	}
	mock.FailNext(errors.New("offline"))
	if webhook(a, body, sign(body)).Code != 502 || item.Status != "pending" {
		t.Fatal("failed retrieval should ask for redelivery")
	}
	if rec := webhook(a, body, sign(body)); rec.Code != 204 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	if item.Status != "rejected" {
		t.Fatal("trusted the event snapshot instead of retrieving the asset")
	}
	before := retrieves(mock)
	if webhook(a, body, sign(body)).Code != 204 || retrieves(mock) != before {
		t.Fatal("replayed delivery was processed again")
	}
	failed := event("event-2", "asset.failed", item.ID, "[]")
	decideAsset(mock.DatabaseStorage.Assets[item.ID], "error")
	if webhook(a, failed, sign(failed)).Code != 204 || item.Status != "error" {
		t.Fatal("asset.failed not applied", item.Status)
	}
	if get(a, "/media?id="+item.ID).Code != 403 {
		t.Fatal("webhook exposed an unapproved clip")
	}
}

func TestWebhookTestFactChangesNothing(t *testing.T) {
	a := demoApp(t)
	mock := live(t, a)
	item := liveClip(t, a, mock)
	decideAsset(mock.DatabaseStorage.Assets[item.ID], "approved")
	body := event("event-test", "asset.approved", item.ID, `[{"key":"test","value":true}]`)
	if rec := webhook(a, body, sign(body)); rec.Code != 204 {
		t.Fatal(rec.Code)
	}
	if item.Status != "pending" || len(mock.Requests()) != 0 || len(a.activity) != 1 {
		t.Fatal("test delivery changed state", item.Status, mock.Requests())
	}
}

func TestUploadRequiresCSRF(t *testing.T) {
	a := demoApp(t)
	if uploadRequest(t, a, upload{token: "wrong"}).Code != 403 || len(a.entries) != 0 || len(a.demo.Mock.Requests()) != 0 {
		t.Fatal("upload without CSRF token")
	}
	mock := live(t, a)
	_, body := startUpload(t, a, "note.mp3", "audio/mpeg", int64(len(clipBytes)))
	asset := browserUpload(t, mock, body.Token)
	if post(a, "/uploads/finish", url.Values{"csrf": {"wrong"}, "clip": {body.Clip}, "assetId": {asset.ID}}).Code != 403 || a.entries[0].ID != "" {
		t.Fatal("finish without CSRF token")
	}
}
