package main

import (
	"bytes"
	"os"
	"testing"
)

func TestErrorCodesAreUpToDate(t *testing.T) {
	// The shared TypeScript source only exists in the monorepo, not in module downloads.
	want, err := generateFile("../../../../packages/shared/src/PublicErrorCodes.ts")
	if os.IsNotExist(err) {
		t.Skip("PublicErrorCodes.ts is not available outside the monorepo")
	}
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

func TestGenerateResolvesImportedErrorCode(t *testing.T) {
	source := []byte("\n  BILLING: new ErrorCode({ id: BILLING_ERROR, status: 409,\n")
	imported := []byte("export const BILLING_ERROR = \"payment/billing-required\";\n")
	got, err := generate(source, imported)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(got, []byte(`CodeBilling ErrorCode = "payment/billing-required"`)) {
		t.Fatalf("generated code is missing the imported error ID:\n%s", got)
	}
	if _, err := generate(source); err == nil {
		t.Fatal("unresolved error ID was silently omitted")
	}
}
