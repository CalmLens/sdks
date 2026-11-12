<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read string $id
 * @property-read null|string $externalId
 * @property-read null|string $uploadPresetId
 * @property-read EventAssetUpload $upload
 * @property-read EventAssetClassification $classification
 * @property-read EventAssetContent $content
 */
final class EventAsset extends CalmLensObject
{
    protected const FIELDS = [
        'upload' => EventAssetUpload::class,
        'classification' => EventAssetClassification::class,
        'content' => EventAssetContent::class,
    ];
}
