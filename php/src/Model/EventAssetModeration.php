<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::STATUS_* $status
 */
final class EventAssetModeration extends CalmLensObject
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_ALLOWED = 'allowed';
    public const STATUS_LIMITED = 'limited';
    public const STATUS_AGE_RESTRICTED = 'age-restricted';
    public const STATUS_BLOCKED = 'blocked';
    public const STATUS_PURGED = 'purged';
}
