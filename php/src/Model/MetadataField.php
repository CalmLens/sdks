<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read string $id
 * @property-read string $title
 * @property-read null|string $description
 * @property-read self::TYPE_* $type
 * @property-read self::ICON_* $icon
 * @property-read string $color
 */
final class MetadataField extends CalmLensObject
{
    public const TYPE_STRING = 'string';
    public const TYPE_NUMBER = 'number';
    public const TYPE_BOOLEAN = 'boolean';
    public const TYPE_DATE = 'date';
    public const TYPE_URL = 'url';

    public const ICON_TAG = 'tag';
    public const ICON_HASH = 'hash';
    public const ICON_USER = 'user';
    public const ICON_FOLDER = 'folder';
    public const ICON_LAYERS = 'layers';
    public const ICON_PHOTO = 'photo';
    public const ICON_LINK = 'link';
}
