package calmlens

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	mathrand "math/rand"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Default limits. Each one can be changed through Options.
const (
	// DefaultTimeout bounds each attempt of a JSON API call, including reading the response.
	// Uploads (Create, Moderate, UploadPart) and CDN.Serve are not bounded by it; they rely on
	// the connect and response-header timeouts plus the context you pass.
	DefaultTimeout = 120 * time.Second
	// DefaultConnectTimeout bounds dialing and the TLS handshake of the default transport.
	DefaultConnectTimeout = 10 * time.Second
	// DefaultResponseHeaderTimeout bounds the wait for response headers after a request body
	// has been sent, on the default transport. Synchronous moderation can take a while, so it
	// is generous.
	DefaultResponseHeaderTimeout = 120 * time.Second
	// DefaultMaxRetries is how many times a retryable request is repeated.
	DefaultMaxRetries = 2
	// DefaultMaxResponseBytes caps how much of an API response body is read.
	DefaultMaxResponseBytes int64 = 32 << 20
	// maxRetryAfter is the longest Retry-After the SDK waits for; longer delays are returned
	// to the caller as the error instead.
	maxRetryAfter = time.Minute
)

// Options configures NewServerClient. APIKey and ProjectID are required.
type Options struct {
	// APIKey is the project API key. It is sent as X-Api-Key and never printed by String.
	APIKey string
	// ProjectID is the project the key belongs to.
	ProjectID string
	// BaseURL overrides the API base URL (default https://api.calmlens.com/v1).
	BaseURL string
	// CDNBaseURL overrides the CDN base URL (default https://cdn.calmlens.com/v1).
	CDNBaseURL string
	// Timeout bounds each attempt of a JSON API call, including reading the body. Zero means
	// DefaultTimeout; negative values are rejected. Uploads and CDN.Serve are never cut off
	// by it, so large transfers can take as long as they need: bound them with a context
	// deadline instead.
	Timeout time.Duration
	// ConnectTimeout bounds dialing and the TLS handshake (default DefaultConnectTimeout).
	// It only applies when HTTPClient is nil.
	ConnectTimeout time.Duration
	// ResponseHeaderTimeout bounds the wait for response headers once the request has been
	// sent (default DefaultResponseHeaderTimeout). It only applies when HTTPClient is nil.
	ResponseHeaderTimeout time.Duration
	// MaxRetries is how many times a retryable request is repeated (default
	// DefaultMaxRetries). Use Ptr(0) to disable retries. See the README for what is retried.
	MaxRetries *int
	// MaxResponseBytes caps the API response body size (default DefaultMaxResponseBytes).
	// CDN.Serve bodies are streamed to the caller and are not capped.
	MaxResponseBytes int64
	// HTTPClient sends every request, including uploads and CDN requests. The SDK uses a copy
	// with redirects disabled. A non-zero HTTPClient.Timeout bounds whole requests,
	// including upload and download bodies, so leave it zero for large transfers.
	HTTPClient *http.Client
}

// String describes the options without the API key.
func (o Options) String() string {
	key := ""
	if o.APIKey != "" {
		key = "[redacted]"
	}
	return fmt.Sprintf("calmlens.Options{APIKey: %s, ProjectID: %q, BaseURL: %q, CDNBaseURL: %q, Timeout: %s}", key, o.ProjectID, o.BaseURL, o.CDNBaseURL, o.Timeout)
}

// GoString is used by %#v and also redacts the API key.
func (o Options) GoString() string { return o.String() }

// ServerClient is a CalmLens API client. It is safe for concurrent use.
type ServerClient struct {
	// Assets uploads, moderates, lists and manages assets.
	Assets *AssetsService
	// Text moderates plain text.
	Text *TextService
	// Folders manages folders.
	Folders *FoldersService
	// Events reads the project event feed.
	Events *EventsService
	// CDN builds CDN URLs and fetches content.
	CDN *CDNService
	// UploadTokens signs upload tokens for upload presets, locally.
	UploadTokens *UploadTokensService

	options    Options
	maxRetries int
	http       *http.Client
	lenses     map[string]Lens
	lensLock   chan struct{}
	// sleep waits between retries and decision checks; tests replace it.
	sleep func(context.Context, time.Duration) error
	// now reads the clock for decision deadlines; tests replace it.
	now func() time.Time
}

// String describes the client without its API key.
func (c *ServerClient) String() string {
	return fmt.Sprintf("calmlens.ServerClient{ProjectID: %q, BaseURL: %q}", c.options.ProjectID, c.options.BaseURL)
}

// GoString is used by %#v and also omits the API key.
func (c *ServerClient) GoString() string { return c.String() }

// NewServerClient validates every option before applying defaults or copying the HTTP client.
// Invalid options return a *Error with code sdk/invalid-config.
func NewServerClient(options Options) (*ServerClient, error) {
	if options.APIKey == "" || options.ProjectID == "" {
		return nil, invalid(CodeSDKInvalidConfig, "API key and project ID are required")
	}
	if options.ProjectID == "." || options.ProjectID == ".." {
		return nil, invalid(CodeSDKInvalidConfig, `ProjectID cannot be "." or ".."`)
	}
	if options.Timeout < 0 || options.ConnectTimeout < 0 || options.ResponseHeaderTimeout < 0 || options.MaxResponseBytes < 0 {
		return nil, invalid(CodeSDKInvalidConfig, "Timeouts and MaxResponseBytes cannot be negative")
	}
	if options.MaxRetries != nil && *options.MaxRetries < 0 {
		return nil, invalid(CodeSDKInvalidConfig, "MaxRetries cannot be negative")
	}
	for name, value := range map[string]string{"BaseURL": options.BaseURL, "CDNBaseURL": options.CDNBaseURL} {
		if value == "" {
			continue
		}
		if parsed, err := url.Parse(value); err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return nil, invalid(CodeSDKInvalidConfig, name+" must be an absolute HTTP(S) URL")
		}
	}
	if options.BaseURL == "" {
		options.BaseURL = "https://api.calmlens.com/v1"
	}
	if options.CDNBaseURL == "" {
		options.CDNBaseURL = "https://cdn.calmlens.com/v1"
	}
	if options.Timeout == 0 {
		options.Timeout = DefaultTimeout
	}
	if options.MaxResponseBytes == 0 {
		options.MaxResponseBytes = DefaultMaxResponseBytes
	}
	options.BaseURL = strings.TrimRight(options.BaseURL, "/")
	options.CDNBaseURL = strings.TrimRight(options.CDNBaseURL, "/")
	var safeClient http.Client
	if options.HTTPClient != nil {
		// Copy the client so caller configuration is unchanged.
		safeClient = *options.HTTPClient
	} else {
		safeClient.Transport = defaultTransport(options)
	}
	// Never follow redirects, so credentials stay on the configured endpoint.
	safeClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	maxRetries := DefaultMaxRetries
	if options.MaxRetries != nil {
		maxRetries = *options.MaxRetries
	}
	c := &ServerClient{options: options, maxRetries: maxRetries, http: &safeClient, lenses: map[string]Lens{}, lensLock: make(chan struct{}, 1), sleep: sleep, now: time.Now}
	c.Assets, c.Text = &AssetsService{c}, &TextService{c}
	c.Folders, c.Events, c.CDN = &FoldersService{c}, &EventsService{c}, &CDNService{c}
	c.UploadTokens = &UploadTokensService{c}
	return c, nil
}

// defaultTransport bounds connecting and waiting for headers, never the body transfer.
func defaultTransport(options Options) *http.Transport {
	connect := options.ConnectTimeout
	if connect == 0 {
		connect = DefaultConnectTimeout
	}
	headers := options.ResponseHeaderTimeout
	if headers == 0 {
		headers = DefaultResponseHeaderTimeout
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: connect, KeepAlive: 30 * time.Second}).DialContext
	transport.TLSHandshakeTimeout = connect
	transport.ResponseHeaderTimeout = headers
	return transport
}

func sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (c *ServerClient) project(path string) string {
	return "/projects/" + component(c.options.ProjectID) + "/" + path
}

func component(value string) string {
	// Match encodeURIComponent, including reserved path/query delimiters.
	var out strings.Builder
	for _, b := range []byte(value) {
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || strings.ContainsRune("-_.!~*'()", rune(b)) {
			out.WriteByte(b)
		} else {
			fmt.Fprintf(&out, "%%%02X", b)
		}
	}
	return out.String()
}

// segment encodes an identifier as one path segment. "." and ".." are rejected because URL
// resolution treats them as relative segments, which would reach another route.
func segment(id string) (string, error) {
	if id == "" {
		return "", invalid(CodeSDKInvalidArgument, "Identifier is required")
	}
	if id == "." || id == ".." {
		return "", invalid(CodeSDKInvalidArgument, `Identifier cannot be "." or ".."`)
	}
	return component(id), nil
}

func resourcePath(kind, id, suffix string) (string, error) {
	escaped, err := segment(id)
	if err != nil {
		return "", err
	}
	return "/" + kind + "/" + escaped + suffix, nil
}

// query encodes options as query parameters, JSON-encoding nested values.
func query(values any) (url.Values, error) {
	b, err := json.Marshal(values)
	if err != nil {
		return nil, argumentError("Could not encode query parameters", err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(b, &fields); err != nil {
		return nil, argumentError("Could not encode query parameters", err)
	}
	result := url.Values{}
	for key, raw := range fields {
		if string(raw) == "null" {
			continue
		}
		var text string
		if json.Unmarshal(raw, &text) == nil {
			result.Set(key, text)
		} else {
			result.Set(key, string(raw))
		}
	}
	if raw, ok := fields["ordering"]; ok {
		var orders []Order
		if err := json.Unmarshal(raw, &orders); err != nil {
			return nil, argumentError("Could not encode ordering", err)
		}
		result.Del("ordering")
		for i, order := range orders {
			result.Set(fmt.Sprintf("ordering[%d][field]", i), order.Field)
			result.Set(fmt.Sprintf("ordering[%d][direction]", i), order.Direction)
		}
	}
	if raw, ok := fields["ids"]; ok {
		var ids []string
		if err := json.Unmarshal(raw, &ids); err != nil {
			return nil, argumentError("Could not encode folder IDs", err)
		}
		result.Del("ids")
		for index, id := range ids {
			result.Set(fmt.Sprintf("ids[%d]", index), id)
		}
	}
	return result, nil
}

// call describes one logical API call, which may be sent more than once.
type call struct {
	method, path string
	params       url.Values
	// body is JSON-encoded; raw is sent as is with size bytes (-1 when unknown).
	body    any
	raw     io.Reader
	size    int64
	headers http.Header
	// idempotencyKey makes a POST safe to retry.
	idempotencyKey string
	// transfer calls (uploads) are not bounded by Options.Timeout.
	transfer bool
}

// rewinder returns a function that resets raw to its start, or nil when it cannot.
func rewinder(raw io.Reader) func() error {
	seeker, ok := raw.(io.Seeker)
	if !ok {
		return nil
	}
	start, err := seeker.Seek(0, io.SeekCurrent)
	if err != nil {
		return nil
	}
	return func() error {
		_, err := seeker.Seek(start, io.SeekStart)
		return err
	}
}

// newIdempotencyKey returns a random UUID v4.
func newIdempotencyKey() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// request sends a JSON API call and decodes its JSON response into out.
func (c *ServerClient) request(ctx context.Context, method, path string, params url.Values, body any, out any) error {
	return c.send(ctx, call{method: method, path: path, params: params, body: body}, out)
}

// send performs a call, retrying it when that is safe, and decodes the response into out.
func (c *ServerClient) send(ctx context.Context, spec call, out any) error {
	endpoint := c.options.BaseURL + spec.path
	if len(spec.params) > 0 {
		endpoint += "?" + spec.params.Encode()
	}
	headers := http.Header{}
	for key, values := range spec.headers {
		headers[key] = append([]string(nil), values...)
	}
	var payload []byte
	rewind := func() error { return nil }
	if spec.body != nil {
		var err error
		if payload, err = json.Marshal(spec.body); err != nil {
			return argumentError("Could not encode the request body", err)
		}
		headers.Set("Content-Type", "application/json")
	} else if spec.raw != nil {
		rewind = rewinder(spec.raw)
	}
	if spec.idempotencyKey != "" {
		headers.Set("Idempotency-Key", spec.idempotencyKey)
	}
	retryable := spec.method == http.MethodGet || spec.method == http.MethodHead || spec.idempotencyKey != ""
	for attempt := 0; ; attempt++ {
		var reader io.Reader
		size := int64(0)
		switch {
		case payload != nil:
			reader, size = bytes.NewReader(payload), int64(len(payload))
		case spec.raw != nil:
			reader, size = spec.raw, spec.size
		}
		err := c.attempt(ctx, spec, endpoint, headers, reader, size, out)
		if err == nil {
			return nil
		}
		sdkErr, ok := err.(*Error)
		if !ok || !retryable || attempt >= c.maxRetries || !sdkErr.Retryable() || ctx.Err() != nil {
			return err
		}
		if rewind == nil || rewind() != nil {
			// A stream that cannot be rewound cannot be sent again.
			return err
		}
		delay := sdkErr.RetryAfter
		if delay > maxRetryAfter {
			return err
		}
		if delay == 0 {
			delay = backoff(attempt)
		}
		if waitErr := c.sleep(ctx, delay); waitErr != nil {
			return transportError(waitErr)
		}
	}
}

// backoff is capped exponential backoff with jitter: 0.5s, 1s, 2s ... up to 8s, each
// randomized to between half and all of that value.
func backoff(attempt int) time.Duration {
	delay := 500 * time.Millisecond << min(attempt, 4)
	return delay/2 + time.Duration(mathrand.Int63n(int64(delay/2)+1))
}

// attempt sends one HTTP request.
func (c *ServerClient) attempt(ctx context.Context, spec call, endpoint string, headers http.Header, body io.Reader, size int64, out any) error {
	if !spec.transfer {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.options.Timeout)
		defer cancel()
	}
	req, err := http.NewRequestWithContext(ctx, spec.method, endpoint, nil)
	if err != nil {
		return argumentError("Could not build the request", err)
	}
	if body != nil {
		// NopCloser keeps the transport from closing a caller's file or stream.
		req.Body = io.NopCloser(body)
		req.ContentLength = size
		if size == 0 {
			req.Body = http.NoBody
		}
	}
	req.Header = headers.Clone()
	req.Header.Set("X-Api-Key", c.options.APIKey)
	req.Header.Set("User-Agent", userAgent)
	res, err := c.http.Do(req)
	if err != nil {
		return transportError(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, c.options.MaxResponseBytes+1))
	if err != nil {
		return transportError(err)
	}
	requestID := res.Header.Get("X-Request-Id")
	if int64(len(data)) > c.options.MaxResponseBytes {
		return &Error{Code: CodeSDKResponseTooLarge, Message: "Response body exceeds MaxResponseBytes", Status: res.StatusCode, RequestID: requestID, Header: res.Header}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return responseError(res, data)
	}
	if out == nil {
		return nil
	}
	if len(data) == 0 {
		return &Error{Code: CodeSDKInvalidResponse, Message: "Empty JSON response", Status: res.StatusCode, RequestID: requestID, Header: res.Header}
	}
	if err = decodeJSON(data, out); err != nil {
		return &Error{Code: CodeSDKInvalidResponse, Message: "Invalid JSON response", Status: res.StatusCode, RequestID: requestID, Header: res.Header, Cause: err}
	}
	return nil
}

// responseError converts a non-2xx response into *Error.
func responseError(res *http.Response, data []byte) error {
	result := &Error{Status: res.StatusCode, RequestID: res.Header.Get("X-Request-Id"), Header: res.Header, RetryAfter: parseRetryAfter(res.Header.Get("Retry-After"), time.Now())}
	var failure struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Details JSON   `json:"details"`
		TraceID string `json:"traceId"`
	}
	if decodeJSON(data, &failure) == nil && failure.Code != "" {
		if failure.Details == nil {
			failure.Details = JSON{}
		}
		failure.Details["network"] = true
		if failure.TraceID != "" {
			failure.Details["traceId"] = failure.TraceID
		}
		result.Code, result.Message, result.Details = failure.Code, failure.Message, failure.Details
		return result
	}
	result.Code, result.Message = CodeSDKHTTPError, "HTTP "+strconv.Itoa(res.StatusCode)
	return result
}

// decodeJSON decodes with UseNumber so integers in JSON maps keep their precision as
// json.Number instead of becoming float64.
func decodeJSON(data []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if decoder.More() {
		return fmt.Errorf("unexpected data after the JSON value")
	}
	return nil
}

// EnsureLens creates or updates one lens by identifier and returns it. See EnsureLenses.
func (c *ServerClient) EnsureLens(ctx context.Context, options EnsureLensOptions) (*Lens, error) {
	lenses, err := c.EnsureLenses(ctx, EnsureLensesOptions{Lenses: []EnsureLensOptions{options}})
	if err != nil {
		return nil, err
	}
	return &lenses[0], nil
}

// EnsureLensesMaxPerRequest is the most lens definitions EnsureLenses sends in one request.
const EnsureLensesMaxPerRequest = 100

// EnsureLenses creates or updates lenses by identifier. Definitions are cached per client:
// repeated and concurrent calls with the same definitions are sent once. More than
// EnsureLensesMaxPerRequest new definitions are sent in consecutive requests, in order.
func (c *ServerClient) EnsureLenses(ctx context.Context, options EnsureLensesOptions) ([]Lens, error) {
	if len(options.Lenses) == 0 {
		return nil, invalid(CodeSDKInvalidArgument, "At least one lens is required")
	}
	keys := make([]string, len(options.Lenses))
	for i, lens := range options.Lenses {
		if lens.Identifier == "" {
			return nil, invalid(CodeSDKInvalidArgument, "Lens identifier is required")
		}
		encoded, err := json.Marshal(lens)
		if err != nil {
			return nil, argumentError("Could not encode the lens", err)
		}
		keys[i] = string(encoded)
	}
	select {
	case c.lensLock <- struct{}{}:
	case <-ctx.Done():
		return nil, transportError(ctx.Err())
	}
	defer func() { <-c.lensLock }()
	missing := []EnsureLensOptions{}
	missingKeys := []string{}
	seen := map[string]bool{}
	for i, key := range keys {
		if _, ok := c.lenses[key]; !ok && !seen[key] {
			missing = append(missing, options.Lenses[i])
			missingKeys = append(missingKeys, key)
			seen[key] = true
		}
	}
	resolved := map[string]Lens{}
	for key, lens := range c.lenses {
		resolved[key] = lens
	}
	for start := 0; start < len(missing); start += EnsureLensesMaxPerRequest {
		end := min(start+EnsureLensesMaxPerRequest, len(missing))
		chunk, chunkKeys := missing[start:end], missingKeys[start:end]
		var response struct {
			Lenses []Lens `json:"lenses"`
		}
		err := c.request(ctx, "PUT", c.project("lenses"), nil, EnsureLensesOptions{Lenses: chunk}, &response)
		if err != nil {
			return nil, err
		}
		if len(response.Lenses) != len(chunk) {
			return nil, invalid(CodeSDKInvalidResponse, "Unexpected lens response")
		}
		for i, lens := range response.Lenses {
			if lens.Identifier != chunk[i].Identifier {
				return nil, invalid(CodeSDKInvalidResponse, "Unexpected lens identifier")
			}
		}
		for i, lens := range response.Lenses {
			for key, old := range c.lenses {
				if old.Identifier == lens.Identifier {
					delete(c.lenses, key)
				}
			}
			c.lenses[chunkKeys[i]] = lens
			resolved[chunkKeys[i]] = lens
		}
	}
	result := make([]Lens, len(keys))
	for i, key := range keys {
		result[i] = resolved[key]
	}
	// Do not let callers mutate cached transforms through returned maps or slices.
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, &Error{Code: CodeSDKInvalidResponse, Message: "Could not copy lenses", Cause: err}
	}
	var cloned []Lens
	if err = decodeJSON(encoded, &cloned); err != nil {
		return nil, &Error{Code: CodeSDKInvalidResponse, Message: "Could not copy lenses", Cause: err}
	}
	return cloned, nil
}
