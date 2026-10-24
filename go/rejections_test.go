package calmlens

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
)

// Typed options that cannot hold the fixture's value: Go's type already refuses the request.
var rejectedByType = map[string]string{
	"signed URL lifetime of a fraction of a second": "SignedURLOptions.ExpiresInSeconds is an int",
}

// TestRejections replays testdata/rejections.json (packages/sdk-contract/surface.ts): requests the
// API would reject fail with the recorded code before anything is sent.
func TestRejections(t *testing.T) {
	data, err := os.ReadFile("testdata/rejections.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name      string
		Operation string
		Options   json.RawMessage
		Error     string
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	strict := func(raw json.RawMessage, out any) error {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		return decoder.Decode(out)
	}
	for _, rejection := range cases {
		t.Run(rejection.Name, func(t *testing.T) {
			c, h := setup(t)
			ctx := context.Background()
			var decodeErr, err error
			switch rejection.Operation {
			case "assets.createSignedUrl":
				var fixture struct {
					AssetID          string          `json:"assetId"`
					Resource         string          `json:"resource"`
					Lens             string          `json:"lens"`
					Transform        json.RawMessage `json:"transform"`
					ExpiresInSeconds int             `json:"expiresInSeconds"`
				}
				if decodeErr = strict(rejection.Options, &fixture); decodeErr == nil {
					options := SignedURLOptions{AssetID: fixture.AssetID, Resource: fixture.Resource, Lens: fixture.Lens, ExpiresInSeconds: fixture.ExpiresInSeconds}
					options.Transform, options.TransformSteps = contractTransform(t, fixture.Transform)
					_, err = c.Assets.CreateSignedURL(ctx, options)
				}
			case "cdn.serve":
				var fixture struct {
					AssetIdentifier    string          `json:"assetIdentifier"`
					Resource           string          `json:"resource"`
					Lens               string          `json:"lens"`
					Transform          json.RawMessage `json:"transform"`
					AllowAgeRestricted bool            `json:"allowAgeRestricted"`
				}
				if decodeErr = strict(rejection.Options, &fixture); decodeErr == nil {
					options := CDNServeOptions{CDNAssetURLOptions: CDNAssetURLOptions{AssetIdentifier: fixture.AssetIdentifier, Resource: fixture.Resource, Lens: fixture.Lens, AllowAgeRestricted: fixture.AllowAgeRestricted}}
					options.Transform, options.TransformSteps = contractTransform(t, fixture.Transform)
					_, err = c.CDN.Serve(ctx, options)
				}
			case "text.classify":
				_, err = c.Text.Classify(ctx, decodeOptions[ClassifyTextOptions](t, rejection.Options))
			case "assets.retrieve":
				_, err = c.Assets.Retrieve(ctx, decodeOptions[AssetIDOptions](t, rejection.Options))
			case "assets.waitForDecision":
				_, err = c.Assets.WaitForDecision(ctx, decodeOptions[WaitForDecisionOptions](t, rejection.Options))
			case "assets.delete":
				err = c.Assets.Delete(ctx, decodeOptions[AssetIDOptions](t, rejection.Options))
			case "folders.retrieve":
				_, err = c.Folders.Retrieve(ctx, decodeOptions[FolderIDOptions](t, rejection.Options))
			default:
				t.Fatal("unhandled operation", rejection.Operation)
			}
			if reason, typed := rejectedByType[rejection.Name]; typed {
				if decodeErr == nil {
					t.Fatalf("%s, yet the options decoded", reason)
				}
				t.Skip(reason)
			}
			if decodeErr != nil {
				t.Fatal(decodeErr)
			}
			got := fmt.Sprint(err)
			var e *Error
			if errors.As(err, &e) {
				got = e.Code
			}
			if got != rejection.Error || len(h.calls) != 0 {
				t.Fatalf("got %q after %d requests; want %q before any request", got, len(h.calls), rejection.Error)
			}
		})
	}
}
