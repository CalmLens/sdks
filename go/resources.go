package calmlens

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"
)

// TextService moderates plain text.
type TextService struct{ c *ServerClient }

// AssetsService uploads, moderates, lists and manages assets.
type AssetsService struct{ c *ServerClient }

// FoldersService manages folders.
type FoldersService struct{ c *ServerClient }

// EventsService reads the project event feed.
type EventsService struct{ c *ServerClient }

// CDNService builds CDN URLs and fetches CDN content.
type CDNService struct{ c *ServerClient }

// Search finds assets by keyword, semantic or hybrid search.
func (s *AssetsService) Search(ctx context.Context, options SearchAssetsOptions) (*AssetSearchResponse, error) {
	params, err := query(options)
	if err != nil {
		return nil, err
	}
	var result AssetSearchResponse
	if err = s.c.request(ctx, "GET", s.c.project("assets/search"), params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// List returns one page of assets. Use ListAll to iterate over every page.
func (s *AssetsService) List(ctx context.Context, options ListAssetsOptions) (*AssetPage, error) {
	params, err := query(options)
	if err != nil {
		return nil, err
	}
	var result AssetPage
	if err = s.c.request(ctx, "GET", s.c.project("assets/page"), params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Retrieve returns the current state of an asset.
func (s *AssetsService) Retrieve(ctx context.Context, options AssetIDOptions) (*Asset, error) {
	path, err := resourcePath("assets", options.AssetID, "")
	if err != nil {
		return nil, err
	}
	params := url.Values{}
	if options.Region != "" {
		params.Set("region", options.Region)
	}
	var result Asset
	if err = s.c.request(ctx, "GET", path, params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Update patches an asset; see UpdateAssetOptions.
func (s *AssetsService) Update(ctx context.Context, options UpdateAssetOptions) (*Asset, error) {
	return s.assetRequest(ctx, "PATCH", options.AssetID, "", options)
}

// Retry processes an asset that failed to process (Processing.Status ClassificationStatusFailed)
// again: processing returns to ClassificationStatusProcessing and moderation to
// ModerationStatusPending.
func (s *AssetsService) Retry(ctx context.Context, options AssetIDOptions) (*Asset, error) {
	return s.assetRequest(ctx, "POST", options.AssetID, "/retry", nil)
}

// Explain completes the policy evidence behind a decided asset's moderation decision: the report's
// Policy.Evidence becomes PolicyEvidenceFull and every action stays as decided. With Rerun the
// asset is moderated again with the project's current policy and returns in
// ClassificationStatusProcessing; use it when the policy changed since the decision
// (CodeAssetPolicyChanged).
func (s *AssetsService) Explain(ctx context.Context, options ExplainAssetOptions) (*Asset, error) {
	body := JSON{}
	if options.Rerun {
		body["rerun"] = true
	}
	return s.assetRequest(ctx, "POST", options.AssetID, "/explain", body)
}

// DefaultDecisionTimeout is how long WaitForDecision waits when no Timeout is given.
const DefaultDecisionTimeout = 60 * time.Second

const (
	decisionPollFirstDelay = 500 * time.Millisecond
	decisionPollFactor     = 1.5
	decisionPollMaxDelay   = 5 * time.Second
)

// WaitForDecision retrieves an asset until it has a moderation decision (Moderation.Status is no
// longer ModerationStatusPending) or its processing failed
// (Processing.Status ClassificationStatusFailed), and returns that asset. It waits 0.5s before the
// second check and 1.5 times longer each time after that, up to 5s. A zero Timeout checks once.
// When Timeout (default DefaultDecisionTimeout) passes without a decision it returns a *Error with code
// sdk/timeout and Details {"assetId", "classificationStatus", "moderationStatus"} holding the last
// statuses seen. Cancelling ctx
// stops waiting with sdk/cancelled. Webhooks report decisions without polling.
func (s *AssetsService) WaitForDecision(ctx context.Context, options WaitForDecisionOptions) (*Asset, error) {
	timeout := DefaultDecisionTimeout
	if options.Timeout != nil {
		timeout = *options.Timeout
	}
	if timeout < 0 {
		return nil, invalid(CodeSDKInvalidArgument, "Timeout cannot be negative")
	}
	deadline := s.c.now().Add(timeout)
	delay := decisionPollFirstDelay
	for {
		if err := ctx.Err(); err != nil {
			return nil, transportError(err)
		}
		asset, err := s.Retrieve(ctx, AssetIDOptions{AssetID: options.AssetID})
		if err != nil {
			return nil, err
		}
		switch {
		case asset.Classification.Moderation.Status != ModerationStatusPending, asset.Classification.Status == ClassificationStatusFailed:
			return asset, nil
		}
		remaining := deadline.Sub(s.c.now())
		if remaining <= 0 {
			return nil, &Error{
				Code:    CodeSDKTimeout,
				Message: "Asset " + asset.ID + " had no moderation decision after " + timeout.String() + " (processing " + asset.Classification.Status + ", moderation " + asset.Classification.Moderation.Status + ")",
				Details: JSON{"assetId": asset.ID, "classificationStatus": asset.Classification.Status, "moderationStatus": asset.Classification.Moderation.Status},
			}
		}
		if err = s.c.sleep(ctx, min(delay, remaining)); err != nil {
			return nil, transportError(err)
		}
		delay = min(decisionPollMaxDelay, time.Duration(float64(delay)*decisionPollFactor))
	}
}

// DeleteContent removes the asset's stored content (source, preview and retained extracted
// text) and keeps the record, metadata and classification results. The returned asset has
// Content.Status ContentStatusRemoved with RemovalReason ContentRemovalReasonRequested, and the
// CDN no longer serves its content.
func (s *AssetsService) DeleteContent(ctx context.Context, options AssetIDOptions) (*Asset, error) {
	return s.assetRequest(ctx, "DELETE", options.AssetID, "/content", nil)
}

// Delete removes the asset record together with its stored content.
func (s *AssetsService) Delete(ctx context.Context, options AssetIDOptions) error {
	path, err := resourcePath("assets", options.AssetID, "")
	if err != nil {
		return err
	}
	return s.c.request(ctx, "DELETE", path, nil, nil, nil)
}

// Batch deletes up to 500 assets (AssetBatchOperationDelete) or removes their stored content
// (AssetBatchOperationRemoveContent) in one request. Every asset must exist in the project and
// the key needs assets:delete for its folder, or nothing is queued. It returns once the
// operation is queued; the work runs in the background and records asset.deleted or
// asset.content-removed for each asset. Assets under a safety hold are skipped. It is not
// retried: it carries no Idempotency-Key.
func (s *AssetsService) Batch(ctx context.Context, options BatchAssetsOptions) (*BatchAssetsResponse, error) {
	if err := validateBatchAssetsOptions(options); err != nil {
		return nil, err
	}
	var result BatchAssetsResponse
	body := JSON{"assetIds": options.AssetIDs, "operation": options.Operation}
	if err := s.c.request(ctx, "POST", s.c.project("assets/batch"), nil, body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// validateBatchAssetsOptions refuses a batch the API would reject for its size, an ID or the
// operation, with sdk/invalid-argument.
func validateBatchAssetsOptions(options BatchAssetsOptions) error {
	if len(options.AssetIDs) < 1 || len(options.AssetIDs) > AssetBatchMaxAssets {
		return invalid(CodeSDKInvalidArgument, "AssetIDs must list 1 to 500 asset IDs")
	}
	for _, id := range options.AssetIDs {
		if id == "" {
			return invalid(CodeSDKInvalidArgument, "Every asset ID must be a non-empty string")
		}
	}
	if options.Operation != AssetBatchOperationDelete && options.Operation != AssetBatchOperationRemoveContent {
		return invalid(CodeSDKInvalidArgument, "Operation must be one of delete, remove-content")
	}
	return nil
}

// Move moves an asset into a folder, or to the root when FolderID is nil.
func (s *AssetsService) Move(ctx context.Context, options MoveAssetOptions) (*Asset, error) {
	return s.assetRequest(ctx, "POST", options.AssetID, "/move", JSON{"folderId": options.FolderID})
}

func (s *AssetsService) assetRequest(ctx context.Context, method, id, suffix string, body any) (*Asset, error) {
	path, err := resourcePath("assets", id, suffix)
	if err != nil {
		return nil, err
	}
	var result Asset
	if err = s.c.request(ctx, method, path, nil, body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ListChildren returns one page of an asset's children. Use ListChildrenAll to iterate
// over every page.
func (s *AssetsService) ListChildren(ctx context.Context, options ListAssetChildrenOptions) (*AssetPage, error) {
	path, err := resourcePath("assets", options.AssetID, "/children")
	if err != nil {
		return nil, err
	}
	params, err := query(ListAssetsOptions{Cursor: options.Cursor, PageSize: options.PageSize, Ordering: options.Ordering})
	if err != nil {
		return nil, err
	}
	var result AssetPage
	if err = s.c.request(ctx, "GET", path, params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// MaxSignedURLSeconds is the longest signed URL lifetime the API accepts: 24 hours.
const MaxSignedURLSeconds = 24 * 60 * 60

// DefaultSignedURLSeconds is the lifetime CreateSignedURL sends when ExpiresInSeconds is zero.
const DefaultSignedURLSeconds = 900

// CreateSignedURL returns a short-lived URL for private CDN content.
func (s *AssetsService) CreateSignedURL(ctx context.Context, options SignedURLOptions) (*SignedURL, error) {
	path, err := resourcePath("assets", options.AssetID, "/signed-url")
	if err != nil {
		return nil, err
	}
	transform, _, err := transformSelector(options.Transform, options.TransformSteps)
	if err != nil {
		return nil, err
	}
	if options.Resource != "" && options.Resource != ResourceOriginal && options.Resource != ResourceRendered {
		return nil, invalid(CodeSDKInvalidArgument, "a signed URL's resource must be original or rendered")
	}
	if options.Resource == ResourceOriginal && (options.Lens != "" || transform != "") {
		return nil, invalid(CodeSDKInvalidArgument, "lenses and transforms apply only to the rendered resource")
	}
	if options.ExpiresInSeconds < 0 || options.ExpiresInSeconds > MaxSignedURLSeconds {
		return nil, invalid(CodeSDKInvalidArgument, "ExpiresInSeconds must be from 1 to 86400 (0 for the default)")
	}
	options.Transform, options.TransformSteps = transform, nil
	if options.ExpiresInSeconds == 0 {
		options.ExpiresInSeconds = DefaultSignedURLSeconds
	}
	var result SignedURL
	if err = s.c.request(ctx, "POST", path, nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// List returns one page of folders.
func (s *FoldersService) List(ctx context.Context, options ListFoldersOptions) (*FolderPage, error) {
	params, err := query(options)
	if err != nil {
		return nil, err
	}
	var result FolderPage
	if err := s.c.request(ctx, "GET", s.c.project("folders"), params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Retrieve returns a folder.
func (s *FoldersService) Retrieve(ctx context.Context, options FolderIDOptions) (*Folder, error) {
	return s.folderRequest(ctx, "GET", options.FolderID, "", nil)
}

// Create creates a folder.
func (s *FoldersService) Create(ctx context.Context, options CreateFolderOptions) (*Folder, error) {
	var result Folder
	if err := s.c.request(ctx, "POST", s.c.project("folders"), nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Update renames a folder.
func (s *FoldersService) Update(ctx context.Context, options UpdateFolderOptions) (*Folder, error) {
	return s.folderRequest(ctx, "PATCH", options.FolderID, "", options)
}

// Move moves a folder under ParentID, or to the root when ParentID is nil.
func (s *FoldersService) Move(ctx context.Context, options MoveFolderOptions) (*Folder, error) {
	return s.folderRequest(ctx, "POST", options.FolderID, "/move", JSON{"parentId": options.ParentID})
}

// Delete deletes an empty folder.
func (s *FoldersService) Delete(ctx context.Context, options FolderIDOptions) error {
	path, err := resourcePath("folders", options.FolderID, "")
	if err != nil {
		return err
	}
	return s.c.request(ctx, "DELETE", path, nil, nil, nil)
}

func (s *FoldersService) folderRequest(ctx context.Context, method, id, suffix string, body any) (*Folder, error) {
	path, err := resourcePath("folders", id, suffix)
	if err != nil {
		return nil, err
	}
	var result Folder
	if err = s.c.request(ctx, method, path, nil, body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// List returns one page of the event feed. Use ListAll to follow the cursor.
func (s *EventsService) List(ctx context.Context, options ListEventsOptions) (*EventsPage, error) {
	params, err := query(options)
	if err != nil {
		return nil, err
	}
	var result EventsPage
	if err = s.c.request(ctx, "GET", s.c.project("events"), params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetAssetURL builds a CDN URL without sending a request.
func (s *CDNService) GetAssetURL(options CDNAssetURLOptions) (string, error) {
	if options.AssetIdentifier == "" {
		return "", invalid(CodeSDKInvalidArgument, "asset identifier is required")
	}
	transform, _, err := transformSelector(options.Transform, options.TransformSteps)
	if err != nil {
		return "", err
	}
	transformed := options.Lens != "" || options.Transform != "" || options.TransformSteps != nil
	if options.Resource == "" {
		options.Resource = ResourceRendered
	}
	if options.Resource != ResourceOriginal && options.Resource != ResourceRendered && options.Resource != ResourcePlaceholder {
		return "", invalid(CodeSDKInvalidArgument, "resource must be original, rendered or placeholder")
	}
	if options.Resource == ResourceOriginal && transformed {
		return "", invalid(CodeSDKInvalidArgument, "lenses and transforms apply only to the rendered resource")
	}
	if options.Resource == ResourcePlaceholder && (options.Lens != "" || options.Transform != "" || options.TransformSteps != nil || options.AllowAgeRestricted) {
		return "", invalid(CodeSDKInvalidArgument, "a placeholder takes no lens, transform or allowAgeRestricted")
	}
	asset, err := segment(options.AssetIdentifier)
	if err != nil {
		return "", err
	}
	endpoint := s.c.options.CDNBaseURL + "/assets/" + component(s.c.options.ProjectID) + "/" + asset + "/" + options.Resource
	if options.Lens != "" {
		lens, err := segment(options.Lens)
		if err != nil {
			return "", err
		}
		endpoint += "/@" + lens
	}
	if options.TransformSteps != nil {
		// Serialized steps are already path-safe: unreserved characters, escapes, "=", "," and "/".
		endpoint += "/" + transform
	} else if transform != "" {
		path, err := transformPath(transform)
		if err != nil {
			return "", err
		}
		endpoint += "/" + path
	}
	params := url.Values{}
	if options.Region != "" {
		params.Set("region", options.Region)
	}
	if options.AllowAgeRestricted {
		params.Set("allowAgeRestricted", "true")
	}
	if len(params) > 0 {
		endpoint += "?" + params.Encode()
	}
	return endpoint, nil
}

// Serve fetches CDN content and returns the raw response, including non-2xx statuses. The
// body is streamed: the caller must close it. Options.Timeout bounds each attempt only until the
// response headers arrive, so long downloads are not cut off; pass a context with a deadline to
// bound the whole download. GET and HEAD requests are retried like API reads (429, 502, 503, 504
// and transport failures, honouring Retry-After); when retries run out, the last response is
// returned. A redirect is never followed: it fails with sdk/http-error and its status.
func (s *CDNService) Serve(ctx context.Context, options CDNServeOptions) (*http.Response, error) {
	endpoint, err := s.GetAssetURL(options.CDNAssetURLOptions)
	if err != nil {
		return nil, err
	}
	method := options.Method
	if method == "" {
		method = "GET"
	}
	retryable := method == http.MethodGet || method == http.MethodHead
	for attempt := 0; ; attempt++ {
		canRetry := retryable && attempt < s.c.maxRetries
		response, err := s.attempt(ctx, method, endpoint, options.Headers)
		if err != nil {
			sdkErr, ok := err.(*Error)
			if !ok || !canRetry || !sdkErr.Retryable() || ctx.Err() != nil {
				return nil, err
			}
			if waitErr := s.c.sleep(ctx, backoff(attempt)); waitErr != nil {
				return nil, transportError(waitErr)
			}
			continue
		}
		if isRedirect(response) {
			response.Body.Close()
			return nil, redirectError(response)
		}
		if response.StatusCode >= 200 && response.StatusCode < 300 || !canRetry {
			return response, nil
		}
		failure := &Error{Status: response.StatusCode, RetryAfter: parseRetryAfter(response.Header.Get("Retry-After"), s.c.now())}
		delay, wait := retryDelay(failure, attempt)
		if !failure.Retryable() || !wait {
			return response, nil
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
		response.Body.Close()
		if waitErr := s.c.sleep(ctx, delay); waitErr != nil {
			return nil, transportError(waitErr)
		}
	}
}

// attempt sends one CDN request. Options.Timeout ends when the response headers arrive.
func (s *CDNService) attempt(ctx context.Context, method, endpoint string, headers http.Header) (*http.Response, error) {
	ctx, cancel := context.WithCancel(ctx)
	var timedOut atomic.Bool
	timer := time.AfterFunc(s.c.options.Timeout, func() {
		timedOut.Store(true)
		cancel()
	})
	req, err := http.NewRequestWithContext(ctx, method, endpoint, nil)
	if err != nil {
		timer.Stop()
		cancel()
		return nil, argumentError("Could not build the CDN request", err)
	}
	req.Header = headers.Clone()
	if req.Header == nil {
		req.Header = http.Header{}
	}
	req.Header.Set("X-Api-Key", s.c.options.APIKey)
	req.Header.Set("User-Agent", userAgent)
	response, err := s.c.http.Do(req)
	if !timer.Stop() && timedOut.Load() {
		cancel()
		if response != nil {
			response.Body.Close()
		}
		return nil, &Error{Code: CodeSDKTimeout, Message: "CDN request timed out", Cause: context.DeadlineExceeded}
	}
	if err != nil {
		cancel()
		return nil, transportError(err)
	}
	response.Body = &cancelOnClose{ReadCloser: response.Body, cancel: cancel}
	return response, nil
}

// cancelOnClose releases a CDN request's context once its body is closed.
type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (b *cancelOnClose) Close() error {
	err := b.ReadCloser.Close()
	b.cancel()
	return err
}

// Classify moderates plain text and waits for the decision.
func (s *TextService) Classify(ctx context.Context, options ClassifyTextOptions) (*Asset, error) {
	if strings.TrimSpace(options.Text) == "" {
		return nil, invalid(CodeInvalidUploadPayload, "Text to classify must be a non-empty string")
	}
	if options.Name == "" {
		options.Name = "text"
	}
	return s.c.Assets.Classify(ctx, SubmitAssetOptions{Name: options.Name, Content: &Content{Type: "text/plain", PlainText: &options.Text}, Description: options.Description, ProcessingOptions: options.ProcessingOptions, Metadata: options.Metadata, AuthorID: options.AuthorID, Context: options.Context, ExternalID: options.ExternalID, ExternalURL: options.ExternalURL, FolderID: options.FolderID, UploadPresetID: options.UploadPresetID, IdempotencyKey: options.IdempotencyKey})
}

// HashListsService manages hash lists: perceptual hashes of images the project never wants
// again. Image uploads are compared with every list: flag lists record matches, block lists
// also block close ones.
type HashListsService struct{ c *ServerClient }

// List returns every hash list in the project.
func (s *HashListsService) List(ctx context.Context, options ListHashListsOptions) (*HashListList, error) {
	var result HashListList
	if err := s.c.request(ctx, "GET", s.c.project("hash-lists"), nil, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Retrieve returns a hash list.
func (s *HashListsService) Retrieve(ctx context.Context, options HashListIDOptions) (*HashList, error) {
	return s.listRequest(ctx, "GET", options.HashListID, nil)
}

// Create creates a hash list.
func (s *HashListsService) Create(ctx context.Context, options CreateHashListOptions) (*HashList, error) {
	var result HashList
	if err := s.c.request(ctx, "POST", s.c.project("hash-lists"), nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Update renames a hash list or changes its action; the new action applies to later uploads.
func (s *HashListsService) Update(ctx context.Context, options UpdateHashListOptions) (*HashList, error) {
	return s.listRequest(ctx, "PATCH", options.HashListID, options)
}

// Delete deletes a hash list and every entry in it.
func (s *HashListsService) Delete(ctx context.Context, options HashListIDOptions) error {
	path, err := resourcePath("hash-lists", options.HashListID, "")
	if err != nil {
		return err
	}
	return s.c.request(ctx, "DELETE", path, nil, nil, nil)
}

// ListEntries returns one page of a hash list's entries, newest first.
func (s *HashListsService) ListEntries(ctx context.Context, options ListHashListEntriesOptions) (*HashListEntryPage, error) {
	path, err := resourcePath("hash-lists", options.HashListID, "/entries")
	if err != nil {
		return nil, err
	}
	params, err := query(ListAssetsOptions{Cursor: options.Cursor, PageSize: options.PageSize})
	if err != nil {
		return nil, err
	}
	var result HashListEntryPage
	if err = s.c.request(ctx, "GET", path, params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// AddEntry adds a hash, or an image asset's hash, to a hash list. A hash already in the list
// returns its existing entry.
func (s *HashListsService) AddEntry(ctx context.Context, options AddHashListEntryOptions) (*HashListEntry, error) {
	path, err := resourcePath("hash-lists", options.HashListID, "/entries")
	if err != nil {
		return nil, err
	}
	var result HashListEntry
	if err = s.c.request(ctx, "POST", path, nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// RemoveEntry removes an entry from its hash list.
func (s *HashListsService) RemoveEntry(ctx context.Context, options HashListEntryIDOptions) error {
	path, err := resourcePath("hash-list-entries", options.EntryID, "")
	if err != nil {
		return err
	}
	return s.c.request(ctx, "DELETE", path, nil, nil, nil)
}

func (s *HashListsService) listRequest(ctx context.Context, method, id string, body any) (*HashList, error) {
	path, err := resourcePath("hash-lists", id, "")
	if err != nil {
		return nil, err
	}
	var result HashList
	if err = s.c.request(ctx, method, path, nil, body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
