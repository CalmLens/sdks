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
	"unicode/utf16"

	calmlens "github.com/CalmLens/sdks/go"
	"github.com/CalmLens/sdks/go/internal/clock"
	"github.com/CalmLens/sdks/go/internal/contract"
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

// Options mirrors calmlens.Options (APIKey, ProjectID, BaseURL, CDNBaseURL, Timeout,
// UploadTimeout, MaxRetries, MaxResponseBytes, PartSizeBytes) and adds in-memory storage and deterministic
// ID, clock and moderation controls.
type Options struct {
	APIKey string
	// ProjectID defaults to DefaultProjectID.
	ProjectID string
	// BaseURL and Timeout are validated and applied exactly as by calmlens.NewServerClient; requests
	// never leave the process.
	BaseURL string
	Timeout time.Duration
	// UploadTimeout and MaxResponseBytes are validated and applied as by calmlens.NewServerClient.
	UploadTimeout    time.Duration
	MaxResponseBytes int64
	// PartSizeBytes is validated and applied as by calmlens.NewServerClient: larger content the
	// client can read again is uploaded to the mock in parts.
	PartSizeBytes int64
	// MaxRetries defaults to 0 in the mock, so a FailNextRequest failure fails exactly one call.
	// Set it to test the client's retry behaviour. Waits take no real time: retry backoff and
	// Assets.WaitForDecision only advance the mock client's clock, so WaitForDecision returns
	// sdk/timeout at once for an asset that stays queued or processing.
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
	// Moderate decides each asset the mock moderates: completed uploads (Assets.Create,
	// Assets.Classify, Text.Classify and final parts), Assets.Retry, Assets.Explain with Rerun,
	// and CompleteProcessing without a decision. Return NewDecision(status), with any Flag and
	// NotEvaluated calls; nil, or no Moderate, means DefaultModerate: queued work stays pending
	// and the rest is allowed. A pending decision leaves the asset processing; for a re-run it
	// keeps the asset's decision until CompleteProcessing, and a failed re-run keeps it. Finished
	// processing removes content unless the upload set
	// ProcessingOptions.KeepContentAfterProcessing. Moderate runs while the mock answers a
	// request, so it must not call the mock.
	Moderate func(ModerationInput) *Decision
	// CDNBaseURL defaults to https://mock.calmlens.invalid/v1. CDN.SignAssetURL returns asset URLs
	// beneath it, which only the mock's CDN accepts.
	CDNBaseURL string
}

// CapturedRequest is a request the client sent to the mock, already decoded.
type CapturedRequest struct {
	Method string
	// Path is unescaped and relative to the API base URL (or the CDN base URL when CDN is
	// true), for example "/projects/my-project/assets".
	Path   string
	Query  url.Values
	Header http.Header
	// Body is the decoded JSON body (plain text arrives as its content.plainText), the options of
	// an upload form, or nil for empty bodies and raw parts.
	Body calmlens.JSON
	// File is an upload form's file bytes, or nil for any other request.
	File []byte
	// RawBody holds the exact bytes sent, including upload content.
	RawBody []byte
	CDN     bool
	// Status is the HTTP status the mock answered with, or nil when the request failed without a
	// response.
	Status *int
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
	policies        policyStore
	uploads         map[string]*upload
	events          []calmlens.JSON
	// assetSequences is each asset's latest event assetSequence, which the API keeps on the asset.
	assetSequences map[string]int64
	replays        map[string]replay
	requests       []CapturedRequest
	failures       []RequestFailure
	grants         []Grant
	requestCount   int
	// lastStatus is the HTTP status of the last response, 0 when the last request failed
	// without one; the contract tests check it.
	lastStatus int
	// status overrides successStatus for the request being answered, 0 when it does not.
	status int
	// waited is the time the client has spent waiting; mock waits advance it instead of sleeping.
	waited time.Duration
	mu     sync.Mutex

	// processingOptions are the processing options each asset was uploaded with, which the API
	// keeps but doesn't return.
	processingOptions map[string]calmlens.JSON
	// reruns are the decided assets whose re-run (Assets.Explain with Rerun) is still queued; they
	// keep their decision until CompleteProcessing decides them.
	reruns map[string]bool
}

// Failures for RequestFailure.Code besides API error codes.
const (
	// FailureTransportError fails the request as a reset connection would (sdk/transport-error).
	FailureTransportError = "transport-error"
	// FailureTimeout fails the request as an expired deadline would (sdk/timeout).
	FailureTimeout = "timeout"
)

// RequestFailure is how FailNextRequest fails a request.
type RequestFailure struct {
	// Code is FailureTransportError, FailureTimeout or an API error code, such as
	// calmlens.CodeFreeUploadsExhausted, which the mock answers with its HTTP status.
	Code string
	// Err, instead of Code, is the transport error the request fails with: the client returns a
	// *calmlens.Error with code sdk/transport-error wrapping it, or sdk/timeout for
	// context.DeadlineExceeded or a net.Error whose Timeout() is true.
	Err error
	// Operation limits the failure to requests from one client method, named like the
	// JavaScript client's method path, such as "assets.create" or "cdn.serve"; empty for any.
	Operation string
	// Details are the API error's details.
	Details calmlens.JSON
	// RetryAfter, a whole number of seconds, is sent as the API error's Retry-After header.
	RetryAfter *time.Duration
}

// FailNextRequest queues failures. Each one fails exactly one later request (the next one, or
// the next of its Operation) without running it: the request is captured, then answered with
// the API error or failed with the transport error. A client retry takes the next queued
// failure or reaches the in-memory backend. It returns an sdk/invalid-argument error, queueing
// nothing, for a failure without exactly one of Code and Err, an unknown code or operation,
// Details or RetryAfter without an API error code, or a negative or fractional RetryAfter.
func (m *MockServerClient) FailNextRequest(failures ...RequestFailure) error {
	for _, failure := range failures {
		if err := checkFailure(failure); err != nil {
			return err
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.failures = append(m.failures, failures...)
	return nil
}

func checkFailure(failure RequestFailure) error {
	invalid := func(message string) error {
		return &calmlens.Error{Code: calmlens.CodeSDKInvalidArgument, Message: message}
	}
	_, apiCode := calmlens.PublicErrorStatus(failure.Code)
	switch {
	case (failure.Code == "") == (failure.Err == nil):
		return invalid("a request failure needs exactly one of Code and Err")
	case failure.Code != "" && failure.Code != FailureTransportError && failure.Code != FailureTimeout && !apiCode:
		return invalid("unknown request failure " + strconv.Quote(failure.Code))
	case failure.Operation != "" && !slices.Contains(mockOperations, failure.Operation):
		return invalid("unknown operation " + strconv.Quote(failure.Operation))
	case !apiCode && (failure.Details != nil || failure.RetryAfter != nil):
		return invalid("Details and RetryAfter need an API error code")
	case failure.RetryAfter != nil && (*failure.RetryAfter < 0 || *failure.RetryAfter%time.Second != 0):
		return invalid("RetryAfter must be a whole number of seconds")
	}
	return nil
}

// transportFailure is the error a queued transport failure fails its request with.
func transportFailure(failure RequestFailure) error {
	switch {
	case failure.Err != nil:
		return failure.Err
	case failure.Code == FailureTimeout:
		return context.DeadlineExceeded
	}
	return errors.New("mock transport error")
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
// project IDs, actors (the mock's API key, which has no ID: calmlens.ActorAPIKey with a nil ID),
// severities (low), titles (the type), facts and creation times are filled in, each
// event about an asset takes that asset's next AssetSequence like the API's (any given one is
// ignored; events without an AssetID have none), and
// an event with the AssetID of a stored asset and no Asset carries that asset's snapshot, like
// the API's events, with the moderation status an asset.<status> event announces. Events.List returns them to cursors taken before they were enqueued, in
// order.
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
		if event.Actor.Type == "" {
			event.Actor = mockAPIKeyActor
		}
		if event.CreatedAt == 0 {
			event.CreatedAt = m.options.Now()
		}
		if event.Facts == nil {
			event.Facts = []calmlens.EventFact{}
		}
		event.AssetSequence = nil
		if event.AssetID != nil {
			sequence := m.nextAssetSequence(*event.AssetID)
			event.AssetSequence = &sequence
		}
		data, _ := json.Marshal(event)
		var raw calmlens.JSON
		_ = json.Unmarshal(data, &raw)
		if event.Asset == nil && event.AssetID != nil {
			if a, err := m.asset(*event.AssetID); err == nil {
				asset := snapshot(a)
				// An asset.<status> event carries the moderation status it announces.
				if status, ok := announcedStatus[event.Type]; ok {
					section(asset, "classification")["moderation"] = calmlens.JSON{"status": status}
				}
				raw["asset"] = asset
				data, _ = json.Marshal(raw)
			}
		}
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
// event whose Actor is a calmlens.ActorUser joins the events feed. The moderation report stays as
// it was. It returns a *calmlens.Error with code asset/not-found for an unknown asset, and
// sdk/invalid-argument for another decision, such as OutcomePending or OutcomeFailed.
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
	m.recordReview(a, decision, nil)
	return toAsset(a)
}

// CompleteProcessing finishes processing a processing asset as the pipeline would, with
// decision, or with Options.Moderate's decision for TriggerComplete when decision is nil, and
// records the pipeline's events. It records no manual review. It returns a *calmlens.Error with
// code asset/not-found for an unknown asset, and sdk/invalid-argument for an asset that isn't
// processing or an invalid decision. A decided asset whose re-run is still queued is processing
// for this: the decision replaces its old one, unless it is pending or failed.
func (m *MockServerClient) CompleteProcessing(assetID string, decision *Decision) (*calmlens.Asset, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, err := m.asset(assetID)
	if err != nil {
		return nil, &calmlens.Error{Code: calmlens.CodeAssetNotFound, Message: "Asset not found", Status: http.StatusNotFound}
	}
	rerun := m.reruns[assetID]
	if !rerun && section(a, "classification")["status"] != calmlens.ClassificationStatusProcessing {
		return nil, &calmlens.Error{Code: calmlens.CodeSDKInvalidArgument, Message: "Asset " + assetID + " isn't processing"}
	}
	if decision == nil {
		if decision, err = m.decisionFor(a, TriggerComplete, true, nil); err != nil {
			return nil, err
		}
	} else if err = decision.Err(); err != nil {
		return nil, err
	}
	if rerun {
		m.settleRerun(a, decision)
	} else {
		m.settle(a, decision)
	}
	return toAsset(a)
}

// toAsset is a stored asset as the client returns it.
func toAsset(a calmlens.JSON) (*calmlens.Asset, error) {
	data, _ := json.Marshal(a)
	var asset calmlens.Asset
	if err := json.Unmarshal(data, &asset); err != nil {
		return nil, err
	}
	return &asset, nil
}

// recordReview applies a reviewer's decision to a stored asset, like the API: the moderation
// status changes (purged also removes the content with removal reason requested, recording an
// asset.content-removed event first), the review joins manualReviews, and an
// "asset.<decision>" event joins the events feed. note is the reviewer's note, or nil for the
// Decide test hook. A decision through the API (with its note) is the mock API key's; the
// Decide test hook's is a reviewer's, whose user ID the mock doesn't know.
func (m *MockServerClient) recordReview(a calmlens.JSON, decision string, note any) {
	// Like the API: a queued re-run no longer replaces a reviewed decision.
	delete(m.reruns, text(a["id"]))
	m.applyOutcome(a, decision, calmlens.ContentRemovalReasonRequested, nil)
	now := m.options.Now()
	moderation := section(section(a, "classification"), "moderation")
	reviews, _ := moderation["manualReviews"].([]any)
	moderation["manualReviews"] = append(reviews, calmlens.JSON{
		"id": m.options.CreateID("rev"), "decision": decision, "note": note,
		// The review is the mock API key's, and mock API keys have no ID.
		"decidedBy": calmlens.JSON{"type": calmlens.ReviewActorAPIKey, "id": nil}, "reviewedAt": now, "applied": true,
	})
	actor := mockAPIKeyActor
	if note == nil {
		actor = mockReviewerActor
	}
	if decision == OutcomePurged {
		m.recordLifecycleEvent(calmlens.EventAssetContentRemoved, a, actor, "")
	}
	// Like the event catalog: only allowing and limiting are low severity.
	severity := calmlens.SeverityHigh
	if decision == OutcomeAllowed || decision == OutcomeLimited {
		severity = calmlens.SeverityLow
	}
	m.addEvent("asset."+decision, severity, a, actor, []any{
		calmlens.JSON{"key": calmlens.FactAssetType, "value": a["type"]},
		calmlens.JSON{"key": calmlens.FactAssetName, "value": a["name"], "url": "https://calmlens.com/go/asset/" + text(a["id"])},
		calmlens.JSON{"key": calmlens.FactNote, "value": note},
	})
}

// maxDecisionNote is the longest reviewer note the API accepts after trimming, in UTF-16 code
// units as JavaScript counts string length.
const maxDecisionNote = 1499

// decideAsset answers POST /assets/:id/decision like the API: the body is validated first
// (a known decision, a trimmed note of 1 to 1499 characters, confirmPurge: true to purge), then
// the asset must exist and have finished uploading and processing (asset/processing). An
// undecided asset (whose processing failed) can only be blocked or purged, the current status is
// refused as unchanged, and purged content can only be blocked. Mock assets carry no safety
// holds and the mock key may make every decision.
func (m *MockServerClient) decideAsset(id string, body calmlens.JSON) (any, error) {
	decision := text(body["decision"])
	switch decision {
	case OutcomeAllowed, OutcomeLimited, OutcomeAgeRestricted, OutcomeBlocked, OutcomePurged:
	default:
		return nil, validation("validation/invalid-value", "decision")
	}
	note, isText := body["note"].(string)
	note = strings.TrimSpace(note)
	switch {
	case !isText:
		return nil, validation("validation/invalid-type", "note")
	case note == "":
		return nil, validation("validation/too-small", "note")
	case len(utf16.Encode([]rune(note))) > maxDecisionNote:
		return nil, validation("validation/too-big", "note")
	}
	if decision == OutcomePurged && body["confirmPurge"] != true {
		return nil, validation("validation/invalid-value", "confirmPurge")
	}
	a, err := m.asset(id)
	if err != nil {
		return nil, err
	}
	status := section(section(a, "classification"), "moderation")["status"]
	switch {
	case section(a, "upload")["status"] == "uploading" || section(a, "classification")["status"] == calmlens.ClassificationStatusProcessing:
		return nil, fail(calmlens.CodeAssetProcessing)
	case status == calmlens.ModerationStatusPending && decision != OutcomeBlocked && decision != OutcomePurged:
		return nil, fail(calmlens.CodeAssetDecisionNotAllowed)
	case status == decision:
		return nil, fail(calmlens.CodeAssetDecisionUnchanged)
	case decision != OutcomeBlocked && decision != OutcomePurged && contentPurged(a):
		return nil, fail(calmlens.CodeAssetContentPurged)
	}
	m.recordReview(a, decision, note)
	return a, nil
}

// contentPurged is whether an asset's content was purged, like the API: it was purged by a
// reviewer, or removed by policy.
func contentPurged(a calmlens.JSON) bool {
	if section(section(a, "classification"), "moderation")["status"] == calmlens.ModerationStatusPurged {
		return true
	}
	content := section(a, "content")
	if content["status"] == calmlens.ContentStatusRemoved && (content["removalReason"] == calmlens.ContentRemovalReasonPolicy || content["removalReason"] == calmlens.ContentRemovalReasonDisposed) {
		return true
	}
	reviews, _ := section(section(a, "classification"), "moderation")["manualReviews"].([]any)
	return slices.ContainsFunc(reviews, func(review any) bool {
		return asJSON(review)["decision"] == OutcomePurged && asJSON(review)["applied"] == true
	})
}

// nextAssetSequence returns the assetSequence of the next event about assetID, like the API:
// 1 for its first event, then one more for each later one.
func (m *MockServerClient) nextAssetSequence(assetID string) int64 {
	m.assetSequences[assetID]++
	return m.assetSequences[assetID]
}

// The actors of the mock's events: its API key (mock keys have no ID), a reviewer deciding through
// the Decide test hook (whose user ID the mock doesn't know) and automated moderation.
var (
	mockAPIKeyActor   = calmlens.Actor{Type: calmlens.ActorAPIKey}
	mockReviewerActor = calmlens.Actor{Type: calmlens.ActorUser}
	automatedActor    = calmlens.Actor{Type: calmlens.ActorAutomated}
)

// addEvent records an event about asset, caused by actor, in the feed.
func (m *MockServerClient) addEvent(eventType, severity string, a calmlens.JSON, actor calmlens.Actor, facts []any) {
	now := m.options.Now()
	m.events = append(m.events, calmlens.JSON{
		"id": m.options.CreateID("evt"), "projectId": m.options.ProjectID, "actor": calmlens.JSON{"type": actor.Type, "id": actor.ID},
		"type": eventType, "severity": severity, "title": eventType,
		"description": nil, "assetId": a["id"], "assetSequence": m.nextAssetSequence(text(a["id"])), "asset": snapshot(a),
		"facts": facts, "createdAt": now,
	})
}

// recordLifecycleEvent adds an asset.deleted, asset.content-removed or asset.retried event caused
// by actor, like the API, with the batch-id fact when batchID is set. A deleted asset has no
// portal page to link its name to.
func (m *MockServerClient) recordLifecycleEvent(eventType string, a calmlens.JSON, actor calmlens.Actor, batchID string) {
	name := calmlens.JSON{"key": calmlens.FactAssetName, "value": a["name"]}
	if eventType != calmlens.EventAssetDeleted {
		name["url"] = "https://calmlens.com/go/asset/" + text(a["id"])
	}
	facts := []any{name, calmlens.JSON{"key": calmlens.FactAssetType, "value": a["type"]}}
	if batchID != "" {
		facts = append(facts, calmlens.JSON{"key": calmlens.FactBatchID, "value": batchID})
	}
	m.addEvent(eventType, calmlens.SeverityLow, a, actor, facts)
}

// snapshot is the asset summary events carry.
// announcedStatus is the moderation status each asset.<status> event announces.
var announcedStatus = map[string]string{
	"asset.allowed": "allowed", "asset.limited": "limited", "asset.age-restricted": "age-restricted",
	"asset.blocked": "blocked", "asset.purged": "purged",
}

func snapshot(a calmlens.JSON) calmlens.JSON {
	return calmlens.JSON{
		"id": a["id"], "externalId": a["externalId"], "uploadPresetId": a["uploadPresetId"],
		"upload":  calmlens.JSON{"status": section(a, "upload")["status"]},
		"content": calmlens.JSON{"status": section(a, "content")["status"]},
		"classification": calmlens.JSON{
			"status":     section(a, "classification")["status"],
			"testInput":  section(a, "classification")["testInput"],
			"moderation": calmlens.JSON{"status": section(section(a, "classification"), "moderation")["status"]},
		},
	}
}

// DefaultProjectID is the project ID of a mock built without one.
const DefaultProjectID = "project-1"

// NewServerClient returns a mock client, with project ID DefaultProjectID unless Options.ProjectID
// is set. Invalid options are rejected like calmlens.NewServerClient.
func NewServerClient(options Options) (*MockServerClient, error) {
	if options.ProjectID == "" {
		options.ProjectID = DefaultProjectID
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
	if options.Moderate == nil {
		options.Moderate = DefaultModerate
	}
	if options.CDNBaseURL == "" {
		options.CDNBaseURL = "https://mock.calmlens.invalid/v1"
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
	mock := &MockServerClient{DatabaseStorage: db, ImageStorage: images, options: options, lenses: map[string]calmlens.JSON{}, uploads: map[string]*upload{}, replays: map[string]replay{}, assetSequences: map[string]int64{}, processingOptions: map[string]calmlens.JSON{}, reruns: map[string]bool{}}
	client, err := calmlens.NewServerClient(calmlens.Options{APIKey: options.APIKey, ProjectID: options.ProjectID, BaseURL: options.BaseURL, CDNBaseURL: options.CDNBaseURL, Timeout: options.Timeout, UploadTimeout: options.UploadTimeout, MaxRetries: options.MaxRetries, MaxResponseBytes: options.MaxResponseBytes, PartSizeBytes: options.PartSizeBytes, HTTPClient: &http.Client{Transport: transport{mock}}})
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
	sent := len(m.requests)
	res, err := m.answer(req, raw)
	m.lastStatus = 0
	if res != nil {
		m.lastStatus = res.StatusCode
		if len(m.requests) > sent {
			status := res.StatusCode
			m.requests[len(m.requests)-1].Status = &status
		}
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
	if jsonBody(req.Header) && len(raw) > 0 {
		_ = json.Unmarshal(raw, &captured.Body)
	}
	// An upload form's options and file are kept apart, as the API reads them.
	formText, formFile, formErr := "", []byte(nil), error(nil)
	if isUploadForm(req.Header) {
		if formText, formFile, formErr = readUploadForm(req.Header, raw); formErr == nil {
			_ = json.Unmarshal([]byte(formText), &captured.Body)
			captured.File = formFile
		}
	}
	m.requests = append(m.requests, captured)
	m.requestCount++
	header := http.Header{"X-Request-Id": {fmt.Sprintf("req_mock_%d", m.requestCount)}}
	operations := operationsOf(req.Method, parts, req.URL.Query(), cdn)
	for index, queued := range m.failures {
		if queued.Operation != "" && !contains(operations, queued.Operation) {
			continue
		}
		m.failures = append(m.failures[:index:index], m.failures[index+1:]...)
		if _, ok := calmlens.PublicErrorStatus(queued.Code); !ok {
			return nil, transportFailure(queued)
		}
		failure := fail(queued.Code).(*apiError)
		failure.details = queued.Details
		if queued.RetryAfter != nil {
			header.Set("Retry-After", strconv.Itoa(int(*queued.RetryAfter/time.Second)))
		}
		return m.jsonResponse(req, header, nil, failure), nil
	}
	if cdn {
		status, data, contentType := m.serve(req, parts, escaped, header)
		return response(req, status, header, contentType, data), nil
	}
	if req.Header.Get("X-Api-Key") != m.options.APIKey {
		return m.jsonResponse(req, header, nil, fail(calmlens.CodeInvalidAPIKey)), nil
	}
	// HTTP stacks trim header values, so the API sees the key without surrounding whitespace.
	key := strings.Trim(req.Header.Get("Idempotency-Key"), " \t\r\n")
	// Like the API, raw uploads are compared by query, Content-Type and length, not bytes, and an
	// upload form by its options and file length, not its boundary.
	compared, contentType, length := "", req.Header.Get("Content-Type"), len(raw)
	if jsonBody(req.Header) {
		compared = string(raw)
	}
	if isUploadForm(req.Header) && formErr == nil {
		compared, contentType, length = formText, "multipart/form-data", len(formFile)
	}
	fingerprint := strings.Join([]string{req.Method, req.URL.EscapedPath(), req.URL.RawQuery, contentType, req.Header.Get("X-Calmlens-Upload"), strconv.Itoa(length), compared}, "\n")
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
	var invalidDecision *calmlens.Error
	if errors.As(err, &invalidDecision) {
		// Options.Moderate returned an invalid decision: the client returns its error as is.
		return nil, invalidDecision
	}
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
		if len(parts) >= 4 && parts[3] == calmlens.ResourceInfo {
			return []string{"cdn.getAssetInfo"}
		}
		return []string{"cdn.serve"}
	}
	if len(parts) >= 3 && parts[0] == "projects" {
		switch route := strings.Join(parts[2:], "/"); {
		case route == "events":
			return []string{"events.list", "events.pages"}
		case route == "lenses" && method == "GET":
			return []string{"lenses.list", "lenses.iterate"}
		case route == "lenses" && method == "POST":
			return []string{"lenses.create"}
		case route == "lenses":
			return []string{"ensureLenses", "ensureLens"}
		case route == "folders" && method == "GET":
			return []string{"folders.list", "folders.iterate"}
		case route == "folders":
			return []string{"folders.create"}
		case route == "hash-lists" && method == "GET":
			return []string{"hashLists.list", "hashLists.iterate"}
		case route == "hash-lists":
			return []string{"hashLists.create"}
		case route == "policy" && method == "GET":
			return []string{"policies.retrieveAssigned"}
		case route == "policy":
			return []string{"policies.assign"}
		case route == "assets" && method == "GET":
			return []string{"assets.list", "assets.iterate"}
		case route == "assets/search":
			return []string{"assets.search"}
		case route == "assets/batch":
			return []string{"assets.batch"}
		case route == "signed-asset-urls":
			return []string{"cdn.signAssetUrl"}
		case len(parts) == 5 && parts[2] == "assets" && parts[4] == "timeline":
			return []string{"assets.listTimeline", "assets.iterateTimeline"}
		case route == "assets" && q.Get("wait") == "false":
			return []string{"assets.create"}
		case route == "assets":
			return []string{"assets.classify", "text.classify"}
		}
		return nil
	}
	if parts[0] == "policies" {
		switch suffix := strings.Join(parts[min(len(parts), 2):], "/"); {
		case len(parts) == 1 && method == "GET":
			return []string{"policies.list", "policies.iterate"}
		case len(parts) == 1:
			return []string{"policies.create"}
		case suffix == "reset":
			return []string{"policies.reset"}
		case suffix == "upgrade":
			return []string{"policies.upgrade"}
		case suffix == "automatic-updates":
			return []string{"policies.setAutomaticUpdates"}
		case method == "GET":
			return []string{"policies.retrieve"}
		case method == "PATCH":
			return []string{"policies.update"}
		}
		return []string{"policies.delete"}
	}
	if len(parts) < 2 {
		return nil
	}
	suffix := strings.Join(parts[2:], "/")
	switch {
	case parts[0] == "lenses" && method == "GET":
		return []string{"lenses.retrieve"}
	case parts[0] == "lenses" && method == "PATCH":
		return []string{"lenses.update"}
	case parts[0] == "lenses":
		return []string{"lenses.delete"}
	case parts[0] == "hash-list-entries":
		return []string{"hashLists.removeEntry"}
	case parts[0] == "hash-lists" && suffix == "entries" && method == "GET":
		return []string{"hashLists.listEntries", "hashLists.iterateEntries"}
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
		return []string{"assets.removeContent"}
	case suffix == "children":
		return []string{"assets.listChildren", "assets.iterateChildren"}
	case suffix == "part":
		return []string{"assets.uploadPart"}
	case suffix == "decision":
		return []string{"assets.decide"}
	case suffix == "retry", suffix == "explain", suffix == "move":
		return []string{"assets." + suffix}
	}
	return nil
}

// mockOperations are the operation names operationsOf gives, for RequestFailure.Operation.
var mockOperations = []string{
	"assets.list", "assets.iterate", "assets.search", "assets.retrieve", "assets.waitForDecision",
	"assets.update", "assets.listChildren", "assets.iterateChildren", "assets.listTimeline",
	"assets.iterateTimeline", "assets.create", "assets.classify", "assets.uploadPart", "assets.move",
	"assets.retry", "assets.explain", "assets.decide", "assets.removeContent", "assets.delete",
	"assets.batch", "text.classify", "cdn.serve", "cdn.getAssetInfo", "cdn.signAssetUrl",
	"events.list", "events.pages", "folders.list", "folders.iterate", "folders.retrieve",
	"folders.create", "folders.update", "folders.delete", "folders.move", "hashLists.list",
	"hashLists.iterate", "hashLists.retrieve", "hashLists.create", "hashLists.update",
	"hashLists.delete", "hashLists.listEntries", "hashLists.iterateEntries", "hashLists.addEntry",
	"hashLists.removeEntry", "policies.list", "policies.iterate", "policies.retrieve",
	"policies.create", "policies.update", "policies.reset", "policies.upgrade",
	"policies.setAutomaticUpdates", "policies.delete", "policies.retrieveAssigned",
	"policies.assign", "lenses.list", "lenses.iterate", "lenses.create", "lenses.retrieve",
	"lenses.update", "lenses.delete", "ensureLens", "ensureLenses",
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
		// The API's error body: requestId repeats the X-Request-Id header, and details is always
		// an object.
		details := failure.details
		if details == nil {
			details = calmlens.JSON{}
		}
		result = calmlens.JSON{"code": failure.code, "message": err.Error(), "requestId": header.Get("X-Request-Id"), "details": details}
	}
	data, _ := json.Marshal(result)
	return response(req, status, header, "application/json", data)
}

// successStatus is the status the API answers a successful request with: 201 Created for a new
// folder, hash list or policy, 202 Accepted for a queued batch, otherwise 200 OK. Adding a hash list
// entry sets its own status.
func successStatus(operations []string) int {
	switch {
	case contains(operations, "folders.create"), contains(operations, "hashLists.create"), contains(operations, "policies.create"), contains(operations, "lenses.create"):
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

var errUnknownRoute = &apiError{code: calmlens.CodeRouteNotFound, status: http.StatusNotFound}

// checkMetadata refuses metadata the API's schema refuses: it is null or a list of { id, value }
// objects with a string id and any JSON value.
func checkMetadata(metadata any) error {
	if metadata == nil {
		return nil
	}
	items, ok := metadata.([]any)
	if !ok {
		return validation("validation/invalid-type", "metadata")
	}
	for index, entry := range items {
		item, ok := entry.(map[string]any)
		if !ok {
			return validation("validation/invalid-type", fmt.Sprintf("metadata.%d", index))
		}
		if _, ok := item["id"].(string); !ok {
			return validation("validation/invalid-type", fmt.Sprintf("metadata.%d.id", index))
		}
		if _, ok := item["value"]; !ok {
			return validation("validation/invalid-value", fmt.Sprintf("metadata.%d.value", index))
		}
	}
	return nil
}

// validation is a request the API's schema refuses: validation/invalid-request with HTTP 400,
// listing the field and its issue code (such as validation/too-big) in details.issues.
func validation(code, path string) error {
	issue := calmlens.JSON{"path": path, "message": "Invalid " + path, "code": code}
	return &apiError{code: calmlens.CodeInvalidRequest, status: http.StatusBadRequest, details: calmlens.JSON{"issues": []any{issue}}}
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
	// defaultPageSize is how many items every cursor list returns when the query has no pageSize.
	defaultPageSize     = 50
	maxEventsPageSize   = 100
	maxPageSize         = 100
	maxSearchPageSize   = 20
	maxSearchQuery      = 200
	maxFolderPageSize   = 100
	minMultipartPart    = 5 * 1024 * 1024
	maxMultipartImage   = 20 * 1024 * 1024
	maxUploadParts      = 10_000 // the most parts an upload can have, as in the API
	imageCacheLifetime  = 31536000
	mockThumbHash       = "1QcSHQRnh493V4dIh4eXh1h4kJUI"
	mockAverageColor    = "#7f7f7f"
	defaultContentType  = "application/octet-stream"
	cdnProtectionPolicy = "sandbox; default-src 'none'"
)

// jsonBody reports a request whose body is JSON: an application/json body that isn't a raw upload's
// content, which may be JSON too.
func jsonBody(headers http.Header) bool {
	upload := headers.Get("X-CalmLens-Upload")
	return headers.Get("Content-Type") == "application/json" && upload != "content" && upload != "part"
}

func (m *MockServerClient) dispatch(method string, parts []string, q url.Values, raw []byte, headers http.Header) (any, error) {
	body := calmlens.JSON{}
	if jsonBody(headers) && len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			return nil, fail(calmlens.CodeInvalidUploadPayload)
		}
	}
	now := m.options.Now()
	if len(parts) >= 1 && parts[0] == "policies" {
		return m.policyRoute(method, parts[1:], body, q)
	}
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
		case route == "lenses" && method == "GET":
			return m.listLenses(q)
		case route == "lenses" && method == "POST":
			return m.createLens(body, now)
		case route == "policy":
			return m.projectPolicyRoute(method, body)
		case route == "folders" && method == "GET":
			return m.listFolders(q)
		case route == "folders" && method == "POST":
			return m.createFolder(body, now)
		case route == "hash-lists" && method == "GET":
			return m.listHashLists(q)
		case route == "hash-lists" && method == "POST":
			return m.createHashList(body, now)
		case route == "assets" && method == "GET":
			return m.page(func(calmlens.JSON) bool { return true }, q, "assets:"+q.Get("filter"))
		case route == "assets/search" && method == "GET":
			return m.search(q)
		case route == "assets/batch" && method == "POST":
			return m.batchAssets(body, now)
		case route == "signed-asset-urls" && method == "POST":
			return m.signAssetURL(body, now)
		case len(parts) == 5 && parts[2] == "assets" && parts[4] == "timeline" && method == "GET":
			return m.listTimeline(parts[3], q)
		case route == "assets" && method == "POST":
			return m.createAsset(headers, body, q, raw, now)
		}
		return nil, errUnknownRoute
	}
	id := parts[1]
	suffix := strings.Join(parts[2:], "/")
	switch parts[0] {
	case "assets":
		if method == "POST" && suffix == "decision" {
			return m.decideAsset(id, body)
		}
		return m.assetRoute(method, id, suffix, body, q, raw, now)
	case "folders":
		return m.folderRoute(method, id, suffix, body, now)
	case "hash-lists":
		return m.hashListRoute(method, id, suffix, body, q, now)
	case "lenses":
		return m.lensRoute(method, id, suffix, body, now)
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

// listTimeline lists an asset's findings timeline like the API (publicGetAssetTimeline.ts):
// refused while a safety hold is on. The mock analyses no audio or video, so it keeps no
// segments: every timeline is empty, and no cursor continues one.
func (m *MockServerClient) listTimeline(id string, q url.Values) (any, error) {
	a, err := m.asset(id)
	if err != nil {
		return nil, err
	}
	if _, err = intRange(q, "pageSize", defaultPageSize, 1, maxPageSize); err != nil {
		return nil, err
	}
	if section(a, "content")["safetyHold"] != nil {
		return nil, &apiError{code: calmlens.CodeAssetHeld, status: http.StatusLocked, details: calmlens.JSON{"hold": "safety"}}
	}
	if q.Has("cursor") {
		return nil, fail(calmlens.CodeInvalidCursor)
	}
	return calmlens.JSON{"items": []any{}, "nextCursor": nil, "hasMore": false}, nil
}

// listEvents reads the feed like the API: without cursor, no events and a nextCursor for now;
// with cursor, up to pageSize (default 50, at most 100) events added since, oldest first.
// nextCursor is never null: it is where to keep polling from.
func (m *MockServerClient) listEvents(q url.Values) (any, error) {
	size, err := intRange(q, "pageSize", defaultPageSize, 1, maxEventsPageSize)
	if err != nil {
		return nil, err
	}
	// types is a comma-separated list of event types and assetId an asset ID, as the API takes.
	var types []string
	if q.Has("types") {
		types = strings.Split(q.Get("types"), ",")
		if slices.ContainsFunc(types, func(t string) bool { return !eventTypePattern.MatchString(t) }) {
			return nil, validation("validation/invalid-value", "types")
		}
		types = sortedUnique(types)
	}
	assetID := q.Get("assetId")
	if q.Has("assetId") && !assetIDPattern.MatchString(assetID) {
		return nil, validation("validation/invalid-format", "assetId")
	}
	matches := func(event calmlens.JSON) bool {
		return (len(types) == 0 || slices.Contains(types, text(event["type"]))) && (assetID == "" || event["assetId"] == assetID)
	}
	// Cursors are "<sequence>_mock~<filters>": the number of events already read and, like the
	// API, the filters they belong to. The mock's key holds every permission, so no event type is
	// excluded.
	filters := base64.RawURLEncoding.EncodeToString([]byte(strings.Join(types, ",") + "|" + assetID))
	cursor := q.Get("cursor")
	if cursor == "" {
		return calmlens.JSON{"items": []calmlens.JSON{}, "nextCursor": fmt.Sprintf("%d_mock~%s", len(m.events), filters), "hasMore": false, "excludedTypes": []string{}}, nil
	}
	sequence, rest, ok := strings.Cut(cursor, "_mock~")
	position, err := strconv.Atoi(sequence)
	if !ok || rest != filters || err != nil || position < 0 || position > len(m.events) {
		return nil, fail(calmlens.CodeInvalidCursor)
	}
	events := []calmlens.JSON{}
	next := position
	for ; next < len(m.events) && len(events) < size; next++ {
		if matches(m.events[next]) {
			events = append(events, m.events[next])
		}
	}
	more := slices.ContainsFunc(m.events[next:], matches)
	return calmlens.JSON{"items": events, "nextCursor": fmt.Sprintf("%d_mock~%s", next, filters), "hasMore": more, "excludedTypes": []string{}}, nil
}

// eventTypePattern is an event type's shape (resource.action): the mock checks types without
// the event catalog.
var eventTypePattern = regexp.MustCompile(`^[a-z][a-z-]*\.[a-z][a-z-]*$`)

// sortedUnique returns values sorted, without repeats.
func sortedUnique(values []string) []string {
	sorted := slices.Clone(values)
	slices.Sort(sorted)
	return slices.Compact(sorted)
}

// lensFields are the fields of a lens definition.
var lensFields = []string{"name", "description", "type", "active", "transform"}

// ensureLenses saves each definition in order like the API: a new identifier is created, an
// unchanged definition returns the stored lens, and a changed one is updated in place.
func (m *MockServerClient) ensureLenses(body calmlens.JSON, now int64) (any, error) {
	definitions, _ := body["lenses"].([]any)
	if len(definitions) == 0 {
		return nil, validation("validation/too-small", "lenses")
	}
	result := []calmlens.JSON{}
	for _, value := range definitions {
		definition, ok := value.(map[string]any)
		if !ok {
			return nil, fail(calmlens.CodeInvalidUploadPayload)
		}
		old := m.lenses[text(definition["identifier"])]
		if old == nil {
			result = append(result, m.saveNewLens(definition, now))
			continue
		}
		result = append(result, m.changeLens(old, definition, now))
	}
	return calmlens.JSON{"lenses": result}, nil
}

// saveNewLens stores a lens from definition.
func (m *MockServerClient) saveNewLens(definition map[string]any, now int64) calmlens.JSON {
	lens := calmlens.JSON{"id": m.options.CreateID("lens"), "projectId": m.options.ProjectID, "description": nil, "createdAt": now, "updatedAt": now}
	for key, item := range definition {
		lens[key] = item
	}
	m.lenses[text(lens["identifier"])] = lens
	return lens
}

// changeLens returns old unchanged when changes leave its definition as it is, and otherwise
// stores it with changes applied.
func (m *MockServerClient) changeLens(old calmlens.JSON, changes map[string]any, now int64) calmlens.JSON {
	same := true
	for _, key := range lensFields {
		if item, ok := changes[key]; ok {
			a, _ := json.Marshal(old[key])
			b, _ := json.Marshal(item)
			same = same && bytes.Equal(a, b)
		}
	}
	if same {
		return old
	}
	lens := calmlens.JSON{}
	for key, item := range old {
		lens[key] = item
	}
	for _, key := range lensFields {
		if item, ok := changes[key]; ok {
			lens[key] = item
		}
	}
	lens["updatedAt"] = now
	m.lenses[text(lens["identifier"])] = lens
	return lens
}

// listLenses pages the project's lenses, newest first unless sort says otherwise.
func (m *MockServerClient) listLenses(q url.Values) (any, error) {
	size, err := intRange(q, "pageSize", defaultPageSize, 1, maxPageSize)
	if err != nil {
		return nil, err
	}
	ordering, err := cursorOrdering(q, sortRule{Field: "createdAt", Direction: sortDescending})
	if err != nil {
		return nil, err
	}
	items := []calmlens.JSON{}
	for _, lens := range m.lenses {
		items = append(items, lens)
	}
	return keysetPage(items, ordering, q.Get("cursor"), "lenses", size)
}

// createLens creates a lens whose identifier is new to the project, like the API.
func (m *MockServerClient) createLens(body calmlens.JSON, now int64) (any, error) {
	identifier := text(body["identifier"])
	if identifier == "" {
		return nil, validation("validation/invalid-type", "identifier")
	}
	if m.lenses[identifier] != nil {
		failure := fail(calmlens.CodeLensIdentifierTaken).(*apiError)
		failure.details = calmlens.JSON{"identifier": identifier}
		return nil, failure
	}
	return m.saveNewLens(body, now), nil
}

// lensRoute answers /lenses/:id: retrieve, update (any definition field but the identifier)
// and delete.
func (m *MockServerClient) lensRoute(method, id, suffix string, body calmlens.JSON, now int64) (any, error) {
	if suffix != "" || method != "GET" && method != "PATCH" && method != "DELETE" {
		return nil, errUnknownRoute
	}
	var lens calmlens.JSON
	for _, candidate := range m.lenses {
		if candidate["id"] == id {
			lens = candidate
		}
	}
	if lens == nil {
		return nil, fail(calmlens.CodeLensNotFound)
	}
	switch method {
	case "PATCH":
		return m.changeLens(lens, body, now), nil
	case "DELETE":
		delete(m.lenses, text(lens["identifier"]))
		return calmlens.JSON{}, nil
	}
	return lens, nil
}

// createAsset handles POST .../assets. The X-CalmLens-Upload header picks the mode: absent is
// a JSON body (a URL, or plain text in content or part), "content" an upload form with the whole
// file and "part" an upload form with the first part of a multipart upload. Like the API, asset
// fields in the query are refused.
func (m *MockServerClient) createAsset(headers http.Header, body calmlens.JSON, q url.Values, raw []byte, now int64) (any, error) {
	if err := optionsInQuery(q); err != nil {
		return nil, err
	}
	mode := headers.Get("X-CalmLens-Upload")
	multipart := mode == "part"
	options := body
	mime := q.Get("contentType")
	isFinal := q.Get("isFinal") == "true"
	declaredTotal := q.Get("totalSizeInBytes")
	hasContent := mode == "content" || multipart
	if hasContent {
		text, file, err := readUploadForm(headers, raw)
		if err != nil {
			return nil, err
		}
		if options, err = formOptions(text); err != nil {
			return nil, err
		}
		raw = file
		if size := q.Get("sizeInBytes"); size != "" && size != strconv.Itoa(len(raw)) {
			return nil, fail(calmlens.CodeInvalidUploadPayload)
		}
	} else if body["content"] != nil || body["part"] != nil {
		field := "content"
		if body["part"] != nil {
			field, multipart = "part", true
		}
		text := asJSON(body[field])
		plainText, isText := text["plainText"].(string)
		textType, isType := text["type"].(string)
		if !isText || !isType {
			return nil, validation("validation/invalid-type", field)
		}
		options = calmlens.JSON{}
		for key, value := range body {
			if key != "content" && key != "part" && key != "sizeInBytes" && key != "totalSizeInBytes" {
				options[key] = value
			}
		}
		raw, mime, hasContent = []byte(plainText), textType, true
		if multipart {
			isFinal = text["isFinal"] == true
			if total, ok := body["totalSizeInBytes"].(float64); ok {
				declaredTotal = strconv.FormatFloat(total, 'f', -1, 64)
			}
		}
	}
	if err := checkMetadata(options["metadata"]); err != nil {
		return nil, err
	}
	if text(options["name"]) == "" {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	// Like the API: content and a multipart upload's first part need a type CalmLens can moderate.
	if hasContent && !contract.AcceptedUploadMimeType(mime) {
		return nil, &apiError{code: calmlens.CodeUnsupportedUploadType, status: http.StatusUnsupportedMediaType, details: calmlens.JSON{"mimeType": mime, "source": "calmlens"}}
	}
	lower := strings.ToLower(mime)
	kind := calmlens.AssetTypeFile
	if options["url"] != nil {
		kind = calmlens.AssetTypeWebsite
	} else {
		for _, prefix := range []string{"image", "video", "audio"} {
			if strings.HasPrefix(lower, prefix+"/") {
				kind = prefix
			}
		}
		if strings.HasPrefix(lower, "text/") {
			kind = calmlens.AssetTypePlaintextDocument
		}
		if strings.Contains(lower, "pdf") || strings.Contains(lower, "document") {
			kind = calmlens.AssetTypeMultimediaDocument
		}
	}
	// wait=false queues the asset; a multipart upload saves the choice for its final part.
	queue := q.Get("wait") == "false"
	open := multipart && !isFinal
	var total *int64
	if multipart {
		if declared := declaredTotal; declared != "" {
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
	// Like the API, metadata and tags are lists, empty when none were given.
	orEmpty := func(key string) any {
		if value := orNull(key); value != nil {
			return value
		}
		return []any{}
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
		"id": id, "projectId": m.options.ProjectID, "parentId": nil, "parentPages": []any{},
		"folderId": orNull("folderId"), "uploadPresetId": orNull("uploadPresetId"),
		"createdAt": now, "updatedAt": now, "name": options["name"],
		"description": orNull("description"), "externalId": orNull("externalId"), "externalUrl": externalURL,
		"type": kind, "metadata": orEmpty("metadata"), "authorId": orNull("authorId"), "context": used, "tags": orEmpty("tags"),
		"visibility": visibility,
	}
	m.processingOptions[id] = asJSON(processingOptions)
	content := calmlens.JSON{
		"status": contentStatus, "removalReason": nil, "updatedAt": now, "safetyHold": nil,
		"format": nil, "extension": nil, "sizeInBytes": nil, "checksums": nil,
		// The mock decodes nothing, so the file's own details are unknown.
		"width": nil, "height": nil, "durationSeconds": nil, "pageCount": nil,
		"perceptualHash": nil, "perceptualHashQuality": nil, "metadata": nil, "extractedText": nil,
		// Like the API, the rendered file and preview come with processing.
		"rendered": nil, "hls": nil, "hlsStatus": nil, "preview": nil,
	}
	uploadState := calmlens.JSON{"status": "completed", "updatedAt": now, "partsReceived": nil}
	// The mock never reads test inputs.
	classification := calmlens.JSON{"status": calmlens.ClassificationStatusProcessing, "failureReason": nil, "updatedAt": now, "completedAt": nil, "progress": nil,
		"testInput": false, "moderation": calmlens.JSON{"status": calmlens.ModerationStatusPending, "manualReviews": []any{},
			// Like the API, moderation's findings are null until moderation decides.
			"automatedStatus": nil, "source": nil, "rule": nil, "explanationComplete": nil, "categories": nil, "raw": nil, "linkSafety": nil,
			"flaggedCategories": []any{}, "regions": []any{}, "timeline": nil},
		// Like the API, a feature's result is null until it has run.
		"ocr": nil, "linkDetection": nil}
	if open {
		uploadState["status"] = "uploading"
		uploadState["partsReceived"] = 1
		classification["status"] = calmlens.ClassificationStatusQueued
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
		m.DatabaseStorage.Assets[id] = a
		return a, nil
	}
	var stored []byte
	if options["url"] == nil {
		stored = raw
		setRendering(a, false)
	}
	decision, err := m.decisionFor(a, TriggerUpload, queue, stored)
	if err != nil {
		return nil, err
	}
	uploaded := snapshot(a)
	m.decide(a, decision)
	m.DatabaseStorage.Assets[id] = a
	m.recordUploaded(a, uploaded)
	m.recordProcessingEvents(a, decision)
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

// imageSizeError is the API's rule for image uploads in parts: at most 20 MiB, at any size below.
func imageSizeError(kind string, size int64, final bool) error {
	if kind == calmlens.AssetTypeImage && size > maxMultipartImage {
		return &apiError{code: calmlens.CodeUploadTooLarge, status: http.StatusRequestEntityTooLarge, details: calmlens.JSON{"limitBytes": maxMultipartImage, "source": "plan"}}
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

// decisionFor asks Options.Moderate how to decide a, with its content: data when the caller
// has it, otherwise the stored parts in order (none once the content is removed). It returns
// the decision's error when the decision is invalid.
func (m *MockServerClient) decisionFor(a calmlens.JSON, trigger string, queued bool, data []byte) (*Decision, error) {
	if data == nil {
		if stored := m.ImageStorage.Content[text(a["id"])]; stored != nil && section(a, "content")["status"] != calmlens.ContentStatusRemoved {
			numbers := make([]int, 0, len(stored.Parts))
			for number := range stored.Parts {
				numbers = append(numbers, number)
			}
			slices.Sort(numbers)
			data = []byte{}
			for _, number := range numbers {
				data = append(data, stored.Parts[number]...)
			}
		}
	}
	asset, err := toAsset(a)
	if err != nil {
		return nil, err
	}
	input := ModerationInput{Asset: asset, Trigger: trigger, Queued: queued}
	if data != nil {
		input.Content.Bytes = slices.Clone(data)
		if a["type"] == calmlens.AssetTypePlaintextDocument {
			decoded := string(data)
			input.Content.Text = &decoded
		}
	}
	decision := m.options.Moderate(input)
	if decision == nil {
		decision = DefaultModerate(input)
	}
	return decision, decision.Err()
}

// decide applies a moderation decision to a processing asset, with its report; a pending
// decision leaves it processing. Like the API for an image with no text, QR codes or people in
// it, a decided image reports OCR and person and face detection when its upload turned them on,
// and link detection unless it turned it off.
func (m *MockServerClient) decide(a calmlens.JSON, decision *Decision) {
	if decision.status == OutcomePending {
		return
	}
	m.applyOutcome(a, decision.status, calmlens.ContentRemovalReasonPolicy, decision.report())
	classification := section(a, "classification")
	if a["type"] != calmlens.AssetTypeImage || classification["status"] != calmlens.ClassificationStatusCompleted {
		return
	}
	features := asJSON(m.processingOptions[a["id"].(string)]["features"])
	if enabled, _ := asJSON(features["ocr"])["enabled"].(bool); enabled {
		classification["ocr"] = calmlens.JSON{"status": calmlens.ResultEvaluated, "textRegions": []any{}}
	}
	if enabled, set := asJSON(features["linkDetection"])["enabled"].(bool); enabled || !set {
		classification["linkDetection"] = calmlens.JSON{"status": calmlens.ResultEvaluated, "qrCodes": []any{}, "links": []any{}}
	}
	if enabled, _ := asJSON(features["personDetection"])["enabled"].(bool); enabled {
		classification["personDetection"] = calmlens.JSON{"status": calmlens.ResultEvaluated, "people": []any{}}
	}
	if enabled, _ := asJSON(features["faceDetection"])["enabled"].(bool); enabled {
		classification["faceDetection"] = calmlens.JSON{"status": calmlens.ResultEvaluated, "faces": []any{}}
	}
}

// settle decides a processing asset and records the pipeline's events.
func (m *MockServerClient) settle(a calmlens.JSON, decision *Decision) {
	m.decide(a, decision)
	m.recordProcessingEvents(a, decision)
}

// settleRerun applies a re-run's decision to a decided asset like the pipeline: a pending decision
// stays queued for CompleteProcessing, a failed one keeps the asset's decision, and any other
// replaces it with the pipeline's events.
func (m *MockServerClient) settleRerun(a calmlens.JSON, decision *Decision) {
	id := text(a["id"])
	delete(m.reruns, id)
	switch decision.status {
	case OutcomePending:
		m.reruns[id] = true
	case OutcomeFailed:
	default:
		m.settle(a, decision)
	}
}

// moderateStored asks Options.Moderate how to decide a queued, processing asset and settles it.
func (m *MockServerClient) moderateStored(a calmlens.JSON, trigger string) error {
	decision, err := m.decisionFor(a, trigger, true, nil)
	if err != nil {
		return err
	}
	m.settle(a, decision)
	return nil
}

// recordUploaded records asset.uploaded as the API does when an upload completes, with uploaded,
// the asset's snapshot from before moderation.
func (m *MockServerClient) recordUploaded(a, uploaded calmlens.JSON) {
	m.addEvent(calmlens.EventAssetUploaded, calmlens.SeverityLow, a, mockAPIKeyActor, []any{
		calmlens.JSON{"key": calmlens.FactAssetType, "value": a["type"]},
		assetNameFact(a),
		calmlens.JSON{"key": calmlens.FactFileFormat, "value": section(a, "content")["format"]},
	})
	m.events[len(m.events)-1]["asset"] = uploaded
}

// recordProcessingEvents records the events the pipeline records when it settles an asset:
// asset.classified and the automated asset.<status>, or asset.failed.
func (m *MockServerClient) recordProcessingEvents(a calmlens.JSON, decision *Decision) {
	switch decision.status {
	case OutcomePending:
		return
	case OutcomeFailed:
		reason := section(a, "classification")["failureReason"]
		if reason == nil {
			reason = calmlens.AssetFailureReasonProcessingError
		}
		m.addEvent(calmlens.EventAssetFailed, calmlens.SeverityHigh, a, automatedActor, []any{
			assetNameFact(a),
			calmlens.JSON{"key": calmlens.FactAssetType, "value": a["type"]},
			calmlens.JSON{"key": calmlens.FactPreviousStatus, "value": calmlens.ClassificationStatusProcessing},
			calmlens.JSON{"key": calmlens.FactFailureReason, "value": reason},
		})
		return
	}
	flagged := decision.flaggedCategories()
	m.addEvent(calmlens.EventAssetClassified, calmlens.SeverityLow, a, automatedActor, []any{
		calmlens.JSON{"key": calmlens.FactFlaggedCategories, "value": flagged},
		calmlens.JSON{"key": calmlens.FactModerationStatus, "value": decision.status},
		calmlens.JSON{"key": calmlens.FactAssetType, "value": a["type"]},
		assetNameFact(a),
	})
	// Like the event catalog: only allowing and limiting are low severity.
	severity := calmlens.SeverityHigh
	if decision.status == OutcomeAllowed || decision.status == OutcomeLimited {
		severity = calmlens.SeverityLow
	}
	m.addEvent("asset."+decision.status, severity, a, automatedActor, []any{
		calmlens.JSON{"key": calmlens.FactFlaggedCategories, "value": flagged},
		calmlens.JSON{"key": calmlens.FactAssetType, "value": a["type"]},
		assetNameFact(a),
	})
}

// assetNameFact is the asset-name fact linking to the asset's portal page.
func assetNameFact(a calmlens.JSON) calmlens.JSON {
	return calmlens.JSON{"key": calmlens.FactAssetName, "value": a["name"], "url": "https://calmlens.com/go/asset/" + text(a["id"])}
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

// waveformSize is the size of the waveform the API makes as an audio asset's preview.
const waveformWidth, waveformHeight = 1200, 300

// browserSafeMediaFormats are audio and video formats browsers play as uploaded, so the API
// serves them as stored (Asset.ts).
var browserSafeMediaFormats = []string{"video/mp4", "audio/mpeg", "audio/aac", "audio/mp4", "audio/x-m4a", "audio/ogg"}

// spreadsheetMimeTypes are spreadsheets, which have no rendered file or preview (Asset.ts).
var spreadsheetMimeTypes = []string{
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-excel.sheet.macroenabled.12",
	"application/vnd.ms-excel",
	"application/vnd.oasis.opendocument.spreadsheet",
}

// normalizedMimeType lower-cases a MIME type and drops its parameters, as the API does.
func normalizedMimeType(mime string) string {
	return strings.TrimSpace(strings.ToLower(strings.Split(mime, ";")[0]))
}

// clearRendering removes an asset's rendered file and preview, which go with its content and
// are withheld while a safety hold is on.
func clearRendering(content calmlens.JSON) {
	content["rendered"], content["hls"], content["hlsStatus"], content["preview"] = nil, nil, nil, nil
}

// setRendering sets the rendered file and preview the API reports for an asset whose content
// is held (Asset.ts, getAssetRendered and getAssetPreview). Once uploaded, an image renders as
// itself with a preview that has no ThumbHash yet, and a PDF and browser-safe audio and video
// render as uploaded. Once processed, a website renders as its screenshot; a document or
// presentation as a PDF, with its first page as the preview; video and audio as a browser-safe
// file (MP4 or M4A unless browsers play the upload), audio with a waveform preview and video
// with no poster; and every preview has its ThumbHash. Text, spreadsheets and other files have
// neither. The mock decodes nothing, so sizes are unknown, audio has no peaks, and audio and
// video never get an adaptive stream.
func setRendering(a calmlens.JSON, processed bool) {
	content := section(a, "content")
	clearRendering(content)
	format := text(content["format"])
	mime := normalizedMimeType(format)
	kind := text(a["type"])
	browserSafe := contains(browserSafeMediaFormats, mime)
	preview := func(width, height any) calmlens.JSON {
		result := calmlens.JSON{"width": width, "height": height, "thumbhash": nil, "averageColor": nil}
		if processed {
			result["thumbhash"], result["averageColor"] = mockThumbHash, mockAverageColor
		}
		return result
	}
	rendered := func(kind calmlens.AssetRenderedKind, format string) calmlens.JSON {
		return calmlens.JSON{"kind": string(kind), "format": format, "width": nil, "height": nil}
	}
	rendersOnUpload := kind == calmlens.AssetTypeImage || mime == "application/pdf" ||
		(kind == calmlens.AssetTypeVideo || kind == calmlens.AssetTypeAudio) && browserSafe
	if !processed && !rendersOnUpload {
		return
	}
	switch kind {
	case calmlens.AssetTypeImage:
		if format == "" {
			format = "image/png"
		}
		content["rendered"], content["preview"] = rendered(calmlens.AssetRenderedKindImage, format), preview(nil, nil)
	case calmlens.AssetTypeWebsite:
		content["rendered"], content["preview"] = rendered(calmlens.AssetRenderedKindImage, "image/png"), preview(nil, nil)
	case calmlens.AssetTypeMultimediaDocument:
		if contains(spreadsheetMimeTypes, mime) {
			return
		}
		content["rendered"] = rendered(calmlens.AssetRenderedKindPDF, "application/pdf")
		if processed {
			content["preview"] = preview(nil, nil)
		}
	case calmlens.AssetTypeVideo:
		if !browserSafe {
			format = "video/mp4"
		}
		content["rendered"] = rendered(calmlens.AssetRenderedKindVideo, format)
	case calmlens.AssetTypeAudio:
		if !browserSafe {
			format = "audio/mp4"
		}
		audio := rendered(calmlens.AssetRenderedKindAudio, format)
		if processed {
			audio["peaks"] = []any{}
			content["preview"] = preview(waveformWidth, waveformHeight)
		}
		content["rendered"] = audio
	}
}

// applyOutcome moves an asset to outcome like the pipeline: a decision finishes processing,
// OutcomePurged deletes the content (with purgeReason), and finished processing removes content
// kept only temporarily (keepContentAfterProcessing off). A decided asset gets its rendered file
// and preview (with a ThumbHash for its placeholder), which go with its content and are withheld
// while a safety hold is on. A report's fields replace the moderation's.
func (m *MockServerClient) applyOutcome(a calmlens.JSON, outcome, purgeReason string, report calmlens.JSON) {
	now := m.options.Now()
	decided := outcome != OutcomePending && outcome != OutcomeFailed
	processing, moderation, content := section(a, "classification"), section(section(a, "classification"), "moderation"), section(a, "content")
	removed := content["status"] == calmlens.ContentStatusRemoved
	purge := outcome == OutcomePurged && !removed
	removeContent := purge || decided && content["status"] == calmlens.ContentStatusTemporary
	if !removed && !purge && content["safetyHold"] == nil {
		setRendering(a, decided)
	} else {
		clearRendering(content)
	}
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
	processing["failureReason"] = nil
	moderation["status"] = calmlens.ModerationStatusPending
	for key, value := range report {
		moderation[key] = value
	}
	switch {
	case decided:
		processing["status"] = calmlens.ClassificationStatusCompleted
		moderation["status"] = outcome
		processing["completedAt"] = now
	case outcome == OutcomeFailed:
		processing["status"] = calmlens.ClassificationStatusFailed
		// The mock has no content checks, so a failure is always a processing error.
		processing["failureReason"] = calmlens.AssetFailureReasonProcessingError
	default:
		processing["status"] = calmlens.ClassificationStatusProcessing
	}
	a["updatedAt"] = now
}

// removeContent deletes the asset's stored bytes and marks its content removed for reason; the
// extracted text, file metadata, rendered file and preview go with it.
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
	content["metadata"] = nil
	clearRendering(content)
}

// requestContentRemoval removes an asset's content on request, like the API: the record and
// report stay; stored content, extracted text, the rendered file and preview go. Content
// already removed keeps its reason, and an asset.content-removed event is recorded either way,
// with the batch-id fact when batchID is set.
func (m *MockServerClient) requestContentRemoval(a calmlens.JSON, now int64, batchID string) {
	content := section(a, "content")
	if content["status"] == calmlens.ContentStatusRemoved {
		delete(m.ImageStorage.Content, text(a["id"]))
		clearRendering(content)
	} else {
		m.removeContent(a, calmlens.ContentRemovalReasonRequested, now)
		a["updatedAt"] = now
	}
	m.recordLifecycleEvent(calmlens.EventAssetContentRemoved, a, mockAPIKeyActor, batchID)
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
// DELETE /assets/:id/content. Each event carries the batch's batch-id fact, and the response its
// batch_ ID. Mock assets carry no safety holds, so none is skipped.
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
	batchID := m.options.CreateID("batch")
	for _, a := range assets {
		if operation == calmlens.AssetBatchOperationDelete {
			m.recordLifecycleEvent(calmlens.EventAssetDeleted, a, mockAPIKeyActor, batchID)
			m.deleteAssetTree(text(a["id"]))
		} else {
			m.requestContentRemoval(a, now, batchID)
		}
	}
	return calmlens.JSON{"batchId": batchID, "status": calmlens.BatchStatusQueued, "assetCount": len(assets)}, nil
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
	// Like the API, the body's schema is checked before the asset is looked up.
	switch {
	case method == "PATCH" && suffix == "":
		if err := checkMetadata(body["metadata"]); err != nil {
			return nil, err
		}
		if value, ok := body["name"]; ok && value == nil {
			return nil, validation("validation/invalid-type", "name")
		}
	}
	a, err := m.asset(id)
	if err != nil {
		return nil, err
	}
	switch {
	case method == "GET" && suffix == "":
	case method == "DELETE" && suffix == "":
		m.recordLifecycleEvent(calmlens.EventAssetDeleted, a, mockAPIKeyActor, "")
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
		m.requestContentRemoval(a, now, "")
	case method == "GET" && suffix == "children":
		return m.page(func(child calmlens.JSON) bool { return child["parentId"] == id }, q, "children:"+id)
	case method == "POST" && suffix == "retry":
		classification := section(a, "classification")
		if classification["status"] != calmlens.ClassificationStatusFailed || section(classification, "moderation")["status"] != calmlens.ModerationStatusPending {
			return nil, fail(calmlens.CodeAssetNotRetryable)
		}
		if section(a, "content")["status"] == calmlens.ContentStatusRemoved {
			return nil, fail(calmlens.CodeAssetContentUnavailable)
		}
		// Like the API: back to processing, to be moderated again, with an asset.retried event.
		m.applyOutcome(a, OutcomePending, calmlens.ContentRemovalReasonPolicy, nil)
		m.recordLifecycleEvent(calmlens.EventAssetRetried, a, mockAPIKeyActor, "")
		if err := m.moderateStored(a, TriggerRetry); err != nil {
			return nil, err
		}
	case method == "POST" && suffix == "explain":
		classification := section(a, "classification")
		if classification["status"] != calmlens.ClassificationStatusCompleted {
			return nil, fail(calmlens.CodeAssetNotDecided)
		}
		moderation := section(classification, "moderation")
		if body["rerun"] != true {
			// Like the API: the explanation is completed and every action stays as decided.
			if moderation["explanationComplete"] == false {
				moderation["explanationComplete"] = true
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
		// Like the API: the request is recorded, and the asset returns as it was. It keeps its
		// decision while it's moderated again under the current policy.
		m.addEvent(calmlens.EventAssetRerunRequested, calmlens.SeverityLow, a, mockAPIKeyActor, []any{
			assetNameFact(a),
			calmlens.JSON{"key": calmlens.FactAssetType, "value": a["type"]},
			calmlens.JSON{"key": calmlens.FactModerationStatus, "value": moderation["status"]},
		})
		response := cloneJSON(a).(calmlens.JSON)
		decision, err := m.decisionFor(a, TriggerRerun, true, nil)
		if err != nil {
			return nil, err
		}
		m.settleRerun(a, decision)
		return response, nil
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
	if part != expected || part > maxUploadParts {
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
	// Without wait, the choice saved when the upload started applies.
	queue := state.queue
	if override := q.Get("wait"); override != "" {
		queue = override == "false"
	}
	delete(m.uploads, id)
	m.applyOutcome(a, OutcomePending, calmlens.ContentRemovalReasonPolicy, nil)
	decision, err := m.decisionFor(a, TriggerUpload, queue, nil)
	if err != nil {
		return err
	}
	uploaded := snapshot(a)
	m.decide(a, decision)
	m.recordUploaded(a, uploaded)
	m.recordProcessingEvents(a, decision)
	return nil
}

// listFolders lists one page of child folders, or searches names, with the ancestors of the
// listed and requested folders, like the API.
func (m *MockServerClient) listFolders(q url.Values) (any, error) {
	db := m.DatabaseStorage
	size, err := intRange(q, "pageSize", defaultPageSize, 1, maxFolderPageSize)
	if err != nil {
		return nil, err
	}
	// Like the API: a sort of one field, name (the default, ascending) or createdAt, then the ID
	// in the same direction. Names compare by code point, so case matters.
	ordering, err := sortOrder(q, []string{"name", "createdAt"}, 1, sortRule{Field: "name", Direction: sortAscending})
	if err != nil {
		return nil, err
	}
	search := strings.ToLower(strings.TrimSpace(q.Get("search")))
	folders := []calmlens.JSON{}
	for _, f := range db.Folders {
		if f["projectId"] == m.options.ProjectID && text(f["parentId"]) == q.Get("parentId") && strings.Contains(strings.ToLower(text(f["name"])), search) {
			folders = append(folders, f)
		}
	}
	scope, _ := json.Marshal([]any{q.Get("parentId"), search})
	result, err := keysetPage(folders, ordering, q.Get("cursor"), "folders:"+string(scope), size)
	if err != nil {
		return nil, err
	}
	page := result["items"].([]calmlens.JSON)
	ids := map[string]bool{}
	selected := []string{q.Get("parentId")}
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
	result["ancestors"] = ancestors
	return result, nil
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

// pageCursor is the position a page ends at, for the query (scope and sort) it belongs to.
type pageCursor struct {
	Scope  string `json:"scope"`
	Values []any  `json:"values"`
}

// page lists project assets accepted by include, applying the RSQL filter, sort and pagination
// from the query like the API. A cursor continues only the query (scope and sort) it came from.
func (m *MockServerClient) page(include func(calmlens.JSON) bool, q url.Values, scope string) (any, error) {
	// Like the API: the query schema (page size, sort) first, then the filter.
	size, err := intRange(q, "pageSize", defaultPageSize, 1, maxPageSize)
	if err != nil {
		return nil, err
	}
	ordering, err := cursorOrdering(q, sortRule{Field: "createdAt", Direction: sortDescending})
	if err != nil {
		return nil, err
	}
	var filter filterNode
	if expression := q.Get("filter"); expression != "" {
		if filter, err = parseFilter(expression); err != nil {
			return nil, fail(calmlens.CodeInvalidFilter)
		}
	}
	items := []calmlens.JSON{}
	for _, a := range m.DatabaseStorage.Assets {
		if a["projectId"] == m.options.ProjectID && include(a) && (filter == nil || filter.match(a)) {
			items = append(items, a)
		}
	}
	return keysetPage(items, ordering, q.Get("cursor"), scope, size)
}

// Sort directions of sortRule.
const (
	sortAscending  = "asc"
	sortDescending = "desc"
)

// sortRule is one field of a list's sort and its direction.
type sortRule struct {
	Field     string `json:"field"`
	Direction string `json:"direction"`
}

// sortPart is one field of a sort query value, as the API's sortQueryField reads it: a field
// name, descending when prefixed with "-".
var sortPart = regexp.MustCompile(`^-?[A-Za-z][A-Za-z0-9.]*$`)

// sortOrder reads a list's sort query value like the API: comma-separated fields from fields,
// each descending when prefixed with "-", none repeated and at most max, refused with
// validation/invalid-value at "sort". Without a sort, fallback applies. The id tie-breaker is
// added in the first field's direction.
func sortOrder(q url.Values, fields []string, max int, fallback sortRule) ([]sortRule, error) {
	ordering := []sortRule{}
	if q.Has("sort") {
		for _, part := range strings.Split(q.Get("sort"), ",") {
			part = strings.TrimSpace(part)
			field := strings.TrimPrefix(part, "-")
			if !sortPart.MatchString(part) || !contains(fields, field) || slices.ContainsFunc(ordering, func(rule sortRule) bool { return rule.Field == field }) {
				return nil, validation("validation/invalid-value", "sort")
			}
			direction := sortAscending
			if strings.HasPrefix(part, "-") {
				direction = sortDescending
			}
			ordering = append(ordering, sortRule{Field: field, Direction: direction})
		}
		if len(ordering) > max {
			return nil, validation("validation/invalid-value", "sort")
		}
	}
	if len(ordering) == 0 {
		ordering = append(ordering, fallback)
	}
	if !slices.ContainsFunc(ordering, func(rule sortRule) bool { return rule.Field == "id" }) {
		ordering = append(ordering, sortRule{Field: "id", Direction: ordering[0].Direction})
	}
	return ordering, nil
}

// cursorOrdering reads a cursor list's sort of at most two fields, createdAt and id, like the
// API; fallback applies without one.
func cursorOrdering(q url.Values, fallback sortRule) ([]sortRule, error) {
	return sortOrder(q, []string{"createdAt", "id"}, 2, fallback)
}

// compareValues orders two values numerically when both are numbers, otherwise as text.
func compareValues(left any, right string) int {
	if n, ok := asNumber(left); ok {
		if r, err := strconv.ParseFloat(right, 64); err == nil {
			switch {
			case n < r:
				return -1
			case n > r:
				return 1
			}
			return 0
		}
	}
	return strings.Compare(fmt.Sprint(left), right)
}

// keysetPage sorts items by the sort ordering (which ends with the id tie-breaker) and returns the page
// of up to size items after cursor, like the API's cursor lists. A cursor holds the ordering
// values of the last item it follows and continues only the query (scope and sort) it came
// from; id and name values are text, the others numbers.
func keysetPage(items []calmlens.JSON, ordering []sortRule, encoded, scope string, size int) (calmlens.JSON, error) {
	signature, _ := json.Marshal([]any{scope, ordering})
	compareItems := func(item calmlens.JSON, values []any) int {
		for i, order := range ordering {
			result := compareValues(lookup(item, order.Field), fmt.Sprint(values[i]))
			if result != 0 {
				if order.Direction == sortDescending {
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
	if encoded != "" {
		raw, err := base64.StdEncoding.DecodeString(encoded)
		var cursor pageCursor
		if err != nil || json.Unmarshal(raw, &cursor) != nil || cursor.Scope != string(signature) || len(cursor.Values) != len(ordering) {
			return nil, fail(calmlens.CodeInvalidCursor)
		}
		for i, order := range ordering {
			if _, isText := cursor.Values[i].(string); isText != (order.Field == "id" || order.Field == "name") {
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
	return calmlens.JSON{"items": items[:end], "nextCursor": next, "hasMore": end < len(items)}, nil
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
	// Like the API's query schema: a trimmed query of 1 to 200 characters, 1 to 20 results.
	queryText := strings.TrimSpace(q.Get("query"))
	if queryText == "" {
		return nil, validation("validation/too-small", "query")
	}
	if len([]rune(queryText)) > maxSearchQuery {
		return nil, validation("validation/too-big", "query")
	}
	limit, err := intRange(q, "pageSize", 10, 1, maxSearchPageSize)
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

// mockEmbedHTML is the page the mock serves at /embed, standing in for the CDN's embed page.
const mockEmbedHTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embed</title></head><body></body></html>`

// serve answers a CDN request like the CDN (/assets/:projectId/:asset/:resource): original is
// the upload; rendered the image, PDF, video or audio file content.rendered describes; preview
// the still content.preview describes; and placeholder its ThumbHash as a PNG. The mock converts
// nothing: an upload stands in for its rendered file, an image for its own preview, and the
// placeholder PNG for a screenshot, page or waveform. Errors are JSON bodies with 400, 403 or 404.
func (m *MockServerClient) serve(req *http.Request, parts, escaped []string, header http.Header) (int, []byte, string) {
	errorBody := func(status int, code, message string) (int, []byte, string) {
		data, _ := json.Marshal(calmlens.JSON{"code": code, "message": message})
		return status, data, "application/json"
	}
	noRenderedVersion := func() (int, []byte, string) {
		return errorBody(http.StatusNotFound, calmlens.CodeNoRenderedVersion, "This asset has no such resource")
	}
	invalidTransform := func() (int, []byte, string) {
		return errorBody(http.StatusBadRequest, calmlens.CodeInvalidTransform, "Invalid transform selector")
	}
	resource := ""
	if len(parts) >= 4 {
		resource = parts[3]
	}
	var selectorPath []string
	if len(escaped) > 4 {
		selectorPath = escaped[4:]
	}
	// Like the CDN (serveAssetResource.ts), the selector after the resource (as sent, still
	// percent-encoded) is read; the original and the embed page take none. Beneath /hls/ are the
	// stream's playlists and segments, not a selector.
	selectorText := strings.Join(selectorPath, "/")
	if resource == calmlens.ResourceHLS {
		selectorText = ""
	}
	lens, transform, ok := contract.ParseTransformSelector(selectorText)
	hasSelector := lens != "" || transform != nil
	if !ok || (resource == calmlens.ResourceOriginal || resource == calmlens.ResourceEmbed || resource == calmlens.ResourceInfo) && hasSelector {
		return invalidTransform()
	}
	if len(parts) < 4 || parts[0] != "assets" || parts[1] != m.options.ProjectID {
		return errorBody(http.StatusNotFound, calmlens.CodeAssetNotFound, "Asset not found")
	}
	// Like the CDN (CdnUtils.ts), the asset is "ext:" and its URL-encoded external ID, a grant
	// ("sig_…") or its ID.
	find := func(match func(calmlens.JSON) bool) calmlens.JSON {
		for _, a := range m.DatabaseStorage.Assets {
			if a["projectId"] == m.options.ProjectID && match(a) {
				return a
			}
		}
		return nil
	}
	var grant *mockGrant
	var asset calmlens.JSON
	switch raw := escaped[2]; {
	case strings.HasPrefix(raw, "sig_"):
		decoded, ok := decodeMockGrant(raw)
		if !ok {
			return errorBody(http.StatusForbidden, calmlens.CodeSignedURLInvalid, "The signed asset URL's grant is invalid")
		}
		if decoded.expiresAt <= m.options.Now() {
			return errorBody(http.StatusForbidden, calmlens.CodeSignedURLExpired, "The signed URL has expired")
		}
		grant = &decoded
		asset = find(func(a calmlens.JSON) bool { return a["id"] == decoded.assetID })
	case strings.HasPrefix(raw, externalIDPrefix):
		if external, err := url.PathUnescape(strings.TrimPrefix(raw, externalIDPrefix)); err == nil && external != "" {
			asset = find(func(a calmlens.JSON) bool { return a["externalId"] == external })
		}
	default:
		asset = find(func(a calmlens.JSON) bool { return a["id"] == parts[2] })
	}
	if asset == nil {
		return errorBody(http.StatusNotFound, calmlens.CodeAssetNotFound, "Asset not found")
	}
	if resource == calmlens.ResourceOriginal && grant != nil && !grant.original {
		return errorBody(http.StatusForbidden, calmlens.CodeSignedURLOriginalNotGranted, "This signed asset URL doesn't grant the original file")
	}
	notAvailable := func() (int, []byte, string) {
		return errorBody(http.StatusForbidden, "asset/not-available", "Asset is not available")
	}
	// A grant authorises a private asset without the API key.
	canDownload := func() bool {
		return grant != nil || m.canDownload(text(asset["folderId"]), req.Header.Get("X-Api-Key"))
	}
	if resource == calmlens.ResourceInfo {
		return m.serveInfo(req, asset, canDownload(), header)
	}
	moderation := section(section(asset, "classification"), "moderation")["status"]
	tag := "asset-" + text(asset["id"])
	content := section(asset, "content")
	rendered, preview := asJSON(content["rendered"]), asJSON(content["preview"])
	// Like the CDN, a safety hold refuses every resource.
	if content["safetyHold"] != nil {
		return notAvailable()
	}
	if resource == calmlens.ResourcePlaceholder {
		// Like the CDN's placeholder handler: the preview's ThumbHash, public whatever the asset's
		// visibility or moderation status; refused for purged assets and assets without one (not
		// yet processed, without a preview, or content removed).
		thumbhash := text(preview["thumbhash"])
		if thumbhash == "" || moderation == calmlens.ModerationStatusPurged {
			return notAvailable()
		}
		png, err := placeholderPNG(thumbhash)
		if err != nil {
			return notAvailable()
		}
		header.Set("Cache-Control", "public, max-age=3600")
		header.Set("Cache-Tag", tag)
		header.Set("ETag", strconv.Quote(thumbhash))
		return http.StatusOK, png, "image/png"
	}
	// Like the CDN, delivery checks come first and refuse everyone: content still uploading,
	// blocked or purged, failed processing or removed content, and an original with no bytes.
	stored := m.ImageStorage.Content[text(asset["id"])]
	if resource == calmlens.ResourceOriginal && stored == nil || section(asset, "upload")["status"] == "uploading" ||
		moderation == calmlens.ModerationStatusBlocked || moderation == calmlens.ModerationStatusPurged ||
		section(asset, "classification")["status"] == calmlens.ClassificationStatusFailed ||
		content["status"] == calmlens.ContentStatusRemoved {
		return notAvailable()
	}
	// Then access: an age-restricted asset needs viewerClaims.ageConfirmed=true whatever the key,
	// and a private asset needs the download permission for its folder.
	claims := map[string]any{}
	_ = json.Unmarshal([]byte(req.URL.Query().Get("viewerClaims")), &claims)
	if moderation == calmlens.ModerationStatusAgeRestricted && claims["ageConfirmed"] != true {
		return errorBody(403, "viewer/age-confirmation-required", "Age confirmation required")
	}
	restricted := asset["visibility"] != calmlens.VisibilityPublic
	if restricted && !canDownload() {
		return errorBody(http.StatusForbidden, calmlens.CodePermissionDenied, "This API key needs assets:download permission for this asset's folder.")
	}
	// The embed page shows any asset that may be delivered, as its viewer for the asset's type or
	// a notice that the type has none.
	if resource == calmlens.ResourceEmbed {
		header.Set("Cache-Control", "public, max-age=3600")
		if restricted {
			header.Set("Cache-Control", "private, max-age=3600")
		}
		if len(claims) > 0 {
			header.Set("Cache-Control", "private, no-store")
		}
		header.Set("Cache-Tag", tag)
		header.Set("X-Content-Type-Options", "nosniff")
		return http.StatusOK, []byte(mockEmbedHTML), "text/html; charset=utf-8"
	}
	// Then whether the asset has the resource (the mock prepares no HLS stream), and whether it is
	// a still image that takes a lens or transform: the preview always is, the rendered file only
	// when it is an image.
	if resource == calmlens.ResourceRendered && content["rendered"] == nil || resource == calmlens.ResourcePreview && content["preview"] == nil ||
		!contains([]string{calmlens.ResourceOriginal, calmlens.ResourceRendered, calmlens.ResourcePreview}, resource) {
		return noRenderedVersion()
	}
	renderedImage := rendered["kind"] == string(calmlens.AssetRenderedKindImage)
	still := resource == calmlens.ResourcePreview || resource == calmlens.ResourceRendered && renderedImage
	if !still && hasSelector {
		return invalidTransform()
	}
	// Then the options, checked against the transform schema once the asset may be served.
	if transform != nil {
		unknownKeys, invalidKeys := contract.CheckTransformOptions(transform)
		if keys := append(unknownKeys, invalidKeys...); len(keys) > 0 {
			return errorBody(http.StatusBadRequest, calmlens.CodeInvalidTransformOptions, "Invalid transform options: "+strings.Join(keys, ", "))
		}
	}
	// The bytes: the upload, which stands in for its own rendered file and an image's preview,
	// or the placeholder PNG for a still the mock doesn't make.
	servesUpload := resource == calmlens.ResourceOriginal || resource == calmlens.ResourceRendered && !renderedImage ||
		asset["type"] == calmlens.AssetTypeImage
	var data []byte
	var contentType string
	if servesUpload {
		if stored == nil {
			return notAvailable()
		}
		indices := []int{}
		for index := range stored.Parts {
			indices = append(indices, index)
		}
		sort.Ints(indices)
		for _, index := range indices {
			data = append(data, stored.Parts[index]...)
		}
		contentType = stored.Type
		if resource == calmlens.ResourceRendered {
			contentType = text(rendered["format"])
		}
		if contentType == "" {
			contentType = defaultContentType
		}
	} else {
		thumbhash := text(preview["thumbhash"])
		if thumbhash == "" {
			thumbhash = mockThumbHash
		}
		png, err := placeholderPNG(thumbhash)
		if err != nil {
			return notAvailable()
		}
		data, contentType = png, "image/png"
	}
	// Like the CDN: a still image's bytes are immutable for a year, other content is kept for an
	// hour, by shared caches only when delivery is public.
	access, lifetime := "public", "max-age=3600"
	if restricted {
		access = "private"
	}
	if still || resource == calmlens.ResourceOriginal && asset["type"] == calmlens.AssetTypeImage {
		lifetime = fmt.Sprintf("max-age=%d, immutable", imageCacheLifetime)
		header.Set("ETag", strconv.Quote(text(asset["id"])))
		header.Set("Expires", time.UnixMilli(m.options.Now()).Add(imageCacheLifetime*time.Second).UTC().Format(http.TimeFormat))
	}
	header.Set("Cache-Control", access+", "+lifetime)
	if len(claims) > 0 {
		header.Set("Cache-Control", "private, no-store")
		header.Del("Expires")
	}
	header.Set("Cache-Tag", tag)
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", cdnProtectionPolicy)
	if activeContentType(contentType) {
		header.Set("Content-Disposition", "attachment")
	}
	return http.StatusOK, data, contentType
}

// serveInfo answers /info like the CDN (AssetInfo.ts): the allowlisted fields and whether the
// viewer the claims describe can see the content, decided as the other resources decide it. A
// private asset's info needs a grant or an API key with assets:download.
func (m *MockServerClient) serveInfo(req *http.Request, asset calmlens.JSON, authorised bool, header http.Header) (int, []byte, string) {
	errorBody := func(status int, code, message string) (int, []byte, string) {
		data, _ := json.Marshal(calmlens.JSON{"code": code, "message": message})
		return status, data, "application/json"
	}
	private := asset["visibility"] != calmlens.VisibilityPublic
	if private && !authorised {
		return errorBody(http.StatusNotFound, "asset/not-found", "Asset not found")
	}
	claims := map[string]any{}
	if raw := req.URL.Query().Get("viewerClaims"); raw != "" && json.Unmarshal([]byte(raw), &claims) != nil {
		return errorBody(http.StatusBadRequest, calmlens.CodeInvalidViewerClaims, "Invalid viewer claims")
	}
	content := section(asset, "content")
	classification := section(asset, "classification")
	moderation := section(classification, "moderation")["status"]
	availability := calmlens.AssetAvailabilityAvailable
	switch {
	case content["safetyHold"] != nil, section(asset, "upload")["status"] == "uploading",
		moderation == calmlens.ModerationStatusBlocked, moderation == calmlens.ModerationStatusPurged,
		classification["status"] == calmlens.ClassificationStatusFailed, content["status"] == calmlens.ContentStatusRemoved:
		availability = calmlens.AssetAvailabilityUnavailable
	case moderation == calmlens.ModerationStatusAgeRestricted && claims["ageConfirmed"] != true:
		availability = calmlens.AssetAvailabilityAgeRestricted
	}
	info := calmlens.JSON{
		"id": asset["id"], "projectId": asset["projectId"], "type": asset["type"], "externalUrl": asset["externalUrl"],
		"content": calmlens.JSON{
			"format": content["format"], "width": content["width"], "height": content["height"],
			"durationSeconds": content["durationSeconds"], "pageCount": content["pageCount"],
			"rendered": content["rendered"], "preview": content["preview"], "hls": content["hls"],
		},
		"availability": availability,
	}
	data, _ := json.Marshal(info)
	access := "public"
	if private {
		access = "private"
	}
	header.Set("Cache-Control", access+", max-age=60")
	header.Set("Cache-Tag", "asset-"+text(asset["id"]))
	return http.StatusOK, data, "application/json"
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

// listHashLists pages the project's hash lists, newest first unless sort says otherwise.
func (m *MockServerClient) listHashLists(q url.Values) (any, error) {
	size, err := intRange(q, "pageSize", defaultPageSize, 1, maxPageSize)
	if err != nil {
		return nil, err
	}
	ordering, err := cursorOrdering(q, sortRule{Field: "createdAt", Direction: sortDescending})
	if err != nil {
		return nil, err
	}
	items := []calmlens.JSON{}
	for _, list := range m.DatabaseStorage.HashLists {
		if list["projectId"] == m.options.ProjectID {
			items = append(items, list)
		}
	}
	return keysetPage(items, ordering, q.Get("cursor"), "hash-lists", size)
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
	list := calmlens.JSON{"id": m.options.CreateID("hl"), "projectId": m.options.ProjectID, "name": strings.TrimSpace(name), "description": description, "action": body["action"], "createdAt": now, "updatedAt": now}
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

// listHashListEntries pages a list's entries, newest first unless sort says otherwise.
func (m *MockServerClient) listHashListEntries(id string, q url.Values) (any, error) {
	size, err := intRange(q, "pageSize", defaultPageSize, 1, maxPageSize)
	if err != nil {
		return nil, err
	}
	ordering, err := cursorOrdering(q, sortRule{Field: "createdAt", Direction: sortDescending})
	if err != nil {
		return nil, err
	}
	entries := []calmlens.JSON{}
	for _, entry := range m.DatabaseStorage.HashListEntries {
		if entry["hashListId"] == id {
			entries = append(entries, entry)
		}
	}
	return keysetPage(entries, ordering, q.Get("cursor"), "hash-list-entries:"+id, size)
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
		content := section(a, "content")
		if text(content["perceptualHash"]) == "" {
			return nil, fail(calmlens.CodeHashListAssetNotHashed)
		}
		hash, quality, source = text(content["perceptualHash"]), content["perceptualHashQuality"], assetID
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
	entry := calmlens.JSON{"id": m.options.CreateID("hle"), "projectId": m.options.ProjectID, "hashListId": id, "hash": hash, "quality": quality, "label": label, "assetId": source, "createdAt": now}
	m.DatabaseStorage.HashListEntries[text(entry["id"])] = entry
	m.status = http.StatusCreated
	return entry, nil
}
