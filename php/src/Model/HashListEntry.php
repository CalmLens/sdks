<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * One hash in a hash list.
 *
 * @property-read string $id
 * @property-read string $projectId
 * @property-read string $hashListId
 * @property-read string $hash
 * @property-read null|int $quality
 * @property-read null|string $label
 * @property-read null|string $assetId
 * @property-read int $createdAt
 */
final class HashListEntry extends CalmLensObject
{
}
