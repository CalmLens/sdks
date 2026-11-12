<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::STATUS_* $status
 * @property-read null|int|float $someScore
 * @property-read null|int|float $allScore
 * @property-read null|self::LIKELIHOOD_* $likelihood
 * @property-read null|self::REASON_* $reason
 */
final class QualifierResult extends CalmLensObject
{
    public const STATUS_EVALUATED = 'evaluated';
    public const STATUS_NOT_EVALUATED = 'not-evaluated';

    public const LIKELIHOOD_VERY_UNLIKELY = 'very-unlikely';
    public const LIKELIHOOD_UNLIKELY = 'unlikely';
    public const LIKELIHOOD_POSSIBLE = 'possible';
    public const LIKELIHOOD_LIKELY = 'likely';
    public const LIKELIHOOD_VERY_LIKELY = 'very-likely';

    public const REASON_NOT_SUPPORTED = 'not-supported';
    public const REASON_UNAVAILABLE = 'unavailable';
}
