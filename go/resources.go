package calmlens

import (
	"context"
	"net/url"
	"strings"
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

// Search finds assets by keyword, semantic or hybrid search.
func (s *AssetsService) Search(ctx context.Context, options SearchAssetsOptions) (*AssetSearchResponse, error) {
	ctx, paramsErr := withCall(ctx, "assets.search", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
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
	ctx, paramsErr := withCall(ctx, "assets.list", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	params, err := query(options)
	if err != nil {
		return nil, err
	}
	var result AssetPage
	if err = s.c.request(ctx, "GET", s.c.project("assets"), params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Retrieve returns the current state of an asset.
func (s *AssetsService) Retrieve(ctx context.Context, options AssetIDOptions) (*Asset, error) {
	ctx, paramsErr := withCall(ctx, "assets.retrieve", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	path, err := resourcePath("assets", options.AssetID, "")
	if err != nil {
		return nil, err
	}
	params := url.Values{}

	var result Asset
	if err = s.c.request(ctx, "GET", path, params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Update patches an asset; see UpdateAssetOptions.
func (s *AssetsService) Update(ctx context.Context, options UpdateAssetOptions) (*Asset, error) {
	ctx, paramsErr := withCall(ctx, "assets.update", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	return s.assetRequest(ctx, "PATCH", options.AssetID, "", options)
}

// Retry processes an asset that failed to process (Processing.Status ClassificationStatusFailed)
// again: processing returns to ClassificationStatusProcessing and moderation to
// ModerationStatusPending.
func (s *AssetsService) Retry(ctx context.Context, options AssetIDOptions) (*Asset, error) {
	ctx, paramsErr := withCall(ctx, "assets.retry", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	return s.assetRequest(ctx, "POST", options.AssetID, "/retry", nil)
}

// Decide records a reviewer's decision, replacing the policy's: the asset's moderation status
// becomes options.Decision, the note joins its review history and the matching asset.<status>
// event is sent with the API key as its Actor. An asset still pending moderation can only be
// blocked or purged. Purging needs ConfirmPurge and the assets:delete permission, and
// permanently deletes the stored content.
func (s *AssetsService) Decide(ctx context.Context, options DecideAssetOptions) (*Asset, error) {
	ctx, paramsErr := withCall(ctx, "assets.decide", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	return s.assetRequest(ctx, "POST", options.AssetID, "/decision", options)
}

// Explain completes the policy evidence behind a decided asset's moderation decision: the report's
// ExplanationComplete becomes true and every action stays as decided. With Rerun the
// asset is moderated again with the project's current policy, and an EventAssetRerunRequested
// event is recorded; use it when the policy changed since the decision (CodeAssetPolicyChanged).
// The asset returns unchanged: it keeps its decision until the re-run's is stored, reported by
// EventAssetClassified and asset.<status> events, and a failed re-run keeps it. A reviewed asset
// fails with CodeAssetReviewed, and one whose content is gone with CodeAssetContentUnavailable.
func (s *AssetsService) Explain(ctx context.Context, options ExplainAssetOptions) (*Asset, error) {
	ctx, paramsErr := withCall(ctx, "assets.explain", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
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
	decisionPollMaxDelay   = 2 * time.Second
)

// WaitForDecision retrieves an asset until it is settled, its Classification.Status
// ClassificationStatusCompleted (with its decision in Classification.Moderation.Decision) or
// ClassificationStatusFailed, and returns that asset. A ClassificationStatusQueued or
// ClassificationStatusProcessing asset is still waiting, even when a reviewer has already decided
// it. It waits 0.5s before the
// second check and 1.5 times longer each time after that, up to 2s. A zero Timeout checks once.
// When Timeout (default DefaultDecisionTimeout) passes before it is settled it returns a *Error with code
// sdk/timeout and Details {"assetId", "classificationStatus", "moderationDecision"} holding the last
// statuses seen. Cancelling ctx
// stops waiting with sdk/cancelled. Webhooks report decisions without polling.
func (s *AssetsService) WaitForDecision(ctx context.Context, options WaitForDecisionOptions) (*Asset, error) {
	ctx, paramsErr := withCall(ctx, "assets.waitForDecision", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	timeout := DefaultDecisionTimeout
	if options.Timeout != nil {
		timeout = *options.Timeout
	}
	if timeout < 0 {
		return nil, invalid(CodeSDKInvalidArgument, "Timeout cannot be negative")
	}
	deadline := s.c.now().Add(timeout)
	pollCtx := ctx
	if timeout > 0 {
		var cancel context.CancelFunc
		pollCtx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	delay := decisionPollFirstDelay
	var last *Asset
	timedOut := func() (*Asset, error) {
		details := JSON{"assetId": options.AssetID, "classificationStatus": nil, "moderationDecision": nil}
		if last != nil {
			details["classificationStatus"] = string(last.Classification.Status)
			if decision := last.Classification.Moderation.Decision; decision != nil {
				details["moderationDecision"] = string(*decision)
			}
		}
		return nil, &Error{Code: CodeSDKTimeout, Message: "Asset " + options.AssetID + " did not settle within " + timeout.String(), Details: details}
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, transportError(err)
		}
		if timeout > 0 && (pollCtx.Err() != nil || !s.c.now().Before(deadline)) {
			return timedOut()
		}
		asset, err := s.Retrieve(pollCtx, AssetIDOptions{AssetID: options.AssetID})
		if ctx.Err() != nil {
			return nil, transportError(ctx.Err())
		}
		if timeout > 0 && (pollCtx.Err() != nil || !s.c.now().Before(deadline)) {
			return timedOut()
		}
		if err != nil {
			return nil, err
		}
		last = asset
		switch {
		case asset.Classification.Status == ClassificationStatusCompleted, asset.Classification.Status == ClassificationStatusFailed:
			return asset, nil
		}
		remaining := deadline.Sub(s.c.now())
		if remaining <= 0 {
			return timedOut()
		}
		if err = s.c.sleep(pollCtx, min(delay, remaining)); err != nil {
			if ctx.Err() == nil && pollCtx.Err() != nil {
				return timedOut()
			}
			return nil, transportError(err)
		}
		delay = min(decisionPollMaxDelay, time.Duration(float64(delay)*decisionPollFactor))
	}
}

// RemoveContent removes the asset's stored content (source, preview and retained extracted
// text) and keeps the record, metadata and classification results. The returned asset has
// Content.Status ContentStatusRemoved with RemovalReason ContentRemovalReasonRequested, and the
// CDN no longer serves its content.
func (s *AssetsService) RemoveContent(ctx context.Context, options AssetIDOptions) (*Asset, error) {
	ctx, paramsErr := withCall(ctx, "assets.removeContent", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	return s.assetRequest(ctx, "DELETE", options.AssetID, "/content", nil)
}

// Delete removes the asset record together with its stored content. An asset extracted from
// another (one with a ParentID) fails with CodeAssetChildNotDeletable: delete its parent instead.
func (s *AssetsService) Delete(ctx context.Context, options AssetIDOptions) error {
	ctx, paramsErr := withCall(ctx, "assets.delete", options.Params)
	if paramsErr != nil {
		return paramsErr
	}
	path, err := resourcePath("assets", options.AssetID, "")
	if err != nil {
		return err
	}
	return s.c.request(ctx, "DELETE", path, nil, nil, nil)
}

// Batch deletes up to 500 assets (AssetBatchOperationDelete) or removes their stored content
// (AssetBatchOperationRemoveContent) in one request. Every asset must exist in the project and
// the key needs assets:delete for its folder, and a deletion can't name an asset extracted from
// another (CodeAssetChildNotDeletable), or nothing is queued. It returns once the
// operation is queued, with the batch's BatchID; the work runs in the background and records
// asset.deleted or asset.content-removed for each asset, with a FactBatchID fact naming BatchID.
// Assets under a safety hold are skipped. It is not retried: it carries no Idempotency-Key.
func (s *AssetsService) Batch(ctx context.Context, options BatchAssetsOptions) (*BatchAssetsResponse, error) {
	ctx, paramsErr := withCall(ctx, "assets.batch", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
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
	ctx, paramsErr := withCall(ctx, "assets.move", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
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
	ctx, paramsErr := withCall(ctx, "assets.listChildren", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	path, err := resourcePath("assets", options.AssetID, "/children")
	if err != nil {
		return nil, err
	}
	params, err := query(ListAssetsOptions{Cursor: options.Cursor, PageSize: options.PageSize, Sort: options.Sort})
	if err != nil {
		return nil, err
	}
	var result AssetPage
	if err = s.c.request(ctx, "GET", path, params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ListTimeline returns one page of an audio or video asset's findings timeline, in time order,
// from the client's project. Classification.Moderation.Timeline.SegmentCount says how many
// segments there are. Pass each page's NextCursor back unchanged; cursors are opaque. Use
// ListTimelineAll to iterate over every page.
func (s *AssetsService) ListTimeline(ctx context.Context, options ListAssetTimelineOptions) (*AssetTimelinePage, error) {
	ctx, paramsErr := withCall(ctx, "assets.listTimeline", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	asset, err := resourcePath("assets", options.AssetID, "/timeline")
	if err != nil {
		return nil, err
	}
	path := s.c.project(strings.TrimPrefix(asset, "/"))
	params, err := query(struct {
		Cursor   string `json:"cursor,omitempty"`
		PageSize int    `json:"pageSize,omitempty"`
	}{options.Cursor, options.PageSize})
	if err != nil {
		return nil, err
	}
	var result AssetTimelinePage
	if err = s.c.request(ctx, "GET", path, params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// List returns one page of child folders, sorted by name unless options.Sort says otherwise.
// Pass the page's NextCursor as Cursor for the next page, or use ListAll to iterate over every
// page.
func (s *FoldersService) List(ctx context.Context, options ListFoldersOptions) (*FolderPage, error) {
	ctx, paramsErr := withCall(ctx, "folders.list", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
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
	ctx, paramsErr := withCall(ctx, "folders.retrieve", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	return s.folderRequest(ctx, "GET", options.FolderID, "", nil)
}

// Create creates a folder.
func (s *FoldersService) Create(ctx context.Context, options CreateFolderOptions) (*Folder, error) {
	ctx, paramsErr := withCall(ctx, "folders.create", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	var result Folder
	if err := s.c.request(ctx, "POST", s.c.project("folders"), nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Update renames a folder.
func (s *FoldersService) Update(ctx context.Context, options UpdateFolderOptions) (*Folder, error) {
	ctx, paramsErr := withCall(ctx, "folders.update", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	return s.folderRequest(ctx, "PATCH", options.FolderID, "", options)
}

// Move moves a folder under ParentID, or to the root when ParentID is nil.
func (s *FoldersService) Move(ctx context.Context, options MoveFolderOptions) (*Folder, error) {
	ctx, paramsErr := withCall(ctx, "folders.move", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	return s.folderRequest(ctx, "POST", options.FolderID, "/move", JSON{"parentId": options.ParentID})
}

// Delete deletes an empty folder.
func (s *FoldersService) Delete(ctx context.Context, options FolderIDOptions) error {
	ctx, paramsErr := withCall(ctx, "folders.delete", options.Params)
	if paramsErr != nil {
		return paramsErr
	}
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
	ctx, paramsErr := withCall(ctx, "events.list", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	params, err := query(options)
	if err != nil {
		return nil, err
	}
	// The API takes the types as one comma-separated value.
	params.Del("types")
	if len(options.Types) > 0 {
		types := make([]string, len(options.Types))
		for i, eventType := range options.Types {
			types[i] = string(eventType)
		}
		params.Set("types", strings.Join(types, ","))
	}
	var result EventsPage
	if err = s.c.request(ctx, "GET", s.c.project("events"), params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Classify moderates plain text and waits for the decision.
func (s *TextService) Classify(ctx context.Context, options ClassifyTextOptions) (*Asset, error) {
	ctx, paramsErr := withCall(ctx, "text.classify", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	if strings.TrimSpace(options.Text) == "" {
		return nil, invalid(CodeSDKInvalidArgument, "Text to classify must be a non-empty string")
	}
	if options.Name == "" {
		options.Name = "text"
	}
	return s.c.Assets.Classify(ctx, SubmitAssetOptions{Name: options.Name, Content: &Content{Type: "text/plain", PlainText: &options.Text}, Description: options.Description, Visibility: options.Visibility, ProcessingOptions: options.ProcessingOptions, Metadata: options.Metadata, Tags: options.Tags, AuthorID: options.AuthorID, Context: options.Context, ExternalID: options.ExternalID, ExternalURL: options.ExternalURL, FolderID: options.FolderID, UploadPresetID: options.UploadPresetID, Params: options.Params})
}

// HashListsService manages hash lists: perceptual hashes of images the project never wants
// again. Image uploads are compared with every list: flag lists record matches, block lists
// also block close ones.
type HashListsService struct{ c *ServerClient }

// List returns one page of the project's hash lists, newest first unless options.Sort says
// otherwise. Use ListAll to iterate over every page.
func (s *HashListsService) List(ctx context.Context, options ListHashListsOptions) (*HashListPage, error) {
	ctx, paramsErr := withCall(ctx, "hashLists.list", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	params, err := query(options)
	if err != nil {
		return nil, err
	}
	var result HashListPage
	if err := s.c.request(ctx, "GET", s.c.project("hash-lists"), params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Retrieve returns a hash list.
func (s *HashListsService) Retrieve(ctx context.Context, options HashListIDOptions) (*HashList, error) {
	ctx, paramsErr := withCall(ctx, "hashLists.retrieve", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	return s.listRequest(ctx, "GET", options.HashListID, nil)
}

// Create creates a hash list.
func (s *HashListsService) Create(ctx context.Context, options CreateHashListOptions) (*HashList, error) {
	ctx, paramsErr := withCall(ctx, "hashLists.create", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	var result HashList
	if err := s.c.request(ctx, "POST", s.c.project("hash-lists"), nil, options, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Update renames a hash list or changes its action; the new action applies to later uploads.
func (s *HashListsService) Update(ctx context.Context, options UpdateHashListOptions) (*HashList, error) {
	ctx, paramsErr := withCall(ctx, "hashLists.update", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	return s.listRequest(ctx, "PATCH", options.HashListID, options)
}

// Delete deletes a hash list and every entry in it.
func (s *HashListsService) Delete(ctx context.Context, options HashListIDOptions) error {
	ctx, paramsErr := withCall(ctx, "hashLists.delete", options.Params)
	if paramsErr != nil {
		return paramsErr
	}
	path, err := resourcePath("hash-lists", options.HashListID, "")
	if err != nil {
		return err
	}
	return s.c.request(ctx, "DELETE", path, nil, nil, nil)
}

// ListEntries returns one page of a hash list's entries, newest first unless options.Sort says
// otherwise. Use ListEntriesAll to iterate over every page.
func (s *HashListsService) ListEntries(ctx context.Context, options ListHashListEntriesOptions) (*HashListEntryPage, error) {
	ctx, paramsErr := withCall(ctx, "hashLists.listEntries", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	path, err := resourcePath("hash-lists", options.HashListID, "/entries")
	if err != nil {
		return nil, err
	}
	params, err := query(ListHashListsOptions{Cursor: options.Cursor, PageSize: options.PageSize, Sort: options.Sort})
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
	ctx, paramsErr := withCall(ctx, "hashLists.addEntry", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
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
	ctx, paramsErr := withCall(ctx, "hashLists.removeEntry", options.Params)
	if paramsErr != nil {
		return paramsErr
	}
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
