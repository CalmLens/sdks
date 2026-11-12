<?php

declare(strict_types=1);

namespace CalmLens;

/**
 * The array shapes the client's methods take and return, for PHPStan: the API's models, such as
 * `Asset`, `Folder` and `Event`, their enumerations and the options shared by several methods.
 * Import one where you need it with `@phpstan-import-type Asset from \CalmLens\Types`. Each
 * method's own docblock names the shape of its options and result.
 *
 * @phpstan-type Asset array{
 *     id: string, projectId: string, parentId?: ?string, folderId?: ?string, uploadPresetId?: ?string,
 *     createdAt: int, updatedAt?: int, type: AssetType, name: string, description?: ?string,
 *     externalId?: ?string, externalUrl?: ?string, authorId?: ?string, context?: ?AssetContext,
 *     parentPages: list<int>, metadata: list<array{id: string, value: MetadataValue}>, tags: list<string>,
 *     visibility: 'public'|'private', upload: AssetUpload, classification: AssetClassification,
 *     content: AssetContent,
 * }
 * @phpstan-type AssetPage array{items: list<Asset>, nextCursor: ?string, hasMore: bool}
 * @phpstan-type AssetSearchResults array{
 *     query: string,
 *     items: list<array{
 *         asset: Asset, score: int|float,
 *         matchedFields: list<'name'|'id'|'externalId'|'description'|'tags'|'type'|'content.format'|'content.extension'
 *             |'classification.moderation.status'|'visual'|'transcript'>,
 *     }>,
 *     semanticStatus: 'disabled'|'ready'|'indexing'|'unavailable',
 * }
 * @phpstan-type TimelinePage array{
 *     items: list<array{
 *         source: 'frame'|'speech'|'frame-text'|'clip', startSeconds: int|float, endSeconds: int|float,
 *         categories: RawCategories,
 *     }>,
 *     nextCursor: ?string, hasMore: bool,
 * }
 * @phpstan-type EventPage array{
 *     items: list<Event>, nextCursor: string, hasMore: bool, excludedTypes: list<EventType>,
 * }
 * @phpstan-type FolderPage array{
 *     items: list<Folder>, nextCursor: ?string, hasMore: bool, ancestors: list<Folder>,
 * }
 * @phpstan-type LensPage array{items: list<Lens>, nextCursor: ?string, hasMore: bool}
 * @phpstan-type HashListPage array{items: list<HashList>, nextCursor: ?string, hasMore: bool}
 * @phpstan-type HashListEntryPage array{items: list<HashListEntry>, nextCursor: ?string, hasMore: bool}
 * @phpstan-type PolicyPage array{items: list<Policy>, nextCursor: ?string, hasMore: bool}
 * @phpstan-type UploadPresetPage array{items: list<UploadPreset>, nextCursor: ?string, hasMore: bool}
 * @phpstan-type EnsuredUploadPresets array{uploadPresets: list<UploadPreset>}
 * @phpstan-type AssetBatch array{batchId: string, status: 'queued', assetCount: int}
 * @phpstan-type SignedAssetUrl array{url: string, expiresAt: int}
 * @phpstan-type AssetUploadedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string}, type: 'asset.uploaded',
 *     severity: 'low'|'high', title: string, description?: ?string, assetId?: ?string,
 *     assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|FileFormatFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type AssetClassifiedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string}, type: 'asset.classified',
 *     severity: 'low'|'high', title: string, description?: ?string, assetId?: ?string,
 *     assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|ParentAssetFact|FlaggedCategoriesFact|ModerationStatusFact
 *         |AutomatedStatusFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetRegionRestrictedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'asset.region-restricted', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|ParentAssetFact|RegionFact|RuleFact|StatusFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetAllowedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string}, type: 'asset.allowed',
 *     severity: 'low'|'high', title: string, description?: ?string, assetId?: ?string,
 *     assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|ParentAssetFact|FlaggedCategoriesFact|ReviewerNameFact|NoteFact
 *         |ChildAssetFact|ChildStatusFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetLimitedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string}, type: 'asset.limited',
 *     severity: 'low'|'high', title: string, description?: ?string, assetId?: ?string,
 *     assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|ParentAssetFact|FlaggedCategoriesFact|ReviewerNameFact|NoteFact
 *         |ChildAssetFact|ChildStatusFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetAgeRestrictedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'asset.age-restricted', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|ParentAssetFact|FlaggedCategoriesFact|ReviewerNameFact|NoteFact
 *         |ChildAssetFact|ChildStatusFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetBlockedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string}, type: 'asset.blocked',
 *     severity: 'low'|'high', title: string, description?: ?string, assetId?: ?string,
 *     assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|ParentAssetFact|FlaggedCategoriesFact|ReviewerNameFact|NoteFact
 *         |ChildAssetFact|ChildStatusFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetPurgedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string}, type: 'asset.purged',
 *     severity: 'low'|'high', title: string, description?: ?string, assetId?: ?string,
 *     assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|ParentAssetFact|FlaggedCategoriesFact|ReviewerNameFact|NoteFact
 *         |ChildAssetFact|ChildStatusFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetFailedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string}, type: 'asset.failed',
 *     severity: 'low'|'high', title: string, description?: ?string, assetId?: ?string,
 *     assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|ParentAssetFact|PreviousStatusFact|FailureReasonFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetProgressUpdatedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'asset.progress-updated', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|CompletedSectionsFact|TotalSectionsFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetDeletedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string}, type: 'asset.deleted',
 *     severity: 'low'|'high', title: string, description?: ?string, assetId?: ?string,
 *     assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|BatchIdFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type AssetContentRemovedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'asset.content-removed', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|BatchIdFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type AssetRetriedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string}, type: 'asset.retried',
 *     severity: 'low'|'high', title: string, description?: ?string, assetId?: ?string,
 *     assetSequence?: ?int, asset?: ?EventAsset, facts: list<AssetNameFact|AssetTypeFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetRerunRequestedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'asset.rerun-requested', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|RerunModerationStatusFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetReviewRequestedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'asset.review-requested', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|ParentAssetFact|ReviewAutomatedStatusFact
 *         |ReviewReasonFact|UncertainCategoriesFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetReviewCompletedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'asset.review-completed', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|ParentAssetFact|ReviewIdFact|DecisionFact|AppliedToAssetFact
 *         |ReviewerNameFact|NoteFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetHashMatchedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'asset.hash-matched', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<AssetNameFact|AssetTypeFact|ParentAssetFact|HashListIdFact|HashListNameFact|DistanceFact
 *         |MatchActionFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type UsageFreeUploadsExhaustedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'usage.free-uploads-exhausted', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<LimitFact|UsedFact|OrganisationIdFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type UsageUploadsPausedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'usage.uploads-paused', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<ReasonFact|ResumesAtFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type UploadPresetDailyLimitReachedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'upload-preset.daily-limit-reached', severity: 'low'|'high', title: string,
 *     description?: ?string, assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<PresetIdFact|PresetNameFact|DailyLimitFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type ProjectMemberJoinedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'project.member-joined', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<MemberUserIdFact|MemberNameFact|RoleFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type ProjectMemberRemovedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'project.member-removed', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<MemberUserIdFact|MemberNameFact|RoleFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type ProjectMemberLeftEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'project.member-left', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<MemberUserIdFact|MemberNameFact|RoleFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type ProjectMemberRoleChangedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'project.member-role-changed', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<MemberUserIdFact|MemberNameFact|PreviousRoleFact|RoleFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type ProjectInvitationSentEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'project.invitation-sent', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<InviteeEmailFact|RoleFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type ProjectTransferredEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'project.transferred', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<PreviousOrganisationIdFact|PreviousOrganisationNameFact|OrganisationIdFact|OrganisationNameFact
 *         |MethodFact|ApiKeysRevokedFact|ConnectorsPausedFact|TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type ApiKeyCreatedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string}, type: 'api-key.created',
 *     severity: 'low'|'high', title: string, description?: ?string, assetId?: ?string,
 *     assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<KeyIdFact|KeyNameFact|ApiKeyRoleFact|CreatedByNameFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type ApiKeyRevokedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string}, type: 'api-key.revoked',
 *     severity: 'low'|'high', title: string, description?: ?string, assetId?: ?string,
 *     assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<KeyIdFact|KeyNameFact|RevokedByNameFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type ApiKeyDeletedEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string}, type: 'api-key.deleted',
 *     severity: 'low'|'high', title: string, description?: ?string, assetId?: ?string,
 *     assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<KeyIdFact|KeyNameFact|DeletedByNameFact|TestFact>, createdAt: int,
 * }
 * @phpstan-type ConnectorDisabledEvent array{
 *     id: string, projectId: string, actor: array{type: ActorType, id: ?string},
 *     type: 'connector.disabled', severity: 'low'|'high', title: string, description?: ?string,
 *     assetId?: ?string, assetSequence?: ?int, asset?: ?EventAsset,
 *     facts: list<ConnectorIdFact|ConnectorNameFact|ConnectorTypeFact|ConsecutiveFailuresFact|LastErrorFact
 *         |TestFact>,
 *     createdAt: int,
 * }
 * @phpstan-type AssetNameFact array{key: 'asset-name', value: ?string, url?: string}
 * @phpstan-type FileFormatFact array{key: 'file-format', value: ?string, url?: string}
 * @phpstan-type TestFact array{key: 'test', value: bool, url?: string}
 * @phpstan-type ParentAssetFact array{key: 'parent-asset', value: string, url?: string}
 * @phpstan-type ModerationStatusFact array{key: 'moderation-status', value: ModerationStatus, url?: string}
 * @phpstan-type AutomatedStatusFact array{key: 'automated-status', value: DecidedStatus, url?: string}
 * @phpstan-type RegionFact array{key: 'region', value: Region, url?: string}
 * @phpstan-type RuleFact array{key: 'rule', value: string, url?: string}
 * @phpstan-type StatusFact array{
 *     key: 'status', value: 'limited'|'age-restricted'|'blocked'|'purged', url?: string,
 * }
 * @phpstan-type ReviewerNameFact array{key: 'reviewer-name', value: ?string, url?: string}
 * @phpstan-type NoteFact array{key: 'note', value: ?string, url?: string}
 * @phpstan-type ChildAssetFact array{key: 'child-asset', value: string, url?: string}
 * @phpstan-type PreviousStatusFact array{key: 'previous-status', value: ?ClassificationStatus, url?: string}
 * @phpstan-type FailureReasonFact array{
 *     key: 'failure-reason',
 *     value: 'file-too-large'|'duration-limit'|'resolution-limit'|'unsupported-format'|'undecodable-content'
 *         |'multiple-tracks'|'type-mismatch'|'free-uploads-exhausted'|'media-limit'|'uploads-paused'
 *         |'too-many-items'|'processing-error',
 *     url?: string,
 * }
 * @phpstan-type CompletedSectionsFact array{key: 'completed-sections', value: int, url?: string}
 * @phpstan-type TotalSectionsFact array{key: 'total-sections', value: int, url?: string}
 * @phpstan-type BatchIdFact array{key: 'batch-id', value: string, url?: string}
 * @phpstan-type RerunModerationStatusFact array{key: 'moderation-status', value: DecidedStatus, url?: string}
 * @phpstan-type ReviewAutomatedStatusFact array{
 *     key: 'automated-status', value: 'allowed'|'limited'|'age-restricted'|'blocked', url?: string,
 * }
 * @phpstan-type ReviewReasonFact array{key: 'review-reason', value: 'sampled'|'uncertain', url?: string}
 * @phpstan-type UncertainCategoriesFact array{key: 'uncertain-categories', value: list<Category>, url?: string}
 * @phpstan-type ReviewIdFact array{key: 'review-id', value: string, url?: string}
 * @phpstan-type DecisionFact array{key: 'decision', value: DecidedStatus, url?: string}
 * @phpstan-type AppliedToAssetFact array{key: 'applied-to-asset', value: bool, url?: string}
 * @phpstan-type HashListIdFact array{key: 'hash-list-id', value: string, url?: string}
 * @phpstan-type HashListNameFact array{key: 'hash-list-name', value: string, url?: string}
 * @phpstan-type DistanceFact array{key: 'distance', value: int, url?: string}
 * @phpstan-type MatchActionFact array{key: 'match-action', value: 'flag'|'block', url?: string}
 * @phpstan-type LimitFact array{key: 'limit', value: int, url?: string}
 * @phpstan-type UsedFact array{key: 'used', value: int, url?: string}
 * @phpstan-type OrganisationIdFact array{key: 'organisation-id', value: string, url?: string}
 * @phpstan-type ReasonFact array{
 *     key: 'reason', value: 'spend-limit'|'usage-cap'|'project-budget'|'payment-failed', url?: string,
 * }
 * @phpstan-type ResumesAtFact array{key: 'resumes-at', value: ?int, url?: string}
 * @phpstan-type PresetIdFact array{key: 'preset-id', value: string, url?: string}
 * @phpstan-type PresetNameFact array{key: 'preset-name', value: string, url?: string}
 * @phpstan-type DailyLimitFact array{key: 'daily-limit', value: int, url?: string}
 * @phpstan-type MemberUserIdFact array{key: 'member-user-id', value: string, url?: string}
 * @phpstan-type MemberNameFact array{key: 'member-name', value: ?string, url?: string}
 * @phpstan-type PreviousRoleFact array{
 *     key: 'previous-role', value: 'admin'|'configurator'|'editor'|'viewer'|'custom'|'reviewer',
 *     url?: string,
 * }
 * @phpstan-type InviteeEmailFact array{key: 'invitee-email', value: string, url?: string}
 * @phpstan-type PreviousOrganisationIdFact array{key: 'previous-organisation-id', value: string, url?: string}
 * @phpstan-type PreviousOrganisationNameFact array{key: 'previous-organisation-name', value: string, url?: string}
 * @phpstan-type OrganisationNameFact array{key: 'organisation-name', value: string, url?: string}
 * @phpstan-type MethodFact array{key: 'method', value: 'handover'|'move', url?: string}
 * @phpstan-type ApiKeysRevokedFact array{key: 'api-keys-revoked', value: int, url?: string}
 * @phpstan-type ConnectorsPausedFact array{key: 'connectors-paused', value: int, url?: string}
 * @phpstan-type KeyIdFact array{key: 'key-id', value: string, url?: string}
 * @phpstan-type KeyNameFact array{key: 'key-name', value: ?string, url?: string}
 * @phpstan-type ApiKeyRoleFact array{
 *     key: 'role', value: 'admin'|'configurator'|'editor'|'viewer'|'custom', url?: string,
 * }
 * @phpstan-type CreatedByNameFact array{key: 'created-by-name', value: ?string, url?: string}
 * @phpstan-type RevokedByNameFact array{key: 'revoked-by-name', value: ?string, url?: string}
 * @phpstan-type DeletedByNameFact array{key: 'deleted-by-name', value: ?string, url?: string}
 * @phpstan-type ConnectorIdFact array{key: 'connector-id', value: string, url?: string}
 * @phpstan-type ConnectorNameFact array{key: 'connector-name', value: string, url?: string}
 * @phpstan-type ConnectorTypeFact array{
 *     key: 'connector-type', value: 'in-app'|'webhook'|'slack'|'email', url?: string,
 * }
 * @phpstan-type ConsecutiveFailuresFact array{key: 'consecutive-failures', value: int, url?: string}
 * @phpstan-type LastErrorFact array{key: 'last-error', value: ?string, url?: string}
 * @phpstan-type Folder array{
 *     id: string, projectId: string, parentId?: ?string, name: string, createdAt: int, updatedAt?: int,
 * }
 * @phpstan-type AssetContext array{items: list<array{text: string, authorId?: string}>}
 * @phpstan-type AssetUpload array{status: 'uploading'|'completed', updatedAt: ?int, partsReceived: ?int}
 * @phpstan-type AssetClassification array{
 *     status: ClassificationStatus,
 *     failureReason: 'file-too-large'|'duration-limit'|'resolution-limit'|'unsupported-format'|'undecodable-content'
 *         |'multiple-tracks'|'type-mismatch'|'free-uploads-exhausted'|'media-limit'|'uploads-paused'
 *         |'too-many-items'|'processing-error'|null,
 *     updatedAt: ?int, completedAt: ?int, progress: array{completedSections: int, totalSections: int}|null,
 *     testInput: bool, moderation: Moderation, ocr: OcrResult|UnevaluatedDetection|null,
 *     personDetection: PersonDetection|UnevaluatedDetection|null,
 *     faceDetection: FaceDetection|UnevaluatedDetection|null,
 *     linkDetection: LinkDetection|UnevaluatedDetection|null,
 * }
 * @phpstan-type Moderation array{
 *     status: ModerationStatus, manualReviews: list<ManualReview>, automatedStatus: ?DecidedStatus,
 *     source: 'policy'|'children'|'hash-list'|'mandatory-rule'|null, policy: ?ModerationPolicy,
 *     pendingReview: ?PendingReview, rule: ?string, explanationComplete: ?bool,
 *     categories: ?ModerationCategories, flaggedCategories: list<Category>,
 *     regions: list<RegionRestriction>, raw: ?RawModeration, timeline: array{segmentCount: int}|null,
 * }
 * @phpstan-type ManualReview array{
 *     id: string, decision: DecidedStatus, note: ?string,
 *     decidedBy: array{type: 'user'|'api-key', id: ?string}, reviewedAt: int, applied: bool,
 * }
 * @phpstan-type ModerationPolicy array{id: string, revision: int, preset: ?ModerationPolicyPreset}
 * @phpstan-type ModerationPolicyPreset array{id: PresetId, version: int}
 * @phpstan-type PendingReview array{
 *     requestedAt: int, reason: 'sampled'|'uncertain', uncertainCategories: list<Category>,
 * }
 * @phpstan-type ModerationCategories array<Category, CategoryModeration>
 * @phpstan-type CategoryModeration array{
 *     score: int|float, action: PolicyAction, settings?: AppliedCategorySettings,
 *     source?: array{kind: 'default'}|array{kind: 'below-threshold'}|AllowanceSource|RestrictionSource,
 * }
 * @phpstan-type AppliedCategorySettings array{
 *     action: PolicyAction, allowances: list<PolicyRule>, restrictions: list<PolicyRule>,
 * }
 * @phpstan-type PolicyRule array{
 *     name?: string, when: list<QualifierKey>, unless?: list<QualifierKey>, action: PolicyAction,
 * }
 * @phpstan-type AllowanceSource array{kind: 'allowance', indexes: list<int>, conditionScore: int|float}
 * @phpstan-type RestrictionSource array{kind: 'restriction', indexes: list<int>, conditionScore: int|float}
 * @phpstan-type RegionRestriction array{
 *     region: Region, status: 'limited'|'age-restricted'|'blocked'|'purged', rule: string,
 *     category?: Category,
 * }
 * @phpstan-type RawModeration array{categories: RawCategories, hashMatches: list<HashMatch>}
 * @phpstan-type RawCategories array{
 *     sexual: EvaluatedCategory|PartialCategory|UnevaluatedCategory,
 *     violence: EvaluatedCategory|PartialCategory|UnevaluatedCategory,
 *     'self-harm': EvaluatedCategory|PartialCategory|UnevaluatedCategory,
 *     harassment: EvaluatedCategory|PartialCategory|UnevaluatedCategory,
 *     hate: EvaluatedCategory|PartialCategory|UnevaluatedCategory,
 *     'criminal-activity': EvaluatedCategory|PartialCategory|UnevaluatedCategory,
 *     'personal-information': EvaluatedCategory|PartialCategory|UnevaluatedCategory,
 *     profanity: EvaluatedCategory|PartialCategory|UnevaluatedCategory,
 * }
 * @phpstan-type EvaluatedCategory array{
 *     status: 'evaluated', likelihood: Likelihood, score: int|float, qualifiers?: QualifierResults,
 * }
 * @phpstan-type QualifierResults array<QualifierKey, EvaluatedQualifier|UnevaluatedQualifier>
 * @phpstan-type EvaluatedQualifier array{
 *     status: 'evaluated', someScore: int|float, allScore?: int|float, likelihood: Likelihood,
 * }
 * @phpstan-type UnevaluatedQualifier array{status: 'not-evaluated', reason: 'not-supported'|'unavailable'}
 * @phpstan-type PartialCategory array{
 *     status: 'partial', likelihood: Likelihood, score: int|float, qualifiers?: QualifierResults,
 * }
 * @phpstan-type UnevaluatedCategory array{
 *     status: 'not-evaluated', reason: 'not-supported'|'unavailable', qualifiers?: QualifierResults,
 * }
 * @phpstan-type HashMatch array{
 *     source: 'hash-list', hashListId: string, hashListEntryId: string, distance: int,
 *     action: 'flag'|'block',
 * }
 * @phpstan-type OcrResult array{status: 'evaluated', textRegions: list<TextRegion>}
 * @phpstan-type TextRegion array{box: Box, personalInformation: bool}
 * @phpstan-type Box array{left: int|float, top: int|float, width: int|float, height: int|float}
 * @phpstan-type UnevaluatedDetection array{
 *     status: 'not-evaluated', reason: 'not-supported'|'unavailable'|'in-children',
 * }
 * @phpstan-type PersonDetection array{status: 'evaluated', people: list<DetectedPerson>}
 * @phpstan-type DetectedPerson array{box: Box, confidence: int|float}
 * @phpstan-type FaceDetection array{status: 'evaluated', faces: list<DetectedFace>}
 * @phpstan-type DetectedFace array{box: Box, confidence: int|float, ageRange?: array{low: int, high: int}}
 * @phpstan-type LinkDetection array{
 *     status: 'evaluated', qrCodes: list<QrCode>,
 *     links: list<array{url: string, source: 'qr-code'|'text'}>,
 * }
 * @phpstan-type QrCode array{value: string, box: Box}
 * @phpstan-type AssetContent array{
 *     status: 'temporary'|'stored'|'removed',
 *     removalReason: 'policy'|'retention'|'requested'|'parent-removed'|'disposed'|null, updatedAt: ?int,
 *     safetyHold: ?SafetyHold, format: ?string, extension: ?string, sizeInBytes: ?int,
 *     checksums: ?Checksums, width: ?int, height: ?int, durationSeconds: int|float|null, pageCount: ?int,
 *     perceptualHash: ?string, perceptualHashQuality: ?int, metadata: ?ContentMetadata,
 *     extractedText: array{type: 'string', content: string}|array{type: 'document', id: string}|null,
 *     rendered: ?RenderedFile, hls: ?HlsStream, preview: ?Preview,
 * }
 * @phpstan-type SafetyHold array{placedAt: int, reason: 'suspected-illegal-content', disposedAt?: ?int}
 * @phpstan-type Checksums array{
 *     md5?: ?string, sha1?: ?string, sha256?: ?string, sha384?: ?string, sha512?: ?string,
 * }
 * @phpstan-type ContentMetadata array{
 *     capturedAt: ?string, cameraMake: ?string, cameraModel: ?string, lensModel: ?string,
 *     software: ?string, creator: ?string, copyright: ?string, digitalSourceType: ?string,
 *     containsLocation: bool, location: array{latitude: int|float, longitude: int|float}|null,
 * }
 * @phpstan-type RenderedFile array{
 *     kind: 'image'|'pdf'|'video'|'audio', format: string, width: ?int, height: ?int,
 *     peaks?: list<int|float>,
 * }
 * @phpstan-type HlsStream array{
 *     status: 'preparing'|'ready'|'unavailable',
 *     reason: 'allowance-used'|'billing-required'|'spend-limit'|'processing-failed'|'content-not-kept'|null,
 *     renditions: list<HlsRendition>,
 * }
 * @phpstan-type HlsRendition array{
 *     kind: 'video'|'audio', width: ?int, height: ?int, bandwidth: int, codecs: string,
 * }
 * @phpstan-type Preview array{width: ?int, height: ?int, thumbhash: ?string, averageColor: ?string}
 * @phpstan-type Lens array{
 *     id: string, projectId?: ?string, identifier: string, name: string, description?: ?string,
 *     type: LensType, active: bool, transform?: array<string, mixed>|null, createdAt: int, updatedAt?: int,
 * }
 * @phpstan-type EventAsset array{
 *     id: string, externalId?: ?string, uploadPresetId?: ?string,
 *     upload: array{status: 'uploading'|'completed'}, classification: EventAssetClassification,
 *     content: array{status: 'temporary'|'stored'|'removed'},
 * }
 * @phpstan-type EventAssetClassification array{
 *     status: ClassificationStatus, testInput: bool, moderation: array{status: ModerationStatus},
 * }
 * @phpstan-type AssetTypeFact array{key: 'asset-type', value: ?AssetType, url?: string}
 * @phpstan-type FlaggedCategoriesFact array{key: 'flagged-categories', value: list<Category>, url?: string}
 * @phpstan-type ChildStatusFact array{key: 'child-status', value: DecidedStatus, url?: string}
 * @phpstan-type RoleFact array{
 *     key: 'role', value: 'admin'|'configurator'|'editor'|'viewer'|'custom'|'reviewer', url?: string,
 * }
 * @phpstan-type HashList array{
 *     id: string, projectId: string, name: string, description?: ?string, action: 'flag'|'block',
 *     createdAt: int, updatedAt?: int,
 * }
 * @phpstan-type HashListEntry array{
 *     id: string, projectId: string, hashListId: string, hash: string, quality: ?int, label?: ?string,
 *     assetId?: ?string, createdAt: int,
 * }
 * @phpstan-type Policy array{
 *     id: string, name: string, description: string, settings: PolicySettings, revision: int,
 *     preset: ?PolicyPreset, projectIds: list<string>, createdAt: int, updatedAt?: int,
 * }
 * @phpstan-type PolicySettings array{categorySettings: PolicyCategorySettings}
 * @phpstan-type PolicyCategorySettings array{
 *     sexual: PolicyCategorySetting, violence: PolicyCategorySetting, 'self-harm': PolicyCategorySetting,
 *     harassment: PolicyCategorySetting, hate: PolicyCategorySetting,
 *     'criminal-activity': PolicyCategorySetting, 'personal-information': PolicyCategorySetting,
 *     profanity: PolicyCategorySetting,
 * }
 * @phpstan-type PolicyCategorySetting array{
 *     allowances: list<PolicyRule>, restrictions: list<PolicyRule>, action: PolicyAction,
 * }
 * @phpstan-type PolicyPreset array{
 *     id: PresetId, version: int, latestVersion: int, mode: 'live'|'pinned'|'copy',
 * }
 * @phpstan-type UploadPreset array{
 *     id: string, projectId: string, createdByUserId?: ?string, key: string, revision: int, name: string,
 *     access: 'token'|'anyone', enabled: bool, allowedContentTypes?: list<string>|null,
 *     maxSizeInBytes?: ?int, folderId?: ?string, policyId?: ?string, visibility: 'public'|'private',
 *     processingOptions?: ?ProcessingOptions, revealDecision: bool, dailyUploadLimit?: ?int,
 *     allowedOrigins?: list<string>|null, createdAt: int, updatedAt?: int,
 * }
 * @phpstan-type ProcessingOptions array{
 *     retainContent?: ?bool, storeSensitiveMetadata?: ?bool, features?: ?ProcessingFeatures,
 * }
 * @phpstan-type ProcessingFeatures array{
 *     ocr?: array{enabled: bool}|null, personDetection?: array{enabled: bool}|null,
 *     faceDetection?: array{enabled: bool, ageEstimation?: bool}|null,
 *     linkDetection?: array{enabled: bool}|null, streaming?: array{enabled: bool}|null,
 * }
 * @phpstan-type ProjectSettingsResource array{projectId: string, revision: int, settings: ProjectSettingsValues}
 * @phpstan-type ProjectSettingsValues array{
 *     retainContent: bool, optOutJurisdictions: list<'EU'>, blockUnmoderatedAssets: bool,
 *     storeSensitiveMetadata: bool, linkCheckingEnabled: bool, streamingEnabled: bool,
 *     aiMediaSearchEnabled: bool, remoteUrlRule: array{mode: 'allow'|'deny', domains: list<string>}|null,
 *     websiteSubmissionsPerMinute: ?int, humanReview: HumanReviewSettings,
 * }
 * @phpstan-type HumanReviewSettings array{
 *     allowedSamplePercent: int|float, restrictedSamplePercent: int|float,
 *     uncertaintyMarginPercent: int|float, reviewMissingEvidence: bool,
 * }
 * @phpstan-type MetadataFieldsResource array{projectId: string, revision: int, fields: list<MetadataField>}
 * @phpstan-type MetadataField array{
 *     id: string, title: string, description?: string, type: MetadataFieldType, icon: MetadataFieldIcon,
 *     color: string,
 * }
 * @phpstan-type AssetType 'image'|'video'|'audio'|'plaintext-document'|'multimedia-document'|'website'|'file'
 * @phpstan-type LensType 'image'|'video'|'audio'|'document'|'website'
 * @phpstan-type EventType 'asset.uploaded'|'asset.classified'|'asset.region-restricted'|'asset.allowed'|'asset.limited'
 *     |'asset.age-restricted'|'asset.blocked'|'asset.purged'|'asset.failed'|'asset.progress-updated'
 *     |'asset.deleted'|'asset.content-removed'|'asset.retried'|'asset.rerun-requested'
 *     |'asset.review-requested'|'asset.review-completed'|'asset.hash-matched'
 *     |'usage.free-uploads-exhausted'|'usage.uploads-paused'|'upload-preset.daily-limit-reached'
 *     |'project.member-joined'|'project.member-removed'|'project.member-left'
 *     |'project.member-role-changed'|'project.invitation-sent'|'project.transferred'|'api-key.created'
 *     |'api-key.revoked'|'api-key.deleted'|'connector.disabled'
 * @phpstan-type ActorType 'user'|'api-key'|'automated'|'system'
 * @phpstan-type ModerationStatus 'pending'|'allowed'|'limited'|'age-restricted'|'blocked'|'purged'
 * @phpstan-type DecidedStatus 'allowed'|'limited'|'age-restricted'|'blocked'|'purged'
 * @phpstan-type Region 'DE'|'AT'|'FR'|'GB'|'EU'|'AU'|'BR'
 * @phpstan-type ClassificationStatus 'queued'|'processing'|'completed'|'failed'
 * @phpstan-type Category 'sexual'|'violence'|'self-harm'|'harassment'|'hate'|'criminal-activity'|'personal-information'
 *     |'profanity'
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
 * @phpstan-type Likelihood 'very-unlikely'|'unlikely'|'possible'|'likely'|'very-likely'
 * @phpstan-type Event AssetUploadedEvent|AssetClassifiedEvent|AssetRegionRestrictedEvent|AssetAllowedEvent
 *     |AssetLimitedEvent|AssetAgeRestrictedEvent|AssetBlockedEvent|AssetPurgedEvent|AssetFailedEvent
 *     |AssetProgressUpdatedEvent|AssetDeletedEvent|AssetContentRemovedEvent|AssetRetriedEvent
 *     |AssetRerunRequestedEvent|AssetReviewRequestedEvent|AssetReviewCompletedEvent|AssetHashMatchedEvent
 *     |UsageFreeUploadsExhaustedEvent|UsageUploadsPausedEvent|UploadPresetDailyLimitReachedEvent
 *     |ProjectMemberJoinedEvent|ProjectMemberRemovedEvent|ProjectMemberLeftEvent
 *     |ProjectMemberRoleChangedEvent|ProjectInvitationSentEvent|ProjectTransferredEvent|ApiKeyCreatedEvent
 *     |ApiKeyRevokedEvent|ApiKeyDeletedEvent|ConnectorDisabledEvent
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
