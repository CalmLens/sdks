<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::KIND_* $kind
 * @property-read null|list<int> $indexes
 * @property-read null|int|float $conditionScore
 */
final class DecisionSource extends CalmLensObject
{
    public const KIND_DEFAULT = 'default';
    public const KIND_BELOW_THRESHOLD = 'below-threshold';
    public const KIND_ALLOWANCE = 'allowance';
    public const KIND_RESTRICTION = 'restriction';
}
