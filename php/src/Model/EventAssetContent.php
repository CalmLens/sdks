<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::STATUS_* $status
 */
final class EventAssetContent extends CalmLensObject
{
    public const STATUS_TEMPORARY = 'temporary';
    public const STATUS_STORED = 'stored';
    public const STATUS_REMOVED = 'removed';
}
