<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::STATUS_* $status
 * @property-read null|self::LIKELIHOOD_* $likelihood
 * @property-read null|int|float $score
 * @property-read null|array<Qualifier::*, QualifierResult> $qualifiers
 * @property-read null|self::REASON_* $reason
 */
final class CategoryResult extends CalmLensObject
{
    public const STATUS_EVALUATED = 'evaluated';
    public const STATUS_PARTIAL = 'partial';
    public const STATUS_NOT_EVALUATED = 'not-evaluated';

    public const LIKELIHOOD_VERY_UNLIKELY = 'very-unlikely';
    public const LIKELIHOOD_UNLIKELY = 'unlikely';
    public const LIKELIHOOD_POSSIBLE = 'possible';
    public const LIKELIHOOD_LIKELY = 'likely';
    public const LIKELIHOOD_VERY_LIKELY = 'very-likely';

    public const REASON_NOT_SUPPORTED = 'not-supported';
    public const REASON_UNAVAILABLE = 'unavailable';

    protected const FIELDS = [
        'qualifiers' => ['*' => QualifierResult::class],
    ];
}
