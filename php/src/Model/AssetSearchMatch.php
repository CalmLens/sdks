<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read Asset $asset
 * @property-read int|float $score
 * @property-read list<self::MATCHED_FIELDS_*> $matchedFields
 */
final class AssetSearchMatch extends CalmLensObject
{
    public const MATCHED_FIELDS_NAME = 'name';
    public const MATCHED_FIELDS_ID = 'id';
    public const MATCHED_FIELDS_EXTERNAL_ID = 'externalId';
    public const MATCHED_FIELDS_DESCRIPTION = 'description';
    public const MATCHED_FIELDS_TAGS = 'tags';
    public const MATCHED_FIELDS_TYPE = 'type';
    public const MATCHED_FIELDS_CONTENT_FORMAT = 'content.format';
    public const MATCHED_FIELDS_CONTENT_EXTENSION = 'content.extension';
    public const MATCHED_FIELDS_CLASSIFICATION_MODERATION_DECISION = 'classification.moderation.decision';
    public const MATCHED_FIELDS_VISUAL = 'visual';
    public const MATCHED_FIELDS_TRANSCRIPT = 'transcript';

    protected const FIELDS = [
        'asset' => Asset::class,
    ];
}
