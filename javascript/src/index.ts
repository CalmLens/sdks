// Types, error codes and the SDK version, shared by both clients. Import a client from
// `@calmlens/sdk/server` (with an API key, on your server) or `@calmlens/sdk/app` (in browsers
// and React Native apps, through an upload preset).

export type {
  CalmLensErrorCode,
  CalmLensErrorDetails,
  CalmLensErrorOptions,
  SdkErrorCode,
} from "./client/CalmLensError";
export { CALMLENS_ERROR_CODES, CalmLensError } from "./client/CalmLensError";
export type { ApiErrorCode } from "./client/CalmLensErrorCodes";
export type {
  AddHashListEntryOptions,
  Asset,
  AssetBatchOperation,
  AssetChecksums,
  AssetChildrenPage,
  AssetClassification,
  AssetClassificationStatus,
  AssetContent,
  AssetContentOptions,
  AssetContentRemovalReason,
  AssetContentStatus,
  AssetModeration,
  AssetModerationDecision,
  AssetModerationStatus,
  AssetPage,
  AssetSearchQuery,
  AssetSearchResponse,
  AssetSearchResult,
  AssetType,
  AssetUpload,
  AssetUploadStatus,
  AssetVisibility,
  BatchAssetsOptions,
  BatchAssetsResponse,
  CalmLensAppClientOptions,
  CalmLensServerClientOptions,
  CdnAssetUrlOptions,
  CdnResource,
  CdnServeOptions,
  CdnTransform,
  ClassifyTextOptions,
  ConnectionOptions,
  CreateAssetSignedUrlOptions,
  CreateFolderOptions,
  CreateHashListOptions,
  CreateMultipartUploadPartOptions,
  DeleteAssetContentOptions,
  DeleteAssetOptions,
  EnsureLensesOptions,
  EnsureLensOptions,
  ExplainAssetOptions,
  FolderIdOptions,
  GetAssetUrlOptions,
  HashList,
  HashListEntry,
  HashListEntryIdOptions,
  HashListEntryPage,
  HashListIdOptions,
  HashListList,
  IdempotencyOptions,
  ImageTransform,
  ImageTransformOptions,
  IterateAssetChildrenOptions,
  IterateAssetsOptions,
  Lens,
  LensTransform,
  ListAssetChildrenOptions,
  ListAssetsOptions,
  ListEventsOptions,
  ListHashListEntriesOptions,
  MoveAssetOptions,
  MoveFolderOptions,
  MultipartUploadOptions,
  MultipartUploadPartOptions,
  RequestOptions,
  RetrieveAssetOptions,
  RetryAssetOptions,
  SearchAssetsOptions,
  SignedUploadToken,
  SignedUrl,
  SignUploadTokenOptions,
  SubmitAssetOptions,
  UpdateAssetOptions,
  UpdateFolderOptions,
  UpdateHashListOptions,
  UploadAssetPartOptions,
  UploadedAsset,
  UploadPresetSubmitAssetOptions,
  VerifyWebhookSignatureOptions,
  ViewerClaims,
  WaitForAssetDecisionOptions,
  WebhookHeadersInput,
  WebhookPayloadInput,
} from "./client/CalmLensTypes";
export { DEFAULT_CDN_BASE_URL, getAssetUrl } from "./client/CalmLensUtils";
export { SDK_VERSION } from "./client/CalmLensVersion";
export type {
  AssetImage,
  AssetSafetyHold,
  AssetSafetyHoldReason,
  ExtractedText,
  MetadataItem,
  ProcessingOptions,
} from "./contract/Asset.js";
export type { AssetSearchMatchField } from "./contract/AssetSearch.js";
export type {
  ClassificationCategories,
  ClassificationCategory,
  ClassificationCategoryReport,
  ClassificationLabel,
  ClassificationNotEvaluatedReason,
  ClassificationQualifierResults,
  Likelihood,
} from "./contract/Classification.js";
export type {
  EventAsset,
  EventCategory,
  EventFactValues,
  EventSeverity,
  EventType,
  TypedEvent,
} from "./contract/Event.js";
export type { EventFact, EventFacts } from "./contract/EventCatalog.js";
export type { Folder } from "./contract/Folder.js";
export type { LensType } from "./contract/Lens.js";
export type { ModerationContext } from "./contract/ModerationContext.js";
export type { ModerationContextItem } from "./contract/ModerationContextLimits.js";
export {
  MODERATION_CONTEXT_USED_CHARACTERS,
  MODERATION_CONTEXT_USED_ITEMS,
  selectModerationContextItems,
} from "./contract/ModerationContextLimits.js";
export type { ModerationQualifier } from "./contract/ModerationPolicyDimensions.js";
export type { CursorPage, Order } from "./contract/Page.js";
export type {
  AgeRange,
  BoundingBox,
  DetectedFace,
  DetectedPerson,
  ProcessingFeatureId,
  ProcessingFeatureResults,
  ProcessingFeatureStage,
  ProcessingFeatures,
} from "./contract/ProcessingFeatures.js";
export type { FlaggedContentAction, FlaggedContentPolicy } from "./contract/Project.js";
export type { GetEventsResponse as EventsPage } from "./contract/PublicApiSchemas.js";
export type { ReceivedWebhookEventPayload as WebhookEventPayload } from "./contract/WebhookPayload.js";
