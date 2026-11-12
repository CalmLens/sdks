<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read int|float $allowedSamplePercent
 * @property-read int|float $restrictedSamplePercent
 * @property-read int|float $uncertaintyMarginPercent
 * @property-read bool $reviewMissingEvidence
 */
final class HumanReviewSettings extends CalmLensObject
{
}
