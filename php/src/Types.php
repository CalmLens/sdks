<?php

declare(strict_types=1);

namespace CalmLens;

/**
 * The array shapes of the params the client's methods take, for PHPStan: shapes and enumerations
 * shared by several methods, and the request options every method takes as its last argument.
 * Results are objects: see `CalmLens\Model`.
 *
 * @phpstan-type AssetContextParams array{items: list<array{text: string, authorId?: string}>}
 * @phpstan-type PolicyRuleParams array{
 *     name?: string, when: list<QualifierKey>, unless?: list<QualifierKey>, action: PolicyAction,
 * }
 * @phpstan-type PolicySettingsParams array{categorySettings: PolicyCategorySettingsParams}
 * @phpstan-type PolicyCategorySettingsParams array{
 *     sexual: PolicyCategorySettingParams, violence: PolicyCategorySettingParams, 'self-harm': PolicyCategorySettingParams,
 *     harassment: PolicyCategorySettingParams, hate: PolicyCategorySettingParams,
 *     'criminal-activity': PolicyCategorySettingParams, 'personal-information': PolicyCategorySettingParams,
 *     profanity: PolicyCategorySettingParams,
 * }
 * @phpstan-type PolicyCategorySettingParams array{
 *     allowances: list<PolicyRuleParams>, restrictions: list<PolicyRuleParams>, action: PolicyAction,
 * }
 * @phpstan-type ProcessingOptionsParams array{
 *     retainContent?: ?bool, storeSensitiveMetadata?: ?bool, features?: ?ProcessingFeaturesParams,
 * }
 * @phpstan-type ProcessingFeaturesParams array{
 *     ocr?: array{enabled: bool}|null, personDetection?: array{enabled: bool}|null,
 *     faceDetection?: array{enabled: bool, ageEstimation?: bool}|null,
 *     linkDetection?: array{enabled: bool}|null, streaming?: array{enabled: bool}|null,
 * }
 * @phpstan-type LensType 'image'|'video'|'audio'|'document'|'website'
 * @phpstan-type EventType 'asset.uploaded'|'asset.classified'|'asset.region-restricted'|'asset.allowed'|'asset.limited'
 *     |'asset.age-restricted'|'asset.blocked'|'asset.purged'|'asset.failed'|'asset.progress-updated'
 *     |'asset.deleted'|'asset.content-removed'|'asset.retried'|'asset.rerun-requested'
 *     |'asset.review-requested'|'asset.review-completed'|'asset.hash-matched'
 *     |'usage.free-uploads-exhausted'|'usage.uploads-paused'|'upload-preset.daily-limit-reached'
 *     |'project.member-joined'|'project.member-removed'|'project.member-left'
 *     |'project.member-role-changed'|'project.invitation-sent'|'project.transferred'|'api-key.created'
 *     |'api-key.revoked'|'api-key.deleted'|'connector.disabled'
 * @phpstan-type PresetId 'general-community'|'children-platform'|'education-support'|'wholesome-community'
 * @phpstan-type MetadataFieldType 'string'|'number'|'boolean'|'date'|'url'
 * @phpstan-type MetadataFieldIcon 'tag'|'hash'|'user'|'folder'|'layers'|'photo'|'link'
 * @phpstan-type QualifierKey 'sexual-pornographic-media'|'hate-nazi-symbols-public-display'|'hate-nazi-insignia-public-display'
 *     |'hate-nazi-genocide-public-peace'|'hate-nazi-genocide-denial-or-approval'
 *     |'hate-adjudicated-nazi-crimes-denial'|'violence-high-impact'|'self-harm-age-restricted'
 *     |'personal-information-contact'|'personal-information-email'|'personal-information-phone'
 *     |'personal-information-government-id'|'personal-information-financial'
 *     |'personal-information-location'|'personal-information-identifiers'
 *     |'personal-information-credentials'|'personal-information-request'
 *     |'personal-information-self-disclosure'|'personal-information-third-party'
 *     |'personal-information-historical'|'personal-information-documentary'
 *     |'personal-information-educational'|'personal-information-fictional'
 *     |'personal-information-support-prevention'|'profanity-mild'|'profanity-strong'|'profanity-slurs'
 *     |'profanity-obfuscated'|'profanity-historical'|'profanity-documentary'|'profanity-educational'
 *     |'profanity-fictional'|'profanity-support-prevention'|'sexual-nudity'|'sexual-activity'
 *     |'sexual-explicit-language'|'sexual-assault-media'|'sexual-non-consensual'
 *     |'sexual-intimate-image-abuse'|'sexual-extreme'|'sexual-strangulation'|'sexual-incest'
 *     |'sexual-minors'|'sexual-solicitation'|'sexual-paid'|'sexual-adult-promotion'
 *     |'sexual-revealing-clothing'|'sexual-suggestive'|'sexual-non-erotic-nudity'|'sexual-text'
 *     |'sexual-historical'|'sexual-documentary'|'sexual-educational'|'sexual-discussion'
 *     |'sexual-fictional'|'sexual-artistic'|'sexual-support-prevention'|'violence-attack'
 *     |'violence-threat'|'violence-preparation'|'violence-encouragement'|'violence-wish'
 *     |'violence-coded-incitement'|'violence-extremism'|'violence-injury'|'violence-violent-death'
 *     |'violence-natural-death'|'violence-graphic'|'violence-decapitation-act'|'violence-gore'
 *     |'violence-weapon'|'violence-sport'|'violence-text'|'violence-historical'|'violence-documentary'
 *     |'violence-educational'|'violence-discussion'|'violence-fictional'|'violence-fantasy'
 *     |'violence-support-prevention'|'self-harm-thoughts'|'self-harm-preparation'|'self-harm-act'
 *     |'self-harm-methods'|'self-harm-encouragement'|'self-harm-historical'|'self-harm-documentary'
 *     |'self-harm-educational'|'self-harm-fictional'|'self-harm-support-prevention'|'harassment-abuse'
 *     |'harassment-mild'|'harassment-bullying'|'harassment-public-target'|'harassment-threat'
 *     |'harassment-sexual'|'harassment-encouragement'|'harassment-historical'|'harassment-documentary'
 *     |'harassment-educational'|'harassment-fictional'|'harassment-support-prevention'|'hate-abuse'
 *     |'hate-slurs'|'hate-dehumanization'|'hate-inferiority'|'hate-exclusion'|'hate-symbol'
 *     |'hate-hostility'|'hate-threat'|'hate-personal'|'hate-historical'|'hate-documentary'
 *     |'hate-educational'|'hate-fictional'|'hate-counterspeech'|'hate-support-prevention'
 *     |'criminal-activity-demonstration'|'criminal-activity-preparation'|'criminal-activity-request'
 *     |'criminal-activity-instructions'|'criminal-activity-promotion'|'criminal-activity-coded-incitement'
 *     |'criminal-activity-substances'|'criminal-activity-grooming'|'criminal-activity-csam'
 *     |'criminal-activity-alcohol'|'criminal-activity-tobacco'|'criminal-activity-gambling'
 *     |'criminal-activity-fraud'|'criminal-activity-sexual-solicitation'|'criminal-activity-graffiti'
 *     |'criminal-activity-historical'|'criminal-activity-documentary'|'criminal-activity-educational'
 *     |'criminal-activity-discussion'|'criminal-activity-fictional'|'criminal-activity-support-prevention'
 * @phpstan-type PolicyAction 'allow'|'limit'|'age-restrict'|'block'|'purge'
 * @phpstan-type MetadataValue string|int|float|bool|null|list<mixed>|array<string, mixed>
 * @phpstan-type RequestOptions array{
 *     idempotencyKey?: string, timeout?: int|float, connectTimeout?: int|float, uploadTimeout?: int|float,
 *     maxRetries?: int, maxResponseBytes?: int,
 * }
 * @phpstan-type UploadContent array{
 *     plainText?: string, base64?: string, data?: string|open-resource|\Psr\Http\Message\StreamInterface,
 *     bytes?: string|open-resource|\Psr\Http\Message\StreamInterface, type: string, sizeInBytes?: int,
 * }
 * @phpstan-type UploadPart array{
 *     plainText?: string, base64?: string, data?: string|open-resource|\Psr\Http\Message\StreamInterface,
 *     bytes?: string|open-resource|\Psr\Http\Message\StreamInterface, type: string, sizeInBytes?: int,
 *     partNumber?: int, isFinal?: bool,
 * }
 * @phpstan-type ViewerClaims array{region?: string, ageConfirmed?: bool}
 */
final class Types
{
    private function __construct() {}
}
