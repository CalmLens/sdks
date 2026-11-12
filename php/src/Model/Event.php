<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * An event in the project's feed or a webhook delivery. Read its facts with
 * `Webhooks::eventFact()`.
 *
 * @property-read string $id
 * @property-read string $projectId
 * @property-read EventActor $actor
 * @property-read self::TYPE_* $type
 * @property-read self::SEVERITY_* $severity
 * @property-read string $title
 * @property-read null|string $description
 * @property-read null|string $assetId
 * @property-read null|int $assetSequence
 * @property-read null|EventAsset $asset
 * @property-read list<EventFact> $facts
 * @property-read int $createdAt
 */
final class Event extends CalmLensObject
{
    public const SEVERITY_LOW = 'low';
    public const SEVERITY_HIGH = 'high';

    public const TYPE_ASSET_UPLOADED = 'asset.uploaded';
    public const TYPE_ASSET_CLASSIFIED = 'asset.classified';
    public const TYPE_ASSET_REGION_RESTRICTED = 'asset.region-restricted';
    public const TYPE_ASSET_ALLOWED = 'asset.allowed';
    public const TYPE_ASSET_LIMITED = 'asset.limited';
    public const TYPE_ASSET_AGE_RESTRICTED = 'asset.age-restricted';
    public const TYPE_ASSET_BLOCKED = 'asset.blocked';
    public const TYPE_ASSET_PURGED = 'asset.purged';
    public const TYPE_ASSET_FAILED = 'asset.failed';
    public const TYPE_ASSET_PROGRESS_UPDATED = 'asset.progress-updated';
    public const TYPE_ASSET_DELETED = 'asset.deleted';
    public const TYPE_ASSET_CONTENT_REMOVED = 'asset.content-removed';
    public const TYPE_ASSET_RETRIED = 'asset.retried';
    public const TYPE_ASSET_RERUN_REQUESTED = 'asset.rerun-requested';
    public const TYPE_ASSET_REVIEW_REQUESTED = 'asset.review-requested';
    public const TYPE_ASSET_REVIEW_COMPLETED = 'asset.review-completed';
    public const TYPE_ASSET_HASH_MATCHED = 'asset.hash-matched';
    public const TYPE_USAGE_FREE_UPLOADS_EXHAUSTED = 'usage.free-uploads-exhausted';
    public const TYPE_USAGE_UPLOADS_PAUSED = 'usage.uploads-paused';
    public const TYPE_UPLOAD_PRESET_DAILY_LIMIT_REACHED = 'upload-preset.daily-limit-reached';
    public const TYPE_PROJECT_MEMBER_JOINED = 'project.member-joined';
    public const TYPE_PROJECT_MEMBER_REMOVED = 'project.member-removed';
    public const TYPE_PROJECT_MEMBER_LEFT = 'project.member-left';
    public const TYPE_PROJECT_MEMBER_ROLE_CHANGED = 'project.member-role-changed';
    public const TYPE_PROJECT_INVITATION_SENT = 'project.invitation-sent';
    public const TYPE_PROJECT_TRANSFERRED = 'project.transferred';
    public const TYPE_API_KEY_CREATED = 'api-key.created';
    public const TYPE_API_KEY_REVOKED = 'api-key.revoked';
    public const TYPE_API_KEY_DELETED = 'api-key.deleted';
    public const TYPE_CONNECTOR_DISABLED = 'connector.disabled';

    protected const FIELDS = [
        'actor' => EventActor::class,
        'asset' => EventAsset::class,
        'facts' => [EventFact::class],
    ];
}
