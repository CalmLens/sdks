<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::SOURCE_* $source
 * @property-read string $hashListId
 * @property-read string $hashListEntryId
 * @property-read int $distance
 * @property-read self::ACTION_* $action
 */
final class HashMatch extends CalmLensObject
{
    public const SOURCE_HASH_LIST = 'hash-list';

    public const ACTION_FLAG = 'flag';
    public const ACTION_BLOCK = 'block';
}
