<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;

/**
 * Earlier posts in a conversation, sent as an upload's `context` (`['items' => [['text' => ...,
 * 'authorId' => ...], ...]]`, oldest first). CalmLens uses only the most recent of them, so the
 * SDK sends only those.
 */
final class ModerationContext
{
    /** The most recent earlier posts CalmLens uses. */
    public const USED_ITEMS = 5;
    /** The most characters (Unicode code points) of earlier posts CalmLens uses. */
    public const USED_CHARACTERS = 2000;

    /**
     * The earlier posts CalmLens uses: the most recent ones, newest first, while at most
     * `USED_ITEMS` posts and `USED_CHARACTERS` characters allow, returned oldest first as
     * `['text' => ..., 'authorId' => ...]` (`authorId` only when given). The newest post is always
     * kept, so an over-long one is left for the API to reject.
     *
     * @param list<array{text: string, authorId?: string}> $items
     * @return list<array{text: string, authorId?: string}>
     */
    public static function select(array $items): array
    {
        if (!array_is_list($items)) {
            Values::invalid('context.items must be a list of earlier posts');
        }
        $selected = [];
        $characters = 0;
        for ($index = count($items) - 1; $index >= 0 && count($selected) < self::USED_ITEMS; $index--) {
            $item = $items[$index];
            $text = is_array($item) ? ($item['text'] ?? null) : null;
            $authorId = is_array($item) ? ($item['authorId'] ?? null) : null;
            if (!is_string($text) || ($authorId !== null && !is_string($authorId))) {
                Values::invalid('Every earlier post needs a text string and an optional authorId string');
            }
            // Code points: every byte but UTF-8 continuation bytes, without needing mbstring.
            $length = strlen($text) - preg_match_all('/[\x80-\xBF]/', $text);
            if ($selected !== [] && $characters + $length > self::USED_CHARACTERS) {
                break;
            }
            array_unshift($selected, $authorId === null ? ['text' => $text] : ['text' => $text, 'authorId' => $authorId]);
            $characters += $length;
        }
        return $selected;
    }
}
