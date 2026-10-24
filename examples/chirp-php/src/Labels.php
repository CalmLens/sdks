<?php

declare(strict_types=1);

namespace Chirp;

/** Words for CalmLens category IDs, used to tell authors why something wasn't posted. */
final class Labels
{
    public const CATEGORIES = [
        'sexual' => 'sexual content',
        'violence' => 'violence',
        'self-harm' => 'self-harm',
        'harassment' => 'harassment',
        'hate' => 'hate speech',
        'criminal-activity' => 'criminal activity',
    ];

    /** @param list<string> $categories */
    public static function describe(array $categories): string
    {
        $labels = array_map(fn ($category) => self::CATEGORIES[$category] ?? $category, $categories);
        return match (count($labels)) {
            0 => 'something our community guidelines don’t allow',
            1 => $labels[0],
            default => implode(', ', array_slice($labels, 0, -1)) . ' and ' . end($labels),
        };
    }
}
