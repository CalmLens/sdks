package calmlens

// Replays the shared SDK contract fixtures that packages/sdk-contract/generate.ts writes to
// testdata (format in packages/sdk-contract/README.md) and that need no HTTP transport:
// transform options, webhooks, rejections and upload tokens. contract_client_test.go replays the
// fixtures that drive the client; the mock scenarios and the SDK surface need calmlenstest, so
// calmlenstest/contract_test.go replays them. Each fixture is replayed in one of these files,
// read through internal/fixtures, and each fixture case is its own subtest.

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"calmlens.com/go/calmlens/internal/fixtures"
)

// Every transform option, decoded into ImageTransformOptions and serialized, gives the selector
// the CDN writes for it: an option missing from the type, or encoded differently, fails here. The
// option names and colour keys match the CDN's.
func TestTransformOptionsContract(t *testing.T) {
	fixture := fixtures.Read[struct {
		Options    []string
		ColourKeys []string
		Cases      []struct {
			Options  json.RawMessage
			Selector string
		}
		Invalid []struct {
			Options     json.RawMessage
			UnknownKeys []string
			InvalidKeys []string
		}
	}](t, "transform-options.json")
	for _, c := range fixture.Cases {
		t.Run(c.Selector, func(t *testing.T) {
			var options ImageTransformOptions
			decoder := json.NewDecoder(bytes.NewReader(c.Options))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&options); err != nil {
				t.Fatalf("%s: %v", c.Options, err)
			}
			selector, err := serializeTransform(options)
			if err != nil {
				t.Fatalf("%s: %v", c.Options, err)
			}
			if selector != c.Selector {
				t.Errorf("%s: got %q, want %q", c.Options, selector, c.Selector)
			}
		})
	}
	// Options the CDN would refuse are refused before a URL is built, naming every refused key:
	// as plain JSON (TransformOptions takes any value that encodes as an object), and as
	// ImageTransformOptions where the type can hold them.
	for _, c := range fixture.Invalid {
		keys := append(append([]string{}, c.UnknownKeys...), c.InvalidKeys...)
		var compact bytes.Buffer
		if err := json.Compact(&compact, c.Options); err != nil {
			t.Fatal(err)
		}
		c.Options = compact.Bytes()
		t.Run("refuses "+string(c.Options), func(t *testing.T) {
			var options JSON
			if err := json.Unmarshal(c.Options, &options); err != nil {
				t.Fatal(err)
			}
			checkTransformRefused(t, options, c.UnknownKeys, c.InvalidKeys)
		})
		t.Run("refuses typed "+string(c.Options), func(t *testing.T) {
			var options ImageTransformOptions
			decoder := json.NewDecoder(bytes.NewReader(c.Options))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&options); err != nil {
				t.Skipf("ImageTransformOptions can't hold %s: %v", c.Options, err)
			}
			// Some nested types decode leniently: they drop a key they don't have.
			encoded, err := json.Marshal(options)
			if err != nil {
				t.Fatal(err)
			}
			var kept map[string]any
			if err = json.Unmarshal(encoded, &kept); err != nil {
				t.Fatal(err)
			}
			for _, key := range keys {
				if !hasDottedKey(kept, key) {
					t.Skipf("ImageTransformOptions doesn't keep %s of %s", key, c.Options)
				}
			}
			checkTransformRefused(t, options, c.UnknownKeys, c.InvalidKeys)
		})
	}
	t.Run("options", func(t *testing.T) {
		var names []string
		typ := reflect.TypeOf(ImageTransformOptions{})
		for i := 0; i < typ.NumField(); i++ {
			name, _, _ := strings.Cut(typ.Field(i).Tag.Get("json"), ",")
			names = append(names, name)
		}
		want := append([]string(nil), fixture.Options...)
		sort.Strings(names)
		sort.Strings(want)
		if !reflect.DeepEqual(names, want) {
			t.Fatalf("ImageTransformOptions has %v, want %v", names, want)
		}
	})
	t.Run("colourKeys", func(t *testing.T) {
		var keys []string
		for key := range transformColourKeys {
			keys = append(keys, key)
		}
		want := append([]string(nil), fixture.ColourKeys...)
		sort.Strings(keys)
		sort.Strings(want)
		if !reflect.DeepEqual(keys, want) {
			t.Fatalf("colour keys %v, want %v", keys, want)
		}
	})
}

// checkTransformRefused requires GetAssetURL to refuse options with sdk/invalid-argument, naming
// the unknown and invalid keys in its message and details.
func checkTransformRefused(t *testing.T, options any, unknownKeys, invalidKeys []string) {
	t.Helper()
	client, err := NewServerClient(Options{APIKey: "key", ProjectID: "project-1"})
	if err != nil {
		t.Fatal(err)
	}
	endpoint, err := client.CDN.GetAssetURL(CDNAssetURLOptions{AssetID: "asset-1", Resource: ResourceRendered, TransformOptions: options})
	var refused *Error
	if !errors.As(err, &refused) || refused.Code != CodeSDKInvalidArgument {
		t.Fatalf("got %q, %v; want %s", endpoint, err, CodeSDKInvalidArgument)
	}
	want := JSON{"unknownKeys": toAny(unknownKeys), "invalidKeys": toAny(invalidKeys)}
	got, _ := json.Marshal(refused.Details)
	var details JSON
	_ = json.Unmarshal(got, &details)
	if !reflect.DeepEqual(details, want) {
		t.Fatalf("details %v, want %v", details, want)
	}
	for _, key := range append(append([]string{}, unknownKeys...), invalidKeys...) {
		if !strings.Contains(refused.Message, key) {
			t.Errorf("message %q doesn't name %s", refused.Message, key)
		}
	}
}

func toAny(values []string) []any {
	out := []any{}
	for _, value := range values {
		out = append(out, value)
	}
	return out
}

// hasDottedKey reports whether object holds a value at a dotted path such as border.colour.
func hasDottedKey(object map[string]any, key string) bool {
	var value any = object
	for _, part := range strings.Split(key, ".") {
		parent, ok := value.(map[string]any)
		if !ok {
			return false
		}
		if value, ok = parent[part]; !ok {
			return false
		}
	}
	return true
}

// ---- upload-mime-types.json -----------------------------------------------------------------

// Every type the API refuses is refused before anything is sent, with the API's code and the
// type in its details. The mock scenarios store the accepted types.
func TestUploadMimeTypesContract(t *testing.T) {
	fixture := fixtures.Read[struct{ Refused []string }](t, "upload-mime-types.json")
	if len(fixture.Refused) == 0 {
		t.Fatal("upload-mime-types.json has no refused types")
	}
	for _, mimeType := range fixture.Refused {
		t.Run(mimeType, func(t *testing.T) {
			transport := &scriptedTransport{}
			c, err := NewServerClient(Options{APIKey: "key", ProjectID: "project-1", MaxRetries: Ptr(0), HTTPClient: &http.Client{Transport: transport}})
			if err != nil {
				t.Fatal(err)
			}
			_, err = c.Assets.Create(context.Background(), SubmitAssetOptions{Name: "x", Content: &Content{Type: mimeType, Base64: Ptr("aGVsbG8=")}})
			var refused *Error
			if !errors.As(err, &refused) || refused.Code != CodeUnsupportedUploadType || refused.Details["mimeType"] != mimeType || refused.Details["source"] != "calmlens" || len(transport.received) != 0 {
				t.Fatalf("got %v (details %v) after %d requests; want %s before any request", err, refusedDetails(refused), len(transport.received), CodeUnsupportedUploadType)
			}
		})
	}
}

func refusedDetails(err *Error) JSON {
	if err == nil {
		return nil
	}
	return err.Details
}

// ---- webhooks.json --------------------------------------------------------------------------

type signedDelivery struct {
	Name, Body, Secret, Timestamp, Signature string
	Now                                      int64
}

func TestWebhookContract(t *testing.T) {
	fixtures := fixtures.Read[struct {
		Parsing []struct {
			signedDelivery
			ExpectedType, ExpectedFactKey string
		}
		Signatures []struct {
			Secret, Timestamp, Body, Signature string
		}
		Verification []struct {
			signedDelivery
			ToleranceSeconds *int64
			Valid            bool
		}
		Payloads []struct {
			Event   json.RawMessage
			Payload any
		}
		HeaderCases []struct {
			Name    string
			Headers map[string]json.RawMessage
			Body    string
			Secret  string
			Now     int64
			Valid   bool
		}
		ParseErrors []struct {
			signedDelivery
			Error string
		}
		Parsed []struct {
			signedDelivery
			Expected any
			IsTest   bool
		}
		TestFacts []struct {
			Name   string
			Event  json.RawMessage
			IsTest bool
		}
		AssetSequences []struct {
			Name         string
			Event        json.RawMessage
			LastSequence *int64
			Newer        bool
		}
		RoundTrips []struct {
			Name             string
			Event            json.RawMessage
			Payload          any
			Body             string
			Secret           string
			DeliveryID       string
			TimestampSeconds int64
			Headers          map[string]string
			IsTest           bool
		}
		FactLookups []struct {
			Name  string
			Event json.RawMessage
			Key   string
			Value any
		}
		FactObjects []struct {
			Name  string
			Event json.RawMessage
			Facts map[string]any
		}
	}](t, "webhooks.json")
	at := func(now int64) WebhookOption { return WithNow(time.Unix(now, 0)) }
	for _, f := range fixtures.Parsing {
		t.Run("parses "+f.ExpectedType+" with "+f.ExpectedFactKey, func(t *testing.T) {
			event, err := ParseWebhookEvent([]byte(f.Body), f.Signature, f.Timestamp, f.Secret, at(f.Now))
			if err != nil {
				t.Fatal(err)
			}
			if string(event.Type) != f.ExpectedType || len(event.Facts) == 0 || string(event.Facts[0].Key) != f.ExpectedFactKey || !reflect.DeepEqual(plain(t, event.RawJSON()), plainJSON(t, f.Body)) {
				t.Fatal(event)
			}
		})
	}
	for _, fixture := range fixtures.Signatures {
		t.Run("signs at "+fixture.Timestamp, func(t *testing.T) {
			var timestamp int64
			if err := json.Unmarshal([]byte(fixture.Timestamp), &timestamp); err != nil {
				t.Fatal(err)
			}
			if got := SignWebhookPayload([]byte(fixture.Body), timestamp, fixture.Secret); got != fixture.Signature {
				t.Errorf("signature %s, want %s", got, fixture.Signature)
			}
		})
	}
	for _, fixture := range fixtures.Verification {
		t.Run("verification: "+fixture.Name, func(t *testing.T) {
			options := []WebhookOption{at(fixture.Now)}
			if fixture.ToleranceSeconds != nil {
				options = append(options, WithTolerance(time.Duration(*fixture.ToleranceSeconds)*time.Second))
			}
			if got := VerifyWebhookSignature([]byte(fixture.Body), fixture.Signature, fixture.Timestamp, fixture.Secret, options...); got != fixture.Valid {
				t.Errorf("got %v, want %v", got, fixture.Valid)
			}
		})
	}
	for _, fixture := range fixtures.Payloads {
		t.Run("payload of "+payloadName(fixture.Event), func(t *testing.T) {
			var event Event
			if err := json.Unmarshal(fixture.Event, &event); err != nil {
				t.Fatal(err)
			}
			if got := plain(t, ToWebhookEventPayload(event).RawJSON()); !reflect.DeepEqual(got, fixture.Payload) {
				t.Errorf("payload %v, want %v", got, fixture.Payload)
			}
		})
	}
	for _, fixture := range fixtures.HeaderCases {
		// The containers a Go receiver gets: an http.Header built with Add (canonical names) and
		// one keyed by the names as sent.
		canonical, asSent := http.Header{}, http.Header{}
		for name, raw := range fixture.Headers {
			var values []string
			if raw[0] == '[' {
				_ = json.Unmarshal(raw, &values)
			} else {
				var value string
				_ = json.Unmarshal(raw, &value)
				values = []string{value}
			}
			for _, value := range values {
				canonical.Add(name, value)
			}
			asSent[name] = values
		}
		for container, header := range map[string]http.Header{"canonical http.Header": canonical, "http.Header as sent": asSent} {
			t.Run(fmt.Sprintf("headers: %s (%s)", fixture.Name, container), func(t *testing.T) {
				if got := VerifyWebhookHeaders([]byte(fixture.Body), header, fixture.Secret, at(fixture.Now)); got != fixture.Valid {
					t.Fatalf("VerifyWebhookHeaders = %v, want %v", got, fixture.Valid)
				}
				request, _ := http.NewRequest(http.MethodPost, "https://example.test/webhook", strings.NewReader(fixture.Body))
				request.Header = header
				_, err := VerifyWebhookRequest(request, fixture.Secret, at(fixture.Now))
				if refused := CodeOf(err) == CodeSDKInvalidWebhookSignature; refused == fixture.Valid {
					t.Fatalf("VerifyWebhookRequest: %v, want valid %v", err, fixture.Valid)
				}
			})
		}
	}
	for _, fixture := range fixtures.ParseErrors {
		t.Run("parse error: "+fixture.Name, func(t *testing.T) {
			_, err := ParseWebhookEvent([]byte(fixture.Body), fixture.Signature, fixture.Timestamp, fixture.Secret, at(fixture.Now))
			if string(CodeOf(err)) != fixture.Error {
				t.Fatalf("got %v, want %s", err, fixture.Error)
			}
		})
	}
	for _, fixture := range fixtures.Parsed {
		t.Run("parses "+fixture.Name, func(t *testing.T) {
			event, err := ParseWebhookEvent([]byte(fixture.Body), fixture.Signature, fixture.Timestamp, fixture.Secret, at(fixture.Now))
			if err != nil {
				t.Fatal(err)
			}
			if got := plain(t, event.RawJSON()); !reflect.DeepEqual(got, fixture.Expected) {
				t.Fatalf("parsed %v, want %v", got, fixture.Expected)
			}
			expected := fixture.Expected.(map[string]any)
			if event.ID != expected["id"] || string(event.Type) != expected["type"] || event.ProjectID != expected["projectId"] || float64(event.CreatedAt) != expected["createdAt"] {
				t.Fatalf("typed fields %+v", event)
			}
			if event.Facts.IsTest() != fixture.IsTest {
				t.Fatalf("IsTest = %v", !fixture.IsTest)
			}
		})
	}
	for _, fixture := range fixtures.TestFacts {
		t.Run("test fact: "+fixture.Name, func(t *testing.T) {
			var event Event
			if err := decodeJSON(fixture.Event, &event); err != nil {
				t.Fatal(err)
			}
			if event.Facts.IsTest() != fixture.IsTest {
				t.Fatalf("IsTest = %v, want %v", !fixture.IsTest, fixture.IsTest)
			}
		})
	}
	for _, fixture := range fixtures.AssetSequences {
		t.Run("asset sequence: "+fixture.Name, func(t *testing.T) {
			var event Event
			if err := decodeJSON(fixture.Event, &event); err != nil {
				t.Fatal(err)
			}
			// Sequences start at 1, so 0 is "nothing applied yet".
			var last int64
			if fixture.LastSequence != nil {
				last = *fixture.LastSequence
			}
			if got := IsNewerAssetEvent(&event, last); got != fixture.Newer {
				t.Fatalf("IsNewerAssetEvent = %v, want %v", got, fixture.Newer)
			}
		})
	}
	for _, fixture := range fixtures.FactLookups {
		t.Run("reads "+fixture.Name+" with GetEventFact", func(t *testing.T) {
			var event Event
			if err := decodeJSON(fixture.Event, &event); err != nil {
				t.Fatal(err)
			}
			if got := plain(t, GetEventFact(&event, EventFactKey(fixture.Key))); !reflect.DeepEqual(got, fixture.Value) {
				t.Fatalf("GetEventFact(%q) = %#v, want %#v", fixture.Key, got, fixture.Value)
			}
		})
	}
	for _, fixture := range fixtures.FactObjects {
		t.Run("reads "+fixture.Name+" with GetEventFacts", func(t *testing.T) {
			var event Event
			if err := decodeJSON(fixture.Event, &event); err != nil {
				t.Fatal(err)
			}
			if got := plain(t, GetEventFacts(&event)); !reflect.DeepEqual(got, plain(t, fixture.Facts)) {
				t.Fatalf("GetEventFacts = %#v, want %#v", got, fixture.Facts)
			}
		})
	}
	for _, fixture := range fixtures.RoundTrips {
		t.Run("round trip: "+fixture.Name, func(t *testing.T) {
			var event Event
			if err := decodeJSON(fixture.Event, &event); err != nil {
				t.Fatal(err)
			}
			payload := ToWebhookEventPayload(event)
			if got := plain(t, payload.RawJSON()); !reflect.DeepEqual(got, fixture.Payload) {
				t.Fatalf("payload %v, want %v", got, fixture.Payload)
			}
			if !reflect.DeepEqual(plainJSON(t, fixture.Body), fixture.Payload) {
				t.Fatal("the body is not the payload")
			}
			header := CreateWebhookHeaders([]byte(fixture.Body), fixture.DeliveryID, fixture.TimestampSeconds, fixture.Secret)
			got := map[string]string{}
			for name := range header {
				got[strings.ToLower(name)] = header.Get(name)
			}
			if !reflect.DeepEqual(got, fixture.Headers) {
				t.Fatalf("headers %v, want %v", got, fixture.Headers)
			}
			request, _ := http.NewRequest(http.MethodPost, "https://example.test/webhook", strings.NewReader(fixture.Body))
			request.Header = header
			received, err := VerifyWebhookRequest(request, fixture.Secret, at(fixture.TimestampSeconds))
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(plain(t, received.RawJSON()), fixture.Payload) || received.Facts.IsTest() != fixture.IsTest {
				t.Fatalf("received %v (test %v)", received.RawJSON(), received.Facts.IsTest())
			}
			// The body stays readable for later handlers.
			if body, _ := io.ReadAll(request.Body); string(body) != fixture.Body {
				t.Fatalf("body after verifying %q", body)
			}
		})
	}
}

func plainJSON(t *testing.T, text string) any {
	t.Helper()
	var out any
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// payloadName names a payload fixture by its event's type and ID.
func payloadName(raw json.RawMessage) string {
	var event struct{ ID, Type string }
	_ = json.Unmarshal(raw, &event)
	return event.Type + " " + event.ID
}

// ---- rejections.json ------------------------------------------------------------------------

// Typed options that cannot hold the fixture's value: Go's type already refuses the request.
var rejectedByType = map[string]string{
	"signed URL lifetime of a fraction of a second": "SignAssetURLOptions.ExpiresIn is an int",
}

// Values Go's typed options give another meaning: ExpiresIn of 0 is the default lifetime, so the
// request carries a valid value for the API to accept.
var meansDefault = map[string]string{
	"signed URL lifetime below 1 second": "SignAssetURLOptions.ExpiresIn of 0 means DefaultSignedURLExpiresIn",
}

// TestRejections replays testdata/rejections.json (packages/sdk-contract/surface.ts): requests the
// API would reject fail with the recorded code before anything is sent.
func TestRejections(t *testing.T) {
	cases := fixtures.Read[[]struct {
		Name      string
		Operation string
		Options   json.RawMessage
		Error     string
		Kind      string
	}](t, "rejections.json")
	for _, rejection := range cases {
		t.Run(rejection.Name, func(t *testing.T) {
			args := decodeArgs(t, rejection.Options)
			if reason, typed := rejectedByType[rejection.Name]; typed {
				var options SignAssetURLOptions
				if json.Unmarshal(rejection.Options, &options) == nil {
					t.Fatalf("%s, yet the options decoded", reason)
				}
				t.Skip(reason)
			}
			if reason, ok := meansDefault[rejection.Name]; ok {
				if expiresIn, _ := args["expiresIn"].(float64); expiresIn != 0 {
					t.Fatalf("%s, yet expiresIn is %v", reason, args["expiresIn"])
				}
				t.Skip(reason)
			}
			transport := &scriptedTransport{}
			c, err := NewServerClient(Options{APIKey: "key", ProjectID: "project-1", MaxRetries: Ptr(0), HTTPClient: &http.Client{Transport: transport}})
			if err != nil {
				t.Fatal(err)
			}
			_, err = invoke(t, context.Background(), c, rejection.Operation, args)
			if got := string(CodeOf(err)); got != rejection.Error || len(transport.received) != 0 {
				t.Fatalf("got %q (%v) after %d requests; want %q before any request", got, err, len(transport.received), rejection.Error)
			}
			checkErrorKind(t, rejection.Name, err, rejection.Kind)
			var failure *Error
			if !errors.As(err, &failure) || !failure.Local() || !IsLocal(err) || failure.Status != 0 || failure.RequestID != "" {
				t.Fatalf("got %#v; want a local error without a status or request ID", err)
			}
		})
	}
}

// TestRetryableAndLocalFollowTheCodeAndStatus replays surface.json's retryable table: whether an
// error is retryable, and whether the SDK raised it locally, follow from its code and status alone.
func TestRetryableAndLocalFollowTheCodeAndStatus(t *testing.T) {
	surface := fixtures.Read[struct {
		Retryable []struct {
			Code      string
			Status    *int
			Retryable bool
			Local     bool
		}
	}](t, "surface.json")
	for _, entry := range surface.Retryable {
		failure := &Error{Code: ErrorCode(entry.Code)}
		if entry.Status != nil {
			failure.Status = *entry.Status
		}
		if failure.Retryable() != entry.Retryable || failure.Local() != entry.Local {
			t.Errorf("%s %v: retryable %v, local %v; want %v, %v", entry.Code, entry.Status, failure.Retryable(), failure.Local(), entry.Retryable, entry.Local)
		}
	}
}

// ---- upload-tokens.json ---------------------------------------------------------------------

type tokenOptions struct {
	UploadPresetID string   `json:"uploadPresetId"`
	ExternalID     *string  `json:"externalId"`
	ExpiresIn      *float64 `json:"expiresIn"`
}

// typed converts fixture token options. reason names a lifetime Go's int field cannot express:
// a fraction, or 0, which means the default lifetime.
func (o tokenOptions) typed() (options SignUploadTokenOptions, reason string) {
	options = SignUploadTokenOptions{UploadPresetID: o.UploadPresetID, ExternalID: o.ExternalID}
	if o.ExpiresIn != nil {
		switch seconds := *o.ExpiresIn; {
		case seconds != float64(int(seconds)):
			return options, "SignUploadTokenOptions.ExpiresIn is an int, which cannot hold a fraction"
		case seconds == 0:
			return options, "SignUploadTokenOptions.ExpiresIn zero means the default lifetime"
		}
		options.ExpiresIn = int(*o.ExpiresIn)
	}
	return options, ""
}

func TestUploadTokenContract(t *testing.T) {
	fixture := fixtures.Read[struct {
		Prefix                  string
		SigningContext          string
		DefaultExpiresInSeconds int
		MaxExpiresInSeconds     int
		Signing                 []struct {
			Name     string
			APIKey   string `json:"apiKey"`
			Options  tokenOptions
			Now      int64
			Nonce    string
			Expected struct {
				Token         string
				ExpiresAt     int64
				Claims        map[string]any
				SigningSecret string
			}
		}
		Rejections []struct {
			Name    string
			APIKey  string `json:"apiKey"`
			Options tokenOptions
			Error   string
		}
		Verification []struct{ Name string }
	}](t, "upload-tokens.json")
	if fixture.Prefix != uploadTokenPrefix || fixture.SigningContext != uploadTokenSigningContext || fixture.DefaultExpiresInSeconds != uploadTokenDefaultTTLSeconds || fixture.MaxExpiresInSeconds != uploadTokenMaxTTLSeconds {
		t.Fatalf("token constants differ: %+v", fixture)
	}
	for _, c := range fixture.Signing {
		options, reason := c.Options.typed()
		if reason != "" {
			t.Fatalf("%s: %s", c.Name, reason)
		}
		t.Run("signs exactly: "+c.Name, func(t *testing.T) {
			signed, err := signUploadToken(c.APIKey, options, time.UnixMilli(c.Now), c.Nonce)
			if err != nil {
				t.Fatal(err)
			}
			if signed.Token != c.Expected.Token || signed.ExpiresAt != c.Expected.ExpiresAt {
				t.Fatalf("got %+v, want %s expiring %d", signed, c.Expected.Token, c.Expected.ExpiresAt)
			}
		})
		t.Run("signs with the clock and a fresh nonce: "+c.Name, func(t *testing.T) {
			client, err := NewServerClient(Options{APIKey: c.APIKey, ProjectID: "project-1"})
			if err != nil {
				t.Fatal(err)
			}
			before := time.Now().UnixMilli()
			signed, err := client.UploadTokens.Sign(context.Background(), options)
			if err != nil {
				t.Fatal(err)
			}
			after := time.Now().UnixMilli()
			body, signature, _ := strings.Cut(strings.TrimPrefix(signed.Token, uploadTokenPrefix), ".")
			data, err := base64.RawURLEncoding.DecodeString(body)
			if err != nil {
				t.Fatal(err)
			}
			var claims map[string]any
			if err = json.Unmarshal(data, &claims); err != nil {
				t.Fatal(err)
			}
			lifetime := c.Expected.ExpiresAt - c.Now
			nonce, _ := claims["n"].(string)
			want := clone(c.Expected.Claims)
			want["n"], want["e"] = nonce, float64(signed.ExpiresAt)
			if !reflect.DeepEqual(claims, want) || nonce == c.Nonce || !uuidV4.MatchString(nonce) || signed.ExpiresAt < before+lifetime || signed.ExpiresAt > after+lifetime {
				t.Fatalf("claims %v expiring %d, want %v", claims, signed.ExpiresAt, c.Expected.Claims)
			}
			mac := hmac.New(sha256.New, []byte(c.Expected.SigningSecret))
			mac.Write([]byte(uploadTokenSigningContext + body))
			if hex.EncodeToString(mac.Sum(nil)) != signature {
				t.Fatal("the signature does not verify with the key's hash")
			}
		})
	}
	for _, c := range fixture.Rejections {
		t.Run("refuses "+c.Name, func(t *testing.T) {
			options, reason := c.Options.typed()
			if reason != "" {
				if options.ExpiresIn != 0 {
					t.Fatalf("%s, yet the lifetime is %d", reason, options.ExpiresIn)
				}
				t.Skip(reason)
			}
			client, err := NewServerClient(Options{APIKey: c.APIKey, ProjectID: "project-1"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = client.UploadTokens.Sign(context.Background(), options); string(CodeOf(err)) != c.Error {
				t.Fatalf("Sign: %v, want %s", err, c.Error)
			}
			if _, err = signUploadToken(c.APIKey, options, time.UnixMilli(0), "n"); string(CodeOf(err)) != c.Error {
				t.Fatalf("signing at a fixed time: %v, want %s", err, c.Error)
			}
		})
	}
	for _, c := range fixture.Verification {
		t.Run("verification: "+c.Name, func(t *testing.T) {
			t.Skip("the Go SDK signs tokens but does not decode or verify them; the server's rules apply")
		})
	}
}
