<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::TYPE_* $type
 * @property-read null|string $id
 */
final class Reviewer extends CalmLensObject
{
    public const TYPE_USER = 'user';
    public const TYPE_API_KEY = 'api-key';
}
