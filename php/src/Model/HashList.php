<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * A list of image hashes the project never wants again.
 *
 * @property-read string $id
 * @property-read string $projectId
 * @property-read string $name
 * @property-read null|string $description
 * @property-read self::ACTION_* $action
 * @property-read int $createdAt
 * @property-read null|int $updatedAt
 */
final class HashList extends CalmLensObject
{
    public const ACTION_FLAG = 'flag';
    public const ACTION_BLOCK = 'block';
}
