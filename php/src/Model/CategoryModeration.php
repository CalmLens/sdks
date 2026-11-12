<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read int|float $score
 * @property-read self::ACTION_* $action
 * @property-read null|AppliedCategorySettings $settings
 * @property-read null|DecisionSource $source
 */
final class CategoryModeration extends CalmLensObject
{
    public const ACTION_ALLOW = 'allow';
    public const ACTION_LIMIT = 'limit';
    public const ACTION_AGE_RESTRICT = 'age-restrict';
    public const ACTION_BLOCK = 'block';
    public const ACTION_PURGE = 'purge';

    protected const FIELDS = [
        'settings' => AppliedCategorySettings::class,
        'source' => DecisionSource::class,
    ];
}
