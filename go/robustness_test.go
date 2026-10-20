package calmlens

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestLensLockRespectsDeadline(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() { close(entered) })
		<-release
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"lenses":[{"identifier":"thumb"}]}`))
	}))
	defer server.Close()
	client, err := NewServerClient(Options{APIKey: "key", ProjectID: "project", BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	lens := EnsureLensOptions{Identifier: "thumb"}
	done := make(chan error, 1)
	go func() {
		_, err := client.EnsureLens(context.Background(), lens)
		done <- err
	}()
	<-entered
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err = client.EnsureLens(ctx, EnsureLensOptions{Identifier: "other"})
	if !errors.Is(err, context.DeadlineExceeded) || ErrorCode(err) != CodeSDKTimeout || time.Since(start) > time.Second {
		t.Fatalf("waiting for the lens lock ignored the deadline: %v", err)
	}
	close(release)
	if err = <-done; err != nil {
		t.Fatal(err)
	}
}
