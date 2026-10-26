package calmlens

import "unicode/utf8"

// ModerationContextUsedItems is the most recent earlier posts CalmLens uses.
const ModerationContextUsedItems = 5

// ModerationContextUsedCharacters is the most characters (Unicode code points) of earlier posts
// CalmLens uses. The newest post always fits, since no post may be longer.
const ModerationContextUsedCharacters = 2000

// ModerationContextItem is an earlier post in the conversation. AuthorID is your identifier for
// who wrote it.
type ModerationContextItem struct {
	Text     string  `json:"text"`
	AuthorID *string `json:"authorId,omitempty"`
}

// ModerationContext holds earlier posts in the conversation, oldest first.
type ModerationContext struct {
	Items []ModerationContextItem `json:"items"`
}

// SelectModerationContextItems returns the earlier posts CalmLens uses, oldest first: the most
// recent ones while at most ModerationContextUsedItems posts and
// ModerationContextUsedCharacters characters (Unicode code points) allow. The newest post is
// always kept, so an over-long one is left for the API to reject. The result is never nil.
func SelectModerationContextItems(items []ModerationContextItem) []ModerationContextItem {
	start, characters := len(items), 0
	for start > 0 && len(items)-start < ModerationContextUsedItems {
		length := utf8.RuneCountInString(items[start-1].Text)
		if start < len(items) && characters+length > ModerationContextUsedCharacters {
			break
		}
		start--
		characters += length
	}
	return append([]ModerationContextItem{}, items[start:]...)
}

// selectedContext is context with only the posts CalmLens uses, or nil when context is nil.
func selectedContext(context *ModerationContext) *ModerationContext {
	if context == nil {
		return nil
	}
	return &ModerationContext{Items: SelectModerationContextItems(context.Items)}
}
