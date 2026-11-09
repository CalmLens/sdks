package calmlens

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"
)

// CDNService builds asset URLs, signs private assets' URLs, reads an asset URL's display info
// and fetches CDN content.
//
// Every asset has one URL, {CDNBaseURL}/assets/{projectId}/{asset}, and each resource is a path
// beneath it (ResourceRendered, ResourcePreview and so on). The asset segment is the asset ID or
// "ext:" and the URL-encoded external ID for a public asset, or a signed grant for a private one:
// use SignAssetURL if the asset is private, GetAssetURL otherwise, and add viewer claims to either.
type CDNService struct{ c *ServerClient }

// DefaultSignedURLExpiresIn is the lifetime in seconds SignAssetURL sends when ExpiresIn is zero:
// 15 minutes.
const DefaultSignedURLExpiresIn = 15 * 60

// MaxSignedURLExpiresIn is the longest signed URL lifetime in seconds the API accepts: 24 hours.
const MaxSignedURLExpiresIn = 24 * 60 * 60

// externalIDSegmentPrefix starts the asset segment that names an asset by its external ID.
const externalIDSegmentPrefix = "ext:"

// cdnResources are the resources beneath an asset URL, in the order messages list them.
var cdnResources = []string{ResourceOriginal, ResourceRendered, ResourcePreview, ResourcePlaceholder, ResourceHLS, ResourceEmbed, ResourceInfo}

// cdnResourcePaths are where each resource is served beneath an asset URL. The adaptive stream
// is its HLS master playlist; its media playlists and segments are the other files beneath hls/.
var cdnResourcePaths = map[string]string{
	ResourceOriginal:    "original",
	ResourceRendered:    "rendered",
	ResourcePreview:     "preview",
	ResourcePlaceholder: "placeholder",
	ResourceHLS:         "hls/index.m3u8",
	ResourceEmbed:       "embed",
	ResourceInfo:        "info",
}

// selectableCDNResource reports the resources that take a lens or transform: the rendered file
// and the preview. The others (the exact upload, the placeholder, the stream, the embed page and
// the info) take none.
func selectableCDNResource(resource string) bool {
	return resource == ResourceRendered || resource == ResourcePreview
}

// CDNAssetURLOptions names an asset and, optionally, one of its resources. Name the asset by
// exactly one of AssetID and ExternalID (the external ID it was uploaded with); ProjectID defaults
// to the client's project.
//
// Without a Resource, GetAssetURL returns the asset URL itself, which takes no lens or transform.
// Resource is one of the Resource constants; only ResourceRendered and ResourcePreview take a
// Lens, Transform or TransformOptions, applied in one pass, with transform options replacing the
// lens's same-named options. Supply Transform (options such as "format=png,width=1024") or
// TransformOptions (ImageTransformOptions, or any value that encodes as a JSON object with the
// same option names; one with no options is rejected), not both.
//
// ViewerClaims are appended as the viewerClaims query, leaving out the defaults: a Region only
// when set, AgeConfirmed only when true. The CDN requires AgeConfirmed before it serves an asset
// whose moderation status is age-restricted, even with a signed URL or an API key.
type CDNAssetURLOptions struct {
	ProjectID        string
	AssetID          string
	ExternalID       string
	Resource         string
	Lens             string
	Transform        string
	TransformOptions any
	ViewerClaims     *ViewerClaims
}

// CDNServeOptions fetches CDN content with an optional method and extra headers (such as
// Range). The resource defaults to ResourceRendered.
type CDNServeOptions struct {
	CDNAssetURLOptions
	Method  string
	Headers http.Header
}

// SignAssetURLOptions signs a private asset's URL. Name the asset by exactly one of AssetID and
// ExternalID; ProjectID defaults to the client's project. ExpiresIn is the lifetime in whole
// seconds, from 1 to MaxSignedURLExpiresIn (0 for DefaultSignedURLExpiresIn). Original grants
// ResourceOriginal, the exact upload, which the URL refuses otherwise.
//
// Resource, Lens, Transform, TransformOptions and ViewerClaims aren't part of the grant: they
// are appended to the signed URL exactly as GetAssetURL appends them (see CDNAssetURLOptions),
// and can be changed later without signing again.
type SignAssetURLOptions struct {
	ProjectID        string
	AssetID          string
	ExternalID       string
	ExpiresIn        int
	Original         bool
	Resource         string
	Lens             string
	Transform        string
	TransformOptions any
	ViewerClaims     *ViewerClaims
}

// SignedAssetURL is a signed asset URL (or a resource URL beneath it) and its expiry in unix
// milliseconds.
type SignedAssetURL struct {
	URL       string `json:"url"`
	ExpiresAt int64  `json:"expiresAt"`
}

// GetAssetInfoOptions are the viewer claims to read an asset URL's info for. Nil ViewerClaims
// keeps the claims the URL carries.
type GetAssetInfoOptions struct {
	ViewerClaims *ViewerClaims
}

// AssetInfo availabilities.
const (
	// AssetAvailabilityAvailable means the viewer can see the content now.
	AssetAvailabilityAvailable = "available"
	// AssetAvailabilityAgeRestricted means the content needs the viewer's age confirmed
	// (ViewerClaims.AgeConfirmed).
	AssetAvailabilityAgeRestricted = "age-restricted"
	// AssetAvailabilityUnavailable means the viewer can't see the content: it is held, blocked in
	// the viewer's region, not yet moderated or removed.
	AssetAvailabilityUnavailable = "unavailable"
)

// AssetInfo is an asset's display info, the CDN's info resource: the public asset fields a
// viewer needs, with the same names as on Asset, and whether this viewer can see it now. It never
// holds moderation results, metadata, names, tags or extracted text.
type AssetInfo struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	// Type is one of the AssetType constants.
	Type string `json:"type"`
	// ExternalURL is a website's page, which a viewer links to.
	ExternalURL *string          `json:"externalUrl"`
	Content     AssetInfoContent `json:"content"`
	// Availability is one of the AssetAvailability constants, for the request's viewer claims.
	// The CDN's resources refuse exactly what it refuses.
	Availability string `json:"availability"`
}

// AssetInfoContent is the part of AssetContent that AssetInfo carries.
type AssetInfoContent struct {
	// Format is the MIME type of the content; it tells a spreadsheet from other documents.
	Format          *string        `json:"format"`
	Width           *int           `json:"width"`
	Height          *int           `json:"height"`
	DurationSeconds *float64       `json:"durationSeconds"`
	PageCount       *int           `json:"pageCount"`
	Rendered        *AssetRendered `json:"rendered"`
	Preview         *AssetPreview  `json:"preview"`
	HLS             *AssetHls      `json:"hls"`
}

// viewerCountries are the ISO 3166-1 alpha-2 countries a viewer's region can be. EU is not a
// viewer country.
var viewerCountries = func() map[string]bool {
	countries := map[string]bool{}
	for _, code := range strings.Fields("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW") {
		countries[code] = true
	}
	return countries
}()

// assetSegment is the asset segment of an asset URL: the path-encoded asset ID, or "ext:" and the
// URL-encoded external ID. Exactly one of them must be given.
func assetSegment(assetID, externalID string) (string, error) {
	switch {
	case assetID != "" && externalID != "", assetID == "" && externalID == "":
		return "", invalid(CodeSDKInvalidArgument, "Pass either AssetID or ExternalID")
	case assetID != "":
		return segment(assetID)
	}
	return externalIDSegmentPrefix + component(externalID), nil
}

// viewerClaimsQuery is the "?viewerClaims=" query of a URL with these claims, or "" for the
// defaults: no region and no age confirmation are left out, so default URLs stay cacheable.
func viewerClaimsQuery(claims *ViewerClaims) (string, error) {
	if claims == nil {
		return "", nil
	}
	if claims.Region != "" && !viewerCountries[claims.Region] {
		return "", invalid(CodeSDKInvalidArgument, "ViewerClaims.Region must be an ISO 3166-1 alpha-2 country code, such as DE")
	}
	sent := struct {
		Region       string `json:"region,omitempty"`
		AgeConfirmed bool   `json:"ageConfirmed,omitempty"`
	}{claims.Region, claims.AgeConfirmed != nil && *claims.AgeConfirmed}
	if sent.Region == "" && !sent.AgeConfirmed {
		return "", nil
	}
	data, err := json.Marshal(sent)
	if err != nil {
		return "", argumentError("Could not encode the viewer claims", err)
	}
	return "?" + url.Values{"viewerClaims": {string(data)}}.Encode(), nil
}

// assetLocation is what follows an asset URL: a resource, its selector and the viewer claims.
type assetLocation struct {
	resource, lens, transform string
	transformOptions          any
	claims                    *ViewerClaims
}

// append adds the location to an asset URL, public or signed. Without a resource the URL stays
// the asset URL, which takes no selector.
func (l assetLocation) append(assetURL string) (string, error) {
	selected := l.lens != "" || l.transform != "" || l.transformOptions != nil
	endpoint := assetURL
	if l.resource == "" {
		if selected {
			return "", invalid(CodeSDKInvalidArgument, "A lens or transform needs a resource, such as "+ResourceRendered)
		}
	} else {
		path, ok := cdnResourcePaths[l.resource]
		if !ok {
			return "", invalid(CodeSDKInvalidArgument, "Resource must be one of "+strings.Join(cdnResources, ", "))
		}
		if !selectableCDNResource(l.resource) && selected {
			return "", invalid(CodeSDKInvalidArgument, "The "+l.resource+" resource takes no lens or transform")
		}
		endpoint += "/" + path
		transform, _, err := transformSelector(l.transform, l.transformOptions)
		if err != nil {
			return "", err
		}
		var selector []string
		if l.lens != "" {
			lens, err := segment(l.lens)
			if err != nil {
				return "", err
			}
			selector = append(selector, "@"+lens)
		}
		if l.transformOptions != nil {
			// Serialized options are already path-safe: unreserved characters, escapes, "=", "," and ".".
			selector = append(selector, transform)
		} else if transform != "" {
			selector = append(selector, transformPath(transform))
		}
		if len(selector) > 0 {
			endpoint += "/" + strings.Join(selector, ",")
		}
	}
	query, err := viewerClaimsQuery(l.claims)
	if err != nil {
		return "", err
	}
	return endpoint + query, nil
}

// projectSegment is the path-encoded project, the client's when projectID is empty.
func (s *CDNService) projectSegment(projectID string) (string, error) {
	if projectID == "" {
		projectID = s.c.options.ProjectID
	}
	return segment(projectID)
}

// GetAssetURL builds an asset's CDN URL without sending a request: the asset URL, which every
// resource is a path beneath, or a resource URL when Resource is set, with its lens or transform
// and the viewer claims. Use it for public assets; private ones need SignAssetURL. Viewer claims
// are assertions from your app; CalmLens doesn't verify them.
func (s *CDNService) GetAssetURL(options CDNAssetURLOptions) (string, error) {
	project, err := s.projectSegment(options.ProjectID)
	if err != nil {
		return "", err
	}
	asset, err := assetSegment(options.AssetID, options.ExternalID)
	if err != nil {
		return "", err
	}
	location := assetLocation{options.Resource, options.Lens, options.Transform, options.TransformOptions, options.ViewerClaims}
	return location.append(s.c.options.CDNBaseURL + "/assets/" + project + "/" + asset)
}

// SignAssetURL signs a private asset's URL on your server, so browsers and apps can load it
// without an API key until it expires. Every resource is a path beneath it, as beneath a public
// asset URL; ResourceOriginal only when signed with Original. With a Resource, it returns that
// resource's URL beneath the grant. The options are checked before anything is sent.
func (s *CDNService) SignAssetURL(ctx context.Context, options SignAssetURLOptions) (*SignedAssetURL, error) {
	if options.ExpiresIn < 0 || options.ExpiresIn > MaxSignedURLExpiresIn {
		return nil, invalid(CodeSDKInvalidArgument, "ExpiresIn must be from 1 to 86400 seconds (0 for the default)")
	}
	if _, err := assetSegment(options.AssetID, options.ExternalID); err != nil {
		return nil, err
	}
	location := assetLocation{options.Resource, options.Lens, options.Transform, options.TransformOptions, options.ViewerClaims}
	// The location is appended to the signed URL: check it before signing.
	if _, err := location.append(""); err != nil {
		return nil, err
	}
	project, err := s.projectSegment(options.ProjectID)
	if err != nil {
		return nil, err
	}
	expiresIn := options.ExpiresIn
	if expiresIn == 0 {
		expiresIn = DefaultSignedURLExpiresIn
	}
	body := struct {
		AssetID    string `json:"assetId,omitempty"`
		ExternalID string `json:"externalId,omitempty"`
		ExpiresIn  int    `json:"expiresIn"`
		Original   bool   `json:"original"`
	}{options.AssetID, options.ExternalID, expiresIn, options.Original}
	var signed SignedAssetURL
	if err = s.c.request(ctx, "POST", "/projects/"+project+"/signed-asset-urls", nil, body, &signed); err != nil {
		return nil, err
	}
	if signed.URL == "" {
		return nil, &Error{Code: CodeSDKInvalidResponse, Message: "The API returned no signed asset URL"}
	}
	endpoint, err := location.append(signed.URL)
	if err != nil {
		return nil, err
	}
	return &SignedAssetURL{URL: endpoint, ExpiresAt: signed.ExpiresAt}, nil
}

// GetAssetInfo fetches the display info of an asset URL, public or signed ({url}/info): its
// type, size, rendered file, preview and stream, and whether the viewer its claims describe can
// see it. The claims are options.ViewerClaims, else those the URL carries. It sends no API key,
// as a browser would. A refusal returns *Error with the CDN's code, such as signed-url/expired or
// asset/not-available.
func (s *CDNService) GetAssetInfo(ctx context.Context, assetURL string, options GetAssetInfoOptions) (*AssetInfo, error) {
	parsed, err := url.Parse(assetURL)
	if err != nil || !parsed.IsAbs() || parsed.Host == "" {
		return nil, invalid(CodeSDKInvalidArgument, "The URL must be an absolute asset URL")
	}
	base, rawQuery, _ := strings.Cut(strings.SplitN(assetURL, "#", 2)[0], "?")
	claims := options.ViewerClaims
	if claims == nil && rawQuery != "" {
		values, err := url.ParseQuery(rawQuery)
		if err != nil {
			return nil, argumentError("The asset URL's query is invalid", err)
		}
		if raw := values.Get("viewerClaims"); values.Has("viewerClaims") {
			claims = &ViewerClaims{}
			if err := json.Unmarshal([]byte(raw), claims); err != nil {
				return nil, argumentError("The asset URL's viewerClaims are not valid JSON", err)
			}
		}
	}
	query, err := viewerClaimsQuery(claims)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, s.c.options.Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/info"+query, nil)
	if err != nil {
		return nil, argumentError("Could not build the CDN request", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)
	res, err := s.c.http.Do(req)
	if err != nil {
		return nil, transportError(err)
	}
	defer res.Body.Close()
	if isRedirect(res) {
		return nil, redirectError(res)
	}
	data, err := readLimited(res, s.c.options.MaxResponseBytes)
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, responseError(res, data, s.c.now())
	}
	var info AssetInfo
	if err = json.Unmarshal(data, &info); err != nil || info.ID == "" || info.ProjectID == "" || info.Type == "" ||
		info.Availability != AssetAvailabilityAvailable && info.Availability != AssetAvailabilityAgeRestricted && info.Availability != AssetAvailabilityUnavailable {
		return nil, &Error{Code: CodeSDKInvalidResponse, Message: "The CDN returned no asset info", Status: res.StatusCode, RequestID: res.Header.Get("X-Request-Id"), Header: res.Header, Cause: err}
	}
	return &info, nil
}

// Serve fetches CDN content with the client's API key and returns the raw response, including
// non-2xx statuses. The resource defaults to ResourceRendered. The body is streamed: the caller
// must close it. Options.Timeout bounds each attempt only until the response headers arrive, so
// long downloads are not cut off; pass a context with a deadline to bound the whole download. GET
// and HEAD requests are retried like API reads (429, 500, 502, 503, 504 and transport failures,
// honouring Retry-After); when retries run out, the last response is returned. A redirect is
// never followed: it fails with sdk/http-error and its status.
func (s *CDNService) Serve(ctx context.Context, options CDNServeOptions) (*http.Response, error) {
	location := options.CDNAssetURLOptions
	if location.Resource == "" {
		location.Resource = ResourceRendered
	}
	endpoint, err := s.GetAssetURL(location)
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
