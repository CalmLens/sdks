package calmlens

import (
	"context"
	"net/http"
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
	return s.assetRequest(ctx, "GET", options.AssetID, "", nil)
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

// DefaultDecisionTimeout is how long WaitForDecision waits when no Timeout is given.
const DefaultDecisionTimeout = 60 * time.Second

const (
	decisionPollFirstDelay = 500 * time.Millisecond
	decisionPollMaxDelay   = 5 * time.Second
)

// WaitForDecision retrieves an asset until it has a moderation decision (Moderation.Status is no
// longer ModerationStatusPending) or its processing failed
// (Processing.Status ClassificationStatusFailed), and returns that asset. It waits 0.5s before the
// second check and 1.5 times longer each time after that, up to 5s. When Timeout
// (default DefaultDecisionTimeout) passes without a decision it returns a *Error with code
// sdk/timeout and Details {"assetId", "classificationStatus", "moderationStatus"} holding the last
// statuses seen. Cancelling ctx
// stops waiting with sdk/cancelled. Webhooks report decisions without polling.
func (s *AssetsService) WaitForDecision(ctx context.Context, options WaitForDecisionOptions) (*Asset, error) {
	if options.Timeout < 0 {
		return nil, invalid(CodeSDKInvalidArgument, "Timeout cannot be negative")
	}
	timeout := options.Timeout
	if timeout == 0 {
		timeout = DefaultDecisionTimeout
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
		delay = min(decisionPollMaxDelay, delay*3/2)
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
	options.Transform, options.TransformSteps = transform, nil
	if options.ExpiresInSeconds == 0 {
		options.ExpiresInSeconds = 900
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
	separator := "/"
	if options.Lens != "" {
		separator = ","
	}
	if options.TransformSteps != nil {
		// Serialized steps are already path-safe: unreserved characters, escapes, "[", "]", "=" and ",".
		endpoint += separator + transform
	} else if transform != "" {
		path, err := transformPath(transform)
		if err != nil {
			return "", err
		}
		endpoint += separator + path
	}
	if options.AllowAgeRestricted {
		endpoint += "?allowAgeRestricted=true"
	}
	return endpoint, nil
}

// Serve fetches CDN content and returns the raw response, including non-2xx statuses. The
// body is streamed: the caller must close it. Serve is not bounded by Options.Timeout, so
// large downloads are never cut off; pass a context with a deadline to bound it.
func (s *CDNService) Serve(ctx context.Context, options CDNServeOptions) (*http.Response, error) {
	endpoint, err := s.GetAssetURL(options.CDNAssetURLOptions)
	if err != nil {
		return nil, err
	}
	method := options.Method
	if method == "" {
		method = "GET"
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, nil)
	if err != nil {
		return nil, argumentError("Could not build the CDN request", err)
	}
	req.Header = options.Headers.Clone()
	if req.Header == nil {
		req.Header = http.Header{}
	}
	req.Header.Set("X-Api-Key", s.c.options.APIKey)
	req.Header.Set("User-Agent", userAgent)
	response, err := s.c.http.Do(req)
	if err != nil {
		return nil, transportError(err)
	}
	return response, nil
}

// Classify moderates plain text and waits for the decision.
func (s *TextService) Classify(ctx context.Context, options ClassifyTextOptions) (*Asset, error) {
	if strings.TrimSpace(options.Text) == "" {
		return nil, invalid(CodeInvalidUploadPayload, "Text to classify must be a non-empty string")
	}
	if options.Name == "" {
		options.Name = "text"
	}
	return s.c.Assets.Classify(ctx, SubmitAssetOptions{Name: options.Name, Content: &Content{Type: "text/plain", PlainText: &options.Text}, Description: options.Description, ProcessingOptions: options.ProcessingOptions, Metadata: options.Metadata, ExternalID: options.ExternalID, ExternalURL: options.ExternalURL, FolderID: options.FolderID, UploadPresetID: options.UploadPresetID, IdempotencyKey: options.IdempotencyKey})
}
