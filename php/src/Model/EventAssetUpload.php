<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::STATUS_* $status
 */
final class EventAssetUpload extends CalmLensObject
{
    public const STATUS_UPLOADING = 'uploading';
    public const STATUS_COMPLETED = 'completed';
}
