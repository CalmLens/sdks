package calmlens

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

// replies answers each request with the next status and body, recording the requests.
func replies(sent *[]*http.Request, answers ...string) HTTPDoer {
	return doerFunc(func(r *http.Request) (*http.Response, error) {
		*sent = append(*sent, r)
		status, body, _ := strings.Cut(answers[min(len(*sent), len(answers))-1], " ")
		code := map[string]int{"200": 200, "204": 204, "404": 404, "503": 503}[status]
		return &http.Response{StatusCode: code, Header: http.Header{"X-Request-Id": {"req_" + status}, "Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})
}

func TestEnvironmentSuppliesTheCredentialsAndBaseURL(t *testing.T) {
	t.Setenv("CALMLENS_API_KEY", "env-key")
	t.Setenv("CALMLENS_PROJECT_ID", "env-project")
	t.Setenv("CALMLENS_BASE_URL", "https://api.example.test/v1")
	var sent []*http.Request
	c, err := NewServerClient(Options{HTTPClient: replies(&sent, `200 {"id":"a"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.Assets.Retrieve(context.Background(), AssetIDOptions{AssetID: "a"}); err != nil {
		t.Fatal(err)
	}
	if got := sent[0]; got.Header.Get("X-Api-Key") != "env-key" || got.URL.String() != "https://api.example.test/v1/assets/a" {
		t.Fatal(got.URL, got.Header.Get("X-Api-Key"))
	}
	// Options win over the environment, and IgnoreEnvironment reads none of it.
	if c, err = NewServerClient(Options{APIKey: "key", HTTPClient: replies(&sent, `200 {"id":"a"}`)}); err != nil || c.options.APIKey != "key" || c.options.ProjectID != "env-project" {
		t.Fatal(err)
	}
	if _, err = NewServerClient(Options{IgnoreEnvironment: true}); !errors.Is(err, ErrConfiguration) {
		t.Fatal(err)
	}
	t.Setenv("CALMLENS_LOG", "loud")
	if _, err = NewServerClient(Options{}); CodeOf(err) != CodeSDKInvalidConfig {
		t.Fatal("an unknown CALMLENS_LOG was accepted", err)
	}
}

func TestAppInfoJoinsTheUserAgent(t *testing.T) {
	var sent []*http.Request
	c, err := NewServerClient(Options{APIKey: "key", ProjectID: "p", IgnoreEnvironment: true, AppInfo: &AppInfo{Name: "Photos", Version: "2.1", URL: "https://photos.example"}, HTTPClient: replies(&sent, `200 {"id":"a"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.Folders.Retrieve(context.Background(), FolderIDOptions{FolderID: "f"}); err != nil {
		t.Fatal(err)
	}
	if got := sent[0].Header.Get("User-Agent"); got != userAgent+" Photos/2.1 (https://photos.example)" {
		t.Fatal(got)
	}
	if _, err = NewServerClient(Options{APIKey: "key", ProjectID: "p", AppInfo: &AppInfo{Name: "Two words"}}); CodeOf(err) != CodeSDKInvalidConfig {
		t.Fatal(err)
	}
}

func TestEachAttemptIsReportedAndLoggedWithoutSecrets(t *testing.T) {
	var sent []*http.Request
	var attempts []Attempt
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	c, err := NewServerClient(Options{APIKey: "secret-key", ProjectID: "p", IgnoreEnvironment: true, Logger: logger, OnAttempt: func(a Attempt) { attempts = append(attempts, a) }, HTTPClient: replies(&sent, `503 busy`, `200 {"id":"a","name":"private name"}`)})
	if err != nil {
		t.Fatal(err)
	}
	c.sleep = func(context.Context, time.Duration) error { return nil }
	if _, err = c.Assets.Retrieve(context.Background(), AssetIDOptions{AssetID: "a"}); err != nil {
		t.Fatal(err)
	}
	if len(attempts) != 2 || attempts[0].Operation != "assets.retrieve" || attempts[0].Method != "GET" || attempts[0].Path != "/assets/a" ||
		attempts[0].Attempt != 1 || attempts[0].Status != 503 || attempts[0].Delay <= 0 || CodeOf(attempts[0].Err) != CodeSDKHTTPError ||
		attempts[1].Attempt != 2 || attempts[1].Status != 200 || attempts[1].RequestID != "req_200" || attempts[1].Delay != 0 || attempts[1].Err != nil {
		t.Fatalf("%+v", attempts)
	}
	text := logs.String()
	if !strings.Contains(text, "operation=assets.retrieve") || !strings.Contains(text, "retry_in=") || strings.Contains(text, "secret-key") || strings.Contains(text, "private name") {
		t.Fatal(text)
	}
}

func TestMaxRetryDelayCapsTheWait(t *testing.T) {
	var sent []*http.Request
	doer := doerFunc(func(r *http.Request) (*http.Response, error) {
		sent = append(sent, r)
		return &http.Response{StatusCode: 503, Header: http.Header{"Retry-After": {"10"}}, Body: io.NopCloser(strings.NewReader("busy")), Request: r}, nil
	})
	c, err := NewServerClient(Options{APIKey: "key", ProjectID: "p", IgnoreEnvironment: true, MaxRetryDelay: time.Second, HTTPClient: doer})
	if err != nil {
		t.Fatal(err)
	}
	// A Retry-After over MaxRetryDelay fails the call instead of waiting.
	if _, err = c.Assets.Retrieve(context.Background(), AssetIDOptions{AssetID: "a"}); !errors.Is(err, ErrServer) || len(sent) != 1 {
		t.Fatal(err, len(sent))
	}
	if delay := c.backoff(10); delay > time.Second {
		t.Fatal(delay)
	}
}

func TestRequestSendsARouteTheSDKHasNoMethodFor(t *testing.T) {
	var sent []*http.Request
	c, err := NewServerClient(Options{APIKey: "key", ProjectID: "p", IgnoreEnvironment: true, HTTPClient: replies(&sent, `200 {"future":1}`, `204 `, `404 {"code":"asset/not-found","message":"No"}`)})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	response, err := c.Request(ctx, RequestOptions{Method: "post", Path: "/projects/p/future", Query: url.Values{"a": {"1"}}, Body: JSON{"b": 2}, Params: Params{Headers: http.Header{"X-Trace": {"t"}}}})
	var decoded struct{ Future int }
	if err != nil || response.Decode(&decoded) != nil || decoded.Future != 1 || response.LastResponse == nil || response.LastResponse.RequestID != "req_200" {
		t.Fatal(response, err)
	}
	if got := sent[0]; got.Method != "POST" || got.URL.RequestURI() != "/v1/projects/p/future?a=1" || got.Header.Get("X-Api-Key") != "key" || got.Header.Get("X-Trace") != "t" {
		t.Fatal(got.Method, got.URL, got.Header)
	}
	if response, err = c.Request(ctx, RequestOptions{Method: "DELETE", Path: "/projects/p/future/1"}); err != nil || len(response.Body) != 0 || response.LastResponse.StatusCode != 204 {
		t.Fatal(response, err)
	}
	if _, err = c.Request(ctx, RequestOptions{Method: "GET", Path: "/projects/p/assets/x"}); !errors.Is(err, ErrNotFound) || CodeOf(err) != CodeAssetNotFound {
		t.Fatal(err)
	}
	for _, path := range []string{"projects/p", "//evil.example/x", "/a?b=1"} {
		if _, err = c.Request(ctx, RequestOptions{Method: "GET", Path: path}); !errors.Is(err, ErrInvalidArgument) {
			t.Fatal(path, err)
		}
	}
	if len(sent) != 3 {
		t.Fatal("refused paths were sent", len(sent))
	}
}

func TestErrorsRecordTheRequestAndLogWithoutTheirBody(t *testing.T) {
	var sent []*http.Request
	c, err := NewServerClient(Options{APIKey: "key", ProjectID: "p", IgnoreEnvironment: true, MaxRetries: Ptr(0), HTTPClient: replies(&sent, `503 <html>proxy</html>`)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.Folders.Retrieve(context.Background(), FolderIDOptions{FolderID: "f"})
	var failure *Error
	if !errors.As(err, &failure) || failure.Method != "GET" || failure.Path != "/folders/f" || failure.Attempts != 1 || failure.Body != "<html>proxy</html>" || failure.Kind() != ErrServer {
		t.Fatalf("%#v", failure)
	}
	var logs bytes.Buffer
	slog.New(slog.NewTextHandler(&logs, nil)).Error("failed", "err", failure)
	if !strings.Contains(logs.String(), "err.status=503") || strings.Contains(logs.String(), "proxy") {
		t.Fatal(logs.String())
	}
}
