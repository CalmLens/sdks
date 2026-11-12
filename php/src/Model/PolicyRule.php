<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read null|string $name
 * @property-read list<Qualifier::*> $when
 * @property-read null|list<Qualifier::*> $unless
 * @property-read self::ACTION_* $action
 */
final class PolicyRule extends CalmLensObject
{
    public const ACTION_ALLOW = 'allow';
    public const ACTION_LIMIT = 'limit';
    public const ACTION_AGE_RESTRICT = 'age-restrict';
    public const ACTION_BLOCK = 'block';
    public const ACTION_PURGE = 'purge';
}
