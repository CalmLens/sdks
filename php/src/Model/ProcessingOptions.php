<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read null|bool $retainContent
 * @property-read null|bool $storeSensitiveMetadata
 * @property-read null|ProcessingFeatures $features
 */
final class ProcessingOptions extends CalmLensObject
{
    protected const FIELDS = [
        'features' => ProcessingFeatures::class,
    ];
}
