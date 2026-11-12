<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::STATUS_* $status
 * @property-read null|self::REMOVAL_REASON_* $removalReason
 * @property-read null|int $updatedAt
 * @property-read null|SafetyHold $safetyHold
 * @property-read null|string $format
 * @property-read null|string $extension
 * @property-read null|int $sizeInBytes
 * @property-read null|Checksums $checksums
 * @property-read null|int $width
 * @property-read null|int $height
 * @property-read null|int|float $durationSeconds
 * @property-read null|int $pageCount
 * @property-read null|string $perceptualHash
 * @property-read null|int $perceptualHashQuality
 * @property-read null|ContentMetadata $metadata
 * @property-read null|ExtractedText $extractedText
 * @property-read null|RenderedFile $rendered
 * @property-read null|HlsStream $hls
 * @property-read null|Preview $preview
 */
final class AssetContent extends CalmLensObject
{
    public const STATUS_TEMPORARY = 'temporary';
    public const STATUS_STORED = 'stored';
    public const STATUS_REMOVED = 'removed';

    public const REMOVAL_REASON_POLICY = 'policy';
    public const REMOVAL_REASON_RETENTION = 'retention';
    public const REMOVAL_REASON_REQUESTED = 'requested';
    public const REMOVAL_REASON_PARENT_REMOVED = 'parent-removed';
    public const REMOVAL_REASON_DISPOSED = 'disposed';

    protected const FIELDS = [
        'safetyHold' => SafetyHold::class,
        'checksums' => Checksums::class,
        'metadata' => ContentMetadata::class,
        'extractedText' => ExtractedText::class,
        'rendered' => RenderedFile::class,
        'hls' => HlsStream::class,
        'preview' => Preview::class,
    ];
}
