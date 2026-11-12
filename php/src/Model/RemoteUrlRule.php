<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::MODE_* $mode
 * @property-read list<string> $domains
 */
final class RemoteUrlRule extends CalmLensObject
{
    public const MODE_ALLOW = 'allow';
    public const MODE_DENY = 'deny';
}
