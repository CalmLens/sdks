<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::STATUS_* $status
 * @property-read null|self::REASON_* $reason
 * @property-read list<HlsRendition> $renditions
 */
final class HlsStream extends CalmLensObject
{
    public const STATUS_PREPARING = 'preparing';
    public const STATUS_READY = 'ready';
    public const STATUS_UNAVAILABLE = 'unavailable';

    public const REASON_ALLOWANCE_USED = 'allowance-used';
    public const REASON_BILLING_REQUIRED = 'billing-required';
    public const REASON_SPEND_LIMIT = 'spend-limit';
    public const REASON_PROCESSING_FAILED = 'processing-failed';
    public const REASON_CONTENT_NOT_KEPT = 'content-not-kept';

    protected const FIELDS = [
        'renditions' => [HlsRendition::class],
    ];
}
