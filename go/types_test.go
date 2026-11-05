package calmlens

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestAssetTypedFieldsDecode(t *testing.T) {
	var a Asset
	err := json.Unmarshal([]byte(`{"id":"a","uploadPresetId":"preset-1","content":{"status":"removed","removalReason":"policy","updatedAt":1760000000600,"format":"image/png","extension":"png","sizeInBytes":2048,"checksums":{"sha256":"abc","md5":null},"width":640,"height":480,"perceptualHash":"ph","perceptualHashQuality":88,"rendered":{"kind":"audio","format":"audio/mp4","width":null,"height":null,"peaks":[0.25,1]},"preview":{"width":1200,"height":300,"thumbhash":"th","averageColor":"#fff"},"safetyHold":{"placedAt":1760000000000,"reason":"suspected-illegal-content","disposedAt":null},"extractedText":{"type":"document","id":"doc-1"}},"upload":{"status":"completed","updatedAt":1760000000500,"partsReceived":3},"classification":{"status":"completed","updatedAt":1760000000500,"moderation":{"manualReviews":[{"id":"review-1","decision":"age-restricted","note":"Fine","decidedBy":{"type":"user","id":"user-1"},"reviewedAt":1760000000700,"applied":true}],"status":"age-restricted","categories":{},"explanationComplete":true,"source":"hash-list","flaggedCategories":[],"automatedStatus":"allowed","regions":[{"region":"DE","status":"blocked","rule":"de-jugendschutz","category":"violence"}],"raw":{"categories":{"sexual":{"status":"evaluated","score":0.9,"likelihood":"very-likely","qualifiers":{"sexual-nudity":{"status":"evaluated","someScore":0.8,"allScore":0.5,"likelihood":"likely"},"sexual-fictional":{"status":"not-evaluated","reason":"not-supported"}}},"hate":{"status":"not-evaluated","reason":"unavailable"}},"hashMatches":[{"source":"hash-list","hashListId":"list-1","hashListEntryId":"entry-1","distance":4,"action":"block"}]}},"linkDetection":{"status":"evaluated","stage":"beta","qrCodes":[{"value":"https://example.com","box":{"left":0.1,"top":0.2,"width":0.3,"height":0.4}}],"links":[{"url":"https://example.com","source":"qr-code"}]},"aiGeneratedDetection":{"status":"evaluated","stage":"beta","provenance":"ai-generated","signals":[{"kind":"c2pa","value":"trainedAlgorithmicMedia"}]},"textRegions":[{"box":{"left":0.5,"top":0.5,"width":0.1,"height":0.1},"personalInformation":true}],"completedAt":1760000000700}}`), &a)
	if err != nil {
		t.Fatal(err)
	}
	if p := a.Classification; p.Status != ClassificationStatusCompleted || *p.UpdatedAt != 1760000000500 || *a.Upload.PartsReceived != 3 {
		t.Fatalf("processing: %+v", p)
	}
	if m := a.Classification.Moderation; m.Status != ModerationStatusAgeRestricted || m.ManualReviews[0].Decision != ModerationDecisionAgeRestricted ||
		*m.ManualReviews[0].Note != "Fine" || m.ManualReviews[0].ReviewedAt != 1760000000700 || *a.Classification.CompletedAt != 1760000000700 {
		t.Fatalf("moderation: %+v", m)
	}
	if review := a.Classification.Moderation.ManualReviews[0]; review.DecidedBy.Type != ReviewActorUser || *review.DecidedBy.ID != "user-1" || !review.Applied {
		t.Fatalf("review: %+v", review)
	}
	if m := a.Classification.Moderation; *m.AutomatedStatus != ModerationStatusAllowed ||
		!reflect.DeepEqual(m.Regions, []RegionalDecision{{Region: "DE", Status: ModerationStatusBlocked, Rule: "de-jugendschutz", Category: "violence"}}) {
		t.Fatalf("automated and regional statuses: %+v", m)
	}
	content := a.Content
	if content.Status != ContentStatusRemoved || *content.RemovalReason != ContentRemovalReasonPolicy || *content.UpdatedAt != 1760000000600 ||
		*content.Format != "image/png" || *content.Extension != "png" || *content.SizeInBytes != 2048 {
		t.Fatalf("content: %+v", content)
	}
	if *a.UploadPresetID != "preset-1" || *content.Checksums.SHA256 != "abc" || content.Checksums.MD5 != nil {
		t.Fatalf("checksums: %+v", content.Checksums)
	}
	if *content.PerceptualHash != "ph" || *content.PerceptualHashQuality != 88 || *content.Width != 640 || *content.Height != 480 || content.DurationSeconds != nil {
		t.Fatalf("content details: %+v", content)
	}
	if r := content.Rendered; r.Kind != AssetRenderedKindAudio || r.Format != "audio/mp4" || r.Width != nil || len(r.Peaks) != 2 || r.Peaks[1] != 1 {
		t.Fatalf("rendered: %+v", r)
	}
	if p := content.Preview; *p.Width != 1200 || *p.Height != 300 || *p.Thumbhash != "th" || *p.AverageColor != "#fff" {
		t.Fatalf("preview: %+v", p)
	}
	if h := content.SafetyHold; h.PlacedAt != 1760000000000 || h.Reason != SafetyHoldReasonSuspectedIllegalContent || h.DisposedAt != nil {
		t.Fatalf("safety hold: %+v", h)
	}
	if x := content.ExtractedText; x.Type != ExtractedTextDocument || *x.ID != "doc-1" || x.Content != nil {
		t.Fatalf("extracted text: %+v", x)
	}
	report := a.Classification.Moderation
	sexual := report.Raw.Categories[CategorySexual]
	nudity, fictional := sexual.Qualifiers[QualifierSexualNudity], sexual.Qualifiers[QualifierSexualFictional]
	if nudity.Status != ResultEvaluated || *nudity.SomeScore != 0.8 || *nudity.AllScore != 0.5 || nudity.Likelihood != LikelihoodLikely {
		t.Fatalf("nudity: %+v", nudity)
	}
	if fictional.Status != ResultNotEvaluated || fictional.Reason != ReasonNotSupported || fictional.SomeScore != nil {
		t.Fatalf("fictional: %+v", fictional)
	}
	if hate := report.Raw.Categories[CategoryHate]; hate.Reason != ReasonUnavailable || hate.Score != nil || hate.Qualifiers != nil {
		t.Fatalf("hate: %+v", hate)
	}
	if !reflect.DeepEqual(report.Raw.HashMatches, []HashMatch{{Source: HashMatchSourceHashList, HashListID: "list-1", HashListEntryID: "entry-1", Distance: 4, Action: HashListActionBlock}}) ||
		*report.Source != DecisionSourceHashList {
		t.Fatalf("hash matches: %+v, decision %+v", report.Raw.HashMatches, report)
	}
	links := a.Classification.LinkDetection
	if links.Status != ResultEvaluated || !reflect.DeepEqual(links.QRCodes, []DetectedQRCode{{Value: "https://example.com", Box: BoundingBox{Left: 0.1, Top: 0.2, Width: 0.3, Height: 0.4}}}) ||
		!reflect.DeepEqual(links.Links, []DetectedLink{{URL: "https://example.com", Source: "qr-code"}}) {
		t.Fatalf("link detection: %+v", links)
	}
	if ai := a.Classification.AIGeneratedDetection; ai.Provenance != "ai-generated" || !reflect.DeepEqual(ai.Signals, []ProvenanceSignal{{Kind: "c2pa", Value: "trainedAlgorithmicMedia"}}) {
		t.Fatalf("AI-generated detection: %+v", ai)
	}
	if regions := a.Classification.TextRegions; !reflect.DeepEqual(regions, []TextRegion{{Box: BoundingBox{Left: 0.5, Top: 0.5, Width: 0.1, Height: 0.1}, PersonalInformation: true}}) {
		t.Fatalf("text regions: %+v", regions)
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
		Features: &ProcessingFeatures{OCR: &OCRFeatureOptions{Enabled: true}, PersonDetection: &PersonDetectionFeatureOptions{Enabled: false}},
	}
	_, err := c.Assets.Create(context.Background(), SubmitAssetOptions{Name: "n", UploadPresetID: Ptr("preset-1"), ProcessingOptions: options, Content: &Content{Type: "text/plain", PlainText: Ptr("x")}})
	if err != nil {
		t.Fatal(err)
	}
	q := h.last().URL.Query()
	want := `{"features":{"ocr":{"enabled":true},"personDetection":{"enabled":false}}}`
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

func TestClassifyTextKeepsAnOverLongNewestPost(t *testing.T) {
	c, h := setup(t)
	newest := strings.Repeat("a", ModerationContextUsedCharacters+1)
	items := []ModerationContextItem{{Text: "older", AuthorID: Ptr("user-1")}, {Text: newest}}
	if _, err := c.Text.Classify(context.Background(), ClassifyTextOptions{Text: "hi", Context: &ModerationContext{Items: items}}); err != nil {
		t.Fatal(err)
	}
	var sent ModerationContext
	if err := json.Unmarshal([]byte(h.last().URL.Query().Get("context")), &sent); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(sent.Items, []ModerationContextItem{{Text: newest}}) {
		t.Fatalf("sent %d items, want only the newest", len(sent.Items))
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
		got, err := serializeTransform(c.options)
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

func TestEnsureLensSendsTypedTransform(t *testing.T) {
	c, h := setup(t)
	lens := EnsureLensOptions{Identifier: "thumb", Name: "Thumb", Type: LensTypeImage, Active: true, Version: 1,
		Transform: ImageTransformOptions{Format: ImageFormatAVIF, Width: Ptr(128)}}
	h.result = JSON{"lenses": []JSON{{"id": "l", "identifier": "thumb", "name": "Thumb", "type": "image", "active": true, "version": 1,
		"transform": JSON{"format": "avif", "width": 128}}}}
	result, err := c.EnsureLens(context.Background(), lens)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"lenses":[{"identifier":"thumb","name":"Thumb","description":null,"type":"image","active":true,"transform":{"format":"avif","width":128},"version":1}]}`
	if string(h.bodies[0]) != want {
		t.Fatalf("sent %s", h.bodies[0])
	}
	if result.Transform.(JSON)["format"] != ImageFormatAVIF {
		t.Fatalf("decoded %+v", result.Transform)
	}
}

func TestEventFactsDecode(t *testing.T) {
	var page EventsPage
	err := json.Unmarshal([]byte(`{
  "items": [
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
      "type": "usage.free-uploads-exhausted",
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
  "nextCursor": "c",
  "hasMore": false
}`), &page)
	if err != nil {
		t.Fatal(err)
	}
	flagged := page.Items[0]
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
	var usage UsageFreeUploadsExhaustedFacts
	if err = page.Items[1].Facts.Decode(&usage); err != nil || usage.Limit != 9007199254740993 || usage.Used != 10 || usage.OrganisationID != "user-1" {
		t.Fatalf("%+v %v", usage, err)
	}
	if err = page.Items[1].Facts.Decode(&AssetClassifiedFacts{}); ErrorCode(err) != "" {
		t.Fatalf("unrelated keys are ignored, got %v", err)
	}
	if err = (EventFacts{{Key: FactLimit, Value: "many"}}).Decode(&UsageFreeUploadsExhaustedFacts{}); ErrorCode(err) != CodeSDKInvalidResponse {
		t.Fatalf("mismatched value: %v", err)
	}
}

func TestEventFactsDecodeTeamAPIKeyAndUsageEvents(t *testing.T) {
	var page EventsPage
	err := json.Unmarshal([]byte(`{"items":[
		{"id":"d","type":"api-key.deleted","severity":"low","actor":{"type":"user","id":"user-1"},"facts":[{"key":"key-id","value":"key-1"},{"key":"key-name","value":"CI"}]},
		{"id":"m","type":"project.member-left","severity":"low","actor":{"type":"user","id":"user-2"},"facts":[{"key":"member-user-id","value":"user-2"},{"key":"role","value":"editor"}]},
		{"id":"p","type":"upload-preset.daily-limit-reached","severity":"low","actor":{"type":"system","id":null},"facts":[{"key":"preset-id","value":"p1"},{"key":"preset-name","value":"Avatars"},{"key":"daily-limit","value":500}]},
		{"id":"u","type":"usage.uploads-paused","severity":"high","actor":{"type":"system","id":null},"facts":[{"key":"reason","value":"usage-cap"},{"key":"resumes-at","value":1793491200000}]},
		{"id":"t","type":"project.transferred","severity":"high","actor":{"type":"user","id":"user-1"},"facts":[{"key":"previous-organisation-id","value":"org-1"},{"key":"previous-organisation-name","value":"Studio North"},{"key":"organisation-id","value":"org-2"},{"key":"organisation-name","value":"Acme"},{"key":"method","value":"move"},{"key":"api-keys-revoked","value":0},{"key":"connectors-paused","value":0}]},
		{"id":"c","type":"connector.disabled","severity":"high","actor":{"type":"system","id":null},"facts":[{"key":"connector-id","value":"conn-1"},{"key":"connector-name","value":"Alerts"},{"key":"connector-type","value":"slack"},{"key":"consecutive-failures","value":10}]}],
		"nextCursor":"c","hasMore":false}`), &page)
	if err != nil {
		t.Fatal(err)
	}
	types := []string{EventAPIKeyDeleted, EventProjectMemberLeft, EventUploadPresetDailyLimitReached, EventUsageUploadsPaused, EventProjectTransferred, EventConnectorDisabled}
	for i, want := range types {
		if page.Items[i].Type != want {
			t.Fatalf("item %d type %q, want %q", i, page.Items[i].Type, want)
		}
	}
	if actor := page.Items[0].Actor; actor.Type != ActorUser || actor.ID == nil || *actor.ID != "user-1" {
		t.Fatalf("user actor %+v", actor)
	}
	if actor := page.Items[2].Actor; actor.Type != ActorSystem || actor.ID != nil {
		t.Fatalf("system actor %+v", actor)
	}
	var deleted APIKeyRevokedFacts
	if err = page.Items[0].Facts.Decode(&deleted); err != nil || deleted.KeyID != "key-1" || *deleted.KeyName != "CI" {
		t.Fatalf("deleted %+v %v", deleted, err)
	}
	var left ProjectMemberRemovedFacts
	if err = page.Items[1].Facts.Decode(&left); err != nil || left.MemberUserID != "user-2" || left.Role != "editor" || left.MemberName != nil {
		t.Fatalf("left %+v %v", left, err)
	}
	var preset UploadPresetDailyLimitReachedFacts
	if err = page.Items[2].Facts.Decode(&preset); err != nil || preset.DailyLimit != 500 || preset.PresetName != "Avatars" {
		t.Fatalf("preset %+v %v", preset, err)
	}
	var paused UsageUploadsPausedFacts
	if err = page.Items[3].Facts.Decode(&paused); err != nil || paused.Reason != "usage-cap" || paused.ResumesAt == nil || *paused.ResumesAt != 1793491200000 {
		t.Fatalf("paused %+v %v", paused, err)
	}
	if resumes, ok := page.Items[3].Facts.Get(FactResumesAt); !ok || resumes.Key != "resumes-at" {
		t.Fatalf("FactResumesAt %v", resumes)
	}
	var transferred ProjectTransferredFacts
	if err = page.Items[4].Facts.Decode(&transferred); err != nil || transferred.Method != TransferMethodMove || transferred.OrganisationName != "Acme" || transferred.PreviousOrganisationID != "org-1" {
		t.Fatalf("transferred %+v %v", transferred, err)
	}
	var disabled ConnectorDisabledFacts
	if err = page.Items[5].Facts.Decode(&disabled); err != nil || disabled.ConnectorType != ConnectorTypeSlack || disabled.ConsecutiveFailures != 10 || disabled.LastError != nil {
		t.Fatalf("disabled %+v %v", disabled, err)
	}
}

func TestEventFactsDecodeAssetDecisionsAndBatchRemovals(t *testing.T) {
	var page EventsPage
	err := json.Unmarshal([]byte(`{"items":[
		{"id":"a","type":"asset.blocked","severity":"high","actor":{"type":"automated","id":null},"facts":[{"key":"asset-name","value":"cat.jpg"},{"key":"flagged-categories","value":["violence"]}]},
		{"id":"r","type":"asset.allowed","severity":"low","actor":{"type":"api-key","id":"key-1"},"facts":[{"key":"reviewer-name","value":"An API key"},{"key":"note","value":"Fine"}]},
		{"id":"b","type":"asset.content-removed","severity":"low","actor":{"type":"api-key","id":"key-1"},"facts":[{"key":"asset-name","value":"cat.jpg"},{"key":"asset-type","value":"image"},{"key":"batch-id","value":"batch_1"}]}],
		"nextCursor":"c","hasMore":false}`), &page)
	if err != nil {
		t.Fatal(err)
	}
	var automated AssetDecisionFacts
	if err = page.Items[0].Facts.Decode(&automated); err != nil || page.Items[0].Actor != (Actor{Type: ActorAutomated}) || !reflect.DeepEqual(automated.FlaggedCategories, []string{CategoryViolence}) || automated.Note != nil {
		t.Fatalf("automated %+v %+v %v", page.Items[0].Actor, automated, err)
	}
	var reviewed AssetDecisionFacts
	if err = page.Items[1].Facts.Decode(&reviewed); err != nil || page.Items[1].Actor.Type != ActorAPIKey || *page.Items[1].Actor.ID != "key-1" || reviewed.FlaggedCategories != nil || *reviewed.ReviewerName != "An API key" || *reviewed.Note != "Fine" {
		t.Fatalf("reviewed %+v %+v %v", page.Items[1].Actor, reviewed, err)
	}
	var removed AssetRemovedFacts
	if err = page.Items[2].Facts.Decode(&removed); err != nil || removed.BatchID == nil || *removed.BatchID != "batch_1" || *removed.AssetType != AssetTypeImage {
		t.Fatalf("removed %+v %v", removed, err)
	}
	if fact, ok := page.Items[2].Facts.Get(FactBatchID); !ok || fact.Value != "batch_1" {
		t.Fatalf("FactBatchID %+v", fact)
	}
}

func TestReportPolicySnapshotDecode(t *testing.T) {
	var policy AssetModeration
	if err := json.Unmarshal([]byte(`{"categories":{"violence":{"score":0.9,"action":"block","source":{"kind":"allowance","indexes":[1,0]},"settings":{"categoryAction":"block","allowances":[],"restrictions":[{"name":"snapshot-rule","when":["violence-graphic","violence-injury"],"match":"all","unless":["violence-documentary"],"action":"block"}]}}},"explanationComplete":true,"source":"hash-list","flaggedCategories":["violence"],"automatedStatus":"purged","linkSafety":{"action":"block","links":[{"url":"https://example.com/login","finalUrl":"https://phish.example/","redirects":1,"source":"text","verdict":"phishing","evidence":[]}],"settings":{"verdictActions":{"phishing":"block"}}}}`), &policy); err != nil {
		t.Fatal(err)
	}
	category := policy.Categories["violence"]
	if category.Settings.CategoryAction != "block" || category.Settings.Restrictions[0].Name != "snapshot-rule" {
		t.Fatalf("lost category snapshot: %#v", category)
	}
	rule := category.Settings.Restrictions[0]
	if rule.Match != "all" || !reflect.DeepEqual(rule.Unless, []string{"violence-documentary"}) || !reflect.DeepEqual(category.Source.Indexes, []int{1, 0}) {
		t.Fatalf("lost condition snapshot: %#v %#v", rule, category.Source)
	}
	if links := policy.LinkSafety.Links; len(links) != 1 || links[0].URL != "https://example.com/login" || *links[0].FinalURL != "https://phish.example/" || links[0].Redirects != 1 || links[0].Verdict != LinkVerdictPhishing {
		t.Fatalf("lost link-safety links: %#v", policy.LinkSafety)
	}
	if *policy.AutomatedStatus != ModerationStatusPurged || *policy.Source != DecisionSourceHashList || !reflect.DeepEqual(policy.FlaggedCategories, []string{"violence"}) {
		t.Fatalf("lost decision snapshot: %#v", policy)
	}
}
