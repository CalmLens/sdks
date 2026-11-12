<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read Box $box
 * @property-read int|float $confidence
 */
final class DetectedPerson extends CalmLensObject
{
    protected const FIELDS = [
        'box' => Box::class,
    ];
}
