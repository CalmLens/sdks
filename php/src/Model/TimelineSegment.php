<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::SOURCE_* $source
 * @property-read int|float $startSeconds
 * @property-read int|float $endSeconds
 * @property-read array<Category::*, CategoryResult> $categories
 */
final class TimelineSegment extends CalmLensObject
{
    public const SOURCE_FRAME = 'frame';
    public const SOURCE_SPEECH = 'speech';
    public const SOURCE_FRAME_TEXT = 'frame-text';
    public const SOURCE_CLIP = 'clip';

    protected const FIELDS = [
        'categories' => ['*' => CategoryResult::class],
    ];
}
