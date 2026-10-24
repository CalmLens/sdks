package calmlens

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestAssetTypedFieldsDecode(t *testing.T) {
	var a Asset
	err := json.Unmarshal([]byte(`{
  "id": "a",
  "uploadPresetId": "preset-1",
  "content": {
    "status": "removed",
    "removalReason": "policy",
    "updatedAt": 1760000000600,
    "format": "image/png",
    "extension": "png",
    "sizeInBytes": 2048,
    "checksums": {
      "sha256": "abc",
      "md5": null
    },
    "image": {
      "width": 640,
      "height": 480,
      "thumbhash": "th",
      "averageColor": "#fff",
      "perceptualHash": "ph"
    },
    "safetyHold": {
      "placedAt": 1760000000000,
      "reason": "suspected-illegal-content",
      "disposedAt": null
    },
    "extractedText": {
      "type": "document",
      "id": "doc-1"
    }
  },
  "processingOptions": {
    "keepContentAfterProcessing": true,
    "flaggedContentPolicy": {
      "action": "block"
    },
    "features": {
      "ocr": {
        "enabled": true
      },
      "faceDetection": {
        "enabled": true,
        "ageEstimation": false
      }
    }
  },
  "upload": {
    "status": "completed",
    "updatedAt": 1760000000500,
    "partsReceived": 3
  },
  "classification": {
    "status": "completed",
    "updatedAt": 1760000000500,
    "moderation": {
      "manualReviews": [{"id": "review-1", "decision": "age-restricted", "note": "Fine", "reviewerUserId": "user-1", "reviewedAt": 1760000000700, "appliedToAsset": true}],
      "status": "age-restricted",
      "categories": {
        "sexual": {
          "status": "evaluated",
          "score": 0.9,
          "likelihood": "very-likely",
          "qualifiers": {
            "sexual-nudity": {
              "status": "evaluated",
              "someScore": 0.8,
              "allScore": 0.5,
              "likelihood": "likely"
            },
            "sexual-fictional": {
              "status": "not-evaluated",
              "reason": "not-supported"
            }
          }
        },
        "hate": {
          "status": "not-evaluated",
          "reason": "unavailable"
        }
      },
      "score": 0.9
    },
    "completedAt": 1760000000700,
    "labels": [
      {
        "description": "Beach",
        "score": 0.7,
        "topicalityScore": 0.6,
        "likelihood": "likely",
        "knowledgeBaseId": "/m/0b3yr"
      },
      {
        "description": "Sky",
        "score": 0.5,
        "likelihood": "possible"
      }
    ]
  }
}`), &a)
	if err != nil {
		t.Fatal(err)
	}
	if p := a.Classification; p.Status != ClassificationStatusCompleted || *p.UpdatedAt != 1760000000500 || *a.Upload.PartsReceived != 3 {
		t.Fatalf("processing: %+v", p)
	}
	if m := a.Classification.Moderation; m.Status != ModerationStatusAgeRestricted || m.ManualReviews[0].Decision != ModerationDecisionAgeRestricted ||
		*m.ManualReviews[0].Note != "Fine" || *m.ManualReviews[0].ReviewerUserID != "user-1" || m.ManualReviews[0].ReviewedAt != 1760000000700 || *a.Classification.CompletedAt != 1760000000700 {
		t.Fatalf("moderation: %+v", m)
	}
	content := a.Content
	if content.Status != ContentStatusRemoved || *content.RemovalReason != ContentRemovalReasonPolicy || *content.UpdatedAt != 1760000000600 ||
		*content.Format != "image/png" || *content.Extension != "png" || *content.SizeInBytes != 2048 {
		t.Fatalf("content: %+v", content)
	}
	if *a.UploadPresetID != "preset-1" || *content.Checksums.SHA256 != "abc" || content.Checksums.MD5 != nil {
		t.Fatalf("checksums: %+v", content.Checksums)
	}
	if i := content.Image; *i.PerceptualHash != "ph" || *i.Width != 640 || *i.Height != 480 || *i.Thumbhash != "th" || *i.AverageColor != "#fff" {
		t.Fatalf("image: %+v", i)
	}
	if h := content.SafetyHold; h.PlacedAt != 1760000000000 || h.Reason != SafetyHoldReasonSuspectedIllegalContent || h.DisposedAt != nil {
		t.Fatalf("safety hold: %+v", h)
	}
	if x := content.ExtractedText; x.Type != ExtractedTextDocument || *x.ID != "doc-1" || x.Content != nil {
		t.Fatalf("extracted text: %+v", x)
	}
	o := a.ProcessingOptions
	if !*o.KeepContentAfterProcessing || o.FlaggedContentPolicy.Action != ModerationActionBlock || !o.Features.OCR.Enabled || o.Features.PersonDetection != nil ||
		!o.Features.FaceDetection.Enabled || *o.Features.FaceDetection.AgeEstimation {
		t.Fatalf("processing options: %+v", o)
	}
	report := a.Classification.Moderation
	sexual := report.Categories[CategorySexual]
	nudity, fictional := sexual.Qualifiers[QualifierSexualNudity], sexual.Qualifiers[QualifierSexualFictional]
	if nudity.Status != ResultEvaluated || *nudity.SomeScore != 0.8 || *nudity.AllScore != 0.5 || nudity.Likelihood != LikelihoodLikely {
		t.Fatalf("nudity: %+v", nudity)
	}
	if fictional.Status != ResultNotEvaluated || fictional.Reason != ReasonNotSupported || fictional.SomeScore != nil {
		t.Fatalf("fictional: %+v", fictional)
	}
	if hate := report.Categories[CategoryHate]; hate.Reason != ReasonUnavailable || hate.Score != nil || hate.Qualifiers != nil {
		t.Fatalf("hate: %+v", hate)
	}
	labels := a.Classification.Labels
	if len(labels) != 2 || labels[0].Description != "Beach" || labels[0].Score != 0.7 || *labels[0].TopicalityScore != 0.6 ||
		labels[0].Likelihood != LikelihoodLikely || *labels[0].KnowledgeBaseID != "/m/0b3yr" || labels[1].TopicalityScore != nil || labels[1].KnowledgeBaseID != nil {
		t.Fatalf("labels: %+v", labels)
	}
}

func TestExtractedTextInlineDecode(t *testing.T) {
	var a Asset
	if err := json.Unmarshal([]byte(`{"content":{"extractedText":{"type":"string","content":"hello"}}}`), &a); err != nil {
		t.Fatal(err)
	}
	if x := a.Content.ExtractedText; x.Type != ExtractedTextString || *x.Content != "hello" || x.ID != nil {
		t.Fatalf("%+v", x)
	}
}

func TestProcessingOptionsEncodeOnlySetFields(t *testing.T) {
	c, h := setup(t)
	options := &ProcessingOptions{
		FlaggedContentPolicy: &FlaggedContentPolicy{Action: ModerationActionPurge},
		Features:             &ProcessingFeatures{OCR: &OCRFeatureOptions{Enabled: true}, PersonDetection: &PersonDetectionFeatureOptions{Enabled: false}},
	}
	_, err := c.Assets.Create(context.Background(), SubmitAssetOptions{Name: "n", UploadPresetID: Ptr("preset-1"), ProcessingOptions: options, Content: &Content{Type: "text/plain", PlainText: Ptr("x")}})
	if err != nil {
		t.Fatal(err)
	}
	q := h.last().URL.Query()
	want := `{"flaggedContentPolicy":{"action":"purge"},"features":{"ocr":{"enabled":true},"personDetection":{"enabled":false}}}`
	if q.Get("processingOptions") != want || q.Get("uploadPresetId") != "preset-1" {
		t.Fatalf("got %s and %q", q.Get("processingOptions"), q.Get("uploadPresetId"))
	}
	if _, err = c.Assets.Create(context.Background(), SubmitAssetOptions{Name: "site", URL: "https://example.com", UploadPresetID: Ptr("preset-2"), ProcessingOptions: &ProcessingOptions{KeepContentAfterProcessing: Ptr(true)}}); err != nil {
		t.Fatal(err)
	}
	body := h.body()
	if body["uploadPresetId"] != "preset-2" || !reflect.DeepEqual(body["processingOptions"], map[string]any{"keepContentAfterProcessing": true}) {
		t.Fatalf("URL body %v", body)
	}
}

func TestClassifyTextForwardsUploadPreset(t *testing.T) {
	c, h := setup(t)
	if _, err := c.Text.Classify(context.Background(), ClassifyTextOptions{Text: "hi", UploadPresetID: Ptr("preset-1")}); err != nil {
		t.Fatal(err)
	}
	if got := h.last().URL.Query().Get("uploadPresetId"); got != "preset-1" {
		t.Fatalf("uploadPresetId %q", got)
	}
}

func TestUpdateAssetSendsOnlySetFields(t *testing.T) {
	c, h := setup(t)
	_, err := c.Assets.Update(context.Background(), UpdateAssetOptions{
		AssetID:     "a",
		Name:        Ptr("renamed"),
		Description: Null[string](),
		Tags:        Set([]string{}),
		Metadata:    Set([]MetadataItem{{ID: "k", Value: 1}}),
		Visibility:  Set(VisibilityPublic),
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"description":null,"metadata":[{"id":"k","value":1}],"name":"renamed","tags":[],"visibility":"public"}`
	if got := string(h.bodies[0]); got != want || h.last().Method != "PATCH" || h.last().URL.EscapedPath() != "/v1/assets/a" {
		t.Fatalf("got %s %s %s", h.last().Method, h.last().URL.EscapedPath(), got)
	}
	if _, err = c.Assets.Update(context.Background(), UpdateAssetOptions{AssetID: "a"}); err != nil || string(h.bodies[1]) != "{}" {
		t.Fatalf("empty update sent %s (%v)", h.bodies[1], err)
	}
}

func TestPatchDecodesAbsentNullAndValue(t *testing.T) {
	var options UpdateAssetOptions
	if err := json.Unmarshal([]byte(`{"assetId":"a","externalId":null,"tags":["x"]}`), &options); err != nil {
		t.Fatal(err)
	}
	tags, ok := options.Tags.Value()
	if options.AssetID != "a" || !options.ExternalID.IsNull() || !ok || !reflect.DeepEqual(tags, []string{"x"}) || options.Description.IsSet() || options.Name != nil {
		t.Fatalf("%+v", options)
	}
	if _, ok = options.ExternalID.Value(); ok {
		t.Fatal("a null patch reported a value")
	}
}

func TestImageTransformOptionsSerialize(t *testing.T) {
	cases := []struct {
		options ImageTransformOptions
		want    string
	}{
		{ImageTransformOptions{Format: ImageFormatPNG, Width: Ptr(1024), Fit: ImageFitScaleDown, Gravity: &ImageGravity{Side: "face"}, Trim: &ImageTrim{Border: &ImageTrimBorder{}}},
			"fit=scale-down,format=png,gravity=face,trim=border,width=1024"},
		{ImageTransformOptions{Rotate: Ptr(0), Gravity: &ImageGravity{Mode: "box-center", X: Ptr(0.25), Y: Ptr(0.5)}, Border: &ImageBorder{Color: "#fff", Width: Ptr(2.0)}},
			"border.color=fff,border.width=2,gravity.mode=box-center,gravity.x=0.25,gravity.y=0.5,rotate=0"},
		{ImageTransformOptions{Trim: &ImageTrim{Top: Ptr(10.0), Border: &ImageTrimBorder{}}},
			"trim.border=true,trim.top=10"},
		{ImageTransformOptions{Trim: &ImageTrim{Border: &ImageTrimBorder{Color: "#000", Keep: Ptr(1.0)}}},
			"trim.border.color=000,trim.border.keep=1"},
		{ImageTransformOptions{Dpr: Ptr(1.5), Anim: Ptr(false), Quality: &ImageQuality{Level: ImageQualityLow}},
			"anim=false,dpr=1.5,quality=low"},
		{ImageTransformOptions{Quality: &ImageQuality{Value: 80}, Background: "#FFAA00"},
			"background=ffaa00,quality=80"},
	}
	for _, c := range cases {
		got, err := serializeTransform([]LensTransform{ImageTransform(c.options)})
		if err != nil || got != c.want {
			t.Errorf("got %q (%v), want %q", got, err, c.want)
		}
	}
}

func TestImageTransformOptionsDecode(t *testing.T) {
	var options ImageTransformOptions
	err := json.Unmarshal([]byte(`{"gravity":"left","trim":"border","border":{"color":"red"}}`), &options)
	if err != nil || options.Gravity.Side != "left" || options.Trim.Border == nil || *options.Trim.Border != (ImageTrimBorder{}) || options.Border.Color != "red" {
		t.Fatalf("%+v %v", options, err)
	}
	err = json.Unmarshal([]byte(`{"gravity":{"mode":"remainder","x":0.1},"trim":{"left":4,"border":false}}`), &options)
	if err != nil || options.Gravity.Side != "" || options.Gravity.Mode != "remainder" || *options.Gravity.X != 0.1 || options.Gravity.Y != nil ||
		*options.Trim.Left != 4 || options.Trim.Border != nil {
		t.Fatalf("%+v %v", options, err)
	}
	err = json.Unmarshal([]byte(`{"trim":{"border":{"tolerance":0.3}}}`), &options)
	if err != nil || *options.Trim.Border.Tolerance != 0.3 {
		t.Fatalf("%+v %v", options, err)
	}
}

func TestEnsureLensSendsTypedTransforms(t *testing.T) {
	c, h := setup(t)
	lens := EnsureLensOptions{Identifier: "thumb", Name: "Thumb", Type: LensTypeImage, Active: true, Version: 1,
		Transforms: []LensTransform{ImageTransform(ImageTransformOptions{Format: ImageFormatAVIF, Width: Ptr(128)})}}
	h.result = JSON{"lenses": []JSON{{"id": "l", "identifier": "thumb", "name": "Thumb", "type": "image", "active": true, "version": 1,
		"transforms": []JSON{{"type": "imageTransform", "options": JSON{"format": "avif", "width": 128}}}}}}
	result, err := c.EnsureLens(context.Background(), lens)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"lenses":[{"identifier":"thumb","name":"Thumb","description":null,"type":"image","active":true,"transforms":[{"type":"imageTransform","options":{"format":"avif","width":128}}],"version":1}]}`
	if string(h.bodies[0]) != want {
		t.Fatalf("sent %s", h.bodies[0])
	}
	if result.Transforms[0].Type != TransformTypeImage || result.Transforms[0].Options.(JSON)["format"] != ImageFormatAVIF {
		t.Fatalf("decoded %+v", result.Transforms)
	}
}

func TestEventFactsDecode(t *testing.T) {
	var page EventsPage
	err := json.Unmarshal([]byte(`{
  "events": [
    {
      "id": "e",
      "type": "asset.classified",
      "severity": "high",
      "asset": {
        "id": "a",
        "content": {
          "status": "stored"
        },
        "upload": {
          "status": "completed"
        },
        "classification": {
          "status": "completed",
          "moderation": {
            "status": "blocked"
          }
        }
      },
      "facts": [
        {
          "key": "asset-name",
          "value": "cat.jpg",
          "url": "/assets/a"
        },
        {
          "key": "flagged-categories",
          "value": [
            "sexual",
            "hate"
          ]
        },
        {
          "key": "moderation-status",
          "value": "blocked"
        }
      ]
    },
    {
      "id": "u",
      "type": "usage.limit-reached",
      "severity": "high",
      "facts": [
        {
          "key": "limit",
          "value": 9007199254740993
        },
        {
          "key": "used",
          "value": 10
        },
        {
          "key": "organisation-id",
          "value": "user-1"
        }
      ]
    }
  ],
  "cursor": "c",
  "hasMore": false
}`), &page)
	if err != nil {
		t.Fatal(err)
	}
	flagged := page.Events[0]
	var facts AssetClassifiedFacts
	if err = flagged.Facts.Decode(&facts); err != nil {
		t.Fatal(err)
	}
	if *facts.AssetName != "cat.jpg" || !reflect.DeepEqual(facts.FlaggedCategories, []string{CategorySexual, CategoryHate}) || facts.ModerationStatus != ModerationStatusBlocked || facts.AssetType != nil {
		t.Fatalf("%+v", facts)
	}
	name, ok := flagged.Facts.Get(FactAssetName)
	if text, isText := name.Text(); !ok || !isText || text != "cat.jpg" || *name.URL != "/assets/a" {
		t.Fatalf("%+v", name)
	}
	categories, _ := flagged.Facts.Get(FactFlaggedCategories)
	if list, ok := categories.Strings(); !ok || !reflect.DeepEqual(list, []string{"sexual", "hate"}) {
		t.Fatalf("%+v", categories)
	}
	if asset := flagged.Asset; asset.ID != "a" || asset.Classification.Status != ClassificationStatusCompleted || asset.Classification.Moderation.Status != ModerationStatusBlocked ||
		asset.Content.Status != ContentStatusStored || flagged.Facts.IsTest() {
		t.Fatalf("%+v", flagged)
	}
	var usage UsageLimitReachedFacts
	if err = page.Events[1].Facts.Decode(&usage); err != nil || usage.Limit != 9007199254740993 || usage.Used != 10 || usage.OrganisationID != "user-1" {
		t.Fatalf("%+v %v", usage, err)
	}
	if err = page.Events[1].Facts.Decode(&AssetClassifiedFacts{}); ErrorCode(err) != "" {
		t.Fatalf("unrelated keys are ignored, got %v", err)
	}
	if err = (EventFacts{{Key: FactLimit, Value: "many"}}).Decode(&UsageLimitReachedFacts{}); ErrorCode(err) != CodeSDKInvalidResponse {
		t.Fatalf("mismatched value: %v", err)
	}
}

func TestEventFactsDecodeTeamAndAPIKeyEvents(t *testing.T) {
	var page EventsPage
	err := json.Unmarshal([]byte(`{"events":[
		{"id":"r","type":"api-key.revoked","severity":"low","facts":[{"key":"key-id","value":"key-1"},{"key":"key-name","value":"CI"},{"key":"action","value":"deleted"},{"key":"revoked-by-user-id","value":"user-1"}]},
		{"id":"m","type":"project.member-removed","severity":"low","facts":[{"key":"member-user-id","value":"user-2"},{"key":"role","value":"editor"},{"key":"left","value":true},{"key":"removed-by-user-id","value":null}]},
		{"id":"p","type":"upload-preset.daily-limit-reached","severity":"low","facts":[{"key":"preset-id","value":"p1"},{"key":"preset-name","value":"Avatars"},{"key":"daily-limit","value":500}]}],
		"cursor":"c","hasMore":false}`), &page)
	if err != nil {
		t.Fatal(err)
	}
	if page.Events[0].Type != EventAPIKeyRevoked || page.Events[1].Type != EventProjectMemberRemoved || page.Events[2].Type != EventUploadPresetDailyLimitReached {
		t.Fatalf("types %q %q %q", page.Events[0].Type, page.Events[1].Type, page.Events[2].Type)
	}
	var revoked APIKeyRevokedFacts
	if err = page.Events[0].Facts.Decode(&revoked); err != nil || revoked.Action != "deleted" || *revoked.KeyName != "CI" || *revoked.RevokedByUserID != "user-1" {
		t.Fatalf("revoked %+v %v", revoked, err)
	}
	var removed ProjectMemberRemovedFacts
	if err = page.Events[1].Facts.Decode(&removed); err != nil || !removed.Left || removed.Role != "editor" || removed.RemovedByUserID != nil {
		t.Fatalf("removed %+v %v", removed, err)
	}
	var preset UploadPresetDailyLimitReachedFacts
	if err = page.Events[2].Facts.Decode(&preset); err != nil || preset.DailyLimit != 500 || preset.PresetName != "Avatars" {
		t.Fatalf("preset %+v %v", preset, err)
	}
	if fact, ok := page.Events[0].Facts.Get(FactAction); !ok || fact.Key != "action" {
		t.Fatalf("FactAction %v", fact)
	}
}

func TestEventFactsDecodeAssetDecisions(t *testing.T) {
	var page EventsPage
	err := json.Unmarshal([]byte(`{"events":[
		{"id":"a","type":"asset.blocked","severity":"high","facts":[{"key":"asset-name","value":"cat.jpg"},{"key":"decided-by","value":"automated"},{"key":"flagged-categories","value":["violence"]}]},
		{"id":"r","type":"asset.allowed","severity":"low","facts":[{"key":"decided-by","value":"reviewer"},{"key":"reviewer-user-id","value":"user-1"},{"key":"note","value":"Fine"}]}],
		"cursor":"c","hasMore":false}`), &page)
	if err != nil {
		t.Fatal(err)
	}
	var automated AssetDecisionFacts
	if err = page.Events[0].Facts.Decode(&automated); err != nil || automated.DecidedBy != DecidedByAutomated || !reflect.DeepEqual(automated.FlaggedCategories, []string{CategoryViolence}) || automated.ReviewerUserID != nil || automated.Note != nil {
		t.Fatalf("automated %+v %v", automated, err)
	}
	var reviewed AssetDecisionFacts
	if err = page.Events[1].Facts.Decode(&reviewed); err != nil || reviewed.DecidedBy != DecidedByReviewer || reviewed.FlaggedCategories != nil || *reviewed.ReviewerUserID != "user-1" || *reviewed.Note != "Fine" {
		t.Fatalf("reviewed %+v %v", reviewed, err)
	}
	if fact, ok := page.Events[1].Facts.Get(FactDecidedBy); !ok || fact.Value != DecidedByReviewer {
		t.Fatalf("FactDecidedBy %+v", fact)
	}
}

func TestReportPolicySnapshotDecode(t *testing.T) {
	var policy ReportPolicy
	if err := json.Unmarshal([]byte(`{"score":0.9,"categories":{"violence":{"score":0.9,"action":"block","source":{"kind":"allowance","index":0,"indexes":[0,1]},"settings":{"enabled":true,"threshold":0.6,"categoryAction":"block","allowances":[],"restrictions":[{"name":"snapshot-rule","when":["violence-graphic","violence-injury"],"match":"all","unless":["violence-documentary"],"action":"block"}]}}},"decision":{"source":"asset-override","action":"purge","flaggedCategories":["violence"]}}`), &policy); err != nil {
		t.Fatal(err)
	}
	category := policy.Categories["violence"]
	if category.Settings.Threshold != 0.6 || category.Settings.Restrictions[0].Name != "snapshot-rule" || *category.Source.Index != 0 {
		t.Fatalf("lost category snapshot: %#v", category)
	}
	rule := category.Settings.Restrictions[0]
	if category.Settings.Enabled == nil || !*category.Settings.Enabled || rule.Match != "all" || !reflect.DeepEqual(rule.Unless, []string{"violence-documentary"}) || !reflect.DeepEqual(category.Source.Indexes, []int{0, 1}) {
		t.Fatalf("lost condition snapshot: %#v %#v", rule, category.Source)
	}
	var finding CategoryResult
	if err := json.Unmarshal([]byte(`{"status":"evaluated","score":0.9,"policyConditions":{"some:opaque":{"status":"evaluated","score":0.8}}}`), &finding); err != nil {
		t.Fatal(err)
	}
	evidence := finding.PolicyConditions["some:opaque"]
	if evidence.Status != "evaluated" || evidence.Score == nil || *evidence.Score != 0.8 {
		t.Fatalf("lost condition evidence: %#v", evidence)
	}
	if *policy.Decision.Action != "purge" || policy.Decision.Source != "asset-override" || !reflect.DeepEqual(policy.Decision.FlaggedCategories, []string{"violence"}) {
		t.Fatalf("lost decision snapshot: %#v", policy.Decision)
	}
}
