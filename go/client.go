package calmlens

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	mathrand "math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"calmlens.com/go/calmlens/internal/clock"
)

// Default limits. Each one can be changed through Options.
const (
	// DefaultTimeout bounds each attempt of a JSON API call, including reading the response.
	// Uploads (Create, Classify, UploadPart) and CDN.Serve are not bounded by it; they rely on
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
	// DefaultPartSizeBytes is the part size of uploads the SDK splits (Options.PartSizeBytes).
	DefaultPartSizeBytes int64 = 8 << 20
	// MinPartSizeBytes and MaxPartSizeBytes bound Options.PartSizeBytes: every part but the
	// last is at least 5 MiB.
	MinPartSizeBytes int64 = 5 << 20
	MaxPartSizeBytes int64 = 64 << 20
	// RetryBaseDelay is the backoff before the first retry. Retry n (0-based) waits between half
	// and all of min(RetryMaxDelay, RetryBaseDelay * 2^n), unless a Retry-After header says
	// otherwise.
	RetryBaseDelay = 500 * time.Millisecond
	// RetryMaxDelay is the longest backoff before a retry.
	RetryMaxDelay = 8 * time.Second
	// RetryAfterMax is the longest Retry-After the SDK waits for; a longer delay is returned to
	// the caller (as the error, or for CDN.Serve as the response) instead.
	RetryAfterMax = time.Minute
)

// HTTPDoer sends HTTP requests. *http.Client implements it.
type HTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

// Options configures NewServerClient. APIKey and ProjectID are required: left empty, they are read
// from the CALMLENS_API_KEY and CALMLENS_PROJECT_ID environment variables, and BaseURL from
// CALMLENS_BASE_URL, unless IgnoreEnvironment is set.
type Options struct {
	// APIKey is the project API key. It is sent as X-Api-Key, so it can only hold printable ASCII
	// without spaces, and is never printed by String.
	APIKey string
	// ProjectID is the project the key belongs to.
	ProjectID string
	// BaseURL overrides the API base URL (default https://api.calmlens.com/v1).
	BaseURL string
	// IgnoreEnvironment stops the client reading CALMLENS_API_KEY, CALMLENS_PROJECT_ID,
	// CALMLENS_BASE_URL and CALMLENS_LOG, such as in a server that holds several projects' keys.
	IgnoreEnvironment bool
	// AppInfo names your application in the User-Agent header, after the SDK's.
	AppInfo *AppInfo
	// Logger receives a record for each API request: at Info its outcome, and at Debug each
	// attempt and retry. Records never hold the API key, upload tokens, signed URLs or bodies.
	// Without one, CALMLENS_LOG=info or debug logs to standard error.
	Logger *slog.Logger
	// OnAttempt is called after each attempt of an API request, retries included.
	OnAttempt func(Attempt)
	// MaxRetryDelay caps the wait before a retry, from a backoff or a Retry-After header
	// (default RetryMaxDelay for backoffs and RetryAfterMax for Retry-After). A Retry-After
	// longer than it fails the call instead.
	MaxRetryDelay time.Duration
	// CDNBaseURL overrides the CDN base URL (default https://cdn.calmlens.com/v1).
	CDNBaseURL string
	// Timeout bounds each attempt of an API call, including reading the response body. Zero
	// means DefaultTimeout; negative values are rejected. Text uploads use it too. For
	// CDN.Serve it ends when the response headers arrive, so long downloads are not cut off.
	// Binary uploads use UploadTimeout instead.
	Timeout time.Duration
	// UploadTimeout bounds each attempt of a binary upload (file content and multipart parts).
	// Zero means no deadline, so large files are never cut off; negative values are rejected.
	UploadTimeout time.Duration
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
	// PartSizeBytes splits uploads: Content larger than this many bytes whose size is known and
	// that the SDK can read again (Bytes, Base64, or Data that is an io.ReaderAt or io.Seeker
	// with SizeInBytes) is uploaded in parts of this size. Each part is retried on its own, and
	// calling again with the same IdempotencyKey resumes the upload. From MinPartSizeBytes to
	// MaxPartSizeBytes; zero means DefaultPartSizeBytes.
	PartSizeBytes int64
	// HTTPClient sends every request, including uploads and CDN requests: an *http.Client, or
	// any HTTPDoer, such as one that adds logging or tracing around another client. The SDK uses a
	// copy of an *http.Client with redirects disabled; another HTTPDoer must not follow redirects,
	// which could send the API key to another origin. A non-zero http.Client.Timeout bounds whole
	// requests, including upload and download bodies, so leave it zero for large transfers.
	HTTPClient HTTPDoer
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
	// HashLists manages hash lists of images the project blocks or flags.
	HashLists *HashListsService
	// Policies manages the moderation policies of the API key's organisation.
	Policies *PoliciesService
	// Lenses manages the project's lenses.
	Lenses *LensesService
	// UploadPresets manages the project's upload presets.
	UploadPresets *UploadPresetsService
	// ProjectSettings reads and replaces the project's settings.
	ProjectSettings *ProjectSettingsService
	// MetadataFields manages the project's metadata fields.
	MetadataFields *MetadataFieldsService
	// Events reads the project event feed.
	Events *EventsService
	// CDN builds CDN URLs and fetches content.
	CDN *CDNService
	// UploadTokens signs upload tokens for upload presets, locally.
	UploadTokens *UploadTokensService

	options    Options
	maxRetries int
	http       HTTPDoer
	lenses     *lensCache
	// sleep waits between retries and decision checks; tests replace it.
	sleep func(context.Context, time.Duration) error
	// now reads the clock for decision deadlines; tests replace it.
	now func() time.Time
	// deferUploadChecks leaves multipart size checks to the API; calmlenstest sets it so its
	// in-memory API answers them in the API's order.
	deferUploadChecks bool
	// userAgent is the SDK's User-Agent with the application's AppInfo.
	userAgent string
	// logger is Options.Logger, or the CALMLENS_LOG logger, or nil.
	logger *slog.Logger
	// basePath is BaseURL's path, such as "/v1".
	basePath string
}

// String describes the client without its API key. It takes a value so a dereferenced client
// doesn't print its fields, API key included.
func (c ServerClient) String() string {
	return fmt.Sprintf("calmlens.ServerClient{ProjectID: %q, BaseURL: %q}", c.options.ProjectID, c.options.BaseURL)
}

// GoString is used by %#v and also omits the API key.
func (c ServerClient) GoString() string { return c.String() }

// NewServerClient validates every option before applying defaults or copying the HTTP client.
// Invalid options return a *Error with code sdk/invalid-config.
func NewServerClient(options Options) (*ServerClient, error) {
	if !options.IgnoreEnvironment {
		for _, value := range []struct {
			field *string
			name  string
		}{{&options.APIKey, "CALMLENS_API_KEY"}, {&options.ProjectID, "CALMLENS_PROJECT_ID"}, {&options.BaseURL, "CALMLENS_BASE_URL"}} {
			if *value.field == "" {
				*value.field = os.Getenv(value.name)
			}
		}
	}
	if options.MaxRetryDelay < 0 {
		return nil, invalid(CodeSDKInvalidConfig, "MaxRetryDelay cannot be negative")
	}
	agent, err := options.AppInfo.userAgent()
	if err != nil {
		return nil, err
	}
	logger := options.Logger
	if logger == nil && !options.IgnoreEnvironment {
		if logger, err = environmentLogger(os.Getenv("CALMLENS_LOG")); err != nil {
			return nil, err
		}
	}
	if options.APIKey == "" || options.ProjectID == "" {
		return nil, invalid(CodeSDKInvalidConfig, "API key and project ID are required")
	}
	// Only what can be sent as a header is checked: the API decides whether a key is real.
	for _, char := range options.APIKey {
		if char < 0x21 || char > 0x7e {
			return nil, invalid(CodeSDKInvalidConfig, "API key must be printable ASCII without spaces")
		}
	}
	if options.ProjectID == "." || options.ProjectID == ".." {
		return nil, invalid(CodeSDKInvalidConfig, `ProjectID cannot be "." or ".."`)
	}
	if options.Timeout < 0 || options.UploadTimeout < 0 || options.ConnectTimeout < 0 || options.ResponseHeaderTimeout < 0 || options.MaxResponseBytes < 0 {
		return nil, invalid(CodeSDKInvalidConfig, "Timeouts and MaxResponseBytes cannot be negative")
	}
	if options.MaxRetries != nil && *options.MaxRetries < 0 {
		return nil, invalid(CodeSDKInvalidConfig, "MaxRetries cannot be negative")
	}
	if options.PartSizeBytes != 0 && (options.PartSizeBytes < MinPartSizeBytes || options.PartSizeBytes > MaxPartSizeBytes) {
		return nil, invalid(CodeSDKInvalidConfig, "PartSizeBytes must be from 5 MiB (5242880) to 64 MiB (67108864)")
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
	if options.PartSizeBytes == 0 {
		options.PartSizeBytes = DefaultPartSizeBytes
	}
	options.BaseURL = strings.TrimRight(options.BaseURL, "/")
	base, _ := url.Parse(options.BaseURL)
	options.CDNBaseURL = strings.TrimRight(options.CDNBaseURL, "/")
	doer := options.HTTPClient
	if client, ok := doer.(*http.Client); ok || doer == nil {
		var safeClient http.Client
		if client != nil {
			// Copy the client so caller configuration is unchanged.
			safeClient = *client
		} else {
			safeClient.Transport = defaultTransport(options)
		}
		// Never follow redirects, so credentials stay on the configured endpoint.
		safeClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		doer = &safeClient
	}
	maxRetries := DefaultMaxRetries
	if options.MaxRetries != nil {
		maxRetries = *options.MaxRetries
	}
	c := &ServerClient{options: options, maxRetries: maxRetries, http: doer, userAgent: userAgent + agent, logger: logger, basePath: base.EscapedPath(), lenses: &lensCache{lenses: map[string]Lens{}, lock: make(chan struct{}, 1)}, sleep: sleep, now: time.Now}
	c.services()
	return c, nil
}

func (c *ServerClient) services() {
	c.Assets, c.Text = &AssetsService{c}, &TextService{c}
	c.Folders, c.Events, c.CDN = &FoldersService{c}, &EventsService{c}, &CDNService{c}
	c.UploadTokens, c.HashLists, c.Policies = &UploadTokensService{c}, &HashListsService{c}, &PoliciesService{c}
	c.Lenses = &LensesService{c}
	c.UploadPresets, c.ProjectSettings, c.MetadataFields = &UploadPresetsService{c}, &ProjectSettingsService{c}, &MetadataFieldsService{c}
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

func init() {
	clock.Set = func(client any, now func() time.Time, sleep func(context.Context, time.Duration) error) {
		c := client.(*ServerClient)
		c.now, c.sleep = now, sleep
	}
	clock.DeferUploadChecks = func(client any) { client.(*ServerClient).deferUploadChecks = true }
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

// query encodes options as query parameters: strings and numbers as text, nested values as JSON.
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
	// binary uploads are bounded by Options.UploadTimeout rather than Options.Timeout.
	binary bool
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

// encodeJSON encodes value as JavaScript's JSON.stringify does: without escaping <, > and &.
func encodeJSON(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n")), nil
}

// retryDelay is how long to wait before repeating a request that failed with err, and whether
// to repeat it at all: a Retry-After header replaces the backoff, and one over RetryAfterMax
// is not waited out.
func (c *ServerClient) retryDelay(err *Error, attempt int) (time.Duration, bool) {
	limit := c.options.MaxRetryDelay
	delay := c.backoff(attempt)
	if err.RetryAfter == nil {
		return delay, true
	}
	if limit == 0 {
		limit = RetryAfterMax
	}
	return *err.RetryAfter, *err.RetryAfter <= limit
}

// send performs a call, retrying it when that is safe, and decodes the response into out.
func (c *ServerClient) send(ctx context.Context, spec call, out any) error {
	// requestPath is the URL path as sent, base path included, such as "/v1/assets/asset_1".
	requestPath := c.basePath + spec.path
	endpoint := c.options.BaseURL + spec.path
	if len(spec.params) > 0 {
		endpoint += "?" + spec.params.Encode()
	}
	params := paramsOf(ctx)
	headers := http.Header{}
	for key, values := range params.Headers {
		headers[key] = append([]string(nil), values...)
	}
	for key, values := range spec.headers {
		headers[key] = append([]string(nil), values...)
	}
	headers.Set("Accept", "application/json")
	var payload []byte
	rewind := func() error { return nil }
	if spec.body != nil {
		var err error
		if payload, err = encodeJSON(spec.body); err != nil {
			return argumentError("Could not encode the request body", err)
		}
		if payload, err = withExtra(payload, params.ExtraBody); err != nil {
			return err
		}
		headers.Set("Content-Type", "application/json")
	} else {
		if len(params.ExtraBody) > 0 {
			return invalid(CodeSDKInvalidArgument, "Params.ExtraBody needs a request with a JSON body")
		}
		if spec.raw != nil {
			rewind = rewinder(spec.raw)
		}
	}
	if len(params.ExtraQuery) > 0 {
		separator := "?"
		if len(spec.params) > 0 {
			separator = "&"
		}
		endpoint += separator + params.ExtraQuery.Encode()
	}
	idempotencyKey := spec.idempotencyKey
	if idempotencyKey == "" && spec.method != http.MethodGet && spec.method != http.MethodHead {
		idempotencyKey = params.IdempotencyKey
	}
	if idempotencyKey != "" {
		headers.Set("Idempotency-Key", idempotencyKey)
	}
	timeout := c.options.Timeout
	if spec.binary {
		timeout = c.options.UploadTimeout
	}
	if params.Timeout > 0 {
		timeout = params.Timeout
	}
	maxRetries := c.maxRetries
	if params.MaxRetries != nil {
		maxRetries = *params.MaxRetries
	}
	retryable := spec.method == http.MethodGet || spec.method == http.MethodHead || idempotencyKey != ""
	for attempt := 0; ; attempt++ {
		var reader io.Reader
		size := int64(0)
		switch {
		case payload != nil:
			reader, size = bytes.NewReader(payload), int64(len(payload))
		case spec.raw != nil:
			reader, size = spec.raw, spec.size
		}
		record := Attempt{Operation: operationOf(ctx), Method: spec.method, Path: requestPath, Attempt: attempt + 1}
		started := time.Now()
		err := c.attempt(ctx, spec.method, endpoint, headers, reader, size, timeout, out, &record)
		record.Duration, record.Err = time.Since(started), err
		if err == nil {
			c.observe(ctx, record, true)
			return nil
		}
		sdkErr, ok := err.(*Error)
		if ok {
			sdkErr.Method, sdkErr.Path, sdkErr.Attempts = spec.method, requestPath, attempt+1
		}
		delay, wait := time.Duration(0), false
		if ok && retryable && attempt < maxRetries && sdkErr.Retryable() && ctx.Err() == nil && rewind != nil && rewind() == nil {
			// A stream that cannot be rewound cannot be sent again.
			delay, wait = c.retryDelay(sdkErr, attempt)
		}
		if !wait {
			c.observe(ctx, record, true)
			return err
		}
		record.Delay, record.WillRetry = delay, true
		c.observe(ctx, record, false)
		if waitErr := c.sleep(ctx, delay); waitErr != nil {
			return transportError(waitErr)
		}
	}
}

// backoff is backoff capped at Options.MaxRetryDelay.
func (c *ServerClient) backoff(attempt int) time.Duration {
	if c.options.MaxRetryDelay > 0 {
		return min(backoff(attempt), c.options.MaxRetryDelay)
	}
	return backoff(attempt)
}

// backoff is capped exponential backoff with jitter: retry n waits between half and all of
// min(RetryMaxDelay, RetryBaseDelay * 2^n), rounded to the millisecond.
func backoff(attempt int) time.Duration {
	delay := min(RetryMaxDelay, RetryBaseDelay<<min(attempt, 16))
	jittered := float64(delay/2) + mathrand.Float64()*float64(delay/2)
	return time.Duration(jittered).Round(time.Millisecond)
}

// attempt sends one HTTP request and reads its response.
func (c *ServerClient) attempt(ctx context.Context, method, endpoint string, headers http.Header, body io.Reader, size int64, timeout time.Duration, out any, record *Attempt) error {
	if timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, nil)
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
	req.Header.Set("User-Agent", c.userAgent)
	res, err := c.http.Do(req)
	if err != nil {
		return transportError(err)
	}
	defer res.Body.Close()
	record.Status, record.RequestID = res.StatusCode, res.Header.Get("X-Request-Id")
	if isRedirect(res) {
		return redirectError(res)
	}
	data, err := readLimited(res, c.options.MaxResponseBytes)
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return responseError(res, data, c.now())
	}
	if out == nil || (res.StatusCode == http.StatusNoContent && headers.Get("Idempotency-Replay-Only") == "true") {
		return nil
	}
	requestID := res.Header.Get("X-Request-Id")
	if raw, ok := out.(*RawResponse); ok && len(data) == 0 {
		raw.setLastResponse(&APIResponse{StatusCode: res.StatusCode, Header: res.Header, RequestID: requestID, IdempotencyKey: headers.Get("Idempotency-Key")})
		return nil
	}
	if len(data) == 0 {
		return &Error{Code: CodeSDKInvalidResponse, Message: "Empty JSON response", Status: res.StatusCode, RequestID: requestID, Header: res.Header}
	}
	if err = decodeJSON(data, out); err != nil {
		return &Error{Code: CodeSDKInvalidResponse, Message: "Invalid JSON response", Status: res.StatusCode, RequestID: requestID, Header: res.Header, Cause: err}
	}
	if model, ok := out.(lastResponseSetter); ok {
		model.setLastResponse(&APIResponse{StatusCode: res.StatusCode, Header: res.Header, RequestID: requestID, IdempotencyKey: headers.Get("Idempotency-Key")})
	}
	return nil
}

// withExtra adds Params.ExtraBody to a JSON object body; the body's own fields win.
func withExtra(payload []byte, extra map[string]any) ([]byte, error) {
	if len(extra) == 0 {
		return payload, nil
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil || fields == nil {
		return nil, invalid(CodeSDKInvalidArgument, "Params.ExtraBody needs a JSON object body")
	}
	for key, value := range extra {
		if _, declared := fields[key]; declared {
			continue
		}
		encoded, err := encodeJSON(value)
		if err != nil {
			return nil, argumentError("Could not encode Params.ExtraBody", err)
		}
		fields[key] = encoded
	}
	return encodeJSON(fields)
}

// readLimited reads a response body of at most limit bytes. A larger declared Content-Length
// fails before the body is read.
func readLimited(res *http.Response, limit int64) ([]byte, error) {
	tooLarge := func() error {
		return &Error{Code: CodeSDKResponseTooLarge, Message: "Response body exceeds MaxResponseBytes", Status: res.StatusCode, RequestID: res.Header.Get("X-Request-Id"), Header: res.Header}
	}
	if res.ContentLength > limit {
		return nil, tooLarge()
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, transportError(err)
	}
	if int64(len(data)) > limit {
		return nil, tooLarge()
	}
	return data, nil
}

// isRedirect reports a 3xx response, which the client never follows: following it could send
// the API key to another origin.
func isRedirect(res *http.Response) bool { return res.StatusCode >= 300 && res.StatusCode < 400 }

// redirectError is the sdk/http-error of a redirect. It is not retried: the request would be
// redirected again.
func redirectError(res *http.Response) error {
	return &Error{Code: CodeSDKHTTPError, Message: "Unexpected redirect (HTTP " + strconv.Itoa(res.StatusCode) + ")", Status: res.StatusCode, RequestID: res.Header.Get("X-Request-Id"), Header: res.Header}
}

// maxErrorBody is the most of an error response's body Error.Body keeps.
const maxErrorBody = 16 << 10

// capBody keeps at most maxErrorBody bytes of an error response's body.
func capBody(data []byte) string {
	if len(data) > maxErrorBody {
		data = data[:maxErrorBody]
	}
	return string(data)
}

// responseError converts a non-2xx response into *Error.
func responseError(res *http.Response, data []byte, now time.Time) error {
	result := &Error{Status: res.StatusCode, RequestID: res.Header.Get("X-Request-Id"), Header: res.Header, RetryAfter: parseRetryAfter(res.Header.Get("Retry-After"), now), Body: capBody(data)}
	var failure struct {
		Code      *string `json:"code"`
		Message   *string `json:"message"`
		Details   JSON    `json:"details"`
		RequestID string  `json:"requestId"`
	}
	if decodeJSON(data, &failure) == nil && failure.Code != nil {
		result.Code, result.Message, result.Details = ErrorCode(*failure.Code), *failure.Code, failure.Details
		if result.RequestID == "" {
			result.RequestID = failure.RequestID
		}
		if failure.Message != nil {
			result.Message = *failure.Message
		}
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

// EnsureLens creates a lens, or changes it to this definition, by identifier and returns it.
// See EnsureLenses.
func (c *ServerClient) EnsureLens(ctx context.Context, options EnsureLensOptions) (*Lens, error) {
	ctx, paramsErr := withCall(ctx, "ensureLens", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	lenses, err := c.EnsureLenses(ctx, EnsureLensesOptions{Lenses: []EnsureLensOptions{options}})
	if err != nil {
		return nil, err
	}
	return &lenses[0], nil
}

// lensCache holds the lenses a client has ensured, by definition. lock serializes ensures, so
// concurrent identical calls send the definition once.
type lensCache struct {
	lenses map[string]Lens
	lock   chan struct{}
}

// EnsureLensesMaxPerRequest is the most lens definitions EnsureLenses sends in one request.
const EnsureLensesMaxPerRequest = 100

// EnsureLenses creates each lens, or changes it to the definition sent, by identifier. An
// unchanged lens is returned as it is, so applications can send their lenses every time they
// start. Definitions are cached per client: repeated and concurrent calls with the same
// definitions are sent once, until Lenses.Create, Lenses.Update or Lenses.Delete changes the
// lens. More than EnsureLensesMaxPerRequest new definitions are sent in consecutive requests, in
// order.
func (c *ServerClient) EnsureLenses(ctx context.Context, options EnsureLensesOptions) ([]Lens, error) {
	ctx, paramsErr := withCall(ctx, "ensureLenses", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	// Each of the consecutive requests is a PUT of its own definitions; one key would replay the
	// first.
	ctx = withoutIdempotencyKey(ctx)
	if len(options.Lenses) == 0 {
		return nil, invalid(CodeSDKInvalidArgument, "At least one lens is required")
	}
	keys := make([]string, len(options.Lenses))
	for i, lens := range options.Lenses {
		if lens.Identifier == "" {
			return nil, invalid(CodeSDKInvalidArgument, "Lens identifier is required")
		}
		// A lens sent without Active is served, so both spellings are one definition.
		if lens.Active == nil {
			lens.Active = Ptr(true)
		}
		encoded, err := json.Marshal(lens)
		if err != nil {
			return nil, argumentError("Could not encode the lens", err)
		}
		keys[i] = string(encoded)
	}
	cache := c.lenses
	select {
	case cache.lock <- struct{}{}:
	case <-ctx.Done():
		return nil, transportError(ctx.Err())
	}
	defer func() { <-cache.lock }()
	missing := []EnsureLensOptions{}
	missingKeys := []string{}
	seen := map[string]bool{}
	for i, key := range keys {
		if _, ok := cache.lenses[key]; !ok && !seen[key] {
			missing = append(missing, options.Lenses[i])
			missingKeys = append(missingKeys, key)
			seen[key] = true
		}
	}
	resolved := map[string]Lens{}
	for key, lens := range cache.lenses {
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
			for key, old := range cache.lenses {
				if old.Identifier == lens.Identifier {
					delete(cache.lenses, key)
				}
			}
			cache.lenses[chunkKeys[i]] = lens
			resolved[chunkKeys[i]] = lens
		}
	}
	result := make([]Lens, len(keys))
	for i, key := range keys {
		result[i] = resolved[key]
	}
	// Do not let callers mutate cached transform options through returned maps.
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
