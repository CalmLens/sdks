<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::TYPE_* $type
 * @property-read null|string $id
 */
final class EventActor extends CalmLensObject
{
    public const TYPE_USER = 'user';
    public const TYPE_API_KEY = 'api-key';
    public const TYPE_AUTOMATED = 'automated';
    public const TYPE_SYSTEM = 'system';
}
