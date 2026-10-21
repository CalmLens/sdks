// Calmclips: a local voice-note and video-clip app demonstrating audio/video moderation
// with the CalmLens Go SDK. In live mode clips go straight from the browser to CalmLens
// through an upload preset; this server only signs a single-use upload token per clip.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log"
	"math"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/CalmLens/sdks/examples/voice-clips-go/demo"
	calmlens "github.com/CalmLens/sdks/go"
)

const (
	// The documented audio/video input limit is 50 MiB and 120 seconds. This app checks the
	// size; CalmLens enforces the duration (longer clips fail processing).
	maxClipBytes = 50 * 1024 * 1024
	// Clips above the threshold are sent as a sequential multipart upload. Every part except
	// the final one must be at least 5 MiB. The browser upload uses the same split.
	multipartThreshold = 8 * 1024 * 1024
	partSize           = 5 * 1024 * 1024
	maxEntries         = 12
	// An upload token only needs to start the upload; its later parts stay authorized.
	uploadTokenSeconds = 600
	// Approved playback uses a short-lived signed URL; long enough to play and seek a
	// two-minute clip.
	signedURLSeconds = 300
	// A cached signed URL is reused while at least this much of its lifetime remains.
	signedURLReuse = 150 * time.Second
	// A segment category is shown as a finding from "possible" (0.4) upwards.
	findingThreshold = 0.4
	demoDelay        = 2 * time.Second
	// The example only runs locally, on loopback.
	listenAddr    = "127.0.0.1:6402"
	defaultAPIURL = "https://api.calmlens.com/v1"
	// defaultSDKDir is the JavaScript SDK's workspace build (npm run build in javascript).
	defaultSDKDir = "../../javascript/esm"
)

// clipTypes is the allow-list of documented, tested audio and video formats. The app does
// not decode media: a renamed or relabelled file that CalmLens cannot decode becomes an error.
var clipTypes = map[string]bool{
	// WAV, MP3, FLAC, AAC, M4A, Ogg/Vorbis, Opus, AIFF, WMA
	"audio/wav": true, "audio/x-wav": true, "audio/wave": true, "audio/mpeg": true,
	"audio/flac": true, "audio/x-flac": true, "audio/aac": true, "audio/mp4": true,
	"audio/x-m4a": true, "audio/ogg": true, "audio/opus": true, "audio/aiff": true,
	"audio/x-aiff": true, "audio/x-ms-wma": true,
	// MP4, MOV, WebM, Matroska, AVI, MPEG, MPEG-TS, WMV
	"video/mp4": true, "video/quicktime": true, "video/webm": true, "video/x-matroska": true,
	"video/x-msvideo": true, "video/avi": true, "video/mpeg": true, "video/mp2t": true,
	"video/x-ms-wmv": true,
}

var categoryLabels = map[string]string{
	calmlens.CategorySexual: "Sexual content", calmlens.CategoryViolence: "Violence", calmlens.CategorySelfHarm: "Self-harm",
	calmlens.CategoryHarassment: "Harassment", calmlens.CategoryHate: "Hate", calmlens.CategoryCriminalActivity: "Criminal activity",
}

// Events that can change a clip's decision. EventAssetApproved and EventAssetRejected report every
// outcome, from automated moderation or a reviewer.
var webhookEvents = map[string]bool{calmlens.EventAssetApproved: true, calmlens.EventAssetRejected: true, calmlens.EventAssetFailed: true}

//go:embed index.html
var pageSource string

//go:embed upload.js
var uploadScript []byte

// sdkFile matches the files of the SDK's ESM build that the page may import.
var sdkFile = regexp.MustCompile(`^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.js$`)
var pageTemplate = template.Must(template.New("page").Funcs(template.FuncMap{"clock": clock, "mib": mib}).Parse(pageSource))

type finding struct {
	Category   string
	Label      string
	Likelihood string
	Score      float64
}
type segment struct {
	Start, End  float64
	Left, Width float64
	Findings    []finding
}
type entry struct {
	// ID is the CalmLens asset ID; Key is this app's own record ID, stored on the asset as its
	// externalId so every asset can be tied back to the record that created it. ID stays empty
	// until the browser reports its upload and a retrieve confirms the asset carries Key.
	ID           string
	Key          string
	Name         string
	Type         string
	Video        bool
	Size         int64
	Parts        int
	Status       string
	Flagged      bool
	Error        string
	DemoResult   string
	PendingSince time.Time
	Duration     float64
	Segments     []segment
	signedURL    string
	signedUntil  time.Time
}

// config is read from the environment by main.
type config struct {
	APIKey, ProjectID, BaseURL, CDNBaseURL, WebhookSecret string
	// UploadPresetID is the token-only upload preset browsers upload through (live mode).
	UploadPresetID string
	// SDKDir holds the JavaScript SDK's ESM build, served to the page at /sdk/.
	SDKDir string
	// Demo runs without a CalmLens project (CALMLENS_DEMO=1).
	Demo bool
}

type app struct {
	client *calmlens.ServerClient
	// demo is nil in live mode.
	demo   *demo.Backend
	secret string
	csrf   string
	// preset, apiURL and sdkDir configure the browser upload in live mode.
	preset string
	apiURL string
	sdkDir string
	// mu guards the fields below. It is never held during a network call.
	mu        sync.Mutex
	entries   []*entry
	uploading int
	seen      map[string]bool
	activity  []string
}

// newApp fails closed: it needs both credentials, or demo mode requested explicitly.
func newApp(cfg config) (*app, error) {
	if cfg.Demo && (cfg.APIKey != "" || cfg.ProjectID != "") {
		return nil, errors.New("CALMLENS_DEMO=1 cannot be combined with CALMLENS_API_KEY or CALMLENS_PROJECT_ID")
	}
	if !cfg.Demo && (cfg.APIKey == "" || cfg.ProjectID == "") {
		return nil, errors.New("set CALMLENS_API_KEY and CALMLENS_PROJECT_ID, or CALMLENS_DEMO=1 to try the simulated demo")
	}
	if cfg.Demo && cfg.UploadPresetID != "" {
		return nil, errors.New("CALMLENS_UPLOAD_PRESET_ID needs a live project; the demo uploads through its simulated server path")
	}
	if !cfg.Demo && cfg.UploadPresetID == "" {
		return nil, errors.New("set CALMLENS_UPLOAD_PRESET_ID to a token-only upload preset; browsers upload clips through it")
	}
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return nil, err
	}
	a := &app{csrf: hex.EncodeToString(token), secret: cfg.WebhookSecret, seen: map[string]bool{}}
	var err error
	if cfg.Demo {
		if a.demo, err = demo.New(); err == nil {
			a.client = a.demo.ServerClient()
		}
		return a, err
	}
	a.preset, a.apiURL, a.sdkDir = cfg.UploadPresetID, cfg.BaseURL, cfg.SDKDir
	if a.apiURL == "" {
		a.apiURL = defaultAPIURL
	}
	if a.sdkDir == "" {
		a.sdkDir = defaultSDKDir
	}
	if _, err := os.Stat(filepath.Join(a.sdkDir, "index.js")); err != nil {
		return nil, fmt.Errorf("the page imports the JavaScript SDK from %s: run npm run build in javascript, or set CALMLENS_JS_SDK_DIR", a.sdkDir)
	}
	a.client, err = calmlens.NewServerClient(calmlens.Options{APIKey: cfg.APIKey, ProjectID: cfg.ProjectID, BaseURL: a.apiURL, CDNBaseURL: cfg.CDNBaseURL})
	return a, err
}

func (a *app) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", a.home)
	if a.demo != nil {
		// The demo has no upload preset: the browser posts the clip to this server.
		mux.HandleFunc("POST /upload", a.upload)
	} else {
		mux.HandleFunc("POST /uploads/start", a.startUpload)
		mux.HandleFunc("POST /uploads/finish", a.finishUpload)
		mux.HandleFunc("GET /upload.js", a.script)
		mux.HandleFunc("GET /sdk/{file}", a.sdk)
	}
	mux.HandleFunc("GET /media", a.media)
	mux.HandleFunc("POST /retry", a.retry)
	mux.HandleFunc("POST /delete", a.remove)
	mux.HandleFunc("POST /webhooks/calmlens", a.webhook)
	policy := "default-src 'none'; style-src 'unsafe-inline'; media-src 'self' https: http://localhost:* http://127.0.0.1:*; form-action 'self'; frame-ancestors 'none'"
	if a.demo == nil {
		// The page's script and the SDK come from this server; uploads go to the CalmLens API.
		policy += "; script-src 'self'; connect-src 'self' " + origin(a.apiURL)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", policy)
		mux.ServeHTTP(w, r)
	})
}

// origin returns the scheme and host of an API base URL, for the page's connect-src.
func origin(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return "'none'"
	}
	return parsed.Scheme + "://" + parsed.Host
}

// find returns the clip with asset ID id. Call it with a.mu held. A clip whose browser upload
// has not been confirmed has no asset ID and is never found here.
func (a *app) find(id string) *entry {
	if id == "" {
		return nil
	}
	for _, item := range a.entries {
		if item.ID == id {
			return item
		}
	}
	return nil
}

// findKey returns the clip with this app's record ID key. Call it with a.mu held.
func (a *app) findKey(key string) *entry {
	if key == "" {
		return nil
	}
	for _, item := range a.entries {
		if item.Key == key {
			return item
		}
	}
	return nil
}

// clipType returns the normalized MIME type if it is on the allow-list.
func clipType(declared string) (string, bool) {
	media, _, err := mime.ParseMediaType(declared)
	if err != nil {
		return "", false
	}
	return media, clipTypes[media]
}

// refresh always retrieves the authoritative asset. It also makes webhook replays harmless.
// The network call runs without the lock; only the result is applied under it.
func (a *app) refresh(ctx context.Context, item *entry) error {
	a.mu.Lock()
	id, key, choice, video, since := item.ID, item.Key, item.DemoResult, item.Video, item.PendingSince
	a.mu.Unlock()
	if a.demo != nil && time.Since(since) >= demoDelay {
		a.demo.Settle(id, choice, video)
	}
	asset, err := a.client.Assets.Retrieve(ctx, calmlens.AssetIDOptions{AssetID: id})
	if err == nil && (asset.ExternalID == nil || *asset.ExternalID != key) {
		// Never apply a decision for an asset that this record did not create.
		err = errors.New("asset is not linked to this clip")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err != nil {
		item.Error = "Could not refresh the decision. Playback is unavailable."
		item.signedURL = ""
		return err
	}
	item.Status = clipStatus(asset)
	// The policy took an action (alert, hide or purge) when the content matched it.
	item.Flagged = asset.Classification.Moderation.Action != nil
	item.Duration, item.Segments = 0, nil
	if report := asset.Classification.Moderation; report.Timeline != nil {
		item.Duration, item.Segments = timeline(report.Timeline)
	}
	item.Error = ""
	if item.Status != clipApproved {
		item.signedURL = ""
	}
	return nil
}

// Clip states shown on the page, derived from the asset's processing and moderation status.
const (
	clipUploading = "uploading"
	clipPending   = "pending"
	clipApproved  = "approved"
	clipRejected  = "rejected"
	clipError     = "error"
)

// clipStatus reads the clip's state from the asset. Failed processing is final; statuses this
// app doesn't know count as still pending, so the clip never plays before an approval.
func clipStatus(asset *calmlens.Asset) string {
	switch {
	case asset.Classification.Status == calmlens.ClassificationStatusFailed:
		return clipError
	case asset.Classification.Moderation.Decision == calmlens.ModerationStatusApproved:
		return clipApproved
	case asset.Classification.Moderation.Decision == calmlens.ModerationStatusRejected:
		return clipRejected
	case asset.Classification.Status == calmlens.ClassificationStatusPending:
		return clipUploading
	default:
		return clipPending
	}
}

// timeline converts report.media into segment rows with the categories that scored in each.
func timeline(media *calmlens.MediaClassificationReport) (float64, []segment) {
	duration := media.DurationSeconds
	rows := []segment{}
	for _, s := range media.Segments {
		row := segment{Start: s.StartSeconds, End: s.EndSeconds}
		if duration > 0 {
			row.Left = math.Max(0, math.Min(100, s.StartSeconds/duration*100))
			row.Width = math.Max(0, math.Min(100-row.Left, (s.EndSeconds-s.StartSeconds)/duration*100))
		}
		for id, result := range s.Categories {
			// Narrow on status first: a not-evaluated category is unknown, never a zero score.
			if (result.Status != calmlens.ResultEvaluated && result.Status != calmlens.ResultPartial) || result.Score == nil || *result.Score < findingThreshold {
				continue
			}
			label := categoryLabels[id]
			if label == "" {
				label = id
			}
			row.Findings = append(row.Findings, finding{Category: id, Label: label, Likelihood: result.Likelihood, Score: *result.Score})
		}
		sort.Slice(row.Findings, func(i, j int) bool { return row.Findings[i].Score > row.Findings[j].Score })
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Start < rows[j].Start })
	return duration, rows
}

func clock(seconds float64) string {
	total := int(math.Round(seconds))
	return fmt.Sprintf("%d:%02d", total/60, total%60)
}
func mib(size int64) string { return fmt.Sprintf("%.1f MiB", float64(size)/(1024*1024)) }

func (a *app) home(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	stale := []*entry{}
	for _, item := range a.entries {
		if item.ID != "" && (item.Status == clipPending || item.Status == clipUploading || item.Error != "") {
			stale = append(stale, item)
		}
	}
	a.mu.Unlock()
	// Refresh concurrently and without the lock, so one slow call never blocks other requests.
	var wg sync.WaitGroup
	for _, item := range stale {
		wg.Add(1)
		go func(item *entry) {
			defer wg.Done()
			_ = a.refresh(r.Context(), item)
		}(item)
	}
	wg.Wait()
	a.mu.Lock()
	copies := make([]entry, 0, len(a.entries))
	pending := false
	for _, item := range a.entries {
		// A clip still uploading from a browser has nothing to check yet.
		pending = pending || (item.ID != "" && (item.Status == clipPending || item.Status == clipUploading))
		copies = append(copies, *item)
	}
	activity := append([]string(nil), a.activity...)
	a.mu.Unlock()
	// In live mode the page's script reloads instead, so a reload never cuts off an upload.
	if pending && a.demo != nil {
		w.Header().Set("Refresh", "3")
	}
	var body bytes.Buffer
	err := pageTemplate.Execute(&body, struct {
		Demo     bool
		CSRF     string
		Entries  []entry
		Pending  bool
		Activity []string
		MaxMiB   int
		Preset   string
		APIURL   string
	}{a.demo != nil, a.csrf, copies, pending, activity, maxClipBytes / (1024 * 1024), a.preset, a.apiURL})
	if err != nil {
		log.Printf("Render failed: %v", err)
		http.Error(w, "Could not render page", 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(body.Bytes())
}

// demoChoice validates the explicitly selected demo outcome; live mode ignores it.
func (a *app) demoChoice(r *http.Request) (string, bool) {
	if a.demo == nil {
		return "", true
	}
	choice := r.FormValue("demo_result")
	switch choice {
	case "approved", "flagged", "rejected", "error":
		return choice, true
	}
	return "", false
}
func (a *app) checkCSRF(w http.ResponseWriter, r *http.Request) bool {
	if subtle.ConstantTimeCompare([]byte(r.FormValue("csrf")), []byte(a.csrf)) != 1 {
		http.Error(w, "Invalid form token. Reload the page.", 403)
		return false
	}
	return true
}

func newKey() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return "clip_" + hex.EncodeToString(b)
}

// checkClip applies the format allow-list and the size limit before anything reaches CalmLens.
func checkClip(w http.ResponseWriter, declared string, size int64) (string, bool) {
	contentType, ok := clipType(declared)
	if !ok {
		http.Error(w, "Use a supported audio or video format (for example MP3, WAV, M4A, Ogg, MP4, MOV or WebM).", 415)
		return "", false
	}
	if size <= 0 || size > maxClipBytes {
		http.Error(w, fmt.Sprintf("The clip must contain between 1 byte and %d MiB.", maxClipBytes/(1024*1024)), 413)
		return "", false
	}
	return contentType, true
}

func clipName(filename string) string {
	name := filepath.Base(filename)
	if len(name) > 150 || name == "." || name == "/" {
		return "clip"
	}
	return name
}

// partsFor is how many requests a clip is sent in: one up to the threshold, otherwise 5 MiB
// parts with a shorter final part.
func partsFor(size int64) int {
	if size <= multipartThreshold {
		return 1
	}
	return int((size + partSize - 1) / partSize)
}

// startUpload checks a clip the browser is about to upload, reserves its slot and signs a
// single-use upload token for it. The token sets the asset's externalId to the clip's key, so
// the browser cannot attach its upload to any other clip. Signing happens locally, without a
// request to CalmLens.
func (a *app) startUpload(w http.ResponseWriter, r *http.Request) {
	if !a.smallForm(w, r) {
		return
	}
	size, err := strconv.ParseInt(r.FormValue("size"), 10, 64)
	if err != nil {
		http.Error(w, "Choose an audio or video clip", 400)
		return
	}
	contentType, ok := checkClip(w, r.FormValue("type"), size)
	if !ok {
		return
	}
	key := newKey()
	signed, err := a.client.UploadTokens.Sign(r.Context(), calmlens.SignUploadTokenOptions{UploadPresetID: a.preset, ExternalID: &key, ExpiresInSeconds: uploadTokenSeconds})
	if err != nil {
		log.Printf("Signing an upload token failed: %v", err)
		http.Error(w, "Could not prepare the upload.", 500)
		return
	}
	item := &entry{
		Key: key, Name: clipName(r.FormValue("name")), Type: contentType, Video: strings.HasPrefix(contentType, "video/"),
		Size: size, Parts: partsFor(size), Status: clipUploading, PendingSince: time.Now(),
	}
	a.mu.Lock()
	if len(a.entries)+a.uploading >= maxEntries {
		a.mu.Unlock()
		http.Error(w, fmt.Sprintf("This local session holds at most %d clips. Delete one or restart.", maxEntries), 409)
		return
	}
	a.entries = append([]*entry{item}, a.entries...)
	a.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"clip": key, "token": signed.Token, "expiresAt": signed.ExpiresAt,
		"type": contentType, "parts": item.Parts, "partSize": partSize,
	})
}

// finishUpload links the asset the browser reports to its clip. The report is only a hint:
// the asset is retrieved and must carry the clip's key as its externalId, which only the
// clip's upload token can set. Its status always comes from that retrieve, never the browser.
func (a *app) finishUpload(w http.ResponseWriter, r *http.Request) {
	if !a.smallForm(w, r) {
		return
	}
	assetID := r.FormValue("assetId")
	a.mu.Lock()
	item := a.findKey(r.FormValue("clip"))
	if item == nil {
		a.mu.Unlock()
		http.NotFound(w, r)
		return
	}
	if assetID == "" || item.ID != "" || a.find(assetID) != nil {
		a.mu.Unlock()
		http.Error(w, "This upload is already linked.", 409)
		return
	}
	item.ID = assetID
	a.mu.Unlock()
	if err := a.refresh(r.Context(), item); err != nil {
		log.Printf("Linking upload failed: %v", err)
		a.mu.Lock()
		item.ID, item.Status, item.Error = "", clipUploading, ""
		a.mu.Unlock()
		http.Error(w, "Could not confirm this upload with CalmLens.", 502)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// script serves the page's upload script.
func (a *app) script(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	_, _ = w.Write(uploadScript)
}

// sdk serves the JavaScript SDK's ESM build, which the upload script imports.
func (a *app) sdk(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if !sdkFile.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	data, err := os.ReadFile(filepath.Join(a.sdkDir, name))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	_, _ = w.Write(data)
}

func (a *app) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxClipBytes+256*1024)
	// Files above 2 MiB spill to temporary files that RemoveAll deletes.
	if err := r.ParseMultipartForm(2 * 1024 * 1024); err != nil {
		http.Error(w, fmt.Sprintf("Upload one audio or video clip of at most %d MiB.", maxClipBytes/(1024*1024)), 413)
		return
	}
	defer r.MultipartForm.RemoveAll()
	if !a.checkCSRF(w, r) {
		return
	}
	file, header, err := r.FormFile("clip")
	if err != nil {
		http.Error(w, "Choose an audio or video clip", 400)
		return
	}
	defer file.Close()
	contentType, ok := checkClip(w, header.Header.Get("Content-Type"), header.Size)
	if !ok {
		return
	}
	choice, ok := a.demoChoice(r)
	if !ok {
		http.Error(w, "Unknown demo result", 400)
		return
	}
	name := clipName(header.Filename)
	// Reserve a slot, then upload without holding the lock.
	a.mu.Lock()
	if len(a.entries)+a.uploading >= maxEntries {
		a.mu.Unlock()
		http.Error(w, fmt.Sprintf("This local session holds at most %d clips. Delete one or restart.", maxEntries), 409)
		return
	}
	a.uploading++
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.uploading--
		a.mu.Unlock()
	}()
	key := newKey()
	asset, parts, err := a.send(r.Context(), key, name, contentType, file, header.Size)
	if err != nil {
		log.Printf("Upload failed: %v", err)
		http.Error(w, "CalmLens could not accept the upload. Please try again.", 502)
		return
	}
	a.mu.Lock()
	a.entries = append([]*entry{{
		ID: asset.ID, Key: key, Name: name, Type: contentType, Video: strings.HasPrefix(contentType, "video/"),
		Size: header.Size, Parts: parts, Status: clipStatus(asset), DemoResult: choice, PendingSince: time.Now(),
	}}, a.entries...)
	a.mu.Unlock()
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// send streams the clip privately and keeps the content so approved clips can be played back.
// Large clips go through the SDK's sequential multipart upload. Every part is a section of
// the uploaded file, so nothing is buffered in memory and the SDK can rewind a part to retry
// it. The idempotency keys make those retries safe.
func (a *app) send(ctx context.Context, key, name, contentType string, file io.ReaderAt, size int64) (*calmlens.Asset, int, error) {
	options := calmlens.SubmitAssetOptions{
		Name: name, Visibility: calmlens.VisibilityPrivate, ExternalID: &key, IdempotencyKey: key,
		ProcessingOptions: &calmlens.ProcessingOptions{KeepContentAfterProcessing: calmlens.Ptr(true)},
	}
	section := func(start, length int64) io.Reader { return io.NewSectionReader(file, start, length) }
	if size <= multipartThreshold {
		options.Content = &calmlens.Content{Type: contentType, Data: section(0, size), SizeInBytes: &size}
		asset, err := a.client.Assets.Create(ctx, options)
		return asset, 1, err
	}
	total := int((size + partSize - 1) / partSize)
	chunk := func(n int) calmlens.Content {
		start := int64(n-1) * partSize
		length := min(partSize, size-start)
		return calmlens.Content{Type: contentType, Data: section(start, length), SizeInBytes: &length, PartNumber: n, IsFinal: n == total}
	}
	first := chunk(1)
	options.Part = &first
	options.TotalSizeInBytes = &size
	asset, err := a.client.Assets.Create(ctx, options)
	if err != nil {
		return nil, 0, err
	}
	for n := 2; n <= total; n++ {
		part := calmlens.UploadAssetPartOptions{AssetID: asset.ID, Part: chunk(n), IdempotencyKey: fmt.Sprintf("%s-part-%d", key, n)}
		if asset, err = a.client.Assets.UploadPart(ctx, part); err != nil {
			// The unfinished temporary upload is abandoned and expires on its own.
			return nil, 0, err
		}
	}
	return asset, total, nil
}

func (a *app) media(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	item := a.find(r.URL.Query().Get("id"))
	cached := ""
	if item != nil && item.signedURL != "" && time.Until(item.signedUntil) >= signedURLReuse {
		cached = item.signedURL
	}
	a.mu.Unlock()
	if item == nil {
		http.NotFound(w, r)
		return
	}
	// A URL signed after a fresh approval is reused until it nears expiry. Refreshes and
	// webhooks that report a different decision drop it.
	if cached != "" {
		http.Redirect(w, r, cached, http.StatusSeeOther)
		return
	}
	// Fail closed: retrieve the current decision before signing.
	if err := a.refresh(r.Context(), item); err != nil {
		http.Error(w, "Playback unavailable", 502)
		return
	}
	a.mu.Lock()
	status, id, contentType := item.Status, item.ID, item.Type
	a.mu.Unlock()
	if status != clipApproved {
		http.Error(w, "This clip is not approved", 403)
		return
	}
	if a.demo != nil {
		a.streamDemo(w, r, id, contentType)
		return
	}
	signed, err := a.client.Assets.CreateSignedURL(r.Context(), calmlens.SignedURLOptions{AssetID: id, Resource: calmlens.ResourceContent, ExpiresInSeconds: signedURLSeconds})
	if err != nil {
		log.Printf("Signed URL failed: %v", err)
		http.Error(w, "Playback unavailable", 502)
		return
	}
	destination, err := url.Parse(signed.URL)
	if err != nil || destination.Host == "" || (destination.Scheme != "https" && !(destination.Scheme == "http" && (destination.Hostname() == "localhost" || destination.Hostname() == "127.0.0.1"))) {
		http.Error(w, "Invalid playback URL", 502)
		return
	}
	a.mu.Lock()
	if item.Status == clipApproved {
		item.signedURL, item.signedUntil = signed.URL, time.UnixMilli(signed.ExpiresAt)
	}
	a.mu.Unlock()
	http.Redirect(w, r, signed.URL, http.StatusSeeOther)
}

// streamDemo streams the mock CDN response, forwarding Range so players can seek.
func (a *app) streamDemo(w http.ResponseWriter, r *http.Request, id, contentType string) {
	headers := http.Header{}
	if value := r.Header.Get("Range"); value != "" {
		headers.Set("Range", value)
	}
	res, err := a.client.CDN.Serve(r.Context(), calmlens.CDNServeOptions{CDNAssetURLOptions: calmlens.CDNAssetURLOptions{AssetIdentifier: id}, Headers: headers})
	if err != nil {
		http.Error(w, "Playback unavailable", 502)
		return
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusPartialContent {
		http.Error(w, "Playback unavailable", 502)
		return
	}
	for _, name := range []string{"Content-Length", "Content-Range", "Accept-Ranges"} {
		if value := res.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(res.StatusCode)
	_, _ = io.Copy(w, res.Body)
}

func (a *app) smallForm(w http.ResponseWriter, r *http.Request) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Invalid form", 400)
		return false
	}
	return a.checkCSRF(w, r)
}

func (a *app) retry(w http.ResponseWriter, r *http.Request) {
	if !a.smallForm(w, r) {
		return
	}
	choice, ok := a.demoChoice(r)
	if !ok {
		http.Error(w, "Unknown demo result", 400)
		return
	}
	a.mu.Lock()
	item := a.find(r.FormValue("id"))
	status := ""
	if item != nil {
		status = item.Status
	}
	a.mu.Unlock()
	if item == nil {
		http.NotFound(w, r)
		return
	}
	if status != clipError {
		http.Error(w, "Only clips that failed processing can be retried", 409)
		return
	}
	asset, err := a.client.Assets.Retry(r.Context(), calmlens.AssetIDOptions{AssetID: item.ID})
	if err != nil {
		log.Printf("Retry failed: %v", err)
		http.Error(w, "CalmLens could not retry this clip.", 502)
		return
	}
	a.mu.Lock()
	item.Status, item.Flagged, item.Error = clipStatus(asset), false, ""
	item.Duration, item.Segments = 0, nil
	item.DemoResult, item.PendingSince = choice, time.Now()
	a.mu.Unlock()
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// remove deletes the asset record and its stored content in CalmLens, then forgets the clip.
// It looks the clip up by its key, so a clip whose browser upload never finished can be removed
// too; that clip has no linked asset to delete.
func (a *app) remove(w http.ResponseWriter, r *http.Request) {
	if !a.smallForm(w, r) {
		return
	}
	a.mu.Lock()
	item := a.findKey(r.FormValue("clip"))
	id := ""
	if item != nil {
		id = item.ID
	}
	a.mu.Unlock()
	if item == nil {
		http.NotFound(w, r)
		return
	}
	var err error
	if id != "" {
		err = a.client.Assets.Delete(r.Context(), calmlens.AssetIDOptions{AssetID: id})
	}
	if err != nil && !calmlens.IsNotFound(err) {
		log.Printf("Delete failed: %v", err)
		http.Error(w, "CalmLens could not delete this clip. It is still listed.", 502)
		return
	}
	a.mu.Lock()
	kept := a.entries[:0]
	for _, other := range a.entries {
		if other != item {
			kept = append(kept, other)
		}
	}
	a.entries = kept
	a.mu.Unlock()
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// record adds a line to the activity panel. Call it with a.mu held.
func (a *app) record(line string) {
	a.activity = append([]string{time.Now().Format("15:04:05") + " " + line}, a.activity...)
	if len(a.activity) > 8 {
		a.activity = a.activity[:8]
	}
}

func (a *app) webhook(w http.ResponseWriter, r *http.Request) {
	if a.secret == "" {
		http.Error(w, "Set CALMLENS_WEBHOOK_SECRET to enable webhooks", 503)
		return
	}
	// Verify the exact raw bytes (read with a 1 MiB limit) before parsing anything.
	event, err := calmlens.VerifyWebhookRequest(r, a.secret)
	if err != nil {
		if calmlens.ErrorCode(err) == calmlens.CodeSDKInvalidWebhookSignature {
			http.Error(w, "Invalid signature", 401)
		} else {
			http.Error(w, "Invalid webhook", 400)
		}
		return
	}
	a.mu.Lock()
	if a.seen[event.ID] {
		a.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if event.Data.Facts.IsTest() {
		a.record("Test delivery received (" + event.Type + "). Nothing changed.")
		a.markSeen(event.ID)
		a.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var item *entry
	if webhookEvents[event.Type] && event.Data.AssetID != nil {
		item = a.find(*event.Data.AssetID)
	}
	a.mu.Unlock()
	if item != nil {
		// Retrieve the current state rather than trusting the event snapshot.
		if err := a.refresh(r.Context(), item); err != nil {
			http.Error(w, "Could not refresh asset", 502)
			return
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if item != nil {
		a.record(event.Type + ": " + item.Name + " is " + item.Status + ".")
	}
	a.markSeen(event.ID)
	w.WriteHeader(http.StatusNoContent)
}

// markSeen remembers a processed delivery. Call it with a.mu held.
func (a *app) markSeen(id string) {
	if len(a.seen) >= 1000 {
		a.seen = map[string]bool{}
	}
	a.seen[id] = true
}

func main() {
	cfg := config{
		APIKey: os.Getenv("CALMLENS_API_KEY"), ProjectID: os.Getenv("CALMLENS_PROJECT_ID"),
		BaseURL: os.Getenv("CALMLENS_API_URL"), CDNBaseURL: os.Getenv("CALMLENS_CDN_URL"), WebhookSecret: os.Getenv("CALMLENS_WEBHOOK_SECRET"),
		UploadPresetID: os.Getenv("CALMLENS_UPLOAD_PRESET_ID"), SDKDir: os.Getenv("CALMLENS_JS_SDK_DIR"),
		Demo: os.Getenv("CALMLENS_DEMO") == "1",
	}
	a, err := newApp(cfg)
	if err != nil {
		log.Fatal(err)
	}
	mode := "live"
	if cfg.Demo {
		mode = "demo"
	}
	log.Printf("Calmclips: http://%s (%s)", listenAddr, mode)
	server := &http.Server{Addr: listenAddr, Handler: a.handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 120 * time.Second, WriteTimeout: 180 * time.Second, IdleTimeout: 60 * time.Second}
	log.Fatal(server.ListenAndServe())
}
