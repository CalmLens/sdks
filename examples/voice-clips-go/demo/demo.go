// Package demo runs Calmclips without a CalmLens project. It is only used when the app is
// started with CALMLENS_DEMO=1: it wraps the SDK's in-memory test client (calmlenstest) and
// writes explicitly selected, simulated outcomes. It is not a moderation model.
package demo

import (
	"sync"
	"time"

	"calmlens.com/go/calmlens"
	"calmlens.com/go/calmlens/calmlenstest"
)

// Categories are the category IDs the simulated reports contain.
var Categories = []calmlens.Category{"sexual", "violence", "self-harm", "harassment", "hate", "criminal-activity"}

// Scenario is the simulated report for one selected outcome: a fixed clip length (the demo never
// decodes media) and the category scores in each analysed segment. Categories left out score 0.03.
type Scenario struct {
	Duration float64
	Segments []map[calmlens.Category]float64
}

// Scenarios holds a simulated report per outcome. Segments mirror native analysis: 30-second
// chunks that overlap by one second, so a clip of D seconds has ceil((D-1)/29) of them.
var Scenarios = map[string]Scenario{
	string(calmlens.ModerationStatusAllowed):       {Duration: 41, Segments: []map[calmlens.Category]float64{{}, {}}},
	string(calmlens.ModerationStatusLimited):       {Duration: 64, Segments: []map[calmlens.Category]float64{{}, {"harassment": 0.58}, {}}},
	string(calmlens.ModerationStatusAgeRestricted): {Duration: 52, Segments: []map[calmlens.Category]float64{{}, {"sexual": 0.72}}},
	string(calmlens.ModerationStatusBlocked): {Duration: 96, Segments: []map[calmlens.Category]float64{
		{}, {}, {"violence": 0.91, "harassment": 0.44}, {"violence": 0.47},
	}},
	string(calmlens.ModerationStatusPurged): {Duration: 38, Segments: []map[calmlens.Category]float64{{"criminal-activity": 0.94}, {}}},
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
	// The mock analyses no media, so its findings timelines are empty: the demo keeps each
	// settled clip's simulated segments, which Timeline lists in their place.
	mu       sync.Mutex
	timeline map[string][]calmlens.MediaClassificationSegment
}

// New returns a demo backend whose key may download private content from the mock CDN.
func New() (*Backend, error) {
	mock, err := calmlenstest.NewServerClient(calmlenstest.Options{APIKey: calmlenstest.CreateMockAPIKey([]calmlenstest.Grant{{Actions: []string{"assets:download"}, IncludeSubfolders: true}})})
	if err != nil {
		return nil, err
	}
	return &Backend{Mock: mock, timeline: map[string][]calmlens.MediaClassificationSegment{}}, nil
}

// ServerClient returns the SDK client backed by the demo.
func (b *Backend) ServerClient() *calmlens.ServerClient { return b.Mock.ServerClient }

// Timeline lists a settled demo clip's simulated findings timeline, as Assets.ListTimeline
// lists a real one; nil for other assets.
func (b *Backend) Timeline(assetID string) []calmlens.MediaClassificationSegment {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]calmlens.MediaClassificationSegment(nil), b.timeline[assetID]...)
}

// Settle writes the selected outcome into a pending demo asset, in the same shape as a real
// audio/video decision, and keeps its simulated timeline. A purged clip also loses its stored
// content, as in CalmLens.
func (b *Backend) Settle(assetID, choice string) {
	b.Mock.WithStorage(func(db *calmlenstest.InMemoryDatabaseStorage, images *calmlenstest.InMemoryImageStorage) {
		if stored := db.Assets[assetID]; stored != nil && Section(stored, "classification")["status"] == string(calmlens.ClassificationStatusProcessing) {
			segments := apply(stored, choice)
			b.mu.Lock()
			b.timeline[assetID] = segments
			b.mu.Unlock()
			if choice == string(calmlens.ModerationStatusPurged) {
				delete(images.Content, assetID)
				content := Section(stored, "content")
				content["status"], content["removalReason"], content["extractedText"] = string(calmlens.ContentStatusRemoved), string(calmlens.ContentRemovalReasonPolicy), nil
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

// apply writes the outcome into the stored asset and returns its simulated timeline segments.
func apply(stored calmlens.JSON, choice string) []calmlens.MediaClassificationSegment {
	processing, moderation := Section(stored, "classification"), Section(Section(stored, "classification"), "moderation")
	if choice == "error" {
		processing["status"] = string(calmlens.ClassificationStatusFailed)
		return nil
	}
	scenario := Scenarios[choice]
	overall := map[calmlens.Category]float64{}
	segments := []calmlens.MediaClassificationSegment{}
	for i, scores := range scenario.Segments {
		categories := map[calmlens.Category]calmlens.CategoryResult{}
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
		segments = append(segments, calmlens.MediaClassificationSegment{Source: calmlens.SegmentSourceClip, StartSeconds: start, EndSeconds: end, Categories: categories})
	}
	categories := calmlens.JSON{}
	for id, score := range overall {
		result := categoryResult(score)
		categories[string(id)] = calmlens.JSON{"status": string(result.Status), "score": *result.Score, "likelihood": string(result.Likelihood)}
	}
	// The selected outcome is the moderation status the policy decided.
	processing["status"] = string(calmlens.ClassificationStatusCompleted)
	processing["completedAt"] = time.Now().UnixMilli()
	Section(stored, "content")["durationSeconds"] = scenario.Duration
	moderation["decision"] = choice
	moderation["automatedStatus"] = choice
	moderation["raw"] = calmlens.JSON{"categories": categories}
	moderation["timeline"] = calmlens.JSON{"segmentCount": len(segments)}
	moderation["categories"] = calmlens.JSON{}
	moderation["source"] = "policy"
	moderation["flaggedCategories"] = []any{}
	moderation["regions"] = []any{}
	moderation["explanationComplete"] = true
	return segments
}

func categoryResult(score float64) calmlens.CategoryResult {
	likelihood := calmlens.LikelihoodVeryUnlikely
	switch {
	case score >= 0.8:
		likelihood = calmlens.LikelihoodVeryLikely
	case score >= 0.6:
		likelihood = calmlens.LikelihoodLikely
	case score >= 0.4:
		likelihood = calmlens.LikelihoodPossible
	case score >= 0.2:
		likelihood = calmlens.LikelihoodUnlikely
	}
	return calmlens.CategoryResult{Status: calmlens.ResultEvaluated, Score: &score, Likelihood: likelihood}
}
