<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * An asset's moderation decision: `status`, and the evidence and reviews behind it.
 *
 * @property-read self::STATUS_* $status
 * @property-read list<ManualReview> $manualReviews
 * @property-read null|self::AUTOMATED_STATUS_* $automatedStatus
 * @property-read null|self::SOURCE_* $source
 * @property-read null|ModerationPolicy $policy
 * @property-read null|PendingReview $pendingReview
 * @property-read null|string $rule
 * @property-read null|bool $explanationComplete
 * @property-read null|array<Category::*, CategoryModeration> $categories
 * @property-read list<Category::*> $flaggedCategories
 * @property-read list<RegionRestriction> $regions
 * @property-read null|RawModeration $raw
 * @property-read null|ModerationTimeline $timeline
 */
final class Moderation extends CalmLensObject
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_ALLOWED = 'allowed';
    public const STATUS_LIMITED = 'limited';
    public const STATUS_AGE_RESTRICTED = 'age-restricted';
    public const STATUS_BLOCKED = 'blocked';
    public const STATUS_PURGED = 'purged';

    public const AUTOMATED_STATUS_ALLOWED = 'allowed';
    public const AUTOMATED_STATUS_LIMITED = 'limited';
    public const AUTOMATED_STATUS_AGE_RESTRICTED = 'age-restricted';
    public const AUTOMATED_STATUS_BLOCKED = 'blocked';
    public const AUTOMATED_STATUS_PURGED = 'purged';

    public const SOURCE_POLICY = 'policy';
    public const SOURCE_CHILDREN = 'children';
    public const SOURCE_HASH_LIST = 'hash-list';
    public const SOURCE_MANDATORY_RULE = 'mandatory-rule';

    protected const FIELDS = [
        'manualReviews' => [ManualReview::class],
        'policy' => ModerationPolicy::class,
        'pendingReview' => PendingReview::class,
        'categories' => ['*' => CategoryModeration::class],
        'regions' => [RegionRestriction::class],
        'raw' => RawModeration::class,
        'timeline' => ModerationTimeline::class,
    ];
}
