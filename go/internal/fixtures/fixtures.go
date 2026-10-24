// Package fixtures is the one loader of the shared SDK contract fixtures in the module's
// testdata directory (packages/sdk-contract/README.md, "Runners"). The root package's and
// calmlenstest's contract tests read every fixture through it.
package fixtures

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Read decodes testdata/<name> into a T, failing t when the file is missing or does not decode.
func Read[T any](t testing.TB, name string) T {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(moduleRoot(t), "testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	var v T
	if err = json.Unmarshal(data, &v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return v
}

// moduleRoot is the directory holding go.mod, found from the test's working directory (its
// package directory).
func moduleRoot(t testing.TB) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("go.mod not found above the test's directory")
		}
		dir = parent
	}
}
