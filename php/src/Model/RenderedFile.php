<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::KIND_* $kind
 * @property-read string $format
 * @property-read null|int $width
 * @property-read null|int $height
 * @property-read null|list<int|float> $peaks
 */
final class RenderedFile extends CalmLensObject
{
    public const KIND_IMAGE = 'image';
    public const KIND_PDF = 'pdf';
    public const KIND_VIDEO = 'video';
    public const KIND_AUDIO = 'audio';
}
