<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * A folder of assets.
 *
 * @property-read string $id
 * @property-read string $projectId
 * @property-read null|string $parentId
 * @property-read string $name
 * @property-read int $createdAt
 * @property-read null|int $updatedAt
 */
final class Folder extends CalmLensObject
{
}
