package calmlenstest

import (
	"context"
	"encoding/hex"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	calmlens "github.com/CalmLens/sdks/go"
)

// externalIDPrefix starts the asset segment of a URL that names the asset by its external ID.
const externalIDPrefix = "ext:"

// mockGrant is what a signed asset URL from the mock grants: one asset, original access or not,
// until expiresAt (unix milliseconds).
type mockGrant struct {
	assetID   string
	original  bool
	expiresAt int64
}

// encode is the grant's asset segment: "sig_" and the lowercase hex of the UTF-8 string
// "{assetId}.{1|0}.{expiresAt}". Every SDK's mock writes it the same way. It is readable, not
// signed, as the mock has no secret to keep.
func (g mockGrant) encode() string {
	original := "0"
	if g.original {
		original = "1"
	}
	return "sig_" + hex.EncodeToString([]byte(g.assetID+"."+original+"."+strconv.FormatInt(g.expiresAt, 10)))
}

var mockGrantText = regexp.MustCompile(`(?s)^(.+)\.([01])\.(\d+)$`)

// decodeMockGrant reads a grant segment; ok is false for one the mock didn't sign.
func decodeMockGrant(segment string) (grant mockGrant, ok bool) {
	encoded := strings.TrimPrefix(segment, "sig_")
	if encoded == "" || strings.ToLower(encoded) != encoded {
		return grant, false
	}
	data, err := hex.DecodeString(encoded)
	if err != nil || !utf8.Valid(data) {
		return grant, false
	}
	match := mockGrantText.FindStringSubmatch(string(data))
	if match == nil {
		return grant, false
	}
	expiresAt, err := strconv.ParseInt(match[3], 10, 64)
	if err != nil {
		return grant, false
	}
	return mockGrant{assetID: match[1], original: match[2] == "1", expiresAt: expiresAt}, true
}

// signAssetURL signs an asset URL like the API (POST /projects/:projectId/signed-asset-urls): a
// grant to one asset, by ID or external ID, until it expires, serving the original only when
// asked. Only the mock's CDN accepts the grant.
func (m *MockServerClient) signAssetURL(body calmlens.JSON, now int64) (any, error) {
	// Like the API's schema, none of these fields takes null.
	for _, key := range []string{"assetId", "externalId", "expiresIn", "original"} {
		if value, ok := body[key]; ok && value == nil {
			return nil, validation("validation/invalid-type", key)
		}
	}
	assetID, hasAssetID := body["assetId"]
	externalID, hasExternalID := body["externalId"]
	if hasAssetID == hasExternalID {
		issue := calmlens.JSON{"path": "", "message": "Send either assetId or externalId", "code": "custom"}
		return nil, &apiError{code: calmlens.CodeInvalidRequest, status: http.StatusBadRequest, details: calmlens.JSON{"issues": []any{issue}}}
	}
	expiresIn := float64(calmlens.DefaultSignedURLExpiresIn)
	if value, ok := body["expiresIn"]; ok {
		seconds, isNumber := value.(float64)
		if !isNumber || seconds != math.Trunc(seconds) {
			return nil, validation("validation/invalid-type", "expiresIn")
		}
		expiresIn = seconds
	}
	if expiresIn < 1 {
		return nil, validation("validation/too-small", "expiresIn")
	}
	if expiresIn > calmlens.MaxSignedURLExpiresIn {
		return nil, validation("validation/too-big", "expiresIn")
	}
	original := false
	if value, ok := body["original"]; ok {
		flag, isBool := value.(bool)
		if !isBool {
			return nil, validation("validation/invalid-type", "original")
		}
		original = flag
	}
	var asset calmlens.JSON
	if hasExternalID {
		for _, a := range m.DatabaseStorage.Assets {
			if a["projectId"] == m.options.ProjectID && a["externalId"] == externalID {
				asset = a
				break
			}
		}
		if asset == nil {
			return nil, fail(calmlens.CodeAssetNotFound)
		}
	} else {
		var err error
		if asset, err = m.asset(text(assetID)); err != nil {
			return nil, err
		}
	}
	if section(asset, "content")["safetyHold"] != nil {
		return nil, fail(calmlens.CodeAssetHeld)
	}
	expiresAt := now + int64(expiresIn)*1000
	grant := mockGrant{assetID: text(asset["id"]), original: original, expiresAt: expiresAt}
	return calmlens.JSON{"url": m.options.CDNBaseURL + "/assets/" + escapeComponent(m.options.ProjectID) + "/" + grant.encode(), "expiresAt": expiresAt}, nil
}

// escapeComponent percent-encodes like encodeURIComponent.
func escapeComponent(value string) string {
	var out strings.Builder
	for _, b := range []byte(value) {
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || strings.IndexByte("-_.!~*'()", b) >= 0 {
			out.WriteByte(b)
		} else {
			fmt.Fprintf(&out, "%%%02X", b)
		}
	}
	return out.String()
}

// FetchCDN fetches a mock CDN URL as a browser would, with a GET and without the API key: a
// signed asset URL from CDN.SignAssetURL (with a resource appended), or a public one from
// CDN.GetAssetURL. Without a grant, a private asset answers 404 asset/not-found whatever its state,
// including its placeholder and info. The request is recorded like any other. The caller must close the
// body.
func (m *MockServerClient) FetchCDN(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	return transport{m}.RoundTrip(req)
}
