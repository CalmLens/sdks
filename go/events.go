package calmlens

import "encoding/json"

// EventType is an event's type.
type EventType string

// Event types.
const (
	EventAssetUploaded                 EventType = "asset.uploaded"
	EventAssetClassified               EventType = "asset.classified"
	EventAssetAllowed                  EventType = "asset.allowed"
	EventAssetLimited                  EventType = "asset.limited"
	EventAssetAgeRestricted            EventType = "asset.age-restricted"
	EventAssetRegionRestricted         EventType = "asset.region-restricted"
	EventAssetBlocked                  EventType = "asset.blocked"
	EventAssetPurged                   EventType = "asset.purged"
	EventAssetFailed                   EventType = "asset.failed"
	EventAssetProgressUpdated          EventType = "asset.progress-updated"
	EventAssetDeleted                  EventType = "asset.deleted"
	EventAssetContentRemoved           EventType = "asset.content-removed"
	EventAssetRetried                  EventType = "asset.retried"
	EventAssetRerunRequested           EventType = "asset.rerun-requested"
	EventAssetHashMatched              EventType = "asset.hash-matched"
	EventAssetReviewRequested          EventType = "asset.review-requested"
	EventAssetReviewCompleted          EventType = "asset.review-completed"
	EventUsageFreeUploadsExhausted     EventType = "usage.free-uploads-exhausted"
	EventUsageUploadsPaused            EventType = "usage.uploads-paused"
	EventUploadPresetDailyLimitReached EventType = "upload-preset.daily-limit-reached"
	EventProjectMemberJoined           EventType = "project.member-joined"
	EventProjectMemberRemoved          EventType = "project.member-removed"
	EventProjectMemberLeft             EventType = "project.member-left"
	EventProjectMemberRoleChanged      EventType = "project.member-role-changed"
	EventProjectInvitationSent         EventType = "project.invitation-sent"
	EventProjectTransferred            EventType = "project.transferred"
	EventAPIKeyCreated                 EventType = "api-key.created"
	EventAPIKeyRevoked                 EventType = "api-key.revoked"
	EventAPIKeyDeleted                 EventType = "api-key.deleted"
	EventConnectorDisabled             EventType = "connector.disabled"
)

// Severity is how much an event needs attention.
type Severity string

// Event severities.
const (
	SeverityLow  Severity = "low"
	SeverityHigh Severity = "high"
)

// EventFactKey is the key of an event fact.
type EventFactKey string

// Registered fact keys. Each event type documents which keys it carries; FactTest marks a test
// send. Who caused an event is its Actor, not a fact. Webhook, Slack and email deliveries and the
// public events feed leave out facts that hold personal or account data (names, email addresses,
// the project owner's ID), so those keys never appear on events you receive from them.
const (
	FactAssetName                EventFactKey = "asset-name"
	FactAssetType                EventFactKey = "asset-type"
	FactFileFormat               EventFactKey = "file-format"
	FactModerationStatus         EventFactKey = "moderation-status"
	FactFlaggedCategories        EventFactKey = "flagged-categories"
	FactNote                     EventFactKey = "note"
	FactPreviousStatus           EventFactKey = "previous-status"
	FactFailureReason            EventFactKey = "failure-reason"
	FactBatchID                  EventFactKey = "batch-id"
	FactLimit                    EventFactKey = "limit"
	FactUsed                     EventFactKey = "used"
	FactOrganisationID           EventFactKey = "organisation-id"
	FactOrganisationName         EventFactKey = "organisation-name"
	FactPreviousOrganisationID   EventFactKey = "previous-organisation-id"
	FactPreviousOrganisationName EventFactKey = "previous-organisation-name"
	FactMethod                   EventFactKey = "method"
	FactAPIKeysRevoked           EventFactKey = "api-keys-revoked"
	FactConnectorsPaused         EventFactKey = "connectors-paused"
	FactMemberUserID             EventFactKey = "member-user-id"
	FactMemberName               EventFactKey = "member-name"
	FactRole                     EventFactKey = "role"
	FactConnectorID              EventFactKey = "connector-id"
	FactConnectorName            EventFactKey = "connector-name"
	FactConnectorType            EventFactKey = "connector-type"
	FactConsecutiveFailures      EventFactKey = "consecutive-failures"
	FactLastError                EventFactKey = "last-error"
	FactResumesAt                EventFactKey = "resumes-at"
	FactReason                   EventFactKey = "reason"
	FactPresetID                 EventFactKey = "preset-id"
	FactPresetName               EventFactKey = "preset-name"
	FactDailyLimit               EventFactKey = "daily-limit"
	FactPreviousRole             EventFactKey = "previous-role"
	FactKeyID                    EventFactKey = "key-id"
	FactKeyName                  EventFactKey = "key-name"
	FactCompletedSections        EventFactKey = "completed-sections"
	FactTotalSections            EventFactKey = "total-sections"
	FactAppliedToAsset           EventFactKey = "applied-to-asset"
	FactAutomatedStatus          EventFactKey = "automated-status"
	FactChildAsset               EventFactKey = "child-asset"
	FactChildStatus              EventFactKey = "child-status"
	FactCreatedByName            EventFactKey = "created-by-name"
	FactDecision                 EventFactKey = "decision"
	FactDeletedByName            EventFactKey = "deleted-by-name"
	FactDistance                 EventFactKey = "distance"
	FactHashListID               EventFactKey = "hash-list-id"
	FactHashListName             EventFactKey = "hash-list-name"
	FactInviteeEmail             EventFactKey = "invitee-email"
	FactMatchAction              EventFactKey = "match-action"
	FactParentAsset              EventFactKey = "parent-asset"
	FactRegion                   EventFactKey = "region"
	FactReviewID                 EventFactKey = "review-id"
	FactReviewReason             EventFactKey = "review-reason"
	FactReviewerName             EventFactKey = "reviewer-name"
	FactRevokedByName            EventFactKey = "revoked-by-name"
	FactRule                     EventFactKey = "rule"
	FactStatus                   EventFactKey = "status"
	FactUncertainCategories      EventFactKey = "uncertain-categories"
	FactTest                     EventFactKey = "test"
)

// EventAsset is a snapshot of an asset's processing, moderation and content status when the
// event was created.
type EventAsset struct {
	responseJSON
	ID             string                   `json:"id"`
	ExternalID     *string                  `json:"externalId,omitempty"`
	UploadPresetID *string                  `json:"uploadPresetId,omitempty"`
	Upload         EventAssetUpload         `json:"upload"`
	Classification EventAssetClassification `json:"classification"`
	Content        EventAssetContent        `json:"content"`
}

// EventAssetClassification is the asset's classification status when the event was created.
type EventAssetUpload struct {
	responseJSON
	Status UploadStatus `json:"status"`
}

type EventAssetClassification struct {
	responseJSON
	// Status is one of the ClassificationStatus constants.
	Status ClassificationStatus `json:"status"`
	// TestInput is whether the results came from one of the project's test inputs rather than
	// analysing the content. Never use test results, such as age ranges, for real decisions.
	TestInput  bool                 `json:"testInput"`
	Moderation EventAssetModeration `json:"moderation"`
}

// EventAssetModeration is the asset's moderation status when the event was created.
type EventAssetModeration struct {
	responseJSON
	// Decision is nil until a moderation decision is in force.
	Decision *ModerationDecision `json:"decision"`
}

// EventAssetContent is whether CalmLens held the asset's content when the event was created.
type EventAssetContent struct {
	responseJSON
	// Status is one of the ContentStatus constants.
	Status ContentStatus `json:"status"`
}

// EventFact is one registered fact of an event. URL, when present, is a stable link that opens
// the fact's item in the CalmLens portal.
//
// Value is any JSON value because its type depends on Key and the event type (a string,
// number, boolean, string list or null); numbers are json.Number. Read it with Text, Int64,
// Bool or Strings, or decode every fact at once with EventFacts.Decode.
type EventFact struct {
	responseJSON
	Key   EventFactKey `json:"key"`
	Value any          `json:"value"`
	URL   *string      `json:"url,omitempty"`
}

// Text returns a string value.
func (f EventFact) Text() (string, bool) {
	value, ok := f.Value.(string)
	return value, ok
}

// Int64 returns an integer value without losing precision.
func (f EventFact) Int64() (int64, bool) {
	switch value := f.Value.(type) {
	case json.Number:
		n, err := value.Int64()
		return n, err == nil
	case int64:
		return value, true
	case int:
		return int64(value), true
	}
	return 0, false
}

// Bool returns a boolean value.
func (f EventFact) Bool() (bool, bool) {
	value, ok := f.Value.(bool)
	return value, ok
}

// Strings returns a string list value, such as FactFlaggedCategories.
func (f EventFact) Strings() ([]string, bool) {
	switch value := f.Value.(type) {
	case []string:
		return value, true
	case []any:
		result := make([]string, len(value))
		for i, item := range value {
			text, ok := item.(string)
			if !ok {
				return nil, false
			}
			result[i] = text
		}
		return result, true
	}
	return nil, false
}

// EventFacts is the list of facts of an event.
type EventFacts []EventFact

// Get returns the fact with key.
func (facts EventFacts) Get(key EventFactKey) (EventFact, bool) {
	for _, fact := range facts {
		if fact.Key == key {
			return fact, true
		}
	}
	return EventFact{}, false
}

// GetEventFact returns the value of one of event's facts by key, the first when the key repeats,
// or nil when the event doesn't carry it. A fact's URL, when it has one, is on the fact in
// event.Facts.
func GetEventFact(event *Event, key EventFactKey) any {
	if event == nil {
		return nil
	}
	fact, _ := event.Facts.Get(key)
	return fact.Value
}

// GetEventFacts returns event's facts as values by key, such as
// {"flagged-categories": ["hate"]}. A key the event repeats keeps its first value, as
// GetEventFact reads it.
func GetEventFacts(event *Event) map[EventFactKey]any {
	values := map[EventFactKey]any{}
	if event == nil {
		return values
	}
	for _, fact := range event.Facts {
		if _, seen := values[fact.Key]; !seen {
			values[fact.Key] = fact.Value
		}
	}
	return values
}

// IsTest reports whether the facts mark a test send ({Key: FactTest, Value: true}).
func (facts EventFacts) IsTest() bool {
	fact, ok := facts.Get(FactTest)
	if !ok {
		return false
	}
	value, ok := fact.Bool()
	return ok && value
}

// Decode copies fact values into out, a pointer to a struct whose json tags are fact keys,
// such as *AssetClassifiedFacts. Facts without a matching field are ignored.
func (facts EventFacts) Decode(out any) error {
	values := make(map[EventFactKey]any, len(facts))
	for _, fact := range facts {
		values[fact.Key] = fact.Value
	}
	data, err := json.Marshal(values)
	if err != nil {
		return argumentError("Could not encode event facts", err)
	}
	if err = decodeJSON(data, out); err != nil {
		return &Error{Code: CodeSDKInvalidResponse, Message: "Event facts do not match the requested type", Cause: err}
	}
	return nil
}

// AssetUploadedFacts are the facts of EventAssetUploaded.
type AssetUploadedFacts struct {
	AssetName  *string    `json:"asset-name"`
	AssetType  *AssetType `json:"asset-type"`
	FileFormat *string    `json:"file-format"`
}

// AssetClassifiedFacts are the facts of EventAssetClassified. FlaggedCategories are the parent
// policy categories whose findings decided the status (empty when nothing was acted on), and
// ModerationStatus is the status the policy decided (a ModerationStatus constant other than
// pending); a reviewer's earlier decision on the asset keeps precedence.
type AssetClassifiedFacts struct {
	AssetName         *string          `json:"asset-name"`
	AssetType         *AssetType       `json:"asset-type"`
	FlaggedCategories []Category       `json:"flagged-categories"`
	ModerationStatus  ModerationStatus `json:"moderation-status"`
}

// AssetDecisionFacts are the facts of EventAssetAllowed, EventAssetLimited,
// EventAssetAgeRestricted, EventAssetBlocked and EventAssetPurged, one event per moderation
// status. The event's Actor says who set it: ActorAutomated moderation, an ActorUser (a reviewer
// in the portal, or an assistant acting for one) or an ActorAPIKey through the API.
// FlaggedCategories, when present, are the parent policy categories whose findings decided the
// status. Note is set only for reviewer decisions.
type AssetDecisionFacts struct {
	AssetName         *string    `json:"asset-name"`
	AssetType         *AssetType `json:"asset-type"`
	FlaggedCategories []Category `json:"flagged-categories"`
	Note              *string    `json:"note"`
}

// AssetRerunRequestedFacts are the facts of EventAssetRerunRequested, recorded when the event's
// Actor asks for a decided asset to be moderated again (AssetsService.Explain with Rerun).
// ModerationStatus is the asset's status when the re-run was requested (a ModerationStatus
// constant other than pending), which stands until the re-run's EventAssetClassified and
// asset.<status> events report the new one; a failed re-run keeps it.
type AssetRerunRequestedFacts struct {
	AssetName        *string          `json:"asset-name"`
	AssetType        *AssetType       `json:"asset-type"`
	ModerationStatus ModerationStatus `json:"moderation-status"`
}

// AssetFailedFacts are the facts of EventAssetFailed.
type AssetFailedFacts struct {
	AssetName *string    `json:"asset-name"`
	AssetType *AssetType `json:"asset-type"`
	// PreviousStatus is the classification status (a ClassificationStatus constant) before the failure.
	PreviousStatus *string `json:"previous-status"`
	// FailureReason is why processing failed (an AssetFailureReason constant).
	FailureReason AssetFailureReason `json:"failure-reason"`
}

// AssetProgressUpdatedFacts are the facts of EventAssetProgressUpdated, sent while long audio or
// video analysed in sections finishes more of them. CompletedSections and TotalSections match the
// asset's AssetClassification.Progress.
type AssetProgressUpdatedFacts struct {
	AssetName         *string    `json:"asset-name"`
	AssetType         *AssetType `json:"asset-type"`
	CompletedSections int64      `json:"completed-sections"`
	TotalSections     int64      `json:"total-sections"`
}

// UsageFreeUploadsExhaustedFacts are the facts of EventUsageFreeUploadsExhausted.
// OrganisationID, the organisation whose free uploads were used, stays in the portal and is empty
// on webhook deliveries.
type UsageFreeUploadsExhaustedFacts struct {
	Limit          int64  `json:"limit"`
	Used           int64  `json:"used"`
	OrganisationID string `json:"organisation-id"`
}

// ProjectMemberJoinedFacts are the facts of EventProjectMemberJoined. Role is "admin",
// "configurator", "editor", "viewer" or "custom"; other values may be added. MemberName stays in
// the portal and is nil on webhook deliveries.
type ProjectMemberJoinedFacts struct {
	MemberUserID string  `json:"member-user-id"`
	MemberName   *string `json:"member-name"`
	Role         string  `json:"role"`
}

// ConnectorType is the kind of a connector, the value of FactConnectorType.
type ConnectorType string

// Values of FactConnectorType. ConnectorDisabledFacts.
const (
	ConnectorTypeInApp   ConnectorType = "in-app"
	ConnectorTypeWebhook ConnectorType = "webhook"
	ConnectorTypeSlack   ConnectorType = "slack"
	ConnectorTypeEmail   ConnectorType = "email"
)

// ConnectorDisabledFacts are the facts of EventConnectorDisabled, sent when deliveries to a
// connector kept failing and it was turned off. ConnectorType is a ConnectorType constant.
// LastError stays in the portal and is nil on webhook deliveries.
type ConnectorDisabledFacts struct {
	ConnectorID         string        `json:"connector-id"`
	ConnectorName       string        `json:"connector-name"`
	ConnectorType       ConnectorType `json:"connector-type"`
	ConsecutiveFailures int64         `json:"consecutive-failures"`
	LastError           *string       `json:"last-error"`
}

// AssetRemovedFacts are the facts of EventAssetDeleted, EventAssetContentRemoved and
// EventAssetRetried. BatchID, on the deletions and content removals an Assets.Batch operation
// causes, is its BatchAssetsResponse.BatchID; nil otherwise.
type AssetRemovedFacts struct {
	AssetName *string    `json:"asset-name"`
	AssetType *AssetType `json:"asset-type"`
	BatchID   *string    `json:"batch-id"`
}

// UsageUploadsPausedFacts are the facts of EventUsageUploadsPaused. Reason is "spend-limit",
// "usage-cap", "project-budget" or "payment-failed"; other values may be added. ResumesAt is when
// uploads resume at the latest, in unix milliseconds (the end of the billing period, or sooner if
// the limit is raised), or nil while an unpaid invoice pauses uploads.
type UsageUploadsPausedFacts struct {
	Reason    string `json:"reason"`
	ResumesAt *int64 `json:"resumes-at"`
}

// UploadPresetDailyLimitReachedFacts are the facts of EventUploadPresetDailyLimitReached.
type UploadPresetDailyLimitReachedFacts struct {
	PresetID   string `json:"preset-id"`
	PresetName string `json:"preset-name"`
	DailyLimit int64  `json:"daily-limit"`
}

// ProjectMemberRemovedFacts are the facts of EventProjectMemberRemoved, when someone removed a
// member, and EventProjectMemberLeft, when a member left. Role is the role the member held.
// MemberName stays in the portal and is nil on webhook deliveries.
type ProjectMemberRemovedFacts struct {
	MemberUserID string  `json:"member-user-id"`
	MemberName   *string `json:"member-name"`
	Role         string  `json:"role"`
}

// ProjectMemberRoleChangedFacts are the facts of EventProjectMemberRoleChanged.
type ProjectMemberRoleChangedFacts struct {
	MemberUserID string  `json:"member-user-id"`
	MemberName   *string `json:"member-name"`
	PreviousRole string  `json:"previous-role"`
	Role         string  `json:"role"`
}

// ProjectInvitationSentFacts are the facts of EventProjectInvitationSent.
type ProjectInvitationSentFacts struct {
	Role string `json:"role"`
}

// TransferMethod is how a project was transferred, the value of FactMethod.
type TransferMethod string

// Values of FactMethod on EventProjectTransferred.
const (
	// TransferMethodHandover is a project an owner of the receiving organisation accepted from
	// another organisation.
	TransferMethodHandover TransferMethod = "handover"
	// TransferMethodMove is a project someone who owns both organisations moved.
	TransferMethodMove TransferMethod = "move"
)

// ProjectTransferredFacts are the facts of EventProjectTransferred, sent when the project moved
// to another organisation. Method is TransferMethodHandover or TransferMethodMove; a handover
// revokes APIKeysRevoked of the project's API keys and pauses ConnectorsPaused of its connectors.
type ProjectTransferredFacts struct {
	PreviousOrganisationID   string         `json:"previous-organisation-id"`
	PreviousOrganisationName string         `json:"previous-organisation-name"`
	OrganisationID           string         `json:"organisation-id"`
	OrganisationName         string         `json:"organisation-name"`
	Method                   TransferMethod `json:"method"`
	APIKeysRevoked           int64          `json:"api-keys-revoked"`
	ConnectorsPaused         int64          `json:"connectors-paused"`
}

// APIKeyCreatedFacts are the facts of EventAPIKeyCreated.
type APIKeyCreatedFacts struct {
	KeyID   string  `json:"key-id"`
	KeyName *string `json:"key-name"`
	Role    string  `json:"role"`
}

// APIKeyRevokedFacts are the facts of EventAPIKeyRevoked, when a key was revoked (kept but no
// longer usable), and EventAPIKeyDeleted, when it was deleted.
type APIKeyRevokedFacts struct {
	KeyID   string  `json:"key-id"`
	KeyName *string `json:"key-name"`
}
