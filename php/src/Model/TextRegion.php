<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read Box $box
 * @property-read bool $personalInformation
 */
final class TextRegion extends CalmLensObject
{
    protected const FIELDS = [
        'box' => Box::class,
    ];
}
