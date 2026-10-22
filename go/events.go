package calmlens

import "encoding/json"

// Event types. Type is a plain string so event types added later still decode.
const (
	EventAssetUploaded                 = "asset.uploaded"
	EventAssetFlagged                  = "asset.flagged"
	EventAssetApproved                 = "asset.approved"
	EventAssetRejected                 = "asset.rejected"
	EventAssetFailed                   = "asset.failed"
	EventAssetDeleted                  = "asset.deleted"
	EventAssetContentRemoved           = "asset.content-removed"
	EventAssetRetried                  = "asset.retried"
	EventUsageLimitReached             = "usage.limit-reached"
	EventUsageSpendLimitReached        = "usage.spend-limit-reached"
	EventUploadPresetDailyLimitReached = "upload-preset.daily-limit-reached"
	EventProjectMemberJoined           = "project.member-joined"
	EventProjectMemberRemoved          = "project.member-removed"
	EventProjectMemberRoleChanged      = "project.member-role-changed"
	EventProjectInvitationSent         = "project.invitation-sent"
	EventAPIKeyCreated                 = "api-key.created"
	EventAPIKeyRevoked                 = "api-key.revoked"
	EventConnectorFailing              = "connector.failing"
)

// Event severities.
const (
	SeverityLow  = "low"
	SeverityHigh = "high"
)

// Registered fact keys. Each event type documents which keys it carries; FactTest marks a
// test send. Webhook, Slack and email deliveries and the public events feed leave out facts that
// hold personal or account data (names, email addresses, the project owner's ID), so those keys
// never appear on events you receive from them.
const (
	FactAssetName           = "asset-name"
	FactAssetType           = "asset-type"
	FactFileFormat          = "file-format"
	FactDecidedBy           = "decided-by"
	FactModerationAction    = "moderation-action"
	FactFlaggedCategories   = "flagged-categories"
	FactReviewerUserID      = "reviewer-user-id"
	FactReviewerName        = "reviewer-name"
	FactNote                = "note"
	FactPreviousStatus      = "previous-status"
	FactLimit               = "limit"
	FactUsed                = "used"
	FactOwnerUserID         = "owner-user-id"
	FactMemberUserID        = "member-user-id"
	FactMemberName          = "member-name"
	FactRole                = "role"
	FactInvitedByUserID     = "invited-by-user-id"
	FactConnectorID         = "connector-id"
	FactConnectorName       = "connector-name"
	FactConnectorType       = "connector-type"
	FactConsecutiveFailures = "consecutive-failures"
	FactLastError           = "last-error"
	FactResumesOn           = "resumes-on"
	FactPresetID            = "preset-id"
	FactPresetName          = "preset-name"
	FactDailyLimit          = "daily-limit"
	FactLeft                = "left"
	FactRemovedByUserID     = "removed-by-user-id"
	FactPreviousRole        = "previous-role"
	FactChangedByUserID     = "changed-by-user-id"
	FactKeyID               = "key-id"
	FactKeyName             = "key-name"
	FactAction              = "action"
	FactCreatedByUserID     = "created-by-user-id"
	FactRevokedByUserID     = "revoked-by-user-id"
	FactTest                = "test"
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
	Moderation EventAssetModeration `json:"moderation"`
	// Status is one of the ClassificationStatus constants.
	Status string `json:"status"`
}

// EventAssetModeration is the asset's moderation decision and policy action when the event was
// created.
type EventAssetModeration struct {
	Decision string `json:"decision"`
	// Action is ModerationActionFlag, ModerationActionHide or ModerationActionPurge, or nil
	// when nothing was flagged.
	Action *string `json:"action"`
}

// EventAssetContent is whether CalmLens held the asset's content when the event was created.
type EventAssetContent struct {
	// Status is one of the ContentStatus constants.
	Status string `json:"status"`
}

// EventFact is one registered fact of an event. URL, when present, links to the resource:
// a portal path or an HTTP(S) URL.
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
// such as *AssetFlaggedFacts. Facts without a matching field are ignored.
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

// AssetFlaggedFacts are the facts of EventAssetFlagged.
type AssetFlaggedFacts struct {
	AssetName         *string  `json:"asset-name"`
	AssetType         *string  `json:"asset-type"`
	FlaggedCategories []string `json:"flagged-categories"`
	ModerationAction  *string  `json:"moderation-action"`
}

// Values of FactDecidedBy.
const (
	DecidedByAutomated = "automated"
	DecidedByReviewer  = "reviewer"
)

// AssetDecisionFacts are the facts of EventAssetApproved and EventAssetRejected, which report the
// asset's outcome whether automated moderation or a reviewer decided it. DecidedBy is
// DecidedByAutomated or DecidedByReviewer. ModerationAction is the action applied to flagged
// content ("flag", "hide" or "purge"), or nil when nothing was flagged or a reviewer decided.
// ReviewerUserID, ReviewerName and Note are set only for reviewer decisions; ReviewerUserID is nil
// when an API key made the decision, and ReviewerName stays in the portal and is nil on webhook
// deliveries.
type AssetDecisionFacts struct {
	AssetName        *string `json:"asset-name"`
	AssetType        *string `json:"asset-type"`
	DecidedBy        string  `json:"decided-by"`
	ModerationAction *string `json:"moderation-action"`
	ReviewerUserID   *string `json:"reviewer-user-id"`
	ReviewerName     *string `json:"reviewer-name"`
	Note             *string `json:"note"`
}

// AssetFailedFacts are the facts of EventAssetFailed.
type AssetFailedFacts struct {
	AssetName *string `json:"asset-name"`
	AssetType *string `json:"asset-type"`
	// PreviousStatus is the classification status (a ClassificationStatus constant) before the failure.
	PreviousStatus *string `json:"previous-status"`
}

// UsageLimitReachedFacts are the facts of EventUsageLimitReached. OwnerUserID stays in the portal
// and is empty on webhook deliveries.
type UsageLimitReachedFacts struct {
	Limit       int64  `json:"limit"`
	Used        int64  `json:"used"`
	OwnerUserID string `json:"owner-user-id"`
}

// ProjectMemberJoinedFacts are the facts of EventProjectMemberJoined. Role is "admin",
// "editor", "viewer" or "custom"; other values may be added. MemberName stays in the portal and is
// nil on webhook deliveries.
type ProjectMemberJoinedFacts struct {
	MemberUserID    string  `json:"member-user-id"`
	MemberName      *string `json:"member-name"`
	Role            string  `json:"role"`
	InvitedByUserID *string `json:"invited-by-user-id"`
}

// ConnectorFailingFacts are the facts of EventConnectorFailing. LastError stays in the portal and
// is nil on webhook deliveries.
type ConnectorFailingFacts struct {
	ConnectorID         string  `json:"connector-id"`
	ConnectorName       string  `json:"connector-name"`
	ConnectorType       string  `json:"connector-type"`
	ConsecutiveFailures int64   `json:"consecutive-failures"`
	LastError           *string `json:"last-error"`
}

// AssetRemovedFacts are the facts of EventAssetDeleted, EventAssetContentRemoved and
// EventAssetRetried.
type AssetRemovedFacts struct {
	AssetName *string `json:"asset-name"`
	AssetType *string `json:"asset-type"`
}

// UsageSpendLimitReachedFacts are the facts of EventUsageSpendLimitReached. ResumesOn is a
// YYYY-MM-DD date in UTC.
type UsageSpendLimitReachedFacts struct {
	ResumesOn *string `json:"resumes-on"`
}

// UploadPresetDailyLimitReachedFacts are the facts of EventUploadPresetDailyLimitReached.
type UploadPresetDailyLimitReachedFacts struct {
	PresetID   string `json:"preset-id"`
	PresetName string `json:"preset-name"`
	DailyLimit int64  `json:"daily-limit"`
}

// ProjectMemberRemovedFacts are the facts of EventProjectMemberRemoved. Left is true when the
// member left the project themselves.
type ProjectMemberRemovedFacts struct {
	MemberUserID    string  `json:"member-user-id"`
	Role            string  `json:"role"`
	Left            bool    `json:"left"`
	RemovedByUserID *string `json:"removed-by-user-id"`
}

// ProjectMemberRoleChangedFacts are the facts of EventProjectMemberRoleChanged.
type ProjectMemberRoleChangedFacts struct {
	MemberUserID    string  `json:"member-user-id"`
	PreviousRole    string  `json:"previous-role"`
	Role            string  `json:"role"`
	ChangedByUserID *string `json:"changed-by-user-id"`
}

// ProjectInvitationSentFacts are the facts of EventProjectInvitationSent.
type ProjectInvitationSentFacts struct {
	Role            string  `json:"role"`
	InvitedByUserID *string `json:"invited-by-user-id"`
}

// APIKeyCreatedFacts are the facts of EventAPIKeyCreated.
type APIKeyCreatedFacts struct {
	KeyID           string  `json:"key-id"`
	KeyName         *string `json:"key-name"`
	Role            string  `json:"role"`
	CreatedByUserID *string `json:"created-by-user-id"`
}

// APIKeyRevokedFacts are the facts of EventAPIKeyRevoked. Action is "revoked" or "deleted".
type APIKeyRevokedFacts struct {
	KeyID           string  `json:"key-id"`
	KeyName         *string `json:"key-name"`
	Action          string  `json:"action"`
	RevokedByUserID *string `json:"revoked-by-user-id"`
}
