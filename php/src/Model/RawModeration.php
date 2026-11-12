<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read array<Category::*, CategoryResult> $categories
 * @property-read list<HashMatch> $hashMatches
 */
final class RawModeration extends CalmLensObject
{
    protected const FIELDS = [
        'categories' => ['*' => CategoryResult::class],
        'hashMatches' => [HashMatch::class],
    ];
}
