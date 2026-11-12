<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read int $requestedAt
 * @property-read self::REASON_* $reason
 * @property-read list<Category::*> $uncertainCategories
 */
final class PendingReview extends CalmLensObject
{
    public const REASON_SAMPLED = 'sampled';
    public const REASON_UNCERTAIN = 'uncertain';
}
