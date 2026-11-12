<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read bool $retainContent
 * @property-read list<self::OPT_OUT_JURISDICTIONS_*> $optOutJurisdictions
 * @property-read bool $blockUnmoderatedAssets
 * @property-read bool $storeSensitiveMetadata
 * @property-read bool $linkCheckingEnabled
 * @property-read bool $streamingEnabled
 * @property-read bool $aiMediaSearchEnabled
 * @property-read null|RemoteUrlRule $remoteUrlRule
 * @property-read null|int $websiteSubmissionsPerMinute
 * @property-read HumanReviewSettings $humanReview
 */
final class ProjectSettingsValues extends CalmLensObject
{
    public const OPT_OUT_JURISDICTIONS_EU = 'EU';

    protected const FIELDS = [
        'remoteUrlRule' => RemoteUrlRule::class,
        'humanReview' => HumanReviewSettings::class,
    ];
}
