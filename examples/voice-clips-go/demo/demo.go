// Package demo runs Calmclips without a CalmLens project. It is only used when the app is
// started with CALMLENS_DEMO=1: it wraps the SDK's in-memory test client (calmlenstest) and
// writes explicitly selected, simulated outcomes. It is not a moderation model.
package demo

import (
	"time"

	calmlens "github.com/CalmLens/sdks/go"
	"github.com/CalmLens/sdks/go/calmlenstest"
)

// Categories are the category IDs the simulated reports contain.
var Categories = []string{"sexual", "violence", "self-harm", "harassment", "hate", "criminal-activity"}

// Scenario is the simulated report for one selected outcome: a fixed clip length (the demo never
// decodes media) and the category scores in each analysed segment. Categories left out score 0.03.
type Scenario struct {
	Duration float64
	Segments []map[string]float64
}

// Scenarios holds a simulated report per outcome. Segments mirror native analysis: 30-second
// chunks that overlap by one second, so a clip of D seconds has ceil((D-1)/29) of them.
var Scenarios = map[string]Scenario{
	calmlens.ModerationStatusAllowed:       {Duration: 41, Segments: []map[string]float64{{}, {}}},
	calmlens.ModerationStatusLimited:       {Duration: 64, Segments: []map[string]float64{{}, {"harassment": 0.58}, {}}},
	calmlens.ModerationStatusAgeRestricted: {Duration: 52, Segments: []map[string]float64{{}, {"sexual": 0.72}}},
	calmlens.ModerationStatusBlocked: {Duration: 96, Segments: []map[string]float64{
		{}, {}, {"violence": 0.91, "harassment": 0.44}, {"violence": 0.47},
	}},
	calmlens.ModerationStatusPurged: {Duration: 38, Segments: []map[string]float64{{"criminal-activity": 0.94}, {}}},
}

// Range returns segment i's start and end: 30-second chunks with a one-second overlap.
func (s Scenario) Range(i int) (float64, float64) {
	start := float64(i) * 29
	return start, min(start+30, s.Duration)
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
// audio/video report. A purged clip also loses its stored content, as in CalmLens.
func (b *Backend) Settle(assetID, choice string, video bool) {
	b.Mock.WithStorage(func(db *calmlenstest.InMemoryDatabaseStorage, images *calmlenstest.InMemoryImageStorage) {
		if stored := db.Assets[assetID]; stored != nil && Section(stored, "classification")["status"] == calmlens.ClassificationStatusProcessing {
			apply(stored, choice, video)
			if choice == calmlens.ModerationStatusPurged {
				delete(images.Content, assetID)
				content := Section(stored, "content")
				content["status"], content["removalReason"], content["extractedText"] = calmlens.ContentStatusRemoved, calmlens.ContentRemovalReasonPolicy, nil
				content["updatedAt"] = time.Now().UnixMilli()
			}
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
	processing, moderation := Section(stored, "classification"), Section(Section(stored, "classification"), "moderation")
	if choice == "error" {
		processing["status"] = calmlens.ClassificationStatusFailed
		return
	}
	scenario := Scenarios[choice]
	overall := map[string]float64{}
	segments := []any{}
	for i, scores := range scenario.Segments {
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
		start, end := scenario.Range(i)
		segments = append(segments, calmlens.JSON{"source": "clip", "startSeconds": start, "endSeconds": end, "categories": categories})
	}
	top := 0.0
	categories := calmlens.JSON{}
	for id, score := range overall {
		categories[id] = categoryResult(score)
		top = max(top, score)
	}
	media := calmlens.JSON{"durationSeconds": scenario.Duration, "sampledFrames": 0, "audioTranscribed": false, "segments": segments}
	if video {
		media["frameIntervalSeconds"] = 0.5
		media["sampledFrames"] = int(scenario.Duration * 2)
	}
	// The selected outcome is the moderation status the policy decided.
	processing["status"] = calmlens.ClassificationStatusCompleted
	moderation["status"] = choice
	processing["completedAt"] = time.Now().UnixMilli()
	moderation["score"] = top
	moderation["categories"] = categories
	moderation["timeline"] = media
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
