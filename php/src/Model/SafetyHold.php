<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read int $placedAt
 * @property-read self::REASON_* $reason
 * @property-read null|int $disposedAt
 */
final class SafetyHold extends CalmLensObject
{
    public const REASON_SUSPECTED_ILLEGAL_CONTENT = 'suspected-illegal-content';
}
