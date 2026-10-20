// Package demo runs Calmclips without a CalmLens project. It is only used when the app is
// started with CALMLENS_DEMO=1: it wraps the SDK's in-memory test client (calmlenstest) and
// writes explicitly selected, simulated outcomes. It is not a moderation model.
package demo

import (
	"time"

	calmlens "github.com/CalmLens/sdks/go"
	"github.com/CalmLens/sdks/go/calmlenstest"
)

// Duration is a fixed, simulated clip length: the demo never decodes media.
const Duration = 48.0

// Categories are the category IDs the simulated reports contain.
var Categories = []string{"sexual", "violence", "self-harm", "harassment", "hate", "criminal-activity"}

// findings lists the simulated category score for each selected outcome, by segment.
// Segments mirror native analysis: 30-second chunks with a one-second overlap.
var findings = map[string][]map[string]float64{
	"approved": {{}, {}},
	"flagged":  {{}, {"harassment": 0.64}},
	"rejected": {{"violence": 0.91}, {"violence": 0.47}},
}

// Backend is the in-memory CalmLens used in demo mode.
type Backend struct {
	// Mock is the SDK's in-memory client; Mock.ServerClient is used like a live client.
	Mock *calmlenstest.MockServerClient
}

// New returns a demo backend whose key may download private content from the mock CDN.
func New() (*Backend, error) {
	mock, err := calmlenstest.NewServerClient(calmlenstest.Options{APIKey: calmlenstest.CreateMockAPIKey([]calmlenstest.Grant{{Actions: []string{"assets:download"}, IncludeSubfolders: true}})})
	if err != nil {
		return nil, err
	}
	return &Backend{Mock: mock}, nil
}

// ServerClient returns the SDK client backed by the demo.
func (b *Backend) ServerClient() *calmlens.ServerClient { return b.Mock.ServerClient }

// Settle writes the selected outcome into a pending demo asset, in the same shape as a real
// audio/video report.
func (b *Backend) Settle(assetID, choice string, video bool) {
	b.Mock.WithStorage(func(db *calmlenstest.InMemoryDatabaseStorage, _ *calmlenstest.InMemoryImageStorage) {
		if stored := db.Assets[assetID]; stored != nil && Section(stored, "processing")["status"] == calmlens.ProcessingStatusProcessing {
			apply(stored, choice, video)
		}
	})
}

// Section returns one of a stored asset's nested objects ("processing", "moderation" or
// "content"), adding it when missing.
func Section(stored calmlens.JSON, key string) calmlens.JSON {
	if value, ok := stored[key].(calmlens.JSON); ok {
		return value
	}
	value := calmlens.JSON{}
	stored[key] = value
	return value
}

func apply(stored calmlens.JSON, choice string, video bool) {
	processing, moderation := Section(stored, "processing"), Section(stored, "moderation")
	if choice == "error" {
		processing["status"] = calmlens.ProcessingStatusFailed
		return
	}
	ranges := [][2]float64{{0, 30}, {29, Duration}}
	overall := map[string]float64{}
	segments := []any{}
	for i, scores := range findings[choice] {
		categories := calmlens.JSON{}
		for _, id := range Categories {
			score := 0.03
			if s, ok := scores[id]; ok {
				score = s
			}
			categories[id] = categoryResult(score)
			if score > overall[id] {
				overall[id] = score
			}
		}
		segments = append(segments, calmlens.JSON{"source": "clip", "startSeconds": ranges[i][0], "endSeconds": ranges[i][1], "categories": categories})
	}
	top := 0.0
	categories := calmlens.JSON{}
	for id, score := range overall {
		categories[id] = categoryResult(score)
		top = max(top, score)
	}
	media := calmlens.JSON{"durationSeconds": Duration, "sampledFrames": 0, "audioTranscribed": false, "segments": segments}
	if video {
		media["frameIntervalSeconds"] = 0.5
		media["sampledFrames"] = 98
	}
	// The policy's action: none for a clean clip, alert to publish a flagged one, hide to reject.
	processing["status"] = calmlens.ProcessingStatusDone
	moderation["status"], moderation["action"] = calmlens.ModerationStatusApproved, nil
	switch choice {
	case "flagged":
		moderation["action"] = calmlens.ModerationActionAlert
	case "rejected":
		moderation["status"], moderation["action"] = calmlens.ModerationStatusRejected, calmlens.ModerationActionHide
	}
	moderation["report"] = calmlens.JSON{
		"processedAt": time.Now().UnixMilli(), "score": top,
		"labels": []any{}, "categories": categories, "media": media,
	}
}

func categoryResult(score float64) calmlens.JSON {
	likelihood := "very-unlikely"
	switch {
	case score >= 0.8:
		likelihood = "very-likely"
	case score >= 0.6:
		likelihood = "likely"
	case score >= 0.4:
		likelihood = "possible"
	case score >= 0.2:
		likelihood = "unlikely"
	}
	return calmlens.JSON{"status": "evaluated", "score": score, "likelihood": likelihood}
}
