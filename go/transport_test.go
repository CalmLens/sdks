package calmlens

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// hijack closes the connection after writing raw bytes, bypassing net/http framing.
func hijack(raw string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, buf, err := w.(http.Hijacker).Hijack()
		if err != nil {
			panic(err)
		}
		buf.WriteString(raw)
		buf.Flush()
		if tcp, ok := conn.(*net.TCPConn); ok {
			tcp.SetLinger(0) // RST instead of FIN
		}
		conn.Close()
	}
}

func expectSDKError(t *testing.T, err error, code string) *Error {
	t.Helper()
	var sdk *Error
	if !errors.As(err, &sdk) {
		t.Fatalf("expected *calmlens.Error, got %T: %v", err, err)
	}
	if sdk.Code != code {
		t.Fatalf("expected %s, got %s (%v)", code, sdk.Code, err)
	}
	if sdk.Cause == nil || errors.Unwrap(err) == nil {
		t.Fatalf("cause not preserved: %#v", sdk)
	}
	return sdk
}

func TestTransportFailuresAreWrapped(t *testing.T) {
	cases := map[string]http.HandlerFunc{
		"connection reset":   hijack(""),
		"malformed response": hijack("NOT HTTP\r\n\r\n"),
		"truncated body":     hijack("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"id\":"),
		"bad chunk encoding": hijack("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n"),
		"decompression": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Encoding", "gzip")
			w.Write([]byte("definitely not gzip"))
		},
	}
	for name, handler := range cases {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(handler)
			defer server.Close()
			client, err := NewServerClient(Options{APIKey: "key", ProjectID: "project", BaseURL: server.URL, MaxRetries: Ptr(0)})
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.Assets.Retrieve(context.Background(), AssetIDOptions{AssetID: "asset"})
			expectSDKError(t, err, "sdk/transport-error")
		})
	}
}

func TestTLSFailureIsWrapped(t *testing.T) {
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	defer server.Close()
	// The default HTTP client does not trust the test server's self-signed certificate.
	client, err := NewServerClient(Options{APIKey: "key", ProjectID: "project", BaseURL: server.URL, MaxRetries: Ptr(0)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Folders.List(context.Background(), ListFoldersOptions{})
	expectSDKError(t, err, "sdk/transport-error")
}

func TestTimeoutsAreWrapped(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/assets/slow-body" {
			w.Header().Set("Content-Length", "100")
			w.Write([]byte("{"))
			w.(http.Flusher).Flush()
		}
		select {
		case <-release:
		case <-time.After(5 * time.Second):
		}
	}))
	defer server.Close()
	defer close(release)
	client, err := NewServerClient(Options{APIKey: "key", ProjectID: "project", BaseURL: server.URL, Timeout: 50 * time.Millisecond, MaxRetries: Ptr(0)})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"slow-headers", "slow-body"} {
		_, err = client.Assets.Retrieve(context.Background(), AssetIDOptions{AssetID: id})
		expectSDKError(t, err, "sdk/timeout")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	slow, _ := NewServerClient(Options{APIKey: "key", ProjectID: "project", BaseURL: server.URL, MaxRetries: Ptr(0)})
	_, err = slow.Assets.Retrieve(ctx, AssetIDOptions{AssetID: "slow-headers"})
	if expectSDKError(t, err, "sdk/timeout"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline cause lost: %v", err)
	}
}

func TestConstructorValidatesOptionsFirst(t *testing.T) {
	cases := []Options{
		{APIKey: "key", ProjectID: "project", Timeout: -time.Second},
		{APIKey: "key", ProjectID: "project", BaseURL: "api.calmlens.com/v1"},
		{APIKey: "key", ProjectID: "project", BaseURL: "ftp://api.calmlens.com"},
		{APIKey: "key", ProjectID: "project", CDNBaseURL: "::"},
		{ProjectID: "project"},
		{APIKey: "key", ProjectID: "project", MaxRetries: Ptr(-1)},
		{APIKey: "key", ProjectID: "project", ConnectTimeout: -time.Second},
	}
	for _, options := range cases {
		client, err := NewServerClient(options)
		if client != nil {
			t.Fatalf("accepted %+v", options)
		}
		var sdk *Error
		if !errors.As(err, &sdk) || sdk.Code != CodeSDKInvalidConfig {
			t.Fatalf("%+v: %v", options, err)
		}
	}
	custom := &http.Client{Timeout: time.Minute}
	client, err := NewServerClient(Options{APIKey: "key", ProjectID: "project", HTTPClient: custom, Timeout: time.Second})
	if err != nil || client.http == custom || client.http.CheckRedirect == nil || custom.CheckRedirect != nil {
		t.Fatalf("caller's client was modified: %v", err)
	}
	// The default client bounds connecting and waiting for headers, never the whole transfer.
	client, err = NewServerClient(Options{APIKey: "key", ProjectID: "project", ResponseHeaderTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	transport := client.http.Transport.(*http.Transport)
	if client.http.Timeout != 0 || transport.ResponseHeaderTimeout != 5*time.Second || transport.TLSHandshakeTimeout != DefaultConnectTimeout {
		t.Fatalf("whole-request timeout %v, header timeout %v", client.http.Timeout, transport.ResponseHeaderTimeout)
	}
}

func TestTimeoutDoesNotCutOffUploadsOrDownloads(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			return
		}
		// Headers arrive at once; the body trickles in for longer than Options.Timeout.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		time.Sleep(150 * time.Millisecond)
		w.Write([]byte(`{"id":"asset","status":"pending"}`))
	}))
	defer server.Close()
	client, err := NewServerClient(Options{APIKey: "key", ProjectID: "project", BaseURL: server.URL, CDNBaseURL: server.URL, Timeout: 50 * time.Millisecond, MaxRetries: Ptr(0)})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	asset, err := client.Assets.Create(ctx, SubmitAssetOptions{Name: "clip", Content: &Content{Type: "audio/mpeg", Bytes: make([]byte, 1<<20)}})
	if err != nil || asset.ID != "asset" {
		t.Fatalf("upload cut off: %v", err)
	}
	res, err := client.CDN.Serve(ctx, CDNServeOptions{CDNAssetURLOptions: CDNAssetURLOptions{AssetIdentifier: "asset"}})
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if body, err := io.ReadAll(res.Body); err != nil || !strings.Contains(string(body), "asset") {
		t.Fatalf("download cut off: %v", err)
	}
	// JSON API calls stay bounded.
	if _, err = client.Assets.Retrieve(ctx, AssetIDOptions{AssetID: "asset"}); ErrorCode(err) != CodeSDKTimeout {
		t.Fatalf("JSON call not bounded: %v", err)
	}
}
