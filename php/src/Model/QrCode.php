<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read string $value
 * @property-read Box $box
 */
final class QrCode extends CalmLensObject
{
    protected const FIELDS = [
        'box' => Box::class,
    ];
}
