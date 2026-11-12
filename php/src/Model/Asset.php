<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * An uploaded asset: its content, classification and moderation decision.
 *
 * @property-read string $id
 * @property-read string $projectId
 * @property-read null|string $parentId
 * @property-read null|string $folderId
 * @property-read null|string $uploadPresetId
 * @property-read int $createdAt
 * @property-read null|int $updatedAt
 * @property-read self::TYPE_* $type
 * @property-read string $name
 * @property-read null|string $description
 * @property-read null|string $externalId
 * @property-read null|string $externalUrl
 * @property-read null|string $authorId
 * @property-read null|AssetContext $context
 * @property-read list<int> $parentPages
 * @property-read list<AssetMetadata> $metadata
 * @property-read list<string> $tags
 * @property-read self::VISIBILITY_* $visibility
 * @property-read AssetUpload $upload
 * @property-read AssetClassification $classification
 * @property-read AssetContent $content
 */
final class Asset extends CalmLensObject
{
    public const TYPE_IMAGE = 'image';
    public const TYPE_VIDEO = 'video';
    public const TYPE_AUDIO = 'audio';
    public const TYPE_PLAINTEXT_DOCUMENT = 'plaintext-document';
    public const TYPE_MULTIMEDIA_DOCUMENT = 'multimedia-document';
    public const TYPE_WEBSITE = 'website';
    public const TYPE_FILE = 'file';

    public const VISIBILITY_PUBLIC = 'public';
    public const VISIBILITY_PRIVATE = 'private';

    protected const FIELDS = [
        'context' => AssetContext::class,
        'metadata' => [AssetMetadata::class],
        'upload' => AssetUpload::class,
        'classification' => AssetClassification::class,
        'content' => AssetContent::class,
    ];
}
