package main

import (
	"bytes"
	"os"
	"testing"
)

func TestErrorCodesAreUpToDate(t *testing.T) {
	// The shared TypeScript source only exists in the monorepo, not in module downloads.
	source, err := os.ReadFile("../../../shared/src/PublicErrorCodes.ts")
	if os.IsNotExist(err) {
		t.Skip("PublicErrorCodes.ts is not available outside the monorepo")
	}
	if err != nil {
		t.Fatal(err)
	}
	want, err := generate(source)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile("../../errorcodes.go")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("errorcodes.go is stale; run go generate ./... in go")
	}
}
