<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::STATUS_* $status
 * @property-read bool $testInput
 * @property-read EventAssetModeration $moderation
 */
final class EventAssetClassification extends CalmLensObject
{
    public const STATUS_QUEUED = 'queued';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';

    protected const FIELDS = [
        'moderation' => EventAssetModeration::class,
    ];
}
