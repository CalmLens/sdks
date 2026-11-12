<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * The settings an upload token or browser upload gets.
 *
 * @property-read string $id
 * @property-read string $projectId
 * @property-read null|string $createdByUserId
 * @property-read string $key
 * @property-read int $revision
 * @property-read string $name
 * @property-read self::ACCESS_* $access
 * @property-read bool $enabled
 * @property-read null|list<string> $allowedContentTypes
 * @property-read null|int $maxSizeInBytes
 * @property-read null|string $folderId
 * @property-read null|string $policyId
 * @property-read self::VISIBILITY_* $visibility
 * @property-read null|ProcessingOptions $processingOptions
 * @property-read bool $revealDecision
 * @property-read null|int $dailyUploadLimit
 * @property-read null|list<string> $allowedOrigins
 * @property-read int $createdAt
 * @property-read null|int $updatedAt
 */
final class UploadPreset extends CalmLensObject
{
    public const ACCESS_TOKEN = 'token';
    public const ACCESS_ANYONE = 'anyone';

    public const VISIBILITY_PUBLIC = 'public';
    public const VISIBILITY_PRIVATE = 'private';

    protected const FIELDS = [
        'processingOptions' => ProcessingOptions::class,
    ];
}
