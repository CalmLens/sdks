<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::TYPE_* $type
 * @property-read null|string $content
 * @property-read null|string $id
 */
final class ExtractedText extends CalmLensObject
{
    public const TYPE_STRING = 'string';
    public const TYPE_DOCUMENT = 'document';
}
