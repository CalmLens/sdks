<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * A named image transform the CDN applies at `/@<identifier>`.
 *
 * @property-read string $id
 * @property-read null|string $projectId
 * @property-read string $identifier
 * @property-read string $name
 * @property-read null|string $description
 * @property-read self::TYPE_* $type
 * @property-read bool $active
 * @property-read null|array<string, mixed> $transform
 * @property-read int $createdAt
 * @property-read null|int $updatedAt
 */
final class Lens extends CalmLensObject
{
    public const TYPE_IMAGE = 'image';
    public const TYPE_VIDEO = 'video';
    public const TYPE_AUDIO = 'audio';
    public const TYPE_DOCUMENT = 'document';
    public const TYPE_WEBSITE = 'website';
}
