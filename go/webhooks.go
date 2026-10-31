package calmlens

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

// webhookEventFields are the fields of the public event shape that events.list returns and
// webhook connectors deliver.
var webhookEventFields = []string{"id", "projectId", "type", "severity", "title", "description", "assetId", "asset", "facts", "createdAt"}

// ToWebhookEventPayload returns the body a webhook connector delivers for an event, such as one
// from Events.List: the event in the same shape. Its Raw holds that body, built from the event's
// Raw (or, for an event built in code, from its typed fields), with Description, AssetID and
// Asset null when absent; fields that are not part of the shape are left out.
func ToWebhookEventPayload(event Event) Event {
	source := event.Raw
	if source == nil {
		if data, err := json.Marshal(event); err == nil {
			_ = decodeJSON(data, &source)
		}
	}
	raw := JSON{}
	for _, key := range webhookEventFields {
		if value, ok := source[key]; ok {
			raw[key] = value
		} else if key == "description" || key == "assetId" || key == "asset" {
			raw[key] = nil
		}
	}
	event.Raw = raw
	return event
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
	toleranceSet bool
	now          time.Time
	maxBodyBytes int64
}

// WithTolerance sets the maximum distance between the delivery timestamp and now, compared
// in whole seconds (default DefaultWebhookTolerance, 5 minutes). Zero accepts only the
// current second; a negative tolerance accepts nothing.
func WithTolerance(tolerance time.Duration) WebhookOption {
	return func(c *webhookConfig) { c.tolerance, c.toleranceSet = tolerance, true }
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
	if !config.toleranceSet {
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
	if age < 0 || config.tolerance < 0 || age > int64(config.tolerance/time.Second) {
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

// VerifyWebhookHeaders is VerifyWebhookSignature with the signature and timestamp read from a
// delivery's headers. Names match in any case, and repeated signature headers are joined into one
// list (so a signature in any of them verifies); a repeated timestamp header does not verify.
func VerifyWebhookHeaders(payload []byte, header http.Header, secret string, options ...WebhookOption) bool {
	return VerifyWebhookSignature(payload, webhookHeader(header, WebhookSignatureHeader), webhookHeader(header, WebhookTimestampHeader), secret, options...)
}

// webhookHeader joins every value of the header name with ",", matching names in any case
// (http.Header keys set without canonicalization included).
func webhookHeader(header http.Header, name string) string {
	var values []string
	for key, list := range header {
		if strings.EqualFold(key, name) {
			values = append(values, list...)
		}
	}
	return strings.Join(values, ",")
}

// ParseWebhookEvent verifies a delivery with VerifyWebhookSignature and then decodes it.
// It returns a *Error with code sdk/invalid-webhook-signature when verification fails and
// sdk/invalid-webhook-payload when the verified body is not an event: a JSON object with string
// id, type and projectId and a numeric createdAt, whose other known fields, when present, have
// the API's types. The body has the shape Events.List returns; unknown fields are kept in Raw.
func ParseWebhookEvent(payload []byte, signature, timestamp, secret string, options ...WebhookOption) (*Event, error) {
	if !VerifyWebhookSignature(payload, signature, timestamp, secret, options...) {
		return nil, invalid(CodeSDKInvalidWebhookSignature, "Webhook signature or timestamp did not verify")
	}
	var raw any
	if err := decodeJSON(payload, &raw); err != nil {
		return nil, &Error{Code: CodeSDKInvalidWebhookPayload, Message: "Webhook body is not JSON", Cause: err}
	}
	object, ok := raw.(map[string]any)
	if !ok || !isWebhookEvent(object) {
		return nil, invalid(CodeSDKInvalidWebhookPayload, "Webhook body is not a CalmLens event")
	}
	var event Event
	if err := decodeJSON(payload, &event); err != nil {
		return nil, &Error{Code: CodeSDKInvalidWebhookPayload, Message: "Webhook body does not match the event type", Cause: err}
	}
	event.Raw = object
	return &event, nil
}

// isWebhookEvent applies the API's rules for a received webhook body.
func isWebhookEvent(value map[string]any) bool {
	isString := func(v any) bool { _, ok := v.(string); return ok }
	_, numeric := value["createdAt"].(json.Number)
	if !isString(value["id"]) || !isString(value["type"]) || !isString(value["projectId"]) || !numeric {
		return false
	}
	optional := func(key string, nullable bool) bool {
		v, present := value[key]
		return !present || nullable && v == nil || isString(v)
	}
	if !optional("severity", false) || !optional("title", false) || !optional("description", true) || !optional("assetId", true) {
		return false
	}
	if asset, present := value["asset"]; present && asset != nil {
		object, ok := asset.(map[string]any)
		if !ok || !isString(object["id"]) {
			return false
		}
	}
	if facts, present := value["facts"]; present {
		list, ok := facts.([]any)
		if !ok {
			return false
		}
		for _, item := range list {
			fact, ok := item.(map[string]any)
			if !ok || !isString(fact["key"]) {
				return false
			}
			if _, hasValue := fact["value"]; !hasValue {
				return false
			}
			if url, hasURL := fact["url"]; hasURL && !isString(url) {
				return false
			}
		}
	}
	return true
}

// VerifyWebhookRequest reads r.Body (up to WithMaxBodyBytes, default 1 MiB), verifies it
// with the signature and timestamp headers (see VerifyWebhookHeaders) and returns the decoded
// event. Call it before anything else reads the body. Afterwards r.Body is replaced with the
// raw bytes so later handlers can read them again.
func VerifyWebhookRequest(r *http.Request, secret string, options ...WebhookOption) (*Event, error) {
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
	return ParseWebhookEvent(raw, webhookHeader(r.Header, WebhookSignatureHeader), webhookHeader(r.Header, WebhookTimestampHeader), secret, options...)
}
