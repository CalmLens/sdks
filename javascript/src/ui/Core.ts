// The browser-independent core that every binding shares, React Native's included.

export type { IconName } from "./Icons";
export { ICON_ATTRIBUTES, ICONS } from "./Icons";
export type {
  GetSignedMediaUrl,
  MediaAsset,
  MediaImageSource,
  MediaKind,
  MediaOptions,
  MediaPlayback,
  MediaRenderedKind,
  MediaSettings,
  MediaSource,
  MediaState,
  SignedMediaUrls,
} from "./Media";
export {
  getMediaState,
  getPeakHeights,
  getPlayedPercent,
  getSignedMediaKey,
  getSignedMediaResources,
  MediaUrlSigner,
  pickMediaSource,
  resolveMediaProps,
} from "./Media";
export type { CalmLensMessages, UploaderView, UploadItemView } from "./Messages";
export {
  DEFAULT_MESSAGES,
  describeUploader,
  describeUploadItem,
  formatBytes,
  formatMessage,
  getDropzoneHint,
  getMediaUnavailableMessage,
  getUploadItemMessage,
  getUploadItemOutcome,
  resolveMessages,
} from "./Messages";
export { createProgressFetch, type ProgressFetchOptions } from "./ProgressFetch";
export type {
  MediaDisplayOptions,
  MediaProps,
  UploaderDisplayOptions,
  UploaderProps,
} from "./Props";
export {
  getMediaAspectRatio,
  getMediaLoadKey,
  getShownPlaceholder,
  MEDIA_FILE_ICON_SIZE,
} from "./Props";
export { CALMLENS_STYLES } from "./Styles";
export type { CalmLensTheme } from "./Theme";
export { CALMLENS_THEME, resolveTheme } from "./Theme";
export type {
  CalmLensUpload,
  CustomUploadContext,
  CustomUploadResult,
  UploadClient,
  UploadControllerOptions,
  UploadFile,
  UploadItem,
  UploadSnapshot,
  UploadStage,
} from "./UploadController";
export { createUploadController, isFileAccepted, UploadController } from "./UploadController";
