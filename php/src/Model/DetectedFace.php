<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read Box $box
 * @property-read int|float $confidence
 * @property-read null|AgeRange $ageRange
 */
final class DetectedFace extends CalmLensObject
{
    protected const FIELDS = [
        'box' => Box::class,
        'ageRange' => AgeRange::class,
    ];
}
