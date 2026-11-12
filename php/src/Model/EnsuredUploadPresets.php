<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read list<UploadPreset> $uploadPresets
 */
final class EnsuredUploadPresets extends CalmLensObject
{
    protected const FIELDS = [
        'uploadPresets' => [UploadPreset::class],
    ];
}
