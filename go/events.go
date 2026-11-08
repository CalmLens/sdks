package calmlens

import "encoding/json"

// Event types. Type is a plain string so event types added later still decode.
const (
	EventAssetUploaded                 = "asset.uploaded"
	EventAssetClassified               = "asset.classified"
	EventAssetAllowed                  = "asset.allowed"
	EventAssetLimited                  = "asset.limited"
	EventAssetAgeRestricted            = "asset.age-restricted"
	EventAssetRegionRestricted         = "asset.region-restricted"
	EventAssetBlocked                  = "asset.blocked"
	EventAssetPurged                   = "asset.purged"
	EventAssetFailed                   = "asset.failed"
	EventAssetProgressUpdated          = "asset.progress-updated"
	EventAssetDeleted                  = "asset.deleted"
	EventAssetContentRemoved           = "asset.content-removed"
	EventAssetRetried                  = "asset.retried"
	EventAssetRerunRequested           = "asset.rerun-requested"
	EventUsageFreeUploadsExhausted     = "usage.free-uploads-exhausted"
	EventUsageUploadsPaused            = "usage.uploads-paused"
	EventUploadPresetDailyLimitReached = "upload-preset.daily-limit-reached"
	EventProjectMemberJoined           = "project.member-joined"
	EventProjectMemberRemoved          = "project.member-removed"
	EventProjectMemberLeft             = "project.member-left"
	EventProjectMemberRoleChanged      = "project.member-role-changed"
	EventProjectInvitationSent         = "project.invitation-sent"
	EventProjectTransferred            = "project.transferred"
	EventAPIKeyCreated                 = "api-key.created"
	EventAPIKeyRevoked                 = "api-key.revoked"
	EventAPIKeyDeleted                 = "api-key.deleted"
	EventConnectorDisabled             = "connector.disabled"
)

// Event severities.
const (
	SeverityLow  = "low"
	SeverityHigh = "high"
)

// Registered fact keys. Each event type documents which keys it carries; FactTest marks a
// test send. Who caused an event is its Actor, not a fact. Webhook, Slack and email deliveries
// and the public events feed leave out facts that hold personal or account data (names, email
// addresses, the project owner's ID), so those keys never appear on events you receive from them.
const (
	FactAssetName                = "asset-name"
	FactAssetType                = "asset-type"
	FactFileFormat               = "file-format"
	FactModerationStatus         = "moderation-status"
	FactFlaggedCategories        = "flagged-categories"
	FactNote                     = "note"
	FactPreviousStatus           = "previous-status"
	FactFailureReason            = "failure-reason"
	FactBatchID                  = "batch-id"
	FactLimit                    = "limit"
	FactUsed                     = "used"
	FactOrganisationID           = "organisation-id"
	FactOrganisationName         = "organisation-name"
	FactPreviousOrganisationID   = "previous-organisation-id"
	FactPreviousOrganisationName = "previous-organisation-name"
	FactMethod                   = "method"
	FactAPIKeysRevoked           = "api-keys-revoked"
	FactConnectorsPaused         = "connectors-paused"
	FactMemberUserID             = "member-user-id"
	FactMemberName               = "member-name"
	FactRole                     = "role"
	FactConnectorID              = "connector-id"
	FactConnectorName            = "connector-name"
	FactConnectorType            = "connector-type"
	FactConsecutiveFailures      = "consecutive-failures"
	FactLastError                = "last-error"
	FactResumesAt                = "resumes-at"
	FactReason                   = "reason"
	FactPresetID                 = "preset-id"
	FactPresetName               = "preset-name"
	FactDailyLimit               = "daily-limit"
	FactPreviousRole             = "previous-role"
	FactKeyID                    = "key-id"
	FactKeyName                  = "key-name"
	FactCompletedSections        = "completed-sections"
	FactTotalSections            = "total-sections"
	FactTest                     = "test"
)

// EventAsset is a snapshot of an asset's processing, moderation and content status when the
// event was created.
type EventAsset struct {
	ID             string                   `json:"id"`
	ExternalID     *string                  `json:"externalId,omitempty"`
	UploadPresetID *string                  `json:"uploadPresetId,omitempty"`
	Upload         EventAssetUpload         `json:"upload"`
	Classification EventAssetClassification `json:"classification"`
	Content        EventAssetContent        `json:"content"`
}

// EventAssetClassification is the asset's classification status when the event was created.
type EventAssetUpload struct {
	Status string `json:"status"`
}

type EventAssetClassification struct {
	// Status is one of the ClassificationStatus constants.
	Status string `json:"status"`
	// TestInput is whether the results came from one of the project's test inputs rather than
	// analysing the content. Never use test results, such as age ranges, for real decisions.
	TestInput  bool                 `json:"testInput"`
	Moderation EventAssetModeration `json:"moderation"`
}

// EventAssetModeration is the asset's moderation status when the event was created.
type EventAssetModeration struct {
	// Status is one of the ModerationStatus constants.
	Status string `json:"status"`
}

// EventAssetContent is whether CalmLens held the asset's content when the event was created.
type EventAssetContent struct {
	// Status is one of the ContentStatus constants.
	Status string `json:"status"`
}

// EventFact is one registered fact of an event. URL, when present, is a stable link that opens
// the fact's item in the CalmLens portal.
//
// Value is any JSON value because its type depends on Key and the event type (a string,
// number, boolean, string list or null); numbers are json.Number. Read it with Text, Int64,
// Bool or Strings, or decode every fact at once with EventFacts.Decode.
type EventFact struct {
	Key   string  `json:"key"`
	Value any     `json:"value"`
	URL   *string `json:"url,omitempty"`
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
func (facts EventFacts) Get(key string) (EventFact, bool) {
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
func GetEventFact(event *Event, key string) any {
	if event == nil {
		return nil
	}
	fact, _ := event.Facts.Get(key)
	return fact.Value
}

// GetEventFacts returns event's facts as values by key, such as
// {"flagged-categories": ["hate"]}. A key the event repeats keeps its first value, as
// GetEventFact reads it.
func GetEventFacts(event *Event) map[string]any {
	values := map[string]any{}
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
	values := make(map[string]any, len(facts))
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
	AssetName  *string `json:"asset-name"`
	AssetType  *string `json:"asset-type"`
	FileFormat *string `json:"file-format"`
}

// AssetClassifiedFacts are the facts of EventAssetClassified. FlaggedCategories are the parent
// policy categories whose findings decided the status (empty when nothing was acted on), and
// ModerationStatus is the status the policy decided (a ModerationStatus constant other than
// pending); a reviewer's earlier decision on the asset keeps precedence.
type AssetClassifiedFacts struct {
	AssetName         *string  `json:"asset-name"`
	AssetType         *string  `json:"asset-type"`
	FlaggedCategories []string `json:"flagged-categories"`
	ModerationStatus  string   `json:"moderation-status"`
}

// AssetDecisionFacts are the facts of EventAssetAllowed, EventAssetLimited,
// EventAssetAgeRestricted, EventAssetBlocked and EventAssetPurged, one event per moderation
// status. The event's Actor says who set it: ActorAutomated moderation, an ActorUser (a reviewer
// in the portal, or an assistant acting for one) or an ActorAPIKey through the API.
// FlaggedCategories, when present, are the parent policy categories whose findings decided the
// status. Note is set only for reviewer decisions.
type AssetDecisionFacts struct {
	AssetName         *string  `json:"asset-name"`
	AssetType         *string  `json:"asset-type"`
	FlaggedCategories []string `json:"flagged-categories"`
	Note              *string  `json:"note"`
}

// AssetRerunRequestedFacts are the facts of EventAssetRerunRequested, recorded when the event's
// Actor asks for a decided asset to be moderated again (AssetsService.Explain with Rerun).
// ModerationStatus is the asset's status when the re-run was requested (a ModerationStatus
// constant other than pending), which stands until the re-run's EventAssetClassified and
// asset.<status> events report the new one; a failed re-run keeps it.
type AssetRerunRequestedFacts struct {
	AssetName        *string `json:"asset-name"`
	AssetType        *string `json:"asset-type"`
	ModerationStatus string  `json:"moderation-status"`
}

// AssetFailedFacts are the facts of EventAssetFailed.
type AssetFailedFacts struct {
	AssetName *string `json:"asset-name"`
	AssetType *string `json:"asset-type"`
	// PreviousStatus is the classification status (a ClassificationStatus constant) before the failure.
	PreviousStatus *string `json:"previous-status"`
	// FailureReason is why processing failed (an AssetFailureReason constant).
	FailureReason string `json:"failure-reason"`
}

// AssetProgressUpdatedFacts are the facts of EventAssetProgressUpdated, sent while long audio or
// video analysed in sections finishes more of them. CompletedSections and TotalSections match the
// asset's AssetClassification.Progress.
type AssetProgressUpdatedFacts struct {
	AssetName         *string `json:"asset-name"`
	AssetType         *string `json:"asset-type"`
	CompletedSections int64   `json:"completed-sections"`
	TotalSections     int64   `json:"total-sections"`
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

// Values of FactConnectorType. ConnectorDisabledFacts.ConnectorType is a plain string so types
// added later still decode.
const (
	ConnectorTypeInApp   = "in-app"
	ConnectorTypeWebhook = "webhook"
	ConnectorTypeSlack   = "slack"
	ConnectorTypeEmail   = "email"
)

// ConnectorDisabledFacts are the facts of EventConnectorDisabled, sent when deliveries to a
// connector kept failing and it was turned off. ConnectorType is a ConnectorType constant.
// LastError stays in the portal and is nil on webhook deliveries.
type ConnectorDisabledFacts struct {
	ConnectorID         string  `json:"connector-id"`
	ConnectorName       string  `json:"connector-name"`
	ConnectorType       string  `json:"connector-type"`
	ConsecutiveFailures int64   `json:"consecutive-failures"`
	LastError           *string `json:"last-error"`
}

// AssetRemovedFacts are the facts of EventAssetDeleted, EventAssetContentRemoved and
// EventAssetRetried. BatchID, on the deletions and content removals an Assets.Batch operation
// causes, is its BatchAssetsResponse.BatchID; nil otherwise.
type AssetRemovedFacts struct {
	AssetName *string `json:"asset-name"`
	AssetType *string `json:"asset-type"`
	BatchID   *string `json:"batch-id"`
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

// Values of FactMethod on EventProjectTransferred.
const (
	// TransferMethodHandover is a project an owner of the receiving organisation accepted from
	// another organisation.
	TransferMethodHandover = "handover"
	// TransferMethodMove is a project someone who owns both organisations moved.
	TransferMethodMove = "move"
)

// ProjectTransferredFacts are the facts of EventProjectTransferred, sent when the project moved
// to another organisation. Method is TransferMethodHandover or TransferMethodMove; a handover
// revokes APIKeysRevoked of the project's API keys and pauses ConnectorsPaused of its connectors.
type ProjectTransferredFacts struct {
	PreviousOrganisationID   string `json:"previous-organisation-id"`
	PreviousOrganisationName string `json:"previous-organisation-name"`
	OrganisationID           string `json:"organisation-id"`
	OrganisationName         string `json:"organisation-name"`
	Method                   string `json:"method"`
	APIKeysRevoked           int64  `json:"api-keys-revoked"`
	ConnectorsPaused         int64  `json:"connectors-paused"`
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
