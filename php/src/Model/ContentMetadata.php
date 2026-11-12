<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read null|string $capturedAt
 * @property-read null|string $cameraMake
 * @property-read null|string $cameraModel
 * @property-read null|string $lensModel
 * @property-read null|string $software
 * @property-read null|string $creator
 * @property-read null|string $copyright
 * @property-read null|string $digitalSourceType
 * @property-read bool $containsLocation
 * @property-read null|Location $location
 */
final class ContentMetadata extends CalmLensObject
{
    protected const FIELDS = [
        'location' => Location::class,
    ];
}
