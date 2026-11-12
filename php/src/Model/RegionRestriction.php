<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::REGION_* $region
 * @property-read self::STATUS_* $status
 * @property-read string $rule
 * @property-read null|Category::* $category
 */
final class RegionRestriction extends CalmLensObject
{
    public const REGION_DE = 'DE';
    public const REGION_AT = 'AT';
    public const REGION_FR = 'FR';
    public const REGION_GB = 'GB';
    public const REGION_EU = 'EU';
    public const REGION_AU = 'AU';
    public const REGION_BR = 'BR';

    public const STATUS_LIMITED = 'limited';
    public const STATUS_AGE_RESTRICTED = 'age-restricted';
    public const STATUS_BLOCKED = 'blocked';
    public const STATUS_PURGED = 'purged';
}
