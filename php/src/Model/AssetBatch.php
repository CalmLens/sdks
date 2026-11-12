<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * A queued batch of asset deletions or content removals.
 *
 * @property-read string $batchId
 * @property-read self::STATUS_* $status
 * @property-read int $assetCount
 */
final class AssetBatch extends CalmLensObject
{
    public const STATUS_QUEUED = 'queued';
}
