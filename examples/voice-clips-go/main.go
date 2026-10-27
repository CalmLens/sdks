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
	// Allowed playback uses a short-lived signed URL; long enough to play and seek a
	// two-minute clip.
	signedURLSeconds = 300
	// A cached signed URL is reused while at least this much of its lifetime remains.
	signedURLReuse = 150 * time.Second
	// A segment category is shown as a finding from "possible" (0.4) upwards.
	findingThreshold = 0.4
	// A demo clip stays in processing this long before its selected outcome is written.
	demoDelay = 5 * time.Second
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

// Events that can change a clip's decision. There is one event per moderation status, sent for
// automated moderation and reviewer decisions alike.
var webhookEvents = map[string]bool{
	calmlens.EventAssetAllowed: true, calmlens.EventAssetLimited: true, calmlens.EventAssetAgeRestricted: true,
	calmlens.EventAssetBlocked: true, calmlens.EventAssetPurged: true, calmlens.EventAssetFailed: true,
}

//go:embed index.html
var pageSource string

//go:embed upload.js
var uploadScript []byte

//go:embed demo.js
var demoScript []byte

// sdkFile matches the files of the SDK's ESM build that the page may load: its modules and
// the upload widget's stylesheet.
var sdkFile = regexp.MustCompile(`^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.(js|css)$`)
var pageTemplate = template.Must(template.New("page").Funcs(template.FuncMap{
	"clock": clock, "size": size, "pct": pct, "label": label, "lower": strings.ToLower,
	"words":   func(s string) string { return strings.ReplaceAll(s, "-", " ") },
	"percent": func(score float64) string { return fmt.Sprintf("%.0f%%", score*100) },
}).Parse(pageSource))

type finding struct {
	Category   string
	Label      string
	Likelihood string
	Score      float64
}
type segment struct {
	// Source is what the segment analysed: a sampled frame, the speech, on-screen text or a
	// whole chunk of the clip (the SegmentSource constants).
	Source     string
	Start, End float64
	// Left and Width place the segment on the clip's timeline bar, in percent. Native chunks
	// overlap by a second; the bar draws each one up to where the next begins.
	Left, Width float64
	Findings    []finding
}

// Level is the strongest finding's likelihood, for colouring the segment; "" when clear.
func (s segment) Level() string {
	if len(s.Findings) == 0 {
		return ""
	}
	return s.Findings[0].Likelihood
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
	Error        string
	DemoResult   string
	PendingSince time.Time
	Duration     float64
	Segments     []segment
	signedURL    string
	signedUntil  time.Time
}

// Format is the clip's short format name, such as MP3 or MP4.
func (e entry) Format() string {
	if name := formatNames[e.Type]; name != "" {
		return name
	}
	return strings.ToUpper(strings.TrimPrefix(strings.TrimPrefix(e.Type, "audio/"), "video/"))
}

// lane is one row of a clip's timeline: the segments of one source.
type lane struct {
	Label    string
	Segments []segment
}

// Fine reports a lane of many short segments (such as sampled frames), drawn without gaps.
func (l lane) Fine() bool { return len(l.Segments) > 12 }

var sourceLabels = map[string]string{
	calmlens.SegmentSourceSpeech: "Speech", calmlens.SegmentSourceFrame: "Frames",
	calmlens.SegmentSourceFrameText: "On-screen text", calmlens.SegmentSourceClip: "Clip",
}

func sourceLabel(source string) string {
	if name := sourceLabels[source]; name != "" {
		return name
	}
	return source
}

// Lanes groups the segments by source, in a fixed order, so each source gets its own bar.
func (e entry) Lanes() []lane {
	lanes := []lane{}
	for _, source := range []string{calmlens.SegmentSourceClip, calmlens.SegmentSourceSpeech, calmlens.SegmentSourceFrame, calmlens.SegmentSourceFrameText} {
		if rows := e.source(source); len(rows) > 0 {
			lanes = append(lanes, lane{Label: sourceLabel(source), Segments: rows})
		}
	}
	for _, s := range e.Segments {
		if sourceLabels[s.Source] == "" && (len(lanes) == 0 || lanes[len(lanes)-1].Label != s.Source) {
			lanes = append(lanes, lane{Label: s.Source, Segments: e.source(s.Source)})
		}
	}
	return lanes
}

func (e entry) source(source string) []segment {
	rows := []segment{}
	for _, s := range e.Segments {
		if s.Source == source {
			rows = append(rows, s)
		}
	}
	return rows
}

// Flagged lists the time ranges with findings, by start time. Touching segments of the same
// source with findings (such as consecutive sampled frames) are merged into one range that keeps
// each category's strongest finding.
func (e entry) Flagged() []segment {
	flagged := []segment{}
	for _, l := range e.Lanes() {
		for _, s := range l.Segments {
			if len(s.Findings) == 0 {
				continue
			}
			if n := len(flagged); n > 0 && flagged[n-1].Source == s.Source && s.Start <= flagged[n-1].End {
				last := &flagged[n-1]
				last.End = math.Max(last.End, s.End)
				last.Findings = strongest(append(append([]finding{}, last.Findings...), s.Findings...))
				continue
			}
			flagged = append(flagged, s)
		}
	}
	sort.SliceStable(flagged, func(i, j int) bool { return flagged[i].Start < flagged[j].Start })
	return flagged
}

// SourceLabel names the segment's source.
func (s segment) SourceLabel() string { return sourceLabel(s.Source) }

// Reasons lists each category found anywhere in the clip once, strongest first, as the reason
// shown next to a decision.
func (e entry) Reasons() []finding {
	all := []finding{}
	for _, s := range e.Segments {
		all = append(all, s.Findings...)
	}
	return strongest(all)
}

// strongest keeps each category's highest-scoring finding, strongest first.
func strongest(findings []finding) []finding {
	best := map[string]finding{}
	for _, f := range findings {
		if f.Score > best[f.Category].Score {
			best[f.Category] = f
		}
	}
	reasons := make([]finding, 0, len(best))
	for _, f := range best {
		reasons = append(reasons, f)
	}
	sort.Slice(reasons, func(i, j int) bool { return reasons[i].Score > reasons[j].Score })
	return reasons
}

var formatNames = map[string]string{
	"audio/wav": "WAV", "audio/x-wav": "WAV", "audio/wave": "WAV", "audio/mpeg": "MP3", "audio/flac": "FLAC",
	"audio/x-flac": "FLAC", "audio/aac": "AAC", "audio/mp4": "M4A", "audio/x-m4a": "M4A", "audio/ogg": "Ogg",
	"audio/opus": "Opus", "audio/aiff": "AIFF", "audio/x-aiff": "AIFF", "audio/x-ms-wma": "WMA",
	"video/mp4": "MP4", "video/quicktime": "MOV", "video/webm": "WebM", "video/x-matroska": "MKV",
	"video/x-msvideo": "AVI", "video/avi": "AVI", "video/mpeg": "MPEG", "video/mp2t": "MPEG-TS", "video/x-ms-wmv": "WMV",
}

// activity is one line in the activity panel: a decision the app picked up for a clip, and
// how (a status check or a webhook). A test delivery has no clip and the status "test".
type activity struct {
	Time, Name, Status, Via string
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
	activity  []activity
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
		mux.HandleFunc("GET /demo.js", a.script)
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
	policy := "default-src 'none'; style-src 'self' 'unsafe-inline'; media-src 'self' https: http://localhost:* http://127.0.0.1:*; form-action 'self'; frame-ancestors 'none'; script-src 'self'"
	if a.demo == nil {
		// The page's script and the SDK come from this server; uploads go to the CalmLens API.
		policy += "; connect-src 'self' " + origin(a.apiURL)
	} else {
		// The demo's script posts the clip to this server, with upload progress.
		policy += "; connect-src 'self'"
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
	_, err := a.refreshDecision(ctx, item)
	return err
}

// refreshDecision is refresh that also reports whether the clip has just been decided: it was
// uploading or pending, and is now decided or failed.
func (a *app) refreshDecision(ctx context.Context, item *entry) (bool, error) {
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
		item.Error = "Couldn't check this clip's status. Playback is paused until it can be checked."
		item.signedURL = ""
		return false, err
	}
	before := item.Status
	item.Status = clipStatus(asset)
	item.Duration, item.Segments = 0, nil
	if report := asset.Classification.Moderation; report.Timeline != nil {
		item.Duration, item.Segments = timeline(report.Timeline)
	}
	item.Error = ""
	if !playable(item.Status) {
		item.signedURL = ""
	}
	return (before == clipPending || before == clipUploading) && item.Status != clipPending && item.Status != clipUploading, nil
}

// Clip states shown on the page, derived from the asset's processing and moderation status. A
// decided clip shows its moderation status (allowed, limited, age-restricted, blocked or purged).
// Only allowed and limited clips play: a limited clip is delivered like an allowed one, and the page
// only collapses it behind a "show" control. This app has no age check, so it does not play
// age-restricted clips either.
const (
	clipUploading = "uploading"
	clipPending   = "pending"
	clipError     = "error"
)

// playable reports whether a clip with status may play.
func playable(status string) bool {
	return status == calmlens.ModerationStatusAllowed || status == calmlens.ModerationStatusLimited
}

// clipStatus reads the clip's state from the asset. Failed processing is final; statuses this
// app doesn't know count as still pending, so the clip never plays before it is allowed.
func clipStatus(asset *calmlens.Asset) string {
	switch status := asset.Classification.Moderation.Status; {
	case asset.Classification.Status == calmlens.ClassificationStatusFailed:
		return clipError
	case status == calmlens.ModerationStatusAllowed, status == calmlens.ModerationStatusLimited,
		status == calmlens.ModerationStatusAgeRestricted, status == calmlens.ModerationStatusBlocked, status == calmlens.ModerationStatusPurged:
		return status
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
		row := segment{Source: s.Source, Start: s.StartSeconds, End: s.EndSeconds}
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
	for i := range rows {
		// Overlapping chunks: draw each one up to where the next of the same source begins.
		for _, next := range rows[i+1:] {
			if next.Source == rows[i].Source {
				rows[i].Width = math.Max(0, math.Min(rows[i].Width, next.Left-rows[i].Left))
				break
			}
		}
	}
	return duration, rows
}

func clock(seconds float64) string {
	total := int(math.Round(seconds))
	return fmt.Sprintf("%d:%02d", total/60, total%60)
}

// statusLabels name each clip state on the page.
var statusLabels = map[string]string{
	clipUploading: "Uploading", clipPending: "Checking", clipError: "Failed",
	calmlens.ModerationStatusAllowed: "Approved", calmlens.ModerationStatusLimited: "Limited",
	calmlens.ModerationStatusAgeRestricted: "Age-restricted", calmlens.ModerationStatusBlocked: "Blocked",
	calmlens.ModerationStatusPurged: "Removed",
}

func label(status string) string {
	if name := statusLabels[status]; name != "" {
		return name
	}
	return status
}

// size formats a byte count for people: 940 KB, 12.4 MB.
func size(bytes int64) string {
	switch {
	case bytes >= 1024*1024:
		return fmt.Sprintf("%.1f MB", float64(bytes)/(1024*1024))
	case bytes >= 1024:
		return fmt.Sprintf("%d KB", (bytes+512)/1024)
	}
	return fmt.Sprintf("%d bytes", bytes)
}

// pct formats a timeline position for a style attribute.
func pct(value float64) template.CSS {
	return template.CSS(strconv.FormatFloat(value, 'f', 2, 64) + "%")
}

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
			if decided, err := a.refreshDecision(r.Context(), item); err == nil && decided {
				a.mu.Lock()
				a.record(item.Name, item.Status, "status check")
				a.mu.Unlock()
			}
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
	lines := append([]activity(nil), a.activity...)
	a.mu.Unlock()
	// The page's script reloads every three seconds while a clip is checked, but never during an
	// upload; without JavaScript the demo page refreshes itself instead (a <noscript> refresh).
	var body bytes.Buffer
	err := pageTemplate.Execute(&body, struct {
		Demo      bool
		CSRF      string
		Entries   []entry
		Pending   bool
		Activity  []activity
		Checking  int
		MaxMiB    int
		PartSize  int
		Threshold int
		Preset    string
		APIURL    string
	}{a.demo != nil, a.csrf, copies, pending, lines, checking(copies), maxClipBytes / (1024 * 1024), partSize, multipartThreshold, a.preset, a.apiURL})
	if err != nil {
		log.Printf("Render failed: %v", err)
		http.Error(w, "Could not render page", 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(body.Bytes())
}

// checking counts the clips still being uploaded or checked.
func checking(entries []entry) int {
	n := 0
	for _, item := range entries {
		if item.Status == clipPending || item.Status == clipUploading {
			n++
		}
	}
	return n
}

// demoChoice validates the explicitly selected demo outcome; live mode ignores it.
func (a *app) demoChoice(r *http.Request) (string, bool) {
	if a.demo == nil {
		return "", true
	}
	choice := r.FormValue("demo_result")
	switch choice {
	case calmlens.ModerationStatusAllowed, calmlens.ModerationStatusLimited, calmlens.ModerationStatusAgeRestricted, calmlens.ModerationStatusBlocked, calmlens.ModerationStatusPurged, clipError:
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

// script serves the page's upload script: the browser upload through the preset in live mode,
// or the demo's upload to this server.
func (a *app) script(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	if a.demo != nil {
		_, _ = w.Write(demoScript)
		return
	}
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
	if strings.HasSuffix(name, ".css") {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	} else {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	}
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

// send streams the clip privately and keeps the content so allowed clips can be played back.
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
	// A URL signed after a fresh allowed retrieve is reused until it nears expiry. Refreshes and
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
	if !playable(status) {
		http.Error(w, "This clip is not allowed", 403)
		return
	}
	if a.demo != nil {
		a.streamDemo(w, r, id, contentType)
		return
	}
	signed, err := a.client.Assets.CreateSignedURL(r.Context(), calmlens.SignedURLOptions{AssetID: id, Resource: calmlens.ResourceOriginal, ExpiresInSeconds: signedURLSeconds})
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
	if playable(item.Status) {
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
	w.Header().Set("Content-Type", contentType)
	if res.StatusCode == http.StatusOK {
		// The CDN sent the whole clip: answer the Range request here so players can still seek.
		data, err := io.ReadAll(res.Body)
		if err != nil {
			http.Error(w, "Playback unavailable", 502)
			return
		}
		http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(data))
		return
	}
	for _, name := range []string{"Content-Length", "Content-Range", "Accept-Ranges"} {
		if value := res.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}
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
	item.Status, item.Error = clipStatus(asset), ""
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
func (a *app) record(name, status, via string) {
	a.activity = append([]activity{{Time: time.Now().Format("15:04"), Name: name, Status: status, Via: via}}, a.activity...)
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
		a.record("", "test", event.Type)
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
		a.record(item.Name, item.Status, event.Type+" webhook")
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
