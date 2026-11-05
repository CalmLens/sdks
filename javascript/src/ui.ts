// The framework-agnostic core of the upload widget and media component. `calmlens/react`,
// `calmlens/react-native`, `calmlens/vue`, `calmlens/svelte` and
// `calmlens/elements` render it; import it directly to build your own UI on the same upload queue and URLs.

export type { IconName } from "./ui/Icons";
export { ICON_ATTRIBUTES, ICONS } from "./ui/Icons";
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
} from "./ui/Media";
export {
  getMediaState,
  getPeakHeights,
  getPlayedPercent,
  getSignedMediaKey,
  getSignedMediaResources,
  MediaUrlSigner,
  pickMediaSource,
  resolveMediaProps,
} from "./ui/Media";
export type { CalmLensMessages, UploaderView, UploadItemView } from "./ui/Messages";
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
} from "./ui/Messages";
export { createProgressFetch, type ProgressFetchOptions } from "./ui/ProgressFetch";
export type {
  MediaDisplayOptions,
  MediaProps,
  UploaderDisplayOptions,
  UploaderProps,
} from "./ui/Props";
export {
  getMediaAspectRatio,
  getMediaLoadKey,
  getShownPlaceholder,
  MEDIA_FILE_ICON_SIZE,
} from "./ui/Props";
export { CALMLENS_STYLES } from "./ui/Styles";
export type { CalmLensTheme } from "./ui/Theme";
export { CALMLENS_THEME, resolveTheme } from "./ui/Theme";
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
} from "./ui/UploadController";
export { createUploadController, isFileAccepted, UploadController } from "./ui/UploadController";
