// Package calmlenstest provides an in-memory CalmLens fake for tests. It embeds the real
// client, so validation and request encoding run unchanged, and answers over an in-memory
// transport with the API's status codes and error bodies. It does not classify content or
// apply transforms. Import it only in tests.
package calmlenstest

import (
	"bytes"
	"cmp"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"runtime"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	calmlens "github.com/CalmLens/sdks/go"
	"github.com/CalmLens/sdks/go/internal/clock"
)

// Grant is one permission grant encoded into a mock API key by CreateMockAPIKey.
type Grant struct {
	Actions           []string `json:"actions"`
	FolderID          *string  `json:"folderId"`
	IncludeSubfolders bool     `json:"includeSubfolders"`
}

// CreateMockAPIKey returns a mock API key carrying grants, such as
// {Actions: []string{"assets:download"}} for CDN access to private and age-restricted assets.
func CreateMockAPIKey(grants []Grant) string {
	if grants == nil {
		grants = []Grant{}
	}
	b, _ := json.Marshal(grants)
	return "sk_test_" + base64.RawURLEncoding.EncodeToString(b)
}

// StoredContent is the uploaded content of one asset, by part number.
type StoredContent struct {
	Type  string
	Parts map[int][]byte
}

// InMemoryDatabaseStorage holds assets, folders, hash lists and hash list entries as
// API-shaped JSON maps. An asset's
// processing, moderation and content objects are nested calmlens.JSON maps, so a test can change
// them in place, such as
// db.Assets[id]["classification"].(calmlens.JSON)["moderation"].(calmlens.JSON)["status"] = "blocked".
type InMemoryDatabaseStorage struct {
	Assets          map[string]calmlens.JSON
	Folders         map[string]calmlens.JSON
	HashLists       map[string]calmlens.JSON
	HashListEntries map[string]calmlens.JSON
}

// InMemoryImageStorage holds uploaded content by asset ID.
type InMemoryImageStorage struct{ Content map[string]*StoredContent }

// Outcomes of mock uploads, for Options.QueuedOutcome and Options.AnalyzedOutcome.
const (
	// OutcomePending leaves the asset processing with moderation pending.
	OutcomePending = "pending"
	// OutcomeAllowed finishes processing with moderation allowed.
	OutcomeAllowed = "allowed"
	// OutcomeLimited finishes processing with moderation limited; the mock CDN serves the asset
	// like an allowed one.
	OutcomeLimited = "limited"
	// OutcomeAgeRestricted finishes processing with moderation age-restricted; the mock CDN then
	// serves the asset only to keys allowed to download it, like a private asset.
	OutcomeAgeRestricted = "age-restricted"
	// OutcomeBlocked finishes processing with moderation blocked.
	OutcomeBlocked = "blocked"
	// OutcomePurged finishes processing with moderation purged and removes the content with
	// removal reason policy.
	OutcomePurged = "purged"
	// OutcomeFailed fails processing (retryable) with moderation pending.
	OutcomeFailed = "failed"
)

// Options mirrors calmlens.Options (APIKey, ProjectID, BaseURL, CDNBaseURL, Timeout,
// MaxRetries) and adds in-memory storage and deterministic ID/clock/outcome controls.
type Options struct {
	APIKey    string
	ProjectID string
	// BaseURL and Timeout are validated and applied exactly as by calmlens.NewServerClient; requests
	// never leave the process.
	BaseURL string
	Timeout time.Duration
	// MaxRetries defaults to 0 in the mock, so FailNext fails exactly one call. Set it to
	// test the client's retry behaviour. Waits take no real time: retry backoff and
	// Assets.WaitForDecision only advance the mock client's clock, so WaitForDecision returns
	// sdk/timeout at once for an asset whose moderation stays pending.
	MaxRetries      *int
	DatabaseStorage *InMemoryDatabaseStorage
	ImageStorage    *InMemoryImageStorage
	// CreateID returns a new ID for an object of the kind prefix names ("asset", "fldr", "hl",
	// "hle", "lens", "evt" or "rev"). The default is like the API's: the prefix, "_" and 20
	// random base62 characters, such as asset_5Gm2Rk8XqT3wLp9VbN4c.
	CreateID func(prefix string) string
	// Now returns the current time in unix milliseconds. The default clock is the wall clock,
	// advanced by at least 1 ms per reading so assets created in a row have strictly increasing
	// createdAt values; a Now you supply is used as is.
	Now func() int64
	// QueuedOutcome is the Outcome constant of queued uploads (Assets.Create and queued
	// multipart uploads; default OutcomePending).
	QueuedOutcome string
	// AnalyzedOutcome is the Outcome constant of moderated uploads (Assets.Classify and
	// Text.Classify; default OutcomeAllowed). Finished processing removes content unless the
	// upload set ProcessingOptions.KeepContentAfterProcessing.
	AnalyzedOutcome  string
	CDNBaseURL       string
	SignedURLBaseURL string
}

// CapturedRequest is a request the client sent to the mock, already decoded.
type CapturedRequest struct {
	Method string
	// Path is unescaped and relative to the API base URL (or the CDN base URL when CDN is
	// true), for example "/projects/my-project/assets".
	Path   string
	Query  url.Values
	Header http.Header
	// Body is the decoded JSON body, or nil for empty and raw upload bodies.
	Body calmlens.JSON
	// RawBody holds the exact bytes sent, including upload content.
	RawBody []byte
	CDN     bool
}

type upload struct {
	queue     bool
	totalSize *int64
}

type replay struct {
	fingerprint string
	status      int
	data        []byte
}

// MockServerClient is a calmlens.ServerClient backed by in-memory storage.
type MockServerClient struct {
	*calmlens.ServerClient
	// DatabaseStorage and ImageStorage can be inspected or seeded between calls; do not
	// mutate them concurrently with requests.
	DatabaseStorage *InMemoryDatabaseStorage
	ImageStorage    *InMemoryImageStorage
	options         Options
	basePath        string
	cdnPath         string
	lenses          map[string]calmlens.JSON
	uploads         map[string]*upload
	events          []calmlens.JSON
	replays         map[string]replay
	requests        []CapturedRequest
	failures        []failure
	grants          []Grant
	requestCount    int
	// lastStatus is the HTTP status of the last response, 0 when the last request failed
	// without one; the contract tests check it.
	lastStatus int
	// status overrides successStatus for the request being answered, 0 when it does not.
	status int
	// waited is the time the client has spent waiting; mock waits advance it instead of sleeping.
	waited time.Duration
	mu     sync.Mutex
}

// failure is a queued request failure: a transport error, or an API error code with its status.
type failure struct {
	err       error
	code      string
	operation string
}

// FailNext queues transport failures. Each following request is captured and then fails
// with the next queued error instead of reaching the in-memory backend, so the client
// returns a *calmlens.Error with code "sdk/transport-error" wrapping it. Queue
// context.DeadlineExceeded (or a net.Error whose Timeout() is true) to get "sdk/timeout".
func (m *MockServerClient) FailNext(errs ...error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, err := range errs {
		m.failures = append(m.failures, failure{err: err})
	}
}

// Failures for FailNextRequest besides API error codes.
const (
	// FailureTransportError fails the request as a reset connection would (sdk/transport-error).
	FailureTransportError = "transport-error"
	// FailureTimeout fails the request as an expired deadline would (sdk/timeout).
	FailureTimeout = "timeout"
)

// FailNextRequest makes the next request, or the next request of operation (a JavaScript client
// method path such as "assets.create" or "cdn.serve"; empty for any), fail without running.
// failure is FailureTransportError, FailureTimeout or an API error code, which the mock answers
// with its HTTP status. Each queued failure is used once.
func (m *MockServerClient) FailNextRequest(failure string, operation string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	queued := failureFor(failure)
	queued.operation = operation
	m.failures = append(m.failures, queued)
}

func failureFor(name string) failure {
	switch name {
	case FailureTransportError:
		return failure{err: errors.New("mock transport error")}
	case FailureTimeout:
		return failure{err: context.DeadlineExceeded}
	}
	return failure{code: name}
}

// SetAPIKeyGrants replaces the grants of the mock's API key, as editing the key in the portal
// would: later requests, such as CDN.Serve, use them. The key itself stays the same, so its
// idempotency keys still replay.
func (m *MockServerClient) SetAPIKeyGrants(grants []Grant) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.grants = append([]Grant{}, grants...)
}

// Requests returns a copy of every request sent so far, oldest first.
func (m *MockServerClient) Requests() []CapturedRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]CapturedRequest(nil), m.requests...)
}

// ClearRequests forgets captured requests.
func (m *MockServerClient) ClearRequests() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requests = nil
}

// WithStorage runs fn while holding the mock's lock, so storage can be changed safely
// while other goroutines send requests.
func (m *MockServerClient) WithStorage(fn func(db *InMemoryDatabaseStorage, images *InMemoryImageStorage)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	fn(m.DatabaseStorage, m.ImageStorage)
}

// EnqueueEvent appends events to the mock event feed and returns them as stored. Missing IDs,
// project IDs, severities (low), titles (the type), facts and creation times are filled in.
// Events.List returns them to cursors taken before they were enqueued, in order.
func (m *MockServerClient) EnqueueEvent(events ...calmlens.Event) []calmlens.Event {
	m.mu.Lock()
	defer m.mu.Unlock()
	stored := []calmlens.Event{}
	for _, event := range events {
		if event.Severity == "" {
			event.Severity = calmlens.SeverityLow
		}
		if event.Title == "" {
			event.Title = event.Type
		}
		if event.ID == "" {
			event.ID = m.options.CreateID("evt")
		}
		if event.ProjectID == "" {
			event.ProjectID = m.options.ProjectID
		}
		if event.CreatedAt == 0 {
			event.CreatedAt = m.options.Now()
		}
		if event.UpdatedAt == nil {
			event.UpdatedAt = calmlens.Ptr(event.CreatedAt)
		}
		if event.Facts == nil {
			event.Facts = []calmlens.EventFact{}
		}
		data, _ := json.Marshal(event)
		var raw calmlens.JSON
		_ = json.Unmarshal(data, &raw)
		m.events = append(m.events, raw)
		var copied calmlens.Event
		_ = json.Unmarshal(data, &copied)
		stored = append(stored, copied)
	}
	return stored
}

// Decide applies a reviewer's decision (calmlens.ModerationStatusAllowed, ...Limited,
// ...AgeRestricted, ...Blocked or ...Purged) to a stored asset, as the portal or API would: the moderation status
// changes (purged also removes the content with removal reason requested, recording an
// asset.content-removed event first), the review joins manualReviews, and an "asset.<decision>"
// event with a decided-by: reviewer fact joins the events feed. It returns a *calmlens.Error with
// code asset/not-found for an unknown asset.
func (m *MockServerClient) Decide(assetID, decision string) (*calmlens.Asset, error) {
	switch decision {
	case OutcomeAllowed, OutcomeLimited, OutcomeAgeRestricted, OutcomeBlocked, OutcomePurged:
	default:
		return nil, &calmlens.Error{Code: calmlens.CodeSDKInvalidArgument, Message: "Unknown review decision " + strconv.Quote(decision)}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	a, err := m.asset(assetID)
	if err != nil {
		return nil, &calmlens.Error{Code: calmlens.CodeAssetNotFound, Message: "Asset not found", Status: http.StatusNotFound}
	}
	m.applyOutcome(a, decision, calmlens.ContentRemovalReasonRequested)
	now := m.options.Now()
	moderation := section(section(a, "classification"), "moderation")
	reviews, _ := moderation["manualReviews"].([]any)
	moderation["manualReviews"] = append(reviews, calmlens.JSON{
		"id": m.options.CreateID("rev"), "decision": decision, "note": nil, "reviewerUserId": nil,
		"reviewedAt": now, "appliedToAsset": true,
	})
	if decision == OutcomePurged {
		m.recordLifecycleEvent(calmlens.EventAssetContentRemoved, a)
	}
	// Like the event catalog: only allowing and limiting are low severity.
	severity := calmlens.SeverityHigh
	if decision == OutcomeAllowed || decision == OutcomeLimited {
		severity = calmlens.SeverityLow
	}
	m.addEvent("asset."+decision, severity, a, []any{
		calmlens.JSON{"key": calmlens.FactDecidedBy, "value": calmlens.DecidedByReviewer},
		calmlens.JSON{"key": calmlens.FactAssetType, "value": a["type"]},
		calmlens.JSON{"key": calmlens.FactAssetName, "value": a["name"], "url": "https://calmlens.com/go/asset/" + assetID},
		calmlens.JSON{"key": calmlens.FactNote, "value": nil},
	})
	data, _ := json.Marshal(a)
	var asset calmlens.Asset
	if err := json.Unmarshal(data, &asset); err != nil {
		return nil, err
	}
	return &asset, nil
}

// addEvent records an event about asset in the feed.
func (m *MockServerClient) addEvent(eventType, severity string, a calmlens.JSON, facts []any) {
	now := m.options.Now()
	m.events = append(m.events, calmlens.JSON{
		"id": m.options.CreateID("evt"), "projectId": m.options.ProjectID, "userId": nil,
		"type": eventType, "severity": severity, "title": eventType,
		"description": nil, "assetId": a["id"], "asset": snapshot(a),
		"facts": facts, "notify": false, "createdAt": now, "updatedAt": now, "readAt": nil,
	})
}

// recordLifecycleEvent adds an asset.deleted, asset.content-removed or asset.retried event, like
// the API. A deleted asset has no portal page to link its name to.
func (m *MockServerClient) recordLifecycleEvent(eventType string, a calmlens.JSON) {
	name := calmlens.JSON{"key": calmlens.FactAssetName, "value": a["name"]}
	if eventType != calmlens.EventAssetDeleted {
		name["url"] = "https://calmlens.com/go/asset/" + text(a["id"])
	}
	m.addEvent(eventType, calmlens.SeverityLow, a, []any{name, calmlens.JSON{"key": calmlens.FactAssetType, "value": a["type"]}})
}

// snapshot is the asset summary events carry.
func snapshot(a calmlens.JSON) calmlens.JSON {
	return calmlens.JSON{
		"id": a["id"], "externalId": a["externalId"], "uploadPresetId": a["uploadPresetId"],
		"upload":  calmlens.JSON{"status": section(a, "upload")["status"]},
		"content": calmlens.JSON{"status": section(a, "content")["status"]},
		"classification": calmlens.JSON{
			"status":     section(a, "classification")["status"],
			"moderation": calmlens.JSON{"status": section(section(a, "classification"), "moderation")["status"]},
		},
	}
}

// NewServerClient returns a mock client. Invalid options are rejected like calmlens.NewServerClient.
func NewServerClient(options Options) (*MockServerClient, error) {
	if options.ProjectID == "" {
		options.ProjectID = "mock-project"
	}
	if options.APIKey == "" {
		options.APIKey = CreateMockAPIKey(nil)
	}
	if options.CreateID == nil {
		options.CreateID = newID
	}
	if options.Now == nil {
		var last atomic.Int64
		options.Now = func() int64 {
			for {
				previous := last.Load()
				next := max(time.Now().UnixMilli(), previous+1)
				if last.CompareAndSwap(previous, next) {
					return next
				}
			}
		}
	}
	if options.QueuedOutcome == "" {
		options.QueuedOutcome = OutcomePending
	}
	if options.AnalyzedOutcome == "" {
		options.AnalyzedOutcome = OutcomeAllowed
	}
	for _, outcome := range []string{options.QueuedOutcome, options.AnalyzedOutcome} {
		switch outcome {
		case OutcomePending, OutcomeAllowed, OutcomeLimited, OutcomeAgeRestricted, OutcomeBlocked, OutcomePurged, OutcomeFailed:
		default:
			return nil, &calmlens.Error{Code: calmlens.CodeSDKInvalidArgument, Message: "Unknown mock outcome " + strconv.Quote(outcome)}
		}
	}
	if options.CDNBaseURL == "" {
		options.CDNBaseURL = "https://mock.calmlens.invalid/v1"
	}
	if options.SignedURLBaseURL == "" {
		options.SignedURLBaseURL = "https://mock.calmlens.invalid"
	}
	if options.MaxRetries == nil {
		options.MaxRetries = calmlens.Ptr(0)
	}
	db := options.DatabaseStorage
	if db == nil {
		db = &InMemoryDatabaseStorage{}
	}
	if db.Assets == nil {
		db.Assets = map[string]calmlens.JSON{}
	}
	if db.Folders == nil {
		db.Folders = map[string]calmlens.JSON{}
	}
	if db.HashLists == nil {
		db.HashLists = map[string]calmlens.JSON{}
	}
	if db.HashListEntries == nil {
		db.HashListEntries = map[string]calmlens.JSON{}
	}
	images := options.ImageStorage
	if images == nil {
		images = &InMemoryImageStorage{}
	}
	if images.Content == nil {
		images.Content = map[string]*StoredContent{}
	}
	mock := &MockServerClient{DatabaseStorage: db, ImageStorage: images, options: options, lenses: map[string]calmlens.JSON{}, uploads: map[string]*upload{}, replays: map[string]replay{}}
	client, err := calmlens.NewServerClient(calmlens.Options{APIKey: options.APIKey, ProjectID: options.ProjectID, BaseURL: options.BaseURL, CDNBaseURL: options.CDNBaseURL, Timeout: options.Timeout, MaxRetries: options.MaxRetries, HTTPClient: &http.Client{Transport: transport{mock}}})
	if err != nil {
		return nil, err
	}
	base := options.BaseURL
	if base == "" {
		base = "https://api.calmlens.com/v1"
	}
	parsed, _ := url.Parse(base) // validated by calmlens.NewServerClient
	mock.basePath = strings.TrimRight(parsed.EscapedPath(), "/")
	mock.options.CDNBaseURL = strings.TrimRight(options.CDNBaseURL, "/")
	cdn, _ := url.Parse(mock.options.CDNBaseURL)
	mock.cdnPath = strings.TrimRight(cdn.EscapedPath(), "/")
	start := time.Now()
	clock.Set(client, func() time.Time {
		mock.mu.Lock()
		defer mock.mu.Unlock()
		return start.Add(mock.waited)
	}, func(ctx context.Context, d time.Duration) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		mock.mu.Lock()
		mock.waited += d
		mock.mu.Unlock()
		runtime.Gosched()
		return nil
	})
	clock.DeferUploadChecks(client)
	mock.grants = keyGrants(options.APIKey)
	mock.ServerClient = client
	return mock, nil
}

// SignUploadToken signs an upload token with apiKey as UploadTokens.Sign does (with the same
// checks), but at now and with nonce, so a test can compare exact tokens.
func SignUploadToken(apiKey string, options calmlens.SignUploadTokenOptions, now time.Time, nonce string) (*calmlens.SignedUploadToken, error) {
	signed, err := clock.SignUploadToken(apiKey, options, now, nonce)
	if err != nil {
		return nil, err
	}
	return signed.(*calmlens.SignedUploadToken), nil
}

// keyGrants decodes the grants CreateMockAPIKey put in a key; other keys have none.
func keyGrants(apiKey string) []Grant {
	data, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(apiKey, "sk_test_"))
	if err != nil {
		return nil
	}
	var grants []Grant
	if json.Unmarshal(data, &grants) != nil {
		return nil
	}
	return grants
}

// transport answers the embedded client's requests from memory. It is unexported so the
// mock does not expose a RoundTrip method.
type transport struct{ m *MockServerClient }

// RoundTrip implements http.RoundTripper.
func (t transport) RoundTrip(req *http.Request) (*http.Response, error) {
	var raw []byte
	var err error
	if req.Body != nil {
		raw, err = io.ReadAll(req.Body)
		req.Body.Close()
		if err != nil {
			return nil, err
		}
	}
	return t.m.roundTrip(req, raw)
}

// apiError is an API failure with the status the API uses for its code.
type apiError struct {
	code    string
	status  int
	details calmlens.JSON
}

func (e *apiError) Error() string { return e.code }

func fail(code string) error {
	status, ok := calmlens.PublicErrorStatus(code)
	if !ok {
		status = http.StatusBadRequest
	}
	return &apiError{code: code, status: status}
}

func (m *MockServerClient) roundTrip(req *http.Request, raw []byte) (*http.Response, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	res, err := m.answer(req, raw)
	m.lastStatus = 0
	if res != nil {
		m.lastStatus = res.StatusCode
	}
	return res, err
}

// answer captures the request and answers it from memory; the caller holds m.mu.
func (m *MockServerClient) answer(req *http.Request, raw []byte) (*http.Response, error) {
	if err := req.Context().Err(); err != nil {
		return nil, err
	}
	cdn := strings.HasPrefix(req.URL.String(), m.options.CDNBaseURL+"/")
	prefix := m.basePath
	if cdn {
		prefix = m.cdnPath
	}
	escaped := strings.Split(strings.Trim(strings.TrimPrefix(req.URL.EscapedPath(), prefix), "/"), "/")
	parts := make([]string, len(escaped))
	for i := range escaped {
		parts[i], _ = url.PathUnescape(escaped[i])
	}
	captured := CapturedRequest{Method: req.Method, Path: "/" + strings.Join(parts, "/"), Query: req.URL.Query(), Header: req.Header.Clone(), RawBody: raw, CDN: cdn}
	if req.Header.Get("Content-Type") == "application/json" && len(raw) > 0 {
		_ = json.Unmarshal(raw, &captured.Body)
	}
	m.requests = append(m.requests, captured)
	m.requestCount++
	header := http.Header{"X-Request-Id": {fmt.Sprintf("req_mock_%d", m.requestCount)}}
	operations := operationsOf(req.Method, parts, req.URL.Query(), cdn)
	for index, queued := range m.failures {
		if queued.operation != "" && !contains(operations, queued.operation) {
			continue
		}
		m.failures = append(m.failures[:index:index], m.failures[index+1:]...)
		if queued.err != nil {
			return nil, queued.err
		}
		return m.jsonResponse(req, header, nil, fail(queued.code)), nil
	}
	if cdn {
		status, data, contentType := m.serve(req, parts, header)
		return response(req, status, header, contentType, data), nil
	}
	if req.Header.Get("X-Api-Key") != m.options.APIKey {
		return m.jsonResponse(req, header, nil, fail(calmlens.CodeInvalidAPIKey)), nil
	}
	// HTTP stacks trim header values, so the API sees the key without surrounding whitespace.
	key := strings.Trim(req.Header.Get("Idempotency-Key"), " \t\r\n")
	// Like the API, raw uploads are compared by query, Content-Type and length, not bytes.
	compared := ""
	if req.Header.Get("Content-Type") == "application/json" {
		compared = string(raw)
	}
	fingerprint := strings.Join([]string{req.Method, req.URL.EscapedPath(), req.URL.RawQuery, req.Header.Get("Content-Type"), req.Header.Get("X-Calmlens-Upload"), strconv.Itoa(len(raw)), compared}, "\n")
	if len(req.Header.Values("Idempotency-Key")) > 0 {
		if !validIdempotencyKey(key) {
			return m.jsonResponse(req, header, nil, fail(calmlens.CodeInvalidIdempotencyKey)), nil
		}
		if saved, ok := m.replays[key]; ok {
			if saved.fingerprint != fingerprint {
				return m.jsonResponse(req, header, nil, fail(calmlens.CodeIdempotencyKeyReused)), nil
			}
			header.Set("Idempotent-Replayed", "true")
			return response(req, saved.status, header, "application/json", saved.data), nil
		}
	}
	m.status = 0
	result, err := m.dispatch(req.Method, parts, req.URL.Query(), raw, req.Header)
	res := m.jsonResponse(req, header, result, err)
	if err == nil {
		status := successStatus(operations)
		if m.status != 0 {
			status = m.status
		}
		setStatus(res, status)
	}
	// A failed request frees its key, like the API.
	if key != "" && err == nil {
		data, _ := json.Marshal(result)
		m.replays[key] = replay{fingerprint: fingerprint, status: res.StatusCode, data: data}
	}
	return res, nil
}

// validIdempotencyKey is the API's rule for a trimmed key: 1 to 255 printable ASCII characters,
// without a space at either end.
func validIdempotencyKey(key string) bool {
	if key == "" || len(key) > 255 || key[0] == ' ' || key[len(key)-1] == ' ' {
		return false
	}
	for i := 0; i < len(key); i++ {
		if key[i] < 0x20 || key[i] > 0x7e {
			return false
		}
	}
	return true
}

// operationsOf names the JavaScript client methods a request can come from, for
// FailNextRequest.
func operationsOf(method string, parts []string, q url.Values, cdn bool) []string {
	if cdn {
		return []string{"cdn.serve"}
	}
	if len(parts) >= 3 && parts[0] == "projects" {
		switch route := strings.Join(parts[2:], "/"); {
		case route == "events":
			return []string{"events.list", "events.pages"}
		case route == "lenses":
			return []string{"ensureLenses", "ensureLens"}
		case route == "folders" && method == "GET":
			return []string{"folders.list"}
		case route == "folders":
			return []string{"folders.create"}
		case route == "hash-lists" && method == "GET":
			return []string{"hashLists.list"}
		case route == "hash-lists":
			return []string{"hashLists.create"}
		case route == "assets/page":
			return []string{"assets.list", "assets.iterate"}
		case route == "assets/search":
			return []string{"assets.search"}
		case route == "assets/batch":
			return []string{"assets.batch"}
		case route == "assets" && q.Get("queue") == "false":
			return []string{"assets.classify", "text.classify"}
		case route == "assets":
			return []string{"assets.create"}
		}
		return nil
	}
	if len(parts) < 2 {
		return nil
	}
	suffix := strings.Join(parts[2:], "/")
	switch {
	case parts[0] == "hash-list-entries":
		return []string{"hashLists.removeEntry"}
	case parts[0] == "hash-lists" && suffix == "entries" && method == "GET":
		return []string{"hashLists.listEntries"}
	case parts[0] == "hash-lists" && suffix == "entries":
		return []string{"hashLists.addEntry"}
	case parts[0] == "hash-lists" && method == "GET":
		return []string{"hashLists.retrieve"}
	case parts[0] == "hash-lists" && method == "PATCH":
		return []string{"hashLists.update"}
	case parts[0] == "hash-lists":
		return []string{"hashLists.delete"}
	}
	if parts[0] == "folders" {
		switch {
		case suffix == "move":
			return []string{"folders.move"}
		case method == "GET":
			return []string{"folders.retrieve"}
		case method == "PATCH":
			return []string{"folders.update"}
		case method == "DELETE":
			return []string{"folders.delete"}
		}
		return nil
	}
	switch {
	case suffix == "" && method == "GET":
		return []string{"assets.retrieve", "assets.waitForDecision"}
	case suffix == "" && method == "PATCH":
		return []string{"assets.update"}
	case suffix == "" && method == "DELETE":
		return []string{"assets.delete"}
	case suffix == "content":
		return []string{"assets.deleteContent"}
	case suffix == "children":
		return []string{"assets.listChildren", "assets.iterateChildren"}
	case suffix == "signed-url":
		return []string{"assets.createSignedUrl"}
	case suffix == "part":
		return []string{"assets.uploadPart"}
	}
	return []string{"assets." + suffix}
}

// jsonResponse encodes result, or err as the API's error body and status.
func (m *MockServerClient) jsonResponse(req *http.Request, header http.Header, result any, err error) *http.Response {
	status := http.StatusOK
	if err != nil {
		var failure *apiError
		if !errors.As(err, &failure) {
			failure = &apiError{code: calmlens.CodeInvalidUploadPayload, status: http.StatusBadRequest}
		}
		status = failure.status
		body := calmlens.JSON{"code": failure.code, "message": err.Error()}
		if failure.details != nil {
			body["details"] = failure.details
		}
		result = body
	}
	data, _ := json.Marshal(result)
	return response(req, status, header, "application/json", data)
}

// successStatus is the status the API answers a successful request with: 201 Created for a new
// folder or hash list, 202 Accepted for a queued batch, otherwise 200 OK. Adding a hash list
// entry sets its own status.
func successStatus(operations []string) int {
	switch {
	case contains(operations, "folders.create"), contains(operations, "hashLists.create"):
		return http.StatusCreated
	case contains(operations, "assets.batch"):
		return http.StatusAccepted
	}
	return http.StatusOK
}

func setStatus(res *http.Response, status int) {
	res.StatusCode = status
	res.Status = fmt.Sprintf("%d %s", status, http.StatusText(status))
}

func response(req *http.Request, status int, header http.Header, contentType string, data []byte) *http.Response {
	if contentType != "" {
		header.Set("Content-Type", contentType)
	}
	header.Set("Content-Length", strconv.Itoa(len(data)))
	body := data
	if req.Method == http.MethodHead {
		body = nil
	}
	return &http.Response{
		Status: fmt.Sprintf("%d %s", status, http.StatusText(status)), StatusCode: status,
		Proto: "HTTP/1.1", ProtoMajor: 1, ProtoMinor: 1, Header: header,
		Body: io.NopCloser(bytes.NewReader(body)), ContentLength: int64(len(data)), Request: req,
	}
}

func (m *MockServerClient) asset(id string) (calmlens.JSON, error) {
	a := m.DatabaseStorage.Assets[id]
	if a == nil || a["projectId"] != m.options.ProjectID {
		return nil, fail(calmlens.CodeAssetNotFound)
	}
	return a, nil
}

func (m *MockServerClient) folder(id string) (calmlens.JSON, error) {
	f := m.DatabaseStorage.Folders[id]
	if f == nil || f["projectId"] != m.options.ProjectID {
		return nil, fail(calmlens.CodeFolderNotFound)
	}
	return f, nil
}

func (m *MockServerClient) unique(name, parent, exclude any) error {
	for id, f := range m.DatabaseStorage.Folders {
		if id != exclude && f["projectId"] == m.options.ProjectID && f["name"] == name && f["parentId"] == parent {
			return fail(calmlens.CodeDuplicateFolderName)
		}
	}
	return nil
}

func text(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

func number(value any) float64 {
	n, _ := asNumber(value)
	return n
}

var errUnknownRoute = &apiError{code: "mock/unknown-route", status: http.StatusNotFound}

// validation is a request the API's schema refuses: validation/<issue> with HTTP 400 and the
// field in details.path.
func validation(code, path string) error {
	return &apiError{code: code, status: http.StatusBadRequest, details: calmlens.JSON{"path": path}}
}

// intRange reads an integer query parameter that must be within [low, high], or fallback when
// it is absent.
func intRange(q url.Values, name string, fallback, low, high int) (int, error) {
	value := q.Get(name)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	switch {
	case err != nil:
		return 0, validation("validation/invalid-type", name)
	case parsed < low:
		return 0, validation("validation/too-small", name)
	case parsed > high:
		return 0, validation("validation/too-big", name)
	}
	return parsed, nil
}

const (
	defaultEventsLimit  = 50
	maxEventsLimit      = 100
	maxPageSize         = 100
	maxSearchLimit      = 20
	maxSearchQuery      = 200
	maxFolderPageSize   = 100
	minMultipartPart    = 5 * 1024 * 1024
	minMultipartImage   = 10 * 1024 * 1024
	maxMultipartImage   = 20 * 1024 * 1024
	imageCacheLifetime  = 31536000
	mockThumbHash       = "1QcSHQRnh493V4dIh4eXh1h4kJUI"
	mockAverageColor    = "#7f7f7f"
	defaultContentType  = "application/octet-stream"
	cdnProtectionPolicy = "sandbox; default-src 'none'"
)

func (m *MockServerClient) dispatch(method string, parts []string, q url.Values, raw []byte, headers http.Header) (any, error) {
	body := calmlens.JSON{}
	if headers.Get("Content-Type") == "application/json" && len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			return nil, fail(calmlens.CodeInvalidUploadPayload)
		}
	}
	now := m.options.Now()
	if len(parts) < 2 {
		return nil, errUnknownRoute
	}
	if parts[0] == "projects" && len(parts) >= 3 {
		if parts[1] != m.options.ProjectID {
			return nil, fail(calmlens.CodeAPIKeyProjectMismatch)
		}
		route := strings.Join(parts[2:], "/")
		switch {
		case route == "events" && method == "GET":
			return m.listEvents(q)
		case route == "lenses" && method == "PUT":
			return m.ensureLenses(body, now)
		case route == "folders" && method == "GET":
			return m.listFolders(q)
		case route == "folders" && method == "POST":
			return m.createFolder(body, now)
		case route == "hash-lists" && method == "GET":
			return m.listHashLists(), nil
		case route == "hash-lists" && method == "POST":
			return m.createHashList(body, now)
		case route == "assets/page" && method == "GET":
			folder, hasFolder := q["folderId"]
			return m.page(func(a calmlens.JSON) bool { return !hasFolder || a["folderId"] == folder[0] }, q, "assets:"+q.Get("filter")+":"+strings.Join(folder, ""))
		case route == "assets/search" && method == "GET":
			return m.search(q)
		case route == "assets/batch" && method == "POST":
			return m.batchAssets(body, now)
		case route == "assets" && method == "POST":
			return m.createAsset(headers.Get("X-CalmLens-Upload"), body, q, raw, now)
		}
		return nil, errUnknownRoute
	}
	id := parts[1]
	suffix := strings.Join(parts[2:], "/")
	switch parts[0] {
	case "assets":
		return m.assetRoute(method, id, suffix, body, q, raw, now)
	case "folders":
		return m.folderRoute(method, id, suffix, body, now)
	case "hash-lists":
		return m.hashListRoute(method, id, suffix, body, q, now)
	case "hash-list-entries":
		entry := m.DatabaseStorage.HashListEntries[id]
		if method != "DELETE" || suffix != "" {
			return nil, errUnknownRoute
		}
		if entry == nil || entry["projectId"] != m.options.ProjectID {
			return nil, fail(calmlens.CodeHashListEntryNotFound)
		}
		delete(m.DatabaseStorage.HashListEntries, id)
		return calmlens.JSON{}, nil
	}
	return nil, errUnknownRoute
}

// listEvents reads the feed like the API: without after, no events and a cursor for now; with
// after, up to limit (default 50, at most 100) events added since, oldest first.
func (m *MockServerClient) listEvents(q url.Values) (any, error) {
	limit, err := intRange(q, "limit", defaultEventsLimit, 1, maxEventsLimit)
	if err != nil {
		return nil, err
	}
	// Cursors are "<sequence>_mock": the number of events already delivered.
	position := len(m.events)
	if after := q.Get("after"); after != "" {
		sequence, ok := strings.CutSuffix(after, "_mock")
		parsed, err := strconv.Atoi(sequence)
		if !ok || err != nil || parsed < 0 || parsed > len(m.events) {
			failure := fail(calmlens.CodeInvalidEventCursor).(*apiError)
			failure.details = calmlens.JSON{"after": after}
			return nil, failure
		}
		position = parsed
	} else {
		return calmlens.JSON{"events": []calmlens.JSON{}, "cursor": fmt.Sprintf("%d_mock", position), "hasMore": false}, nil
	}
	end := min(position+limit, len(m.events))
	events := append([]calmlens.JSON{}, m.events[position:end]...)
	return calmlens.JSON{"events": events, "cursor": fmt.Sprintf("%d_mock", end), "hasMore": end < len(m.events)}, nil
}

// ensureLenses saves each definition in order like the API: a new identifier is created, an
// unchanged definition returns the stored lens, and a change needs a greater version. Lenses
// before a conflict stay saved.
func (m *MockServerClient) ensureLenses(body calmlens.JSON, now int64) (any, error) {
	definitions, _ := body["lenses"].([]any)
	result := []calmlens.JSON{}
	for _, value := range definitions {
		definition, ok := value.(map[string]any)
		if !ok {
			return nil, fail(calmlens.CodeInvalidUploadPayload)
		}
		id := text(definition["identifier"])
		old := m.lenses[id]
		if old == nil {
			lens := calmlens.JSON{"id": m.options.CreateID("lens"), "projectId": m.options.ProjectID, "userId": nil, "createdAt": now, "updatedAt": now}
			for key, item := range definition {
				lens[key] = item
			}
			m.lenses[id] = lens
			result = append(result, lens)
			continue
		}
		same := true
		for _, key := range []string{"name", "description", "type", "active", "transforms", "version"} {
			a, _ := json.Marshal(old[key])
			b, _ := json.Marshal(definition[key])
			same = same && bytes.Equal(a, b)
		}
		switch {
		case same:
			result = append(result, old)
		case number(definition["version"]) > number(old["version"]):
			lens := calmlens.JSON{}
			for key, item := range old {
				lens[key] = item
			}
			for key, item := range definition {
				lens[key] = item
			}
			lens["updatedAt"] = now
			m.lenses[id] = lens
			result = append(result, lens)
		default:
			failure := fail(calmlens.CodeLensVersionConflict).(*apiError)
			failure.details = calmlens.JSON{"currentVersion": old["version"], "minimumVersion": number(old["version"]) + 1, "requestedVersion": definition["version"]}
			return nil, failure
		}
	}
	return calmlens.JSON{"lenses": result}, nil
}

// createAsset handles POST .../assets. The X-CalmLens-Upload header picks the mode: absent is
// a JSON body, "content" raw file content and "part" the raw first part of a multipart upload.
func (m *MockServerClient) createAsset(mode string, body calmlens.JSON, q url.Values, raw []byte, now int64) (any, error) {
	multipart := mode == "part"
	options := body
	if mode == "content" || multipart {
		options = calmlens.JSON{}
		for key, values := range q {
			value := values[0]
			if key == "metadata" || key == "processingOptions" || key == "context" {
				var parsed any
				if err := json.Unmarshal([]byte(value), &parsed); err != nil {
					return nil, fail(calmlens.CodeInvalidUploadPayload)
				}
				options[key] = parsed
			} else {
				options[key] = value
			}
		}
		if size := q.Get("sizeInBytes"); size != "" && size != strconv.Itoa(len(raw)) {
			return nil, fail(calmlens.CodeInvalidUploadPayload)
		}
	}
	if text(options["name"]) == "" {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	mime := q.Get("contentType")
	kind := calmlens.AssetTypeFile
	if options["url"] != nil {
		kind = calmlens.AssetTypeWebsite
	} else {
		for _, prefix := range []string{"image", "video", "audio"} {
			if strings.HasPrefix(mime, prefix+"/") {
				kind = prefix
			}
		}
		if strings.HasPrefix(mime, "text/") {
			kind = calmlens.AssetTypePlaintextDocument
		}
		if strings.Contains(mime, "pdf") || strings.Contains(mime, "document") {
			kind = calmlens.AssetTypeMultimediaDocument
		}
	}
	queue := q.Get("queue") == "true"
	open := multipart && q.Get("isFinal") != "true"
	var total *int64
	if multipart {
		if declared := q.Get("totalSizeInBytes"); declared != "" {
			size, err := strconv.ParseInt(declared, 10, 64)
			if err != nil {
				return nil, fail(calmlens.CodeInvalidUploadPayload)
			}
			total = &size
		}
		// Like the API: a declared total is checked before anything is stored, then a single
		// final part as the whole upload, then the part itself.
		if total != nil {
			if err := imageSizeError(kind, *total, true); err != nil {
				return nil, err
			}
		}
		if !open {
			if err := totalSizeError(total, int64(len(raw)), true); err != nil {
				return nil, err
			}
			if err := imageSizeError(kind, int64(len(raw)), true); err != nil {
				return nil, err
			}
		}
		if err := partSizeError(len(raw), !open); err != nil {
			return nil, err
		}
		if err := totalSizeError(total, int64(len(raw)), !open); err != nil {
			return nil, err
		}
	}
	if folder := text(options["folderId"]); folder != "" {
		if _, err := m.folder(folder); err != nil {
			return nil, err
		}
	}
	if external := text(options["externalId"]); external != "" {
		for _, other := range m.DatabaseStorage.Assets {
			if other["projectId"] == m.options.ProjectID && other["externalId"] == external {
				return nil, fail(calmlens.CodeDuplicateExternalID)
			}
		}
	}
	orNull := func(key string) any {
		if value, ok := options[key]; ok {
			return value
		}
		return nil
	}
	processingOptions := orNull("processingOptions")
	if processingOptions == nil {
		processingOptions = calmlens.JSON{"keepContentAfterProcessing": false}
	}
	contentStatus := calmlens.ContentStatusTemporary
	if keep, _ := asJSON(processingOptions)["keepContentAfterProcessing"].(bool); keep {
		contentStatus = calmlens.ContentStatusStored
	}
	visibility := orNull("visibility")
	if visibility == nil {
		visibility = calmlens.VisibilityPrivate
	}
	externalURL := orNull("externalUrl")
	if options["url"] != nil {
		externalURL = options["url"]
	}
	used, err := usedContext(options["context"])
	if err != nil {
		return nil, err
	}
	id := m.options.CreateID("asset")
	// Fields the API returns as null when they are not set.
	a := calmlens.JSON{
		"id": id, "projectId": m.options.ProjectID, "userId": nil, "parentId": nil,
		"folderId": orNull("folderId"), "uploadPresetId": orNull("uploadPresetId"),
		"createdAt": now, "updatedAt": now, "name": options["name"],
		"description": orNull("description"), "externalId": orNull("externalId"), "externalUrl": externalURL,
		"type": kind, "metadata": orNull("metadata"), "authorId": orNull("authorId"), "context": used, "tags": nil,
		"processingOptions": processingOptions, "visibility": visibility,
	}
	content := calmlens.JSON{
		"status": contentStatus, "removalReason": nil, "updatedAt": now, "safetyHold": nil,
		"format": nil, "extension": nil, "sizeInBytes": nil, "checksums": nil, "image": nil,
		"extractedText": nil,
	}
	uploadState := calmlens.JSON{"status": "completed", "updatedAt": now, "partsReceived": nil}
	classification := calmlens.JSON{"status": calmlens.ClassificationStatusProcessing, "updatedAt": now, "completedAt": nil,
		"moderation": calmlens.JSON{"status": calmlens.ModerationStatusPending, "manualReviews": []any{}}}
	if open {
		uploadState["status"] = "uploading"
		uploadState["partsReceived"] = 1
		classification["status"] = calmlens.ClassificationStatusPending
	}
	a["content"], a["upload"], a["classification"] = content, uploadState, classification
	if options["url"] == nil {
		if mime != "" {
			content["format"] = mime
		}
		content["sizeInBytes"] = len(raw)
		m.ImageStorage.Content[id] = &StoredContent{Type: mime, Parts: map[int][]byte{1: raw}}
	}
	if open {
		m.uploads[id] = &upload{queue: queue, totalSize: total}
	} else {
		m.applyOutcome(a, m.outcome(queue), calmlens.ContentRemovalReasonPolicy)
	}
	m.DatabaseStorage.Assets[id] = a
	return a, nil
}

// usedContext is what the API keeps of a request's earlier posts: only the ones CalmLens uses,
// or null when there are none.
func usedContext(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	var context calmlens.ModerationContext
	if err = json.Unmarshal(data, &context); err != nil {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	items := calmlens.SelectModerationContextItems(context.Items)
	if len(items) == 0 {
		return nil, nil
	}
	if data, err = json.Marshal(calmlens.ModerationContext{Items: items}); err != nil {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	var stored calmlens.JSON
	if err = json.Unmarshal(data, &stored); err != nil {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	return stored, nil
}

// imageSizeError is the API's rule for image uploads in parts: at most 20 MiB, and (checked at
// the last part) at least 10 MiB.
func imageSizeError(kind string, size int64, final bool) error {
	switch {
	case kind != calmlens.AssetTypeImage:
		return nil
	case size > maxMultipartImage:
		return fail(calmlens.CodeMultipartImageTooLarge)
	case final && size < minMultipartImage:
		return fail(calmlens.CodeMultipartImageTooSmall)
	}
	return nil
}

// partSizeError is the API's rule for a part: at least 5 MiB unless it is the last.
func partSizeError(size int, final bool) error {
	if !final && size < minMultipartPart {
		return fail(calmlens.CodeInvalidUploadPayload)
	}
	return nil
}

// totalSizeError refuses parts that overshoot a declared total, or do not reach it at the end.
func totalSizeError(total *int64, received int64, final bool) error {
	if total != nil && (received > *total || final && received != *total) {
		return fail(calmlens.CodeUploadSizeMismatch)
	}
	return nil
}

func (m *MockServerClient) outcome(queue bool) string {
	if queue {
		return m.options.QueuedOutcome
	}
	return m.options.AnalyzedOutcome
}

// asJSON returns value as a JSON object, or an empty one when it is not an object.
func asJSON(value any) calmlens.JSON {
	if object, ok := value.(map[string]any); ok {
		return object
	}
	return calmlens.JSON{}
}

// section returns the asset's nested processing, moderation or content object, adding an
// empty one to assets seeded without it.
func section(a calmlens.JSON, name string) calmlens.JSON {
	object, ok := a[name].(map[string]any)
	if !ok {
		object = calmlens.JSON{}
		a[name] = object
	}
	return object
}

// withoutPlaceholder drops an image's ThumbHash and average colour, which go with its content.
func withoutPlaceholder(image any) any {
	object, ok := image.(map[string]any)
	if !ok {
		return image
	}
	copied := calmlens.JSON{}
	for key, value := range object {
		copied[key] = value
	}
	copied["thumbhash"], copied["averageColor"] = nil, nil
	return copied
}

// applyOutcome moves an asset to outcome like the pipeline: a decision finishes processing,
// OutcomePurged deletes the content (with purgeReason), and finished processing removes content
// kept only temporarily (keepContentAfterProcessing off). A classified image gets a ThumbHash
// for its placeholder, which goes with its content.
func (m *MockServerClient) applyOutcome(a calmlens.JSON, outcome, purgeReason string) {
	now := m.options.Now()
	decided := outcome != OutcomePending && outcome != OutcomeFailed
	processing, moderation, content := section(a, "classification"), section(section(a, "classification"), "moderation"), section(a, "content")
	removed := content["status"] == calmlens.ContentStatusRemoved
	purge := outcome == OutcomePurged && !removed
	removeContent := purge || decided && content["status"] == calmlens.ContentStatusTemporary
	image := content["image"]
	switch {
	case decided && a["type"] == calmlens.AssetTypeImage && !removed && !purge:
		classified := calmlens.JSON{"width": nil, "height": nil, "perceptualHash": nil, "perceptualHashQuality": nil}
		for key, value := range asJSON(image) {
			classified[key] = value
		}
		classified["thumbhash"] = mockThumbHash
		if classified["averageColor"] == nil {
			classified["averageColor"] = mockAverageColor
		}
		image = classified
	case outcome == OutcomePurged:
		image = withoutPlaceholder(image)
	}
	content["image"] = image
	if removeContent {
		reason := calmlens.ContentRemovalReasonRetention
		if purge {
			reason = purgeReason
		}
		m.removeContent(a, reason, now)
	}
	section(a, "upload")["status"] = "completed"
	section(a, "upload")["updatedAt"] = now
	processing["updatedAt"] = now
	processing["completedAt"] = nil
	moderation["status"] = calmlens.ModerationStatusPending
	switch {
	case decided:
		processing["status"] = calmlens.ClassificationStatusCompleted
		moderation["status"] = outcome
		processing["completedAt"] = now
	case outcome == OutcomeFailed:
		processing["status"] = calmlens.ClassificationStatusFailed
	default:
		processing["status"] = calmlens.ClassificationStatusProcessing
	}
	a["updatedAt"] = now
}

// removeContent deletes the asset's stored bytes and marks its content removed for reason; the
// extracted text and the image's placeholder go with it.
func (m *MockServerClient) removeContent(a calmlens.JSON, reason string, now int64) {
	delete(m.ImageStorage.Content, text(a["id"]))
	a["context"] = nil
	content := section(a, "content")
	if content["status"] == calmlens.ContentStatusRemoved {
		return
	}
	content["status"] = calmlens.ContentStatusRemoved
	content["removalReason"] = reason
	content["updatedAt"] = now
	content["extractedText"] = nil
	content["image"] = withoutPlaceholder(content["image"])
}

// requestContentRemoval removes an asset's content on request, like the API: the record and
// report stay; stored content, extracted text and the placeholder go. Content already removed
// keeps its reason, and an asset.content-removed event is recorded either way.
func (m *MockServerClient) requestContentRemoval(a calmlens.JSON, now int64) {
	content := section(a, "content")
	if content["status"] == calmlens.ContentStatusRemoved {
		delete(m.ImageStorage.Content, text(a["id"]))
		if asJSON(content["image"])["thumbhash"] != nil {
			content["image"] = withoutPlaceholder(content["image"])
		}
	} else {
		m.removeContent(a, calmlens.ContentRemovalReasonRequested, now)
		a["updatedAt"] = now
	}
	m.recordLifecycleEvent(calmlens.EventAssetContentRemoved, a)
}

// assetIDPattern is the asset ID form the API's schema accepts.
var assetIDPattern = regexp.MustCompile(`^asset_[0-9A-Za-z]{20}$`)

const idAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// newID returns a new ID like the API's: prefix, "_" and 20 base62 characters from a CSPRNG
// (bytes 248 to 255 are redrawn, so every character is equally likely).
func newID(prefix string) string {
	body := make([]byte, 0, 20)
	buf := make([]byte, 40)
	for len(body) < 20 {
		if _, err := rand.Read(buf); err != nil {
			panic(err)
		}
		for _, b := range buf {
			if b >= 248 {
				continue
			}
			body = append(body, idAlphabet[b%62])
			if len(body) == 20 {
				break
			}
		}
	}
	return prefix + "_" + string(body)
}

// batchAssets checks the batch like the API (1 to 500 asset IDs, a known operation, and every asset
// in the project, refusing the whole batch otherwise), then applies it at once, in request order,
// instead of in the background: delete deletes each asset with its stored child assets and
// records asset.deleted with the asset as it was; remove-content removes the content like
// DELETE /assets/:id/content. Mock assets carry no safety holds, so none is skipped.
func (m *MockServerClient) batchAssets(body calmlens.JSON, now int64) (any, error) {
	ids, ok := body["assetIds"].([]any)
	if !ok {
		return nil, validation("validation/invalid-type", "assetIds")
	}
	if len(ids) < 1 {
		return nil, validation("validation/too-small", "assetIds")
	}
	if len(ids) > calmlens.AssetBatchMaxAssets {
		return nil, validation("validation/too-big", "assetIds")
	}
	for index, id := range ids {
		value, isString := id.(string)
		if !isString {
			return nil, validation("validation/invalid-type", fmt.Sprintf("assetIds.%d", index))
		}
		if !assetIDPattern.MatchString(value) {
			return nil, validation("validation/invalid-format", fmt.Sprintf("assetIds.%d", index))
		}
	}
	operation := calmlens.AssetBatchOperation(text(body["operation"]))
	if operation != calmlens.AssetBatchOperationDelete && operation != calmlens.AssetBatchOperationRemoveContent {
		return nil, validation("validation/invalid-value", "operation")
	}
	var assets []calmlens.JSON
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id.(string)] {
			continue
		}
		seen[id.(string)] = true
		a, err := m.asset(id.(string))
		if err != nil {
			return nil, err
		}
		assets = append(assets, a)
	}
	for _, a := range assets {
		if operation == calmlens.AssetBatchOperationDelete {
			m.recordLifecycleEvent(calmlens.EventAssetDeleted, a)
			m.deleteAssetTree(text(a["id"]))
		} else {
			m.requestContentRemoval(a, now)
		}
	}
	return calmlens.JSON{"queued": true}, nil
}

// deleteAssetTree deletes an asset, its stored child assets and their content.
func (m *MockServerClient) deleteAssetTree(id string) {
	deleting := map[string]bool{id: true}
	for added := true; added; {
		added = false
		for otherID, other := range m.DatabaseStorage.Assets {
			if parent := text(other["parentId"]); parent != "" && deleting[parent] && !deleting[otherID] {
				deleting[otherID] = true
				added = true
			}
		}
	}
	for deleted := range deleting {
		delete(m.ImageStorage.Content, deleted)
		delete(m.DatabaseStorage.Assets, deleted)
		delete(m.uploads, deleted)
	}
}

func (m *MockServerClient) assetRoute(method, id, suffix string, body calmlens.JSON, q url.Values, raw []byte, now int64) (any, error) {
	a, err := m.asset(id)
	if err != nil {
		return nil, err
	}
	switch {
	case method == "GET" && suffix == "":
	case method == "DELETE" && suffix == "":
		m.recordLifecycleEvent(calmlens.EventAssetDeleted, a)
		delete(m.ImageStorage.Content, id)
		delete(m.DatabaseStorage.Assets, id)
		delete(m.uploads, id)
		return calmlens.JSON{}, nil
	case method == "PATCH" && suffix == "":
		// Like the API: an externalId stays unique in the project; null clears a field.
		if external := text(body["externalId"]); external != "" {
			for otherID, other := range m.DatabaseStorage.Assets {
				if otherID != id && other["projectId"] == m.options.ProjectID && other["externalId"] == external {
					return nil, fail(calmlens.CodeDuplicateExternalID)
				}
			}
		}
		for key, value := range body {
			a[key] = value
		}
		a["updatedAt"] = now
	case method == "DELETE" && suffix == "content":
		m.requestContentRemoval(a, now)
	case method == "GET" && suffix == "children":
		return m.page(func(child calmlens.JSON) bool { return child["parentId"] == id }, q, "children:"+id)
	case method == "POST" && suffix == "signed-url":
		params := url.Values{"expiresInSeconds": {fmt.Sprint(body["expiresInSeconds"])}}
		for _, key := range []string{"lens", "transform"} {
			if value := text(body[key]); value != "" {
				params.Set(key, value)
			}
		}
		// Like the API, the resource defaults to rendered.
		resource := text(body["resource"])
		if resource == "" {
			resource = calmlens.ResourceRendered
		}
		return calmlens.JSON{"url": m.options.SignedURLBaseURL + "/assets/" + id + "/" + resource + "?" + params.Encode(), "expiresAt": now + int64(number(body["expiresInSeconds"])*1000)}, nil
	case method == "POST" && suffix == "retry":
		classification := section(a, "classification")
		if classification["status"] != calmlens.ClassificationStatusFailed || section(classification, "moderation")["status"] != calmlens.ModerationStatusPending {
			return nil, fail(calmlens.CodeAssetNotRetryable)
		}
		if section(a, "content")["status"] == calmlens.ContentStatusRemoved {
			return nil, fail(calmlens.CodeAssetContentUnavailable)
		}
		// Like the API: back to processing, to be moderated again, with an asset.retried event.
		m.applyOutcome(a, OutcomePending, calmlens.ContentRemovalReasonPolicy)
		m.recordLifecycleEvent(calmlens.EventAssetRetried, a)
	case method == "POST" && suffix == "explain":
		classification := section(a, "classification")
		if classification["status"] != calmlens.ClassificationStatusCompleted {
			return nil, fail(calmlens.CodeAssetNotDecided)
		}
		moderation := section(classification, "moderation")
		if body["rerun"] != true {
			// Like the API: the evidence is completed and every action stays as decided.
			if policy, ok := moderation["policy"].(map[string]any); ok && policy["evidence"] == calmlens.PolicyEvidenceDecision {
				policy["evidence"] = calmlens.PolicyEvidenceFull
				a["updatedAt"] = now
			}
			break
		}
		if reviews, _ := moderation["manualReviews"].([]any); len(reviews) > 0 {
			return nil, fail(calmlens.CodeAssetReviewed)
		}
		if section(a, "content")["status"] == calmlens.ContentStatusRemoved {
			return nil, fail(calmlens.CodeAssetContentUnavailable)
		}
		// Like the API: back to processing, to be moderated again under the current policy.
		m.applyOutcome(a, OutcomePending, calmlens.ContentRemovalReasonPolicy)
	case method == "POST" && suffix == "move":
		if folder := text(body["folderId"]); folder != "" {
			if _, err = m.folder(folder); err != nil {
				return nil, err
			}
		}
		a["folderId"] = body["folderId"]
		a["updatedAt"] = now
	case method == "POST" && suffix == "part":
		if err := m.uploadPart(a, id, q, raw, now); err != nil {
			return nil, err
		}
	default:
		return nil, errUnknownRoute
	}
	return a, nil
}

// uploadPart continues a multipart upload in the API's order: the upload must be open, parts
// arrive in order, then image totals and the declared total are checked.
func (m *MockServerClient) uploadPart(a calmlens.JSON, id string, q url.Values, raw []byte, now int64) error {
	state := m.uploads[id]
	stored := m.ImageStorage.Content[id]
	progress := section(a, "upload")
	if state == nil || stored == nil || progress["status"] != "uploading" {
		return fail(calmlens.CodeUploadNotOpen)
	}
	if size := q.Get("sizeInBytes"); size != "" && size != strconv.Itoa(len(raw)) {
		return fail(calmlens.CodeInvalidUploadPayload)
	}
	part, _ := strconv.Atoi(q.Get("partNumber"))
	expected := int(number(progress["partsReceived"])) + 1
	if part != expected {
		failure := fail(calmlens.CodeInvalidUploadPartNumber).(*apiError)
		failure.details = calmlens.JSON{"expectedPartNumber": expected, "receivedPartNumber": part}
		return failure
	}
	size := int64(len(raw))
	for _, value := range stored.Parts {
		size += int64(len(value))
	}
	final := q.Get("isFinal") == "true"
	if err := imageSizeError(text(a["type"]), size, final); err != nil {
		return err
	}
	if err := totalSizeError(state.totalSize, size, final); err != nil {
		return err
	}
	if err := partSizeError(len(raw), final); err != nil {
		return err
	}
	stored.Parts[part] = raw
	section(a, "content")["sizeInBytes"] = size
	progress["updatedAt"] = now
	a["updatedAt"] = now
	if !final {
		progress["partsReceived"] = part
		return nil
	}
	// Like the API, a completed upload no longer counts parts.
	progress["partsReceived"] = nil
	queue := state.queue
	if override := q.Get("queue"); override != "" {
		queue = override == "true"
	}
	delete(m.uploads, id)
	m.applyOutcome(a, m.outcome(queue), calmlens.ContentRemovalReasonPolicy)
	return nil
}

// listFolders lists one page of child folders, or searches names, with the ancestors of the
// listed and requested folders, like the API.
func (m *MockServerClient) listFolders(q url.Values) (any, error) {
	db := m.DatabaseStorage
	size, err := intRange(q, "pageSize", maxFolderPageSize, 1, maxFolderPageSize)
	if err != nil {
		return nil, err
	}
	index, _ := strconv.Atoi(q.Get("pageIndex"))
	search := strings.ToLower(q.Get("search"))
	folders := []calmlens.JSON{}
	for _, f := range db.Folders {
		if f["projectId"] == m.options.ProjectID && ((q.Get("searchAll") == "true" && search != "") || text(f["parentId"]) == q.Get("parentId")) && strings.Contains(strings.ToLower(text(f["name"])), search) {
			folders = append(folders, f)
		}
	}
	// Like the database: names compare by code point, so case matters.
	sort.Slice(folders, func(i, j int) bool {
		var order int
		if q.Get("sort") == "createdAt" {
			order = cmp.Compare(number(folders[i]["createdAt"]), number(folders[j]["createdAt"]))
		} else {
			order = strings.Compare(text(folders[i]["name"]), text(folders[j]["name"]))
		}
		if order == 0 {
			order = strings.Compare(text(folders[i]["id"]), text(folders[j]["id"]))
		}
		if q.Get("direction") == "DESC" {
			return order > 0
		}
		return order < 0
	})
	start := min(index*size, len(folders))
	end := min(start+size, len(folders))
	page := folders[start:end]
	if q.Get("resolveOnly") == "true" {
		page = []calmlens.JSON{}
	}
	ids := map[string]bool{}
	var selected []string
	for index := 0; ; index++ {
		id := q.Get(fmt.Sprintf("ids[%d]", index))
		if id == "" {
			break
		}
		selected = append(selected, id)
	}
	selected = append(selected, q.Get("parentId"))
	for _, f := range page {
		selected = append(selected, text(f["id"]))
	}
	for len(selected) > 0 {
		id := selected[len(selected)-1]
		selected = selected[:len(selected)-1]
		if id == "" || ids[id] {
			continue
		}
		ids[id] = true
		if f := db.Folders[id]; f != nil {
			selected = append(selected, text(f["parentId"]))
		}
	}
	ancestors := []calmlens.JSON{}
	for id := range ids {
		if f := db.Folders[id]; f != nil && f["projectId"] == m.options.ProjectID && !slices.ContainsFunc(page, func(item calmlens.JSON) bool { return text(item["id"]) == id }) {
			ancestors = append(ancestors, f)
		}
	}
	sort.Slice(ancestors, func(i, j int) bool { return text(ancestors[i]["id"]) < text(ancestors[j]["id"]) })
	return calmlens.JSON{"folders": page, "ancestors": ancestors, "hasMore": q.Get("resolveOnly") != "true" && len(folders) > index*size+size}, nil
}

func (m *MockServerClient) createFolder(body calmlens.JSON, now int64) (any, error) {
	if text(body["name"]) == "" {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	if id := text(body["parentId"]); id != "" {
		if _, err := m.folder(id); err != nil {
			return nil, err
		}
	}
	if err := m.unique(body["name"], body["parentId"], nil); err != nil {
		return nil, err
	}
	folder := calmlens.JSON{"id": m.options.CreateID("fldr"), "projectId": m.options.ProjectID, "parentId": body["parentId"], "name": body["name"], "createdAt": now, "updatedAt": now}
	m.DatabaseStorage.Folders[text(folder["id"])] = folder
	return folder, nil
}

func (m *MockServerClient) folderRoute(method, id, suffix string, body calmlens.JSON, now int64) (any, error) {
	f, err := m.folder(id)
	if err != nil {
		return nil, err
	}
	switch {
	case method == "GET" && suffix == "":
	case method == "DELETE" && suffix == "":
		hasAssets, hasChildren := false, false
		for _, a := range m.DatabaseStorage.Assets {
			hasAssets = hasAssets || a["folderId"] == id
		}
		for _, other := range m.DatabaseStorage.Folders {
			hasChildren = hasChildren || other["parentId"] == id
		}
		if hasAssets || hasChildren {
			failure := fail(calmlens.CodeFolderNotEmpty).(*apiError)
			failure.details = calmlens.JSON{"hasAssets": hasAssets, "hasChildren": hasChildren}
			return nil, failure
		}
		delete(m.DatabaseStorage.Folders, id)
		return calmlens.JSON{}, nil
	case method == "POST" && suffix == "move":
		current := text(body["parentId"])
		seen := map[string]bool{id: true}
		for current != "" {
			if seen[current] {
				return nil, fail(calmlens.CodeFolderParentCycle)
			}
			seen[current] = true
			parent, err := m.folder(current)
			if err != nil {
				return nil, err
			}
			current = text(parent["parentId"])
		}
		if err = m.unique(f["name"], body["parentId"], id); err != nil {
			return nil, err
		}
		f["parentId"] = body["parentId"]
		f["updatedAt"] = now
	case method == "PATCH" && suffix == "":
		if name, ok := body["name"]; ok {
			if err = m.unique(name, f["parentId"], id); err != nil {
				return nil, err
			}
			f["name"] = name
		}
		f["updatedAt"] = now
	default:
		return nil, errUnknownRoute
	}
	return f, nil
}

// pageCursor is the position a page ends at, for the query (scope and ordering) it belongs to.
type pageCursor struct {
	Scope  string `json:"scope"`
	Values []any  `json:"values"`
}

// page lists project assets accepted by include, applying the RSQL filter, ordering and
// pagination from the query like the API. A cursor continues only the query (scope and
// ordering) it came from.
func (m *MockServerClient) page(include func(calmlens.JSON) bool, q url.Values, scope string) (any, error) {
	var filter filterNode
	if expression := q.Get("filter"); expression != "" {
		var err error
		if filter, err = parseFilter(expression); err != nil {
			return nil, &apiError{code: "mock/invalid-filter", status: http.StatusBadRequest, details: calmlens.JSON{"reason": err.Error()}}
		}
	}
	size, err := intRange(q, "pageSize", 10, 1, maxPageSize)
	if err != nil {
		return nil, err
	}
	ordering := []calmlens.Order{}
	for i := 0; q.Has(fmt.Sprintf("ordering[%d][field]", i)); i++ {
		order := calmlens.Order{Field: q.Get(fmt.Sprintf("ordering[%d][field]", i)), Direction: strings.ToUpper(q.Get(fmt.Sprintf("ordering[%d][direction]", i)))}
		if (order.Field != "createdAt" && order.Field != "id") || order.Direction != "ASC" && order.Direction != "DESC" {
			return nil, fail(calmlens.CodeInvalidUploadPayload)
		}
		ordering = append(ordering, order)
	}
	if len(ordering) == 0 {
		ordering = append(ordering, calmlens.Order{Field: "createdAt", Direction: "DESC"})
	}
	if !slices.ContainsFunc(ordering, func(order calmlens.Order) bool { return order.Field == "id" }) {
		ordering = append(ordering, calmlens.Order{Field: "id", Direction: ordering[0].Direction})
	}
	signature, _ := json.Marshal([]any{scope, ordering})
	items := []calmlens.JSON{}
	for _, a := range m.DatabaseStorage.Assets {
		if a["projectId"] == m.options.ProjectID && include(a) && (filter == nil || filter.match(a)) {
			items = append(items, a)
		}
	}
	compareItems := func(item calmlens.JSON, values []any) int {
		for i, order := range ordering {
			result := compareValues(lookup(item, order.Field), fmt.Sprint(values[i]))
			if result != 0 {
				if order.Direction == "DESC" {
					return -result
				}
				return result
			}
		}
		return 0
	}
	sort.SliceStable(items, func(i, j int) bool {
		values := make([]any, len(ordering))
		for k, order := range ordering {
			values[k] = lookup(items[j], order.Field)
		}
		return compareItems(items[i], values) < 0
	})
	if encoded := q.Get("cursor"); encoded != "" {
		raw, err := base64.StdEncoding.DecodeString(encoded)
		var cursor pageCursor
		if err != nil || json.Unmarshal(raw, &cursor) != nil || cursor.Scope != string(signature) || len(cursor.Values) != len(ordering) {
			return nil, fail(calmlens.CodeInvalidCursor)
		}
		for i, order := range ordering {
			if _, isText := cursor.Values[i].(string); isText != (order.Field == "id") {
				return nil, fail(calmlens.CodeInvalidCursor)
			}
		}
		remaining := []calmlens.JSON{}
		for _, item := range items {
			if compareItems(item, cursor.Values) > 0 {
				remaining = append(remaining, item)
			}
		}
		items = remaining
	}
	end := min(size, len(items))
	var next any
	if end < len(items) {
		cursor := pageCursor{Scope: string(signature)}
		for _, order := range ordering {
			cursor.Values = append(cursor.Values, lookup(items[end-1], order.Field))
		}
		raw, _ := json.Marshal(cursor)
		next = base64.StdEncoding.EncodeToString(raw)
	}
	return calmlens.JSON{"items": items[:end], "nextCursor": next, "pageSize": size, "ordering": ordering, "hasMore": end < len(items)}, nil
}

// maxSearchTokens is how many distinct query words the API searches for.
const maxSearchTokens = 8

// searchFields are the keyword fields the API searches, in the order it reports matches.
var searchFields = []string{"name", "id", "externalId", "description", "tags", "type", "content.format", "content.extension", "classification.moderation.status"}

// search runs keyword search as the API does: the trimmed, lowercased query is split on
// whitespace into at most 8 distinct words, and an asset matches when every word appears in
// one of searchFields. Results are ranked by the API's score for the whole query (exact ID,
// external ID or name first, then prefixes, then name and tag substrings), then newest first.
// Semantic search is not simulated, so semanticStatus is "disabled".
func (m *MockServerClient) search(q url.Values) (any, error) {
	// Like the API's query schema: a trimmed query of 1 to 200 characters, a limit of 1 to 20.
	queryText := strings.TrimSpace(q.Get("query"))
	if queryText == "" {
		return nil, validation("validation/too-small", "query")
	}
	if len([]rune(queryText)) > maxSearchQuery {
		return nil, validation("validation/too-big", "query")
	}
	limit, err := intRange(q, "limit", 10, 1, maxSearchLimit)
	if err != nil {
		return nil, err
	}
	normalized := strings.ToLower(queryText)
	tokens := []string{}
	for _, word := range strings.Fields(normalized) {
		if len(tokens) < maxSearchTokens && !contains(tokens, word) {
			tokens = append(tokens, word)
		}
	}
	type match struct {
		asset  calmlens.JSON
		score  float64
		fields []string
	}
	matches := []match{}
	for _, a := range m.DatabaseStorage.Assets {
		if a["projectId"] != m.options.ProjectID {
			continue
		}
		values := map[string]string{}
		for _, field := range searchFields {
			value := lookup(a, field)
			if field == "tags" {
				tags := []string{}
				if list, ok := value.([]any); ok {
					for _, tag := range list {
						tags = append(tags, text(tag))
					}
				}
				value = strings.Join(tags, " ")
			}
			values[field] = strings.ToLower(text(value))
		}
		fields := []string{}
		for _, field := range searchFields {
			for _, token := range tokens {
				if strings.Contains(values[field], token) {
					fields = append(fields, field)
					break
				}
			}
		}
		matchesAll := true
		for _, token := range tokens {
			found := false
			for _, field := range searchFields {
				if strings.Contains(values[field], token) {
					found = true
					break
				}
			}
			matchesAll = matchesAll && found
		}
		if matchesAll {
			matches = append(matches, match{a, searchScore(values, normalized), fields})
		}
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		left, right := number(matches[i].asset["createdAt"]), number(matches[j].asset["createdAt"])
		if left != right {
			return left > right
		}
		return text(matches[i].asset["id"]) < text(matches[j].asset["id"])
	})
	items := []calmlens.JSON{}
	for i, found := range matches {
		if i == limit {
			break
		}
		items = append(items, calmlens.JSON{"asset": found.asset, "score": found.score, "matchedFields": found.fields})
	}
	return calmlens.JSON{"query": queryText, "items": items, "semanticStatus": "disabled"}, nil
}

// searchScore is the API's keyword score of lowercased field values for the whole lowercased query.
func searchScore(values map[string]string, query string) float64 {
	id, externalID, name := values["id"], values["externalId"], values["name"]
	switch {
	case id == query:
		return 1000
	case externalID == query:
		return 950
	case name == query:
		return 900
	case strings.HasPrefix(id, query):
		return 800
	case strings.HasPrefix(externalID, query):
		return 750
	case strings.HasPrefix(name, query):
		return 700
	case strings.Contains(name, query):
		return 600
	case strings.Contains(values["tags"], query):
		return 500
	}
	return 100
}

func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}

// serve answers a CDN request like the CDN: a placeholder PNG, or the stored content with its
// type, length, cache and protection headers; or a JSON error body.
func (m *MockServerClient) serve(req *http.Request, parts []string, header http.Header) (int, []byte, string) {
	errorBody := func(status int, code, message string) (int, []byte, string) {
		data, _ := json.Marshal(calmlens.JSON{"code": code, "message": message})
		return status, data, "application/json"
	}
	if len(parts) < 4 || parts[0] != "assets" || parts[1] != m.options.ProjectID {
		return errorBody(http.StatusNotFound, calmlens.CodeAssetNotFound, "Asset not found")
	}
	id := parts[2]
	var asset calmlens.JSON
	for _, a := range m.DatabaseStorage.Assets {
		if a["projectId"] == m.options.ProjectID && (a["id"] == id || a["externalId"] == id) {
			asset = a
			break
		}
	}
	if asset == nil {
		return errorBody(http.StatusNotFound, calmlens.CodeAssetNotFound, "Asset not found")
	}
	notAvailable := func() (int, []byte, string) {
		return errorBody(http.StatusForbidden, "asset/not-available", "Asset is not available")
	}
	canDownload := func() bool { return m.canDownload(text(asset["folderId"]), req.Header.Get("X-Api-Key")) }
	moderation := section(section(asset, "classification"), "moderation")["status"]
	tag := "asset-" + text(asset["id"])
	if parts[3] == calmlens.ResourcePlaceholder {
		// Like the CDN's placeholder handler: an image's ThumbHash, public for public assets
		// whatever their moderation status; refused for purged assets, assets without one (not
		// yet classified, or content removed) and, for private assets, keys without
		// assets:download.
		thumbhash := text(contentImage(asset)["thumbhash"])
		if thumbhash == "" || moderation == calmlens.ModerationStatusPurged {
			return notAvailable()
		}
		public := asset["visibility"] == calmlens.VisibilityPublic
		if !public && !canDownload() {
			return notAvailable()
		}
		png, err := placeholderPNG(thumbhash)
		if err != nil {
			return notAvailable()
		}
		access := "private"
		if public {
			access = "public"
		}
		header.Set("Cache-Control", access+", max-age=3600")
		header.Set("Cache-Tag", tag)
		header.Set("ETag", strconv.Quote(thumbhash))
		return http.StatusOK, png, "image/png"
	}
	// Like the CDN, delivery checks come first and refuse everyone: content still uploading,
	// blocked or purged, failed processing or removed content.
	stored := m.ImageStorage.Content[text(asset["id"])]
	if stored == nil || section(asset, "upload")["status"] == "uploading" ||
		moderation == calmlens.ModerationStatusBlocked || moderation == calmlens.ModerationStatusPurged ||
		section(asset, "classification")["status"] == calmlens.ClassificationStatusFailed ||
		section(asset, "content")["status"] == calmlens.ContentStatusRemoved {
		return notAvailable()
	}
	// Then access: a private asset, or a public age-restricted one requested without the
	// allowAgeRestricted=true opt-in, needs the download permission for its folder.
	restricted := asset["visibility"] != calmlens.VisibilityPublic || moderation == calmlens.ModerationStatusAgeRestricted && req.URL.Query().Get("allowAgeRestricted") != "true"
	if restricted && !canDownload() {
		return errorBody(http.StatusForbidden, "asset/api-key-missing-permission", "This API key needs assets:download permission for this asset's folder.")
	}
	// Like the CDN: an image's bytes are immutable for a year, other content is kept for an hour,
	// by shared caches only when delivery is public.
	access, lifetime := "public", "max-age=3600"
	if restricted {
		access = "private"
	}
	image := asset["type"] == calmlens.AssetTypeImage
	if image {
		lifetime = fmt.Sprintf("max-age=%d, immutable", imageCacheLifetime)
		header.Set("ETag", strconv.Quote(text(asset["id"])))
		header.Set("Expires", time.UnixMilli(m.options.Now()).Add(imageCacheLifetime*time.Second).UTC().Format(http.TimeFormat))
	}
	header.Set("Cache-Control", access+", "+lifetime)
	header.Set("Cache-Tag", tag)
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", cdnProtectionPolicy)
	contentType := stored.Type
	if contentType == "" {
		contentType = defaultContentType
	}
	if activeContentType(contentType) {
		header.Set("Content-Disposition", "attachment")
	}
	indices := []int{}
	for index := range stored.Parts {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	var data []byte
	for _, index := range indices {
		data = append(data, stored.Parts[index]...)
	}
	return http.StatusOK, data, contentType
}

// contentImage returns the asset's content.image object (empty when it has none).
func contentImage(asset calmlens.JSON) calmlens.JSON {
	return asJSON(section(asset, "content")["image"])
}

// activeContentType reports content a browser could run as a document, which the CDN serves as
// a download.
func activeContentType(contentType string) bool {
	normalized := strings.TrimSpace(strings.ToLower(strings.Split(contentType, ";")[0]))
	switch normalized {
	case "image/svg+xml", "application/xhtml+xml", "text/html", "application/xml", "text/xml":
		return true
	}
	return strings.HasSuffix(normalized, "+xml")
}

// canDownload reports whether the API key may download content in folder: the mock's own key
// has the grants SetAPIKeyGrants (or CreateMockAPIKey) gave it.
func (m *MockServerClient) canDownload(folder, apiKey string) bool {
	grants := m.grants
	if apiKey != m.options.APIKey {
		grants = keyGrants(apiKey)
	}
	for _, grant := range grants {
		if !contains(grant.Actions, "assets:download") {
			continue
		}
		if grant.FolderID == nil {
			return true
		}
		current := folder
		seen := map[string]bool{}
		for current != "" && !seen[current] {
			if current == *grant.FolderID {
				return true
			}
			if !grant.IncludeSubfolders {
				break
			}
			seen[current] = true
			f, err := m.folder(current)
			if err != nil {
				break
			}
			current = text(f["parentId"])
		}
	}
	return false
}

// ---- Hash lists -----------------------------------------------------------------------------
// Lists and entries live in DatabaseStorage. Uploads aren't matched against them.

const defaultHashListEntryPageSize = 20

var pdqHash = regexp.MustCompile(`^[0-9a-f]{64}$`)

// newestFirst sorts items by createdAt, then ID, newest first, like the API.
func newestFirst(items []calmlens.JSON) {
	sort.Slice(items, func(i, j int) bool {
		if order := cmp.Compare(number(items[i]["createdAt"]), number(items[j]["createdAt"])); order != 0 {
			return order > 0
		}
		return text(items[i]["id"]) > text(items[j]["id"])
	})
}

func (m *MockServerClient) listHashLists() calmlens.JSON {
	items := []calmlens.JSON{}
	for _, list := range m.DatabaseStorage.HashLists {
		if list["projectId"] == m.options.ProjectID {
			items = append(items, list)
		}
	}
	newestFirst(items)
	return calmlens.JSON{"items": items}
}

func validHashListAction(value any) bool {
	return value == calmlens.HashListActionFlag || value == calmlens.HashListActionBlock
}

func (m *MockServerClient) createHashList(body calmlens.JSON, now int64) (any, error) {
	name, _ := body["name"].(string)
	if strings.TrimSpace(name) == "" || !validHashListAction(body["action"]) {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	var description any
	if value, ok := body["description"].(string); ok {
		description = value
	}
	list := calmlens.JSON{"id": m.options.CreateID("hl"), "projectId": m.options.ProjectID, "name": strings.TrimSpace(name), "description": description, "action": body["action"], "createdByUserId": nil, "createdAt": now, "updatedAt": now}
	m.DatabaseStorage.HashLists[text(list["id"])] = list
	return list, nil
}

func (m *MockServerClient) hashListRoute(method, id, suffix string, body calmlens.JSON, q url.Values, now int64) (any, error) {
	list := m.DatabaseStorage.HashLists[id]
	if list == nil || list["projectId"] != m.options.ProjectID {
		return nil, fail(calmlens.CodeHashListNotFound)
	}
	switch {
	case method == "GET" && suffix == "":
	case method == "PATCH" && suffix == "":
		if name, ok := body["name"].(string); ok {
			list["name"] = strings.TrimSpace(name)
		}
		if description, ok := body["description"]; ok {
			list["description"] = description
		}
		if validHashListAction(body["action"]) {
			list["action"] = body["action"]
		}
		list["updatedAt"] = now
	case method == "DELETE" && suffix == "":
		delete(m.DatabaseStorage.HashLists, id)
		for entryID, entry := range m.DatabaseStorage.HashListEntries {
			if entry["hashListId"] == id {
				delete(m.DatabaseStorage.HashListEntries, entryID)
			}
		}
		return calmlens.JSON{}, nil
	case method == "GET" && suffix == "entries":
		return m.listHashListEntries(id, q)
	case method == "POST" && suffix == "entries":
		return m.addHashListEntry(id, body, now)
	default:
		return nil, errUnknownRoute
	}
	return list, nil
}

// listHashListEntries pages a list's entries newest first. The cursor is the base64 offset of
// the next page.
func (m *MockServerClient) listHashListEntries(id string, q url.Values) (any, error) {
	size, err := intRange(q, "pageSize", defaultHashListEntryPageSize, 1, maxPageSize)
	if err != nil {
		return nil, err
	}
	entries := []calmlens.JSON{}
	for _, entry := range m.DatabaseStorage.HashListEntries {
		if entry["hashListId"] == id {
			entries = append(entries, entry)
		}
	}
	newestFirst(entries)
	start := 0
	if encoded := q.Get("cursor"); encoded != "" {
		raw, err := base64.StdEncoding.DecodeString(encoded)
		if err == nil {
			start, err = strconv.Atoi(string(raw))
		}
		if err != nil || start < 0 {
			return nil, fail(calmlens.CodeInvalidCursor)
		}
	}
	start = min(start, len(entries))
	end := min(start+size, len(entries))
	var next any
	if end < len(entries) {
		next = base64.StdEncoding.EncodeToString([]byte(strconv.Itoa(end)))
	}
	ordering := []calmlens.Order{{Field: "createdAt", Direction: "DESC"}, {Field: "id", Direction: "DESC"}}
	return calmlens.JSON{"items": entries[start:end], "hasMore": end < len(entries), "nextCursor": next, "pageSize": size, "ordering": ordering}, nil
}

// addHashListEntry adds a hash, or an image asset's perceptual hash, answering 201 for a new
// entry and 200 with the existing entry when the hash is already listed.
func (m *MockServerClient) addHashListEntry(id string, body calmlens.JSON, now int64) (any, error) {
	hash, hasHash := body["hash"].(string)
	assetID, hasAsset := body["assetId"].(string)
	if hasHash == hasAsset {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	hash = strings.ToLower(strings.TrimSpace(hash))
	var quality any
	if value, ok := body["quality"].(float64); ok {
		quality = value
	}
	var source any
	if hasAsset {
		a, err := m.asset(assetID)
		if err != nil {
			return nil, err
		}
		image := asJSON(section(a, "content")["image"])
		if text(image["perceptualHash"]) == "" {
			return nil, fail(calmlens.CodeHashListAssetNotHashed)
		}
		hash, quality, source = text(image["perceptualHash"]), image["perceptualHashQuality"], assetID
	}
	if !pdqHash.MatchString(hash) {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	for _, entry := range m.DatabaseStorage.HashListEntries {
		if entry["hashListId"] == id && entry["hash"] == hash {
			return entry, nil
		}
	}
	var label any
	if value, ok := body["label"].(string); ok {
		label = value
	}
	entry := calmlens.JSON{"id": m.options.CreateID("hle"), "projectId": m.options.ProjectID, "hashListId": id, "hash": hash, "quality": quality, "label": label, "sourceAssetId": source, "createdByUserId": nil, "createdAt": now}
	m.DatabaseStorage.HashListEntries[text(entry["id"])] = entry
	m.status = http.StatusCreated
	return entry, nil
}
