<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::STATUS_* $status
 * @property-read null|list<DetectedFace> $faces
 * @property-read null|self::REASON_* $reason
 */
final class FaceDetection extends CalmLensObject
{
    public const STATUS_EVALUATED = 'evaluated';
    public const STATUS_NOT_EVALUATED = 'not-evaluated';

    public const REASON_NOT_SUPPORTED = 'not-supported';
    public const REASON_UNAVAILABLE = 'unavailable';
    public const REASON_IN_CHILDREN = 'in-children';

    protected const FIELDS = [
        'faces' => [DetectedFace::class],
    ];
}
