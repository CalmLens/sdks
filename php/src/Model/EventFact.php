<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * One fact of an event: a registered `key`, its `value`, and a `url` when it links to something.
 *
 * @property-read self::KEY_* $key
 * @property-read null|string|bool|list<Category::*>|int $value
 * @property-read null|string $url
 */
final class EventFact extends CalmLensObject
{
    public const KEY_ASSET_NAME = 'asset-name';
    public const KEY_ASSET_TYPE = 'asset-type';
    public const KEY_FILE_FORMAT = 'file-format';
    public const KEY_TEST = 'test';
    public const KEY_PARENT_ASSET = 'parent-asset';
    public const KEY_FLAGGED_CATEGORIES = 'flagged-categories';
    public const KEY_MODERATION_STATUS = 'moderation-status';
    public const KEY_AUTOMATED_STATUS = 'automated-status';
    public const KEY_REGION = 'region';
    public const KEY_RULE = 'rule';
    public const KEY_STATUS = 'status';
    public const KEY_REVIEWER_NAME = 'reviewer-name';
    public const KEY_NOTE = 'note';
    public const KEY_CHILD_ASSET = 'child-asset';
    public const KEY_CHILD_STATUS = 'child-status';
    public const KEY_PREVIOUS_STATUS = 'previous-status';
    public const KEY_FAILURE_REASON = 'failure-reason';
    public const KEY_COMPLETED_SECTIONS = 'completed-sections';
    public const KEY_TOTAL_SECTIONS = 'total-sections';
    public const KEY_BATCH_ID = 'batch-id';
    public const KEY_REVIEW_REASON = 'review-reason';
    public const KEY_UNCERTAIN_CATEGORIES = 'uncertain-categories';
    public const KEY_REVIEW_ID = 'review-id';
    public const KEY_DECISION = 'decision';
    public const KEY_APPLIED_TO_ASSET = 'applied-to-asset';
    public const KEY_HASH_LIST_ID = 'hash-list-id';
    public const KEY_HASH_LIST_NAME = 'hash-list-name';
    public const KEY_DISTANCE = 'distance';
    public const KEY_MATCH_ACTION = 'match-action';
    public const KEY_LIMIT = 'limit';
    public const KEY_USED = 'used';
    public const KEY_ORGANISATION_ID = 'organisation-id';
    public const KEY_REASON = 'reason';
    public const KEY_RESUMES_AT = 'resumes-at';
    public const KEY_PRESET_ID = 'preset-id';
    public const KEY_PRESET_NAME = 'preset-name';
    public const KEY_DAILY_LIMIT = 'daily-limit';
    public const KEY_MEMBER_USER_ID = 'member-user-id';
    public const KEY_MEMBER_NAME = 'member-name';
    public const KEY_ROLE = 'role';
    public const KEY_PREVIOUS_ROLE = 'previous-role';
    public const KEY_INVITEE_EMAIL = 'invitee-email';
    public const KEY_PREVIOUS_ORGANISATION_ID = 'previous-organisation-id';
    public const KEY_PREVIOUS_ORGANISATION_NAME = 'previous-organisation-name';
    public const KEY_ORGANISATION_NAME = 'organisation-name';
    public const KEY_METHOD = 'method';
    public const KEY_API_KEYS_REVOKED = 'api-keys-revoked';
    public const KEY_CONNECTORS_PAUSED = 'connectors-paused';
    public const KEY_KEY_ID = 'key-id';
    public const KEY_KEY_NAME = 'key-name';
    public const KEY_CREATED_BY_NAME = 'created-by-name';
    public const KEY_REVOKED_BY_NAME = 'revoked-by-name';
    public const KEY_DELETED_BY_NAME = 'deleted-by-name';
    public const KEY_CONNECTOR_ID = 'connector-id';
    public const KEY_CONNECTOR_NAME = 'connector-name';
    public const KEY_CONNECTOR_TYPE = 'connector-type';
    public const KEY_CONSECUTIVE_FAILURES = 'consecutive-failures';
    public const KEY_LAST_ERROR = 'last-error';
}
