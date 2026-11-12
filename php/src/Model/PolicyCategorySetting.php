<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read list<PolicyRule> $allowances
 * @property-read list<PolicyRule> $restrictions
 * @property-read self::ACTION_* $action
 */
final class PolicyCategorySetting extends CalmLensObject
{
    public const ACTION_ALLOW = 'allow';
    public const ACTION_LIMIT = 'limit';
    public const ACTION_AGE_RESTRICT = 'age-restrict';
    public const ACTION_BLOCK = 'block';
    public const ACTION_PURGE = 'purge';

    protected const FIELDS = [
        'allowances' => [PolicyRule::class],
        'restrictions' => [PolicyRule::class],
    ];
}
