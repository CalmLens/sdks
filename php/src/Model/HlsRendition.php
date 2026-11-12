<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::KIND_* $kind
 * @property-read null|int $width
 * @property-read null|int $height
 * @property-read int $bandwidth
 * @property-read string $codecs
 */
final class HlsRendition extends CalmLensObject
{
    public const KIND_VIDEO = 'video';
    public const KIND_AUDIO = 'audio';
}
