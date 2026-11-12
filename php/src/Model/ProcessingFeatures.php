<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read null|FeatureSetting $ocr
 * @property-read null|FeatureSetting $personDetection
 * @property-read null|FaceDetectionSetting $faceDetection
 * @property-read null|FeatureSetting $linkDetection
 * @property-read null|FeatureSetting $streaming
 */
final class ProcessingFeatures extends CalmLensObject
{
    protected const FIELDS = [
        'ocr' => FeatureSetting::class,
        'personDetection' => FeatureSetting::class,
        'faceDetection' => FaceDetectionSetting::class,
        'linkDetection' => FeatureSetting::class,
        'streaming' => FeatureSetting::class,
    ];
}
