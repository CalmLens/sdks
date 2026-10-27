// The framework-agnostic core of the upload widget and media component. `@calmlens/sdk/react`,
// `@calmlens/sdk/react-native`, `@calmlens/sdk/vue`, `@calmlens/sdk/svelte` and
// `@calmlens/sdk/elements` render it; import it directly to build your own UI on the same upload queue and URLs.

export type { IconName } from "./ui/Icons";
export { ICON_ATTRIBUTES, ICONS } from "./ui/Icons";
export type {
  MediaAsset,
  MediaImageSource,
  MediaOptions,
  MediaSettings,
  MediaSource,
  MediaState,
} from "./ui/Media";
export { getMediaState, pickMediaSource, resolveMediaProps } from "./ui/Media";
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
export { createProgressFetch } from "./ui/ProgressFetch";
export type {
  MediaDisplayOptions,
  MediaProps,
  UploaderDisplayOptions,
  UploaderProps,
} from "./ui/Props";
export { getMediaAspectRatio, getMediaLoadKey } from "./ui/Props";
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
