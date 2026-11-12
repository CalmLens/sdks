<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read null|self::DECISION_* $decision
 */
final class EventAssetModeration extends CalmLensObject
{
    public const DECISION_ALLOWED = 'allowed';
    public const DECISION_LIMITED = 'limited';
    public const DECISION_AGE_RESTRICTED = 'age-restricted';
    public const DECISION_BLOCKED = 'blocked';
    public const DECISION_PURGED = 'purged';
}
