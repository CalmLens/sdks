package calmlens

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestWebhookTimestampFarInTheFutureDoesNotOverflow(t *testing.T) {
	// 18446744074 seconds is 2^64 nanoseconds plus 0.29s: as a time.Duration it wraps to 0.29s.
	body := []byte("{}")
	timestamp := "20146744074"
	signature := SignWebhookPayload(body, 20146744074, "key")
	if VerifyWebhookSignature(body, signature, timestamp, "key", WithNow(time.Unix(1700000000, 0))) {
		t.Fatal("timestamp thousands of years away accepted")
	}
}

func signedRequest(t *testing.T, body string, now time.Time) *http.Request {
	t.Helper()
	req := httptest.NewRequest("POST", "/webhooks", strings.NewReader(body))
	req.Header.Set(WebhookTimestampHeader, strconv.FormatInt(now.Unix(), 10))
	req.Header.Set(WebhookSignatureHeader, SignWebhookPayload([]byte(body), now.Unix(), "secret"))
	return req
}

func TestParseAndVerifyWebhookRequest(t *testing.T) {
	now := time.Unix(1760000000, 0)
	body := `{"id": "event-1", "type": "asset.blocked", "createdAt": 1760000000000, "projectId": "p", "severity": "low", "title": "t", "description": null, "assetId": "a", "asset": {"id": "a", "externalId": null, "content": {"status": "removed"}, "upload": {"status": "completed"}, "classification": {"status": "completed", "moderation": {"status": "blocked"}}}, "facts": [{"key": "limit", "value": 9007199254740993}, {"key": "test", "value": true}]}`
	req := signedRequest(t, body, now)
	event, err := VerifyWebhookRequest(req, "secret", WithNow(now))
	if err != nil || event.ID != "event-1" || *event.AssetID != "a" || !event.Facts.IsTest() || event.Asset.Classification.Status != ClassificationStatusCompleted || event.Asset.Classification.Moderation.Status != ModerationStatusBlocked || event.Asset.Content.Status != ContentStatusRemoved || event.Asset.ExternalID != nil {
		t.Fatal(event, err)
	}
	if limit, ok := event.Facts[0].Int64(); !ok || limit != 9007199254740993 {
		t.Fatal("fact lost integer precision", event.Facts[0])
	}
	if again, _ := io.ReadAll(req.Body); string(again) != body {
		t.Fatal("body not restored for later handlers")
	}
	tampered := signedRequest(t, body, now)
	tampered.Body = io.NopCloser(strings.NewReader(strings.Replace(body, "event-1", "event-2", 1)))
	if _, err = VerifyWebhookRequest(tampered, "secret", WithNow(now)); ErrorCode(err) != CodeSDKInvalidWebhookSignature {
		t.Fatal(err)
	}
	if _, err = VerifyWebhookRequest(signedRequest(t, body, now), "secret", WithNow(now), WithMaxBodyBytes(10)); ErrorCode(err) != CodeSDKInvalidWebhookPayload {
		t.Fatal("oversized body accepted", err)
	}
	notEvent := signedRequest(t, `{"hello":1}`, now)
	if _, err = VerifyWebhookRequest(notEvent, "secret", WithNow(now)); ErrorCode(err) != CodeSDKInvalidWebhookPayload {
		t.Fatal(err)
	}
	if _, err = ParseWebhookEvent([]byte(body), "", "", "", WithNow(now)); ErrorCode(err) != CodeSDKInvalidWebhookSignature {
		t.Fatal("empty secret accepted", err)
	}
}
