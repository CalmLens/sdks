package calmlens

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Webhook delivery headers. Values are the canonical lowercase names; net/http
// canonicalizes them when setting or reading headers.
const (
	WebhookDeliveryHeader  = "x-calmlens-delivery"
	WebhookTimestampHeader = "x-calmlens-timestamp"
	WebhookSignatureHeader = "x-calmlens-signature"

	// DefaultWebhookTolerance is how far a delivery's timestamp may be from now.
	DefaultWebhookTolerance = 300 * time.Second
)

// WebhookEventPayload is the JSON body of a webhook connector delivery.
type WebhookEventPayload struct {
	ID string `json:"id"`
	// Type is one of the EventType constants.
	Type      string           `json:"type"`
	CreatedAt int64            `json:"createdAt"`
	ProjectID string           `json:"projectId"`
	Data      WebhookEventData `json:"data"`
}

// WebhookEventData holds the event fields of a webhook delivery.
type WebhookEventData struct {
	// Severity is SeverityLow or SeverityHigh.
	Severity    string      `json:"severity"`
	Title       string      `json:"title"`
	Description *string     `json:"description"`
	AssetID     *string     `json:"assetId"`
	Asset       *EventAsset `json:"asset"`
	Facts       EventFacts  `json:"facts"`
}

// ToWebhookEventPayload converts a feed event into the body a webhook connector delivers.
func ToWebhookEventPayload(event Event) WebhookEventPayload {
	return WebhookEventPayload{
		ID:        event.ID,
		Type:      event.Type,
		CreatedAt: event.CreatedAt,
		ProjectID: event.ProjectID,
		Data: WebhookEventData{
			Severity:    event.Severity,
			Title:       event.Title,
			Description: event.Description,
			AssetID:     event.AssetID,
			Asset:       event.Asset,
			Facts:       event.Facts,
		},
	}
}

// SignWebhookPayload returns the x-calmlens-signature value for payload:
// "v1=" + hex HMAC-SHA256(secret, "<timestamp>.<payload>"). Arguments follow the same
// order as VerifyWebhookSignature: payload, timestamp, secret.
func SignWebhookPayload(payload []byte, timestamp int64, secret string) string {
	return "v1=" + webhookHMAC(secret, strconv.FormatInt(timestamp, 10), payload)
}

// CreateWebhookHeaders returns the headers of one signed delivery of payload, as CalmLens sends
// them: content-type, x-calmlens-delivery (deliveryID), x-calmlens-timestamp and
// x-calmlens-signature. Pass time.Now().Unix() as timestamp to test a webhook handler, which
// rejects deliveries more than five minutes old.
func CreateWebhookHeaders(payload []byte, deliveryID string, timestamp int64, secret string) http.Header {
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	header.Set(WebhookDeliveryHeader, deliveryID)
	header.Set(WebhookTimestampHeader, strconv.FormatInt(timestamp, 10))
	header.Set(WebhookSignatureHeader, SignWebhookPayload(payload, timestamp, secret))
	return header
}

func webhookHMAC(secret, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// DefaultWebhookMaxBodyBytes caps the body VerifyWebhookRequest reads (1 MiB).
const DefaultWebhookMaxBodyBytes int64 = 1 << 20

// WebhookOption changes how a webhook delivery is verified.
type WebhookOption func(*webhookConfig)

type webhookConfig struct {
	tolerance    time.Duration
	now          time.Time
	maxBodyBytes int64
}

// WithTolerance sets the maximum distance between the delivery timestamp and now, compared
// in whole seconds. Zero or negative keeps DefaultWebhookTolerance (5 minutes).
func WithTolerance(tolerance time.Duration) WebhookOption {
	return func(c *webhookConfig) { c.tolerance = tolerance }
}

// WithNow sets the current time used to check the timestamp (default time.Now()).
func WithNow(now time.Time) WebhookOption {
	return func(c *webhookConfig) { c.now = now }
}

// WithMaxBodyBytes caps the body VerifyWebhookRequest reads (default
// DefaultWebhookMaxBodyBytes). Larger bodies are rejected.
func WithMaxBodyBytes(limit int64) WebhookOption {
	return func(c *webhookConfig) { c.maxBodyBytes = limit }
}

func webhookOptions(options []WebhookOption) webhookConfig {
	config := webhookConfig{}
	for _, option := range options {
		option(&config)
	}
	if config.tolerance <= 0 {
		config.tolerance = DefaultWebhookTolerance
	}
	if config.now.IsZero() {
		config.now = time.Now()
	}
	if config.maxBodyBytes <= 0 {
		config.maxBodyBytes = DefaultWebhookMaxBodyBytes
	}
	return config
}

// VerifyWebhookSignature authenticates a delivery before JSON decoding. payload is the exact
// raw body bytes (never a re-encoded value), signature the x-calmlens-signature header
// ("v1=<hex>", a comma-separated list is allowed) and timestamp the x-calmlens-timestamp
// header (unix seconds). It returns false when no v1 signature matches or the timestamp is
// further than the tolerance from now. Most handlers should call VerifyWebhookRequest or
// ParseWebhookEvent instead.
func VerifyWebhookSignature(payload []byte, signature, timestamp, secret string, options ...WebhookOption) bool {
	config := webhookOptions(options)
	timestamp = strings.TrimSpace(timestamp)
	if secret == "" || signature == "" || timestamp == "" || strings.Trim(timestamp, "0123456789") != "" {
		return false
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	// Compare in seconds: converting a huge age to a time.Duration would overflow.
	age := config.now.Unix() - seconds
	if age < 0 {
		age = -age
	}
	if age < 0 || age > int64(config.tolerance/time.Second) {
		return false
	}
	expected := []byte(webhookHMAC(secret, timestamp, payload))
	matched := false
	for _, part := range strings.Split(signature, ",") {
		part = strings.TrimSpace(part)
		if !strings.HasPrefix(part, "v1=") {
			continue
		}
		if hmac.Equal(expected, []byte(strings.ToLower(part[3:]))) {
			matched = true
		}
	}
	return matched
}

// ParseWebhookEvent verifies a delivery with VerifyWebhookSignature and then decodes it.
// It returns a *Error with code sdk/invalid-webhook-signature when verification fails and
// sdk/invalid-webhook-payload when the verified body is not an event.
func ParseWebhookEvent(payload []byte, signature, timestamp, secret string, options ...WebhookOption) (*WebhookEventPayload, error) {
	if secret == "" {
		return nil, invalid(CodeSDKInvalidArgument, "A webhook secret is required")
	}
	if !VerifyWebhookSignature(payload, signature, timestamp, secret, options...) {
		return nil, invalid(CodeSDKInvalidWebhookSignature, "Webhook signature or timestamp is invalid")
	}
	var event WebhookEventPayload
	if err := decodeJSON(payload, &event); err != nil {
		return nil, &Error{Code: CodeSDKInvalidWebhookPayload, Message: "Webhook body is not valid JSON", Cause: err}
	}
	if event.ID == "" || event.Type == "" {
		return nil, invalid(CodeSDKInvalidWebhookPayload, "Webhook body is not a CalmLens event")
	}
	return &event, nil
}

// VerifyWebhookRequest reads r.Body (up to WithMaxBodyBytes, default 1 MiB), verifies it
// with the signature and timestamp headers and returns the decoded event. Call it before
// anything else reads the body. Afterwards r.Body is replaced with the raw bytes so later
// handlers can read them again.
func VerifyWebhookRequest(r *http.Request, secret string, options ...WebhookOption) (*WebhookEventPayload, error) {
	config := webhookOptions(options)
	if r.Body == nil {
		return nil, invalid(CodeSDKInvalidWebhookPayload, "Webhook request has no body")
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, config.maxBodyBytes+1))
	r.Body.Close()
	if err != nil {
		return nil, transportError(err)
	}
	if int64(len(raw)) > config.maxBodyBytes {
		return nil, invalid(CodeSDKInvalidWebhookPayload, "Webhook body is too large")
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	return ParseWebhookEvent(raw, r.Header.Get(WebhookSignatureHeader), r.Header.Get(WebhookTimestampHeader), secret, options...)
}
