// ../../../../private/tmp/calmlens-explicit-scenario-contract/packages/shared/src/ModerationContextLimits.ts
/** The longest earlier post one request may send. */
const MODERATION_CONTEXT_MAX_ITEM_CHARACTERS = 2e3;
/** The most characters of earlier posts one request may send in total. */
const MODERATION_CONTEXT_MAX_CHARACTERS = 1e4;
/** The most recent earlier posts CalmLens uses. */
const MODERATION_CONTEXT_USED_ITEMS = 5;
/**
* The most characters of earlier posts CalmLens uses. The newest post always fits, since no post
* may be longer.
*/
const MODERATION_CONTEXT_USED_CHARACTERS = 2e3;
/** Unicode code points, as every SDK counts characters. */
const countModerationContextCharacters = (text) => {
	let count = 0;
	for (const _ of text) count++;
	return count;
};
/**
* The earlier posts CalmLens uses: the most recent ones, newest first, while at most
* `MODERATION_CONTEXT_USED_ITEMS` and `MODERATION_CONTEXT_USED_CHARACTERS` allow, returned oldest
* first. The newest post is always kept, so an over-long one is left for validation to reject.
*/
const selectModerationContextItems = (items) => {
	const selected = [];
	let characters = 0;
	for (let index = items.length - 1; index >= 0; index--) {
		if (selected.length === 5) break;
		const item = items[index];
		const length = countModerationContextCharacters(item.text);
		if (selected.length && characters + length > 2e3) break;
		selected.unshift(item);
		characters += length;
	}
	return selected;
};
export { countModerationContextCharacters as a, MODERATION_CONTEXT_USED_ITEMS as i, MODERATION_CONTEXT_MAX_ITEM_CHARACTERS as n, selectModerationContextItems as o, MODERATION_CONTEXT_USED_CHARACTERS as r, MODERATION_CONTEXT_MAX_CHARACTERS as t };
