<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * The display info of an asset URL (`Cdn::getAssetInfo`): the public fields a viewer needs, and
 * whether the viewer its claims describe can see the asset now.
 *
 * @property-read string $id
 * @property-read string $projectId
 * @property-read Asset::TYPE_* $type
 * @property-read null|string $externalUrl
 * @property-read AssetInfoContent $content
 * @property-read self::AVAILABILITY_* $availability
 */
final class AssetInfo extends CalmLensObject
{
    public const AVAILABILITY_AVAILABLE = 'available';
    public const AVAILABILITY_AGE_RESTRICTED = 'age-restricted';
    public const AVAILABILITY_UNAVAILABLE = 'unavailable';

    protected const FIELDS = [
        'content' => AssetInfoContent::class,
    ];
}
