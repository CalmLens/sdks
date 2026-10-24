package calmlens

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

// testdata/webhooks.json is generated from the JavaScript SDK by packages/sdk-contract/generate.ts.
type webhookSignatureFixture struct {
	Secret, Timestamp, Body, Signature string
}
type webhookVerificationFixture struct {
	Name, Secret, Timestamp, Body, Signature string
	Now, ToleranceSeconds                    int64
	Valid                                    bool
}
type webhookPayloadFixture struct {
	Event   json.RawMessage
	Payload any
}
type webhookFixtures struct {
	Parsing []struct {
		Body, Signature, Timestamp, Secret, ExpectedType, ExpectedFactKey string
		Now                                                               int64
	}
	Signatures   []webhookSignatureFixture
	Verification []webhookVerificationFixture
	Payloads     []webhookPayloadFixture
}

func loadWebhookFixtures(t *testing.T) webhookFixtures {
	t.Helper()
	data, err := os.ReadFile("testdata/webhooks.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures webhookFixtures
	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	return fixtures
}

func TestWebhookTestVector(t *testing.T) {
	const want = "v1=9d713ed406bb7076d4123f0dc2c39d2df5c654ed4b0cd56b52c8b4c940bd63ae"
	if got := SignWebhookPayload([]byte("{}"), 1700000000, "key"); got != want {
		t.Fatal(got)
	}
	at := WithNow(time.Unix(1700000000, 0))
	if !VerifyWebhookSignature([]byte("{}"), want, "1700000000", "key", at) {
		t.Fatal("test vector rejected")
	}
	if VerifyWebhookSignature([]byte("{}"), want, "1700000000", "key") {
		t.Fatal("expired test vector accepted with the real clock")
	}
}

func TestWebhookContract(t *testing.T) {
	fixtures := loadWebhookFixtures(t)
	for _, f := range fixtures.Parsing {
		event, err := ParseWebhookEvent([]byte(f.Body), f.Signature, f.Timestamp, f.Secret, WithNow(time.Unix(f.Now, 0)))
		if err != nil {
			t.Fatal(err)
		}
		if event.Type != f.ExpectedType || len(event.Data.Facts) != 1 || event.Data.Facts[0].Key != f.ExpectedFactKey {
			t.Fatal(event)
		}
	}

	for _, fixture := range fixtures.Signatures {
		var timestamp int64
		if err := json.Unmarshal([]byte(fixture.Timestamp), &timestamp); err != nil {
			t.Fatal(err)
		}
		if got := SignWebhookPayload([]byte(fixture.Body), timestamp, fixture.Secret); got != fixture.Signature {
			t.Errorf("signature %s, want %s", got, fixture.Signature)
		}
	}
	for _, fixture := range fixtures.Verification {
		t.Run(fixture.Name, func(t *testing.T) {
			options := []WebhookOption{WithNow(time.Unix(fixture.Now, 0)), WithTolerance(time.Duration(fixture.ToleranceSeconds) * time.Second)}
			if got := VerifyWebhookSignature([]byte(fixture.Body), fixture.Signature, fixture.Timestamp, fixture.Secret, options...); got != fixture.Valid {
				t.Errorf("got %v, want %v", got, fixture.Valid)
			}
		})
	}
	for _, fixture := range fixtures.Payloads {
		var event Event
		if err := json.Unmarshal(fixture.Event, &event); err != nil {
			t.Fatal(err)
		}
		body, err := json.Marshal(ToWebhookEventPayload(event))
		if err != nil {
			t.Fatal(err)
		}
		var got any
		if err = json.Unmarshal(body, &got); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, fixture.Payload) {
			t.Errorf("payload %v, want %v", got, fixture.Payload)
		}
	}
}

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
	body := `{"id": "event-1", "type": "asset.blocked", "createdAt": 1760000000000, "projectId": "p", "data": {"severity": "low", "title": "t", "assetId": "a", "asset": {"id": "a", "externalId": null, "content": {"status": "removed"}, "upload": {"status": "completed"}, "classification": {"status": "completed", "moderation": {"status": "blocked"}}}, "facts": [{"key": "limit", "value": 9007199254740993}, {"key": "test", "value": true}]}}`
	req := signedRequest(t, body, now)
	event, err := VerifyWebhookRequest(req, "secret", WithNow(now))
	if err != nil || event.ID != "event-1" || *event.Data.AssetID != "a" || !event.Data.Facts.IsTest() || event.Data.Asset.Classification.Status != ClassificationStatusCompleted || event.Data.Asset.Classification.Moderation.Status != ModerationStatusBlocked || event.Data.Asset.Content.Status != ContentStatusRemoved || event.Data.Asset.ExternalID != nil {
		t.Fatal(event, err)
	}
	if limit, ok := event.Data.Facts[0].Int64(); !ok || limit != 9007199254740993 {
		t.Fatal("fact lost integer precision", event.Data.Facts[0])
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
	if _, err = ParseWebhookEvent([]byte(body), "", "", "", WithNow(now)); ErrorCode(err) != CodeSDKInvalidArgument {
		t.Fatal("empty secret accepted", err)
	}
}

func TestCreateWebhookHeadersSignADeliveryVerifyWebhookRequestAccepts(t *testing.T) {
	now := time.Unix(1760000000, 0)
	body := `{"id":"event-1","type":"asset.allowed","createdAt":1760000000000,"projectId":"p","data":{"severity":"low","title":"t","facts":[]}}`
	header := CreateWebhookHeaders([]byte(body), "delivery-1", now.Unix(), "secret")
	if header.Get(WebhookDeliveryHeader) != "delivery-1" || header.Get(WebhookTimestampHeader) != "1760000000" || header.Get("Content-Type") != "application/json" {
		t.Fatal(header)
	}
	req := httptest.NewRequest("POST", "/webhooks", strings.NewReader(body))
	req.Header = header
	if event, err := VerifyWebhookRequest(req, "secret", WithNow(now)); err != nil || event.ID != "event-1" {
		t.Fatal(event, err)
	}
	req = httptest.NewRequest("POST", "/webhooks", strings.NewReader(body))
	req.Header = header
	if _, err := VerifyWebhookRequest(req, "other", WithNow(now)); ErrorCode(err) != CodeSDKInvalidWebhookSignature {
		t.Fatal("signed with the wrong secret", err)
	}
}
