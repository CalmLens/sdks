package calmlens

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

const uploadTokenTestKey = "clsk_use_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHabcdef"

func decodeUploadToken(t *testing.T, token string) (claims map[string]any, body, signature string) {
	t.Helper()
	rest, ok := strings.CutPrefix(token, "clut_")
	if !ok {
		t.Fatalf("token %q has no clut_ prefix", token)
	}
	body, signature, ok = strings.Cut(rest, ".")
	if !ok {
		t.Fatalf("token %q has no signature", token)
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatal(err)
	}
	return claims, body, signature
}

func uploadTokenVerifies(body, signature, apiKey string) bool {
	hash := sha256.Sum256([]byte(apiKey))
	mac := hmac.New(sha256.New, []byte(hex.EncodeToString(hash[:])))
	mac.Write([]byte("calmlens-upload-token:v1:" + body))
	return hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(signature))
}

func TestUploadTokensSignVerifiesAgainstTheKeyHash(t *testing.T) {
	c, err := NewServerClient(Options{APIKey: uploadTokenTestKey, ProjectID: "p"})
	if err != nil {
		t.Fatal(err)
	}
	before := time.Now().UnixMilli()
	signed, err := c.UploadTokens.Sign(context.Background(), SignUploadTokenOptions{UploadPresetID: "preset-1", ExternalID: Ptr("post-42"), ExpiresInSeconds: 120})
	if err != nil {
		t.Fatal(err)
	}
	claims, body, signature := decodeUploadToken(t, signed.Token)
	if claims["v"] != float64(1) || claims["u"] != "preset-1" || claims["x"] != "post-42" || claims["k"] != "clsk_use_abcd" || claims["e"] != float64(signed.ExpiresAt) {
		t.Fatalf("claims %v", claims)
	}
	if delta := signed.ExpiresAt - before; delta < 120_000 || delta >= 121_000 {
		t.Fatalf("expires %dms from now", delta)
	}
	if !uploadTokenVerifies(body, signature, uploadTokenTestKey) || uploadTokenVerifies(body, signature, "other") {
		t.Fatal("signature must verify only against this key")
	}
}

func TestUploadTokensGetOwnNoncesAndShortKeyPrefixes(t *testing.T) {
	c, _ := NewServerClient(Options{APIKey: "legacykey-1234", ProjectID: "p"})
	first, _ := c.UploadTokens.Sign(context.Background(), SignUploadTokenOptions{UploadPresetID: "p1"})
	second, _ := c.UploadTokens.Sign(context.Background(), SignUploadTokenOptions{UploadPresetID: "p1"})
	a, _, _ := decodeUploadToken(t, first.Token)
	b, _, _ := decodeUploadToken(t, second.Token)
	if a["n"] == b["n"] || a["k"] != "legacyke" {
		t.Fatalf("claims %v and %v", a, b)
	}
	if _, has := a["x"]; has {
		t.Fatalf("x must be omitted without an external ID: %v", a)
	}
}

func TestUploadTokensRejectInvalidOptions(t *testing.T) {
	c, _ := NewServerClient(Options{APIKey: uploadTokenTestKey, ProjectID: "p"})
	for name, options := range map[string]SignUploadTokenOptions{
		"no preset":  {},
		"too long":   {UploadPresetID: "p", ExpiresInSeconds: 3601},
		"negative":   {UploadPresetID: "p", ExpiresInSeconds: -1},
		"empty x id": {UploadPresetID: "p", ExternalID: Ptr("")},
	} {
		_, err := c.UploadTokens.Sign(context.Background(), options)
		var e *Error
		if !errors.As(err, &e) || e.Code != CodeSDKInvalidArgument {
			t.Errorf("%s: got %v", name, err)
		}
	}
}
