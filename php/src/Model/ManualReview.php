<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read string $id
 * @property-read self::DECISION_* $decision
 * @property-read null|string $note
 * @property-read Reviewer $decidedBy
 * @property-read int $reviewedAt
 * @property-read bool $applied
 */
final class ManualReview extends CalmLensObject
{
    public const DECISION_ALLOWED = 'allowed';
    public const DECISION_LIMITED = 'limited';
    public const DECISION_AGE_RESTRICTED = 'age-restricted';
    public const DECISION_BLOCKED = 'blocked';
    public const DECISION_PURGED = 'purged';

    protected const FIELDS = [
        'decidedBy' => Reviewer::class,
    ];
}
