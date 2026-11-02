package calmlenstest

import (
	"fmt"
	"math"
	"slices"
	"strings"

	calmlens "github.com/CalmLens/sdks/go"
)

// Moderation statuses of a mock Decision. OutcomeAllowed to OutcomePurged are also the reviewer
// decisions Decide takes.
const (
	// OutcomePending leaves the asset processing with moderation pending.
	OutcomePending = "pending"
	// OutcomeFailed fails processing (retryable) with moderation pending and failure reason
	// processing-error.
	OutcomeFailed = "failed"
	// OutcomeAllowed finishes processing with moderation allowed.
	OutcomeAllowed = "allowed"
	// OutcomeLimited finishes processing with moderation limited; the mock CDN serves the asset
	// like an allowed one.
	OutcomeLimited = "limited"
	// OutcomeAgeRestricted finishes processing with moderation age-restricted; the mock CDN then
	// serves the asset only to keys allowed to download it, like a private asset.
	OutcomeAgeRestricted = "age-restricted"
	// OutcomeBlocked finishes processing with moderation blocked.
	OutcomeBlocked = "blocked"
	// OutcomePurged finishes processing with moderation purged and removes the content with
	// removal reason policy.
	OutcomePurged = "purged"
)

var outcomes = []string{OutcomePending, OutcomeFailed, OutcomeAllowed, OutcomeLimited, OutcomeAgeRestricted, OutcomeBlocked, OutcomePurged}

// statusAction is the policy action that gives each decided status.
var statusAction = map[string]string{
	OutcomeAllowed: "allow", OutcomeLimited: "limit", OutcomeAgeRestricted: "age-restrict",
	OutcomeBlocked: "block", OutcomePurged: "purge",
}

// Why the mock moderates an asset, for ModerationInput.Trigger.
const (
	// TriggerUpload is a completed upload: Assets.Create, Assets.Classify, Text.Classify or a
	// final part.
	TriggerUpload = "upload"
	// TriggerRetry is Assets.Retry queueing a failed asset again.
	TriggerRetry = "retry"
	// TriggerRerun is Assets.Explain with Rerun queueing the asset again.
	TriggerRerun = "rerun"
	// TriggerComplete is CompleteProcessing without a decision of its own.
	TriggerComplete = "complete"
)

// ModerationContent is the content the mock moderates.
type ModerationContent struct {
	// Bytes are the uploaded bytes, parts joined in order; nil without stored content, such as
	// a website or removed content.
	Bytes []byte
	// Text is Bytes as UTF-8 for a plaintext-document asset, otherwise nil.
	Text *string
}

// ModerationInput is what Options.Moderate receives for each asset the mock moderates.
type ModerationInput struct {
	// Asset is the asset as stored, still processing.
	Asset   *calmlens.Asset
	Content ModerationContent
	// Trigger is TriggerUpload, TriggerRetry, TriggerRerun or TriggerComplete.
	Trigger string
	// Queued is true when the API would queue the work rather than answer with the decision:
	// queued uploads, retries, reruns and CompleteProcessing.
	Queued bool
}

// DefaultModerate is the moderation used without Options.Moderate: queued work stays pending
// until CompleteProcessing, which allows it, and everything else is allowed.
func DefaultModerate(input ModerationInput) *Decision {
	if input.Queued && input.Trigger != TriggerComplete {
		return NewDecision(OutcomePending)
	}
	return NewDecision(OutcomeAllowed)
}

type flag struct {
	score      float64
	qualifiers map[string]float64
}

// Decision is a moderation decision for Options.Moderate or CompleteProcessing, started with
// NewDecision: Flag the categories it found, with their scores and qualifiers, and mark the
// categories it couldn't assess with NotEvaluated. The calls chain. A call with a status,
// category, qualifier or score CalmLens doesn't have, a category already in the decision, or
// findings on a pending or failed decision makes Err return an sdk/invalid-argument
// *calmlens.Error, and the mock returns that error from the call that uses the decision.
type Decision struct {
	status       string
	flags        map[string]flag
	notEvaluated map[string]bool
	err          error
}

// NewDecision starts a decision with status: OutcomePending, OutcomeFailed, OutcomeAllowed,
// OutcomeLimited, OutcomeAgeRestricted, OutcomeBlocked or OutcomePurged. A decided status alone
// reports every category evaluated with score 0.
func NewDecision(status string) *Decision {
	d := &Decision{status: status, flags: map[string]flag{}, notEvaluated: map[string]bool{}}
	if !slices.Contains(outcomes, status) {
		d.fail("status must be one of %s, not %q", strings.Join(outcomes, ", "), status)
	}
	return d
}

// Status is the decision's moderation status.
func (d *Decision) Status() string { return d.status }

// Err is the first refused call's sdk/invalid-argument error, or nil.
func (d *Decision) Err() error { return d.err }

func (d *Decision) fail(format string, args ...any) {
	if d.err == nil {
		d.err = &calmlens.Error{Code: calmlens.CodeSDKInvalidArgument, Message: fmt.Sprintf(format, args...)}
	}
}

func isScore(score float64) bool {
	return !math.IsNaN(score) && score >= 0 && score <= 1
}

// addable checks that category can join the decision.
func (d *Decision) addable(category string) bool {
	switch {
	case d.err != nil:
		return false
	case !slices.Contains(mockCategories, category):
		d.fail("%s is not a CalmLens category", category)
	case d.status == OutcomePending || d.status == OutcomeFailed:
		d.fail("a %s decision has no findings", d.status)
	case d.notEvaluated[category]:
		d.fail("%s is already in this decision", category)
	default:
		if _, ok := d.flags[category]; ok {
			d.fail("%s is already in this decision", category)
		}
	}
	return d.err == nil
}

// Flag records findings in category with its score (0 to 1) and, optionally, scores for its
// qualifiers, such as {"violence-threat": 0.9}. The policy acts on a category at 0.5 and above,
// so flaggedCategories lists it there unless the status is allowed.
func (d *Decision) Flag(category string, score float64, qualifiers map[string]float64) *Decision {
	if !d.addable(category) {
		return d
	}
	if !isScore(score) {
		d.fail("%s's score must be from 0 to 1", category)
		return d
	}
	entry := flag{score: score, qualifiers: map[string]float64{}}
	for qualifier, qualifierScore := range qualifiers {
		if !slices.Contains(mockQualifiers[category], qualifier) {
			d.fail("%s is not a qualifier of %s", qualifier, category)
			return d
		}
		if !isScore(qualifierScore) {
			d.fail("%s's score must be from 0 to 1", qualifier)
			return d
		}
		entry.qualifiers[qualifier] = qualifierScore
	}
	d.flags[category] = entry
	return d
}

// NotEvaluated marks category as not assessed (not-evaluated for reason not-supported).
func (d *Decision) NotEvaluated(category string) *Decision {
	if d.addable(category) {
		d.notEvaluated[category] = true
	}
	return d
}

// scoreToLikelihood is the likelihood the API reports for a score.
func scoreToLikelihood(score float64) string {
	switch {
	case score >= 0.8:
		return "very-likely"
	case score >= 0.6:
		return "likely"
	case score >= 0.4:
		return "possible"
	case score >= 0.2:
		return "unlikely"
	}
	return "very-unlikely"
}

// decided is whether the status finishes processing with a decision.
func decided(status string) bool { return status != OutcomePending && status != OutcomeFailed }

// report is the moderation report fields a decided asset gets, as the API sends them: every
// category (unflagged ones evaluated with score 0), the highest score, and the policy's actions
// and flaggedCategories. It is nil for pending and failed decisions.
func (d *Decision) report() calmlens.JSON {
	if !decided(d.status) {
		return nil
	}
	action := func(score float64) string {
		if d.status != OutcomeAllowed && score >= 0.5 {
			return statusAction[d.status]
		}
		return "allow"
	}
	categories := calmlens.JSON{}
	policyCategories := calmlens.JSON{}
	flagged := []any{}
	highest := 0.0
	for _, category := range mockCategories {
		if d.notEvaluated[category] {
			categories[category] = calmlens.JSON{"status": "not-evaluated", "reason": "not-supported"}
			continue
		}
		entry := d.flags[category]
		highest = max(highest, entry.score)
		evaluated := calmlens.JSON{"status": "evaluated", "likelihood": scoreToLikelihood(entry.score), "score": entry.score}
		if len(entry.qualifiers) > 0 {
			qualifiers := calmlens.JSON{}
			for qualifier, score := range entry.qualifiers {
				qualifiers[qualifier] = calmlens.JSON{"status": "evaluated", "someScore": score, "likelihood": scoreToLikelihood(score)}
			}
			evaluated["qualifiers"] = qualifiers
		}
		categories[category] = evaluated
		policyCategories[category] = calmlens.JSON{"score": entry.score, "action": action(entry.score)}
		if action(entry.score) != "allow" {
			flagged = append(flagged, category)
		}
	}
	var decisionAction any
	if d.status != OutcomeAllowed {
		decisionAction = statusAction[d.status]
	}
	return calmlens.JSON{
		"categories": categories,
		"score":      highest,
		"policy": calmlens.JSON{
			"score":      highest,
			"categories": policyCategories,
			"evidence":   calmlens.PolicyEvidenceFull,
			"decision": calmlens.JSON{
				"source": "policy", "action": decisionAction, "regions": []any{}, "flaggedCategories": flagged,
			},
		},
	}
}

// flaggedCategories is the report's policy.decision.flaggedCategories, empty when undecided.
func (d *Decision) flaggedCategories() []any {
	report := d.report()
	if report == nil {
		return []any{}
	}
	return report["policy"].(calmlens.JSON)["decision"].(calmlens.JSON)["flaggedCategories"].([]any)
}
