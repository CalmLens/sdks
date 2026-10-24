// Package calmlenstest provides an in-memory CalmLens fake for tests. It embeds the real
// client, so validation and request encoding run unchanged, and answers over an in-memory
// transport with the API's status codes and error bodies. It does not classify content or
// apply transforms. Import it only in tests.
package calmlenstest

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	calmlens "github.com/CalmLens/sdks/go"
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

// InMemoryDatabaseStorage holds assets and folders as API-shaped JSON maps. An asset's
// processing, moderation and content objects are nested calmlens.JSON maps, so a test can change
// them in place, such as
// db.Assets[id]["classification"].(calmlens.JSON)["moderation"].(calmlens.JSON)["status"] = "blocked".
type InMemoryDatabaseStorage struct {
	Assets  map[string]calmlens.JSON
	Folders map[string]calmlens.JSON
}

// InMemoryImageStorage holds uploaded content by asset ID.
type InMemoryImageStorage struct{ Content map[string]*StoredContent }

// Outcomes of mock uploads, for Options.QueuedOutcome and Options.AnalyzedOutcome.
const (
	// OutcomePending leaves the asset processing with moderation pending.
	OutcomePending = "pending"
	// OutcomeAllowed finishes processing with moderation allowed.
	OutcomeAllowed = "allowed"
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
	// test the client's retry behaviour; retries then wait the real backoff.
	MaxRetries      *int
	DatabaseStorage *InMemoryDatabaseStorage
	ImageStorage    *InMemoryImageStorage
	CreateID        func() string
	// Now returns the current time in unix milliseconds.
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
	failures        []error
	requestCount    int
	mu              sync.Mutex
}

// FailNext queues transport failures. Each following request is captured and then fails
// with the next queued error instead of reaching the in-memory backend, so the client
// returns a *calmlens.Error with code "sdk/transport-error" wrapping it. Queue
// context.DeadlineExceeded (or a net.Error whose Timeout() is true) to get "sdk/timeout".
func (m *MockServerClient) FailNext(errs ...error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.failures = append(m.failures, errs...)
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

// EnqueueEvent appends events to the mock event feed. Missing IDs, project IDs and
// creation times are filled in. Events.List returns them to cursors taken before they
// were enqueued, in order.
func (m *MockServerClient) EnqueueEvent(events ...calmlens.Event) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, event := range events {
		if event.ID == "" {
			event.ID = m.options.CreateID()
		}
		if event.ProjectID == "" {
			event.ProjectID = m.options.ProjectID
		}
		if event.CreatedAt == 0 {
			event.CreatedAt = m.options.Now()
		}
		if event.Facts == nil {
			event.Facts = []calmlens.EventFact{}
		}
		data, _ := json.Marshal(event)
		var stored calmlens.JSON
		_ = json.Unmarshal(data, &stored)
		m.events = append(m.events, stored)
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
		options.CreateID = func() string {
			b := make([]byte, 16)
			if _, err := rand.Read(b); err != nil {
				panic(err)
			}
			return hex.EncodeToString(b)
		}
	}
	if options.Now == nil {
		options.Now = func() int64 { return time.Now().UnixMilli() }
	}
	if options.QueuedOutcome == "" {
		options.QueuedOutcome = OutcomePending
	}
	if options.AnalyzedOutcome == "" {
		options.AnalyzedOutcome = OutcomeAllowed
	}
	for _, outcome := range []string{options.QueuedOutcome, options.AnalyzedOutcome} {
		switch outcome {
		case OutcomePending, OutcomeAllowed, OutcomeAgeRestricted, OutcomeBlocked, OutcomePurged, OutcomeFailed:
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
	mock.ServerClient = client
	return mock, nil
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
	if len(m.failures) > 0 {
		failure := m.failures[0]
		m.failures = m.failures[1:]
		return nil, failure
	}
	m.requestCount++
	header := http.Header{"X-Request-Id": {fmt.Sprintf("req_mock_%d", m.requestCount)}}
	if cdn {
		status, data, contentType := m.serve(req, parts, header)
		return response(req, status, header, contentType, data), nil
	}
	if req.Header.Get("X-Api-Key") != m.options.APIKey {
		return m.jsonResponse(req, header, nil, fail(calmlens.CodeInvalidAPIKey)), nil
	}
	key := req.Header.Get("Idempotency-Key")
	// Like the API, raw uploads are compared by query, Content-Type and length, not bytes.
	compared := ""
	if req.Header.Get("Content-Type") == "application/json" {
		compared = string(raw)
	}
	fingerprint := strings.Join([]string{req.Method, req.URL.EscapedPath(), req.URL.RawQuery, req.Header.Get("Content-Type"), strconv.Itoa(len(raw)), compared}, "\n")
	if key != "" {
		if len(key) > 255 || strings.IndexFunc(key, func(r rune) bool { return r < 0x20 || r > 0x7e }) >= 0 {
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
	result, err := m.dispatch(req.Method, parts, req.URL.Query(), raw, req.Header)
	res := m.jsonResponse(req, header, result, err)
	if key != "" && err == nil {
		data, _ := json.Marshal(result)
		m.replays[key] = replay{fingerprint: fingerprint, status: res.StatusCode, data: data}
	}
	return res, nil
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

func (m *MockServerClient) dispatch(method string, parts []string, q url.Values, raw []byte, headers http.Header) (any, error) {
	body := calmlens.JSON{}
	if headers.Get("Content-Type") == "application/json" && len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			return nil, fail(calmlens.CodeInvalidUploadPayload)
		}
	}
	now := m.options.Now()
	db := m.DatabaseStorage
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
			return m.listEvents(q, now)
		case route == "lenses" && method == "PUT":
			return m.ensureLenses(body, now)
		case route == "folders" && method == "GET":
			folders := []calmlens.JSON{}
			for _, f := range db.Folders {
				if f["projectId"] == m.options.ProjectID && ((q.Get("searchAll") == "true" && q.Get("search") != "") || text(f["parentId"]) == q.Get("parentId")) && strings.Contains(strings.ToLower(text(f["name"])), strings.ToLower(q.Get("search"))) {
					folders = append(folders, f)
				}
			}
			sort.Slice(folders, func(i, j int) bool {
				a, b := text(folders[i]["name"]), text(folders[j]["name"])
				if q.Get("sort") == "createdAt" {
					a, b = fmt.Sprintf("%020v", folders[i]["createdAt"]), fmt.Sprintf("%020v", folders[j]["createdAt"])
				}
				if a == b {
					a, b = text(folders[i]["id"]), text(folders[j]["id"])
				}
				if q.Get("direction") == "DESC" {
					return a > b
				}
				return a < b
			})
			size, _ := strconv.Atoi(q.Get("pageSize"))
			if size == 0 {
				size = 100
			}
			index, _ := strconv.Atoi(q.Get("pageIndex"))
			start := index * size
			end := start + size
			if end > len(folders) {
				end = len(folders)
			}
			if start > end {
				start = end
			}
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
				if f := db.Folders[id]; f != nil && f["projectId"] == m.options.ProjectID {
					inPage := false
					for _, item := range page {
						if text(item["id"]) == id {
							inPage = true
							break
						}
					}
					if !inPage {
						ancestors = append(ancestors, f)
					}
				}
			}
			return calmlens.JSON{"folders": page, "ancestors": ancestors, "hasMore": q.Get("resolveOnly") != "true" && len(folders) > index*size+size}, nil
		case route == "folders" && method == "POST":
			if id := text(body["parentId"]); id != "" {
				if _, err := m.folder(id); err != nil {
					return nil, err
				}
			}
			if err := m.unique(body["name"], body["parentId"], nil); err != nil {
				return nil, err
			}
			body["id"] = m.options.CreateID()
			body["projectId"] = m.options.ProjectID
			body["createdAt"] = now
			body["updatedAt"] = now
			db.Folders[text(body["id"])] = body
			return body, nil
		case route == "assets/page" && method == "GET":
			return m.page(func(a calmlens.JSON) bool { return q.Get("folderId") == "" || a["folderId"] == q.Get("folderId") }, q)
		case route == "assets/search" && method == "GET":
			return m.search(q)
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
	}
	return nil, errUnknownRoute
}

func (m *MockServerClient) listEvents(q url.Values, now int64) (any, error) {
	limit := 100
	if value := q.Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 100 {
			return nil, fail(calmlens.CodeInvalidUploadPayload)
		}
		limit = parsed
	}
	// Cursors are "<sequence>_mock": the number of events already delivered.
	position := len(m.events)
	if after := q.Get("after"); after != "" {
		sequence, ok := strings.CutSuffix(after, "_mock")
		parsed, err := strconv.Atoi(sequence)
		if !ok || err != nil || parsed < 0 || parsed > len(m.events) {
			return nil, fail(calmlens.CodeInvalidEventCursor)
		}
		position = parsed
	}
	end := min(position+limit, len(m.events))
	events := append([]calmlens.JSON{}, m.events[position:end]...)
	return calmlens.JSON{"events": events, "cursor": fmt.Sprintf("%d_mock", end), "hasMore": end < len(m.events)}, nil
}

func (m *MockServerClient) ensureLenses(body calmlens.JSON, now int64) (any, error) {
	definitions, _ := body["lenses"].([]any)
	result := []calmlens.JSON{}
	pending := map[string]calmlens.JSON{}
	for k, v := range m.lenses {
		pending[k] = v
	}
	for _, value := range definitions {
		definition, ok := value.(map[string]any)
		if !ok {
			return nil, fail(calmlens.CodeInvalidUploadPayload)
		}
		id := text(definition["identifier"])
		old := pending[id]
		same := old != nil
		for _, key := range []string{"name", "description", "type", "active", "transforms", "version"} {
			a, _ := json.Marshal(old[key])
			b, _ := json.Marshal(definition[key])
			if !bytes.Equal(a, b) {
				same = false
			}
		}
		if old != nil && !same && number(definition["version"]) <= number(old["version"]) {
			return nil, fail(calmlens.CodeLensVersionConflict)
		}
		lens := old
		if !same {
			lens = definition
			lens["id"] = m.options.CreateID()
			lens["createdAt"] = now
			if old != nil {
				lens["id"] = old["id"]
				lens["createdAt"] = old["createdAt"]
			}
			lens["projectId"] = m.options.ProjectID
			lens["userId"] = nil
			lens["updatedAt"] = now
		}
		pending[id] = lens
		result = append(result, lens)
	}
	m.lenses = pending
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
			if key == "metadata" || key == "processingOptions" {
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
	if external := text(options["externalId"]); external != "" {
		for _, other := range m.DatabaseStorage.Assets {
			if other["projectId"] == m.options.ProjectID && other["externalId"] == external {
				return nil, fail(calmlens.CodeDuplicateExternalID)
			}
		}
	}
	mime := q.Get("contentType")
	kind := "file"
	if options["url"] != nil {
		kind = "website"
	} else {
		for _, prefix := range []string{"image", "video", "audio"} {
			if strings.HasPrefix(mime, prefix+"/") {
				kind = prefix
			}
		}
		if strings.HasPrefix(mime, "text/") {
			kind = "plaintext-document"
		}
		if strings.Contains(mime, "pdf") || strings.Contains(mime, "document") {
			kind = "multimedia-document"
		}
	}
	queue := q.Get("queue") == "true"
	open := multipart && q.Get("isFinal") != "true"
	a := calmlens.JSON{}
	for _, key := range []string{"name", "description", "metadata", "externalId", "externalUrl", "processingOptions", "folderId", "visibility"} {
		if v, ok := options[key]; ok {
			a[key] = v
		}
	}
	if folder := text(a["folderId"]); folder != "" {
		if _, err := m.folder(folder); err != nil {
			return nil, err
		}
	}
	id := m.options.CreateID()
	a["id"] = id
	a["projectId"] = m.options.ProjectID
	a["type"] = kind
	a["createdAt"] = now
	a["updatedAt"] = now
	a["parentId"] = nil
	a["tags"] = []any{}
	if a["visibility"] == nil {
		a["visibility"] = calmlens.VisibilityPrivate
	}
	processing := calmlens.JSON{"status": calmlens.ClassificationStatusProcessing, "updatedAt": now, "completedAt": nil}
	uploadState := calmlens.JSON{"status": "completed", "updatedAt": now, "partsReceived": nil}
	if open {
		processing["status"] = calmlens.ClassificationStatusPending
		uploadState["status"] = "uploading"
	}
	contentStatus := calmlens.ContentStatusTemporary
	if keep, _ := asJSON(options["processingOptions"])["keepContentAfterProcessing"].(bool); keep {
		contentStatus = calmlens.ContentStatusStored
	}
	content := calmlens.JSON{
		"status": contentStatus, "removalReason": nil, "updatedAt": now, "safetyHold": nil,
		"format": nil, "extension": nil, "sizeInBytes": nil, "checksums": nil, "image": nil,
		"previewImage": nil, "extractedText": nil,
	}
	a["upload"] = uploadState
	a["classification"] = processing
	processing["moderation"] = calmlens.JSON{
		"status": calmlens.ModerationStatusPending, "manualReviews": []any{},
	}
	a["content"] = content
	if options["url"] != nil {
		a["externalUrl"] = options["url"]
	} else {
		if mime != "" {
			content["format"] = mime
		}
		content["sizeInBytes"] = len(raw)
		m.ImageStorage.Content[id] = &StoredContent{Type: mime, Parts: map[int][]byte{1: raw}}
	}
	if multipart {
		uploadState["partsReceived"] = 1
		state := &upload{queue: queue}
		if total := q.Get("totalSizeInBytes"); total != "" {
			size, err := strconv.ParseInt(total, 10, 64)
			if err != nil || size < int64(len(raw)) {
				return nil, fail(calmlens.CodeUploadSizeMismatch)
			}
			state.totalSize = &size
		}
		if open {
			m.uploads[id] = state
		}
	}
	if !open {
		m.applyOutcome(a, m.outcome(queue), now)
	}
	m.DatabaseStorage.Assets[id] = a
	return a, nil
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

// applyOutcome moves an asset to outcome like the pipeline: a decision finishes processing,
// OutcomePurged deletes the content, and finished processing removes content kept only
// temporarily (keepContentAfterProcessing off).
func (m *MockServerClient) applyOutcome(a calmlens.JSON, outcome string, now int64) {
	decided := outcome != OutcomePending && outcome != OutcomeFailed
	processing, moderation, content := section(a, "classification"), section(section(a, "classification"), "moderation"), section(a, "content")
	processing["updatedAt"] = now
	section(a, "upload")["status"] = "completed"
	section(a, "upload")["updatedAt"] = now
	moderation["status"] = calmlens.ModerationStatusPending
	processing["completedAt"] = nil
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
	switch {
	case outcome == OutcomePurged:
		m.removeContent(a, calmlens.ContentRemovalReasonPolicy, now)
	case decided && content["status"] == calmlens.ContentStatusTemporary:
		m.removeContent(a, calmlens.ContentRemovalReasonRetention, now)
	}
}

// removeContent deletes the asset's stored bytes and marks its content removed for reason.
func (m *MockServerClient) removeContent(a calmlens.JSON, reason string, now int64) {
	delete(m.ImageStorage.Content, text(a["id"]))
	content := section(a, "content")
	if content["status"] == calmlens.ContentStatusRemoved {
		return
	}
	content["status"] = calmlens.ContentStatusRemoved
	content["removalReason"] = reason
	content["updatedAt"] = now
	content["extractedText"] = nil
}

func (m *MockServerClient) assetRoute(method, id, suffix string, body calmlens.JSON, q url.Values, raw []byte, now int64) (any, error) {
	a, err := m.asset(id)
	if err != nil {
		return nil, err
	}
	switch {
	case method == "GET" && suffix == "":
	case method == "DELETE" && suffix == "":
		delete(m.ImageStorage.Content, id)
		delete(m.DatabaseStorage.Assets, id)
		delete(m.uploads, id)
		return calmlens.JSON{}, nil
	case method == "PATCH" && suffix == "":
		for key, value := range body {
			a[key] = value
		}
	case method == "DELETE" && suffix == "content":
		// Like the API: the record and report stay; stored content and extracted text go.
		m.removeContent(a, calmlens.ContentRemovalReasonRequested, now)
	case method == "GET" && suffix == "children":
		return m.page(func(child calmlens.JSON) bool { return child["parentId"] == id }, q)
	case method == "POST" && suffix == "signed-url":
		params := url.Values{"expiresInSeconds": {fmt.Sprint(body["expiresInSeconds"])}}
		for _, key := range []string{"lens", "transform"} {
			if value := text(body[key]); value != "" {
				params.Set(key, value)
			}
		}
		return calmlens.JSON{"url": m.options.SignedURLBaseURL + "/assets/" + id + "/" + text(body["resource"]) + "?" + params.Encode(), "expiresAt": now + int64(number(body["expiresInSeconds"])*1000)}, nil
	case method == "POST" && suffix == "retry":
		if section(a, "classification")["status"] != calmlens.ClassificationStatusFailed {
			return nil, fail(calmlens.CodeAssetNotRetryable)
		}
		if section(a, "content")["status"] == calmlens.ContentStatusRemoved {
			return nil, fail(calmlens.CodeAssetContentUnavailable)
		}
		// Like the API: back to processing, to be moderated again.
		m.applyOutcome(a, OutcomePending, now)
	case method == "POST" && suffix == "move":
		if folder := text(body["folderId"]); folder != "" {
			if _, err = m.folder(folder); err != nil {
				return nil, err
			}
		}
		a["folderId"] = body["folderId"]
	case method == "POST" && suffix == "part":
		if err := m.uploadPart(a, id, q, raw, now); err != nil {
			return nil, err
		}
	default:
		return nil, errUnknownRoute
	}
	if method != "GET" {
		a["updatedAt"] = now
	}
	return a, nil
}

func (m *MockServerClient) uploadPart(a calmlens.JSON, id string, q url.Values, raw []byte, now int64) error {
	state := m.uploads[id]
	stored := m.ImageStorage.Content[id]
	processing := section(a, "upload")
	if state == nil || stored == nil || processing["status"] != "uploading" {
		return fail(calmlens.CodeUploadNotOpen)
	}
	if size := q.Get("sizeInBytes"); size != "" && size != strconv.Itoa(len(raw)) {
		return fail(calmlens.CodeInvalidUploadPayload)
	}
	part, _ := strconv.Atoi(q.Get("partNumber"))
	expected := int(number(processing["partsReceived"])) + 1
	if part != expected {
		failure := fail(calmlens.CodeInvalidUploadPartNumber).(*apiError)
		failure.details = calmlens.JSON{"expectedPartNumber": expected}
		return failure
	}
	size := int64(0)
	for _, value := range stored.Parts {
		size += int64(len(value))
	}
	size += int64(len(raw))
	final := q.Get("isFinal") == "true"
	if state.totalSize != nil && (size > *state.totalSize || final && size != *state.totalSize) {
		return fail(calmlens.CodeUploadSizeMismatch)
	}
	stored.Parts[part] = raw
	section(a, "content")["sizeInBytes"] = size
	processing["partsReceived"] = part
	if !final {
		return nil
	}
	queue := state.queue
	if override := q.Get("queue"); override != "" {
		queue = override == "true"
	}
	delete(m.uploads, id)
	m.applyOutcome(a, m.outcome(queue), now)
	return nil
}

func (m *MockServerClient) folderRoute(method, id, suffix string, body calmlens.JSON, now int64) (any, error) {
	f, err := m.folder(id)
	if err != nil {
		return nil, err
	}
	switch {
	case method == "GET" && suffix == "":
	case method == "DELETE" && suffix == "":
		for _, a := range m.DatabaseStorage.Assets {
			if a["folderId"] == id {
				return nil, fail(calmlens.CodeFolderNotEmpty)
			}
		}
		for _, other := range m.DatabaseStorage.Folders {
			if other["parentId"] == id {
				return nil, fail(calmlens.CodeFolderNotEmpty)
			}
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
	case method == "PATCH" && suffix == "":
		if name, ok := body["name"]; ok {
			if err = m.unique(name, f["parentId"], id); err != nil {
				return nil, err
			}
			f["name"] = name
		}
	default:
		return nil, errUnknownRoute
	}
	if method != "GET" {
		f["updatedAt"] = now
	}
	return f, nil
}

// page lists project assets accepted by include, applying the RSQL filter, ordering and
// pagination from the query like the API.
func (m *MockServerClient) page(include func(calmlens.JSON) bool, q url.Values) (any, error) {
	var filter filterNode
	if expression := q.Get("filter"); expression != "" {
		var err error
		if filter, err = parseFilter(expression); err != nil {
			return nil, &apiError{code: "mock/invalid-filter", status: http.StatusBadRequest, details: calmlens.JSON{"reason": err.Error()}}
		}
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
	hasID := false
	for _, order := range ordering {
		if order.Field == "id" {
			hasID = true
		}
	}
	if !hasID {
		ordering = append(ordering, calmlens.Order{Field: "id", Direction: ordering[0].Direction})
	}
	items := []calmlens.JSON{}
	for _, a := range m.DatabaseStorage.Assets {
		if a["projectId"] == m.options.ProjectID && include(a) && (filter == nil || filter.match(a)) {
			items = append(items, a)
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		for _, order := range ordering {
			left, right := lookup(items[i], order.Field), lookup(items[j], order.Field)
			result := 0
			switch {
			case left == nil && right == nil:
			case left == nil:
				result = -1
			case right == nil:
				result = 1
			default:
				result = compareValues(left, fmt.Sprint(right))
			}
			if result != 0 {
				return result < 0 == (order.Direction == "ASC")
			}
		}
		if number(items[i]["createdAt"]) == number(items[j]["createdAt"]) {
			return text(items[i]["id"]) < text(items[j]["id"])
		}
		return number(items[i]["createdAt"]) < number(items[j]["createdAt"])
	})
	if cursor := q.Get("cursor"); cursor != "" {
		raw, err := base64.StdEncoding.DecodeString(cursor)
		var boundary calmlens.JSON
		if err != nil || json.Unmarshal(raw, &boundary) != nil {
			return nil, fail(calmlens.CodeInvalidCursor)
		}
		for _, order := range ordering {
			if order.Field == "id" {
				if _, ok := boundary[order.Field].(string); !ok {
					return nil, fail(calmlens.CodeInvalidCursor)
				}
			} else {
				if _, ok := boundary[order.Field].(float64); !ok {
					return nil, fail(calmlens.CodeInvalidCursor)
				}
			}
		}
		remaining := []calmlens.JSON{}
		for _, item := range items {
			for _, order := range ordering {
				comparison := compareValues(lookup(item, order.Field), fmt.Sprint(boundary[order.Field]))
				if comparison == 0 {
					continue
				}
				if (comparison > 0) == (order.Direction == "ASC") {
					remaining = append(remaining, item)
				}
				break
			}
		}
		items = remaining
	}
	size, _ := strconv.Atoi(q.Get("pageSize"))
	if size <= 0 {
		size = 10
	}
	if size > 100 {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	end := min(size, len(items))
	var cursor any
	if end < len(items) {
		boundary := calmlens.JSON{}
		for _, order := range ordering {
			boundary[order.Field] = lookup(items[end-1], order.Field)
		}
		raw, _ := json.Marshal(boundary)
		cursor = base64.StdEncoding.EncodeToString(raw)
	}
	return calmlens.JSON{"items": items[:end], "nextCursor": cursor, "pageSize": size, "ordering": ordering, "hasMore": end < len(items)}, nil
}

// search ranks assets whose name, ID, external ID, description or tags contain every
// query word. Semantic search is not simulated, so semanticStatus is "disabled".
func (m *MockServerClient) search(q url.Values) (any, error) {
	queryText := strings.TrimSpace(q.Get("query"))
	if queryText == "" || len(queryText) > 200 {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	limit := 10
	if value := q.Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 20 {
			return nil, fail(calmlens.CodeInvalidUploadPayload)
		}
		limit = parsed
	}
	words := strings.Fields(strings.ToLower(queryText))
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
		values := map[string]string{"name": text(a["name"]), "id": text(a["id"]), "externalId": text(a["externalId"]), "description": text(a["description"])}
		if tags, ok := a["tags"].([]any); ok {
			values["tags"] = strings.ToLower(fmt.Sprint(tags...))
		}
		fields := []string{}
		found := 0
		for _, word := range words {
			hit := false
			for field, value := range values {
				if strings.Contains(strings.ToLower(value), word) {
					hit = true
					if !contains(fields, field) {
						fields = append(fields, field)
					}
				}
			}
			if hit {
				found++
			}
		}
		if found == len(words) {
			sort.Strings(fields)
			matches = append(matches, match{a, float64(len(fields)) / float64(len(values)), fields})
		}
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].score == matches[j].score {
			return text(matches[i].asset["id"]) < text(matches[j].asset["id"])
		}
		return matches[i].score > matches[j].score
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

func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}

// serve answers a CDN request like the CDN: JSON errors, content type and length, and
// single byte ranges.
func (m *MockServerClient) serve(req *http.Request, parts []string, header http.Header) (int, []byte, string) {
	errorBody := func(status int, code string) (int, []byte, string) {
		data, _ := json.Marshal(calmlens.JSON{"code": code, "message": http.StatusText(status)})
		return status, data, "application/json"
	}
	if len(parts) < 4 || parts[0] != "assets" || parts[1] != m.options.ProjectID {
		return errorBody(http.StatusNotFound, calmlens.CodeAssetNotFound)
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
		return errorBody(http.StatusNotFound, calmlens.CodeAssetNotFound)
	}
	// A public age-restricted asset is served from its public URL only with the
	// allowAgeRestricted=true opt-in; otherwise it needs the download permission, like a private one.
	ageRestricted := section(section(asset, "classification"), "moderation")["status"] == calmlens.ModerationStatusAgeRestricted
	restricted := asset["visibility"] != calmlens.VisibilityPublic || ageRestricted && req.URL.Query().Get("allowAgeRestricted") != "true"
	if restricted && !m.canDownload(text(asset["folderId"]), req.Header.Get("X-Api-Key")) {
		return errorBody(http.StatusForbidden, "asset/api-key-missing-permission")
	}
	stored := m.ImageStorage.Content[text(asset["id"])]
	if stored == nil || section(asset, "upload")["status"] == "uploading" {
		return errorBody(http.StatusNotFound, calmlens.CodeAssetContentUnavailable)
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
	header.Set("Accept-Ranges", "bytes")
	if spec, ok := strings.CutPrefix(req.Header.Get("Range"), "bytes="); ok && !strings.Contains(spec, ",") {
		startText, endText, _ := strings.Cut(spec, "-")
		start, startErr := strconv.Atoi(startText)
		end, endErr := strconv.Atoi(endText)
		if endText == "" {
			end, endErr = len(data)-1, nil
		}
		if startErr != nil || endErr != nil || start > end || start >= len(data) {
			return errorBody(http.StatusRequestedRangeNotSatisfiable, "cdn/invalid-range")
		}
		end = min(end, len(data)-1)
		header.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(data)))
		return http.StatusPartialContent, data[start : end+1], stored.Type
	}
	return http.StatusOK, data, stored.Type
}

func (m *MockServerClient) canDownload(folder, apiKey string) bool {
	data, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(apiKey, "sk_test_"))
	if err != nil {
		return false
	}
	var grants []Grant
	if json.Unmarshal(data, &grants) != nil {
		return false
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
