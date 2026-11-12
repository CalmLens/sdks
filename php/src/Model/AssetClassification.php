<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * How far an asset's classification has got, and what it found.
 *
 * @property-read self::STATUS_* $status
 * @property-read null|self::FAILURE_REASON_* $failureReason
 * @property-read null|int $updatedAt
 * @property-read null|int $completedAt
 * @property-read null|ClassificationProgress $progress
 * @property-read bool $testInput
 * @property-read Moderation $moderation
 * @property-read null|OcrResult $ocr
 * @property-read null|PersonDetection $personDetection
 * @property-read null|FaceDetection $faceDetection
 * @property-read null|LinkDetection $linkDetection
 */
final class AssetClassification extends CalmLensObject
{
    public const STATUS_QUEUED = 'queued';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';

    public const FAILURE_REASON_FILE_TOO_LARGE = 'file-too-large';
    public const FAILURE_REASON_DURATION_LIMIT = 'duration-limit';
    public const FAILURE_REASON_RESOLUTION_LIMIT = 'resolution-limit';
    public const FAILURE_REASON_UNSUPPORTED_FORMAT = 'unsupported-format';
    public const FAILURE_REASON_UNDECODABLE_CONTENT = 'undecodable-content';
    public const FAILURE_REASON_MULTIPLE_TRACKS = 'multiple-tracks';
    public const FAILURE_REASON_TYPE_MISMATCH = 'type-mismatch';
    public const FAILURE_REASON_FREE_UPLOADS_EXHAUSTED = 'free-uploads-exhausted';
    public const FAILURE_REASON_MEDIA_LIMIT = 'media-limit';
    public const FAILURE_REASON_UPLOADS_PAUSED = 'uploads-paused';
    public const FAILURE_REASON_TOO_MANY_ITEMS = 'too-many-items';
    public const FAILURE_REASON_PROCESSING_ERROR = 'processing-error';

    protected const FIELDS = [
        'progress' => ClassificationProgress::class,
        'moderation' => Moderation::class,
        'ocr' => OcrResult::class,
        'personDetection' => PersonDetection::class,
        'faceDetection' => FaceDetection::class,
        'linkDetection' => LinkDetection::class,
    ];
}
