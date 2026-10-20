package calmlens

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	uploadTokenPrefix            = "clut_"
	uploadTokenSigningContext    = "calmlens-upload-token:v1:"
	uploadTokenDefaultTTLSeconds = 600
	uploadTokenMaxTTLSeconds     = 3600
)

// UploadTokensService signs upload tokens, with no request to CalmLens.
type UploadTokensService struct{ c *ServerClient }

// SignUploadTokenOptions describes one upload token.
type SignUploadTokenOptions struct {
	// UploadPresetID is the preset the token may upload through (required).
	UploadPresetID string
	// ExternalID becomes the external ID of the uploaded asset when set (must not be empty).
	ExternalID *string
	// ExpiresInSeconds is the token's lifetime, from 1 to 3600. Zero means 600.
	ExpiresInSeconds int
}

// SignedUploadToken is a signed upload token and when it expires.
type SignedUploadToken struct {
	Token string `json:"token"`
	// ExpiresAt is in milliseconds since the Unix epoch.
	ExpiresAt int64 `json:"expiresAt"`
}

type uploadTokenClaims struct {
	V int    `json:"v"`
	U string `json:"u"`
	K string `json:"k"`
	E int64  `json:"e"`
	N string `json:"n"`
	X string `json:"x,omitempty"`
}

// Sign signs a single-use token with the client's API key. A browser can use it as the
// bearer token for an upload preset that requires one. Give each upload its own token.
func (s *UploadTokensService) Sign(_ context.Context, options SignUploadTokenOptions) (*SignedUploadToken, error) {
	if options.UploadPresetID == "" {
		return nil, invalid(CodeSDKInvalidArgument, "Upload preset ID is required")
	}
	if options.UploadPresetID == "." || options.UploadPresetID == ".." {
		return nil, invalid(CodeSDKInvalidArgument, `Upload preset ID cannot be "." or ".."`)
	}
	ttl := options.ExpiresInSeconds
	if ttl == 0 {
		ttl = uploadTokenDefaultTTLSeconds
	}
	if ttl < 1 || ttl > uploadTokenMaxTTLSeconds {
		return nil, invalid(CodeSDKInvalidArgument, fmt.Sprintf("ExpiresInSeconds must be a whole number from 1 to %d", uploadTokenMaxTTLSeconds))
	}
	if options.ExternalID != nil && *options.ExternalID == "" {
		return nil, invalid(CodeSDKInvalidArgument, "ExternalID must be a non-empty string")
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	nonce[6] = nonce[6]&0x0f | 0x40
	nonce[8] = nonce[8]&0x3f | 0x80
	hexNonce := hex.EncodeToString(nonce)
	apiKey := s.c.options.APIKey
	prefixLength := 8
	if strings.HasPrefix(apiKey, "clsk_") {
		prefixLength = 13
	}
	if len(apiKey) < prefixLength {
		prefixLength = len(apiKey)
	}
	expiresAt := time.Now().UnixMilli() + int64(ttl)*1000
	claims := uploadTokenClaims{V: 1, U: options.UploadPresetID, K: apiKey[:prefixLength], E: expiresAt,
		N: hexNonce[0:8] + "-" + hexNonce[8:12] + "-" + hexNonce[12:16] + "-" + hexNonce[16:20] + "-" + hexNonce[20:]}
	if options.ExternalID != nil {
		claims.X = *options.ExternalID
	}
	encoded, err := json.Marshal(claims)
	if err != nil {
		return nil, err
	}
	body := base64.RawURLEncoding.EncodeToString(encoded)
	keyHash := sha256.Sum256([]byte(apiKey))
	mac := hmac.New(sha256.New, []byte(hex.EncodeToString(keyHash[:])))
	mac.Write([]byte(uploadTokenSigningContext + body))
	return &SignedUploadToken{Token: uploadTokenPrefix + body + "." + hex.EncodeToString(mac.Sum(nil)), ExpiresAt: expiresAt}, nil
}
