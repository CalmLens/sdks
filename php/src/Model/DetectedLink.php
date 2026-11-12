<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read string $url
 * @property-read self::SOURCE_* $source
 */
final class DetectedLink extends CalmLensObject
{
    public const SOURCE_QR_CODE = 'qr-code';
    public const SOURCE_TEXT = 'text';
}
