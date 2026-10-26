/** The most recent earlier posts CalmLens uses. */
declare const MODERATION_CONTEXT_USED_ITEMS = 5;
/**
 * The most characters of earlier posts CalmLens uses. The newest post always fits, since no post
 * may be longer.
 */
declare const MODERATION_CONTEXT_USED_CHARACTERS = 2000;
/** An earlier post in the conversation. */
interface ModerationContextItem {
  text: string;
  authorId?: string;
}
/**
 * The earlier posts CalmLens uses: the most recent ones, newest first, while at most
 * `MODERATION_CONTEXT_USED_ITEMS` and `MODERATION_CONTEXT_USED_CHARACTERS` allow, returned oldest
 * first. The newest post is always kept, so an over-long one is left for validation to reject.
 */
declare const selectModerationContextItems: <Item extends ModerationContextItem>(items: readonly Item[]) => Item[];
export { selectModerationContextItems as i, MODERATION_CONTEXT_USED_ITEMS as n, ModerationContextItem as r, MODERATION_CONTEXT_USED_CHARACTERS as t };