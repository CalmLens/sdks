import { getFileIcon, renderFileIconSvg } from "./FileIcons";
import type { MediaState } from "./Media";
import type { UploadControllerOptions, UploadItem, UploadSnapshot } from "./UploadController";

/** The size of a row's file-type icon, the same as an image preview. */
const FILE_ICON_SIZE = 40;

/**
 * The text the components show. Pass `messages` to any component to replace some or all of it,
 * for example to translate it. Keys other than the named ones are error codes, so you can give
 * any `CalmLensError` code its own message.
 */
export interface CalmLensMessages {
  dropzoneTitle: string;
  dropzoneTitleDragging: string;
  /** The picker button when the uploader takes one file. */
  chooseFile: string;
  /** The picker button with `multiple`. */
  chooseFiles: string;
  /** Replaces the picked file when the uploader takes one file. */
  chooseAnother: string;
  /** `{size}` is replaced with the largest accepted size, such as `20 MB`. */
  maxFileSizeHint: string;
  /** Under a file waiting for `start()`. Empty by default, so the row shows only its size. */
  selected: string;
  queued: string;
  uploading: string;
  checking: string;
  /** Finished, when the upload preset doesn't show decisions to the uploader. */
  submitted: string;
  pending: string;
  allowed: string;
  limited: string;
  "age-restricted": string;
  blocked: string;
  purged: string;
  failed: string;
  "file/not-accepted": string;
  "file/too-large": string;
  retry: string;
  /** `{name}` is replaced with the file name. */
  remove: string;
  /** `{name}` is replaced with the file name. */
  cancel: string;
  sensitiveTitle: string;
  sensitiveBody: string;
  reveal: string;
  unavailable: string;
  /** A viewer-specific regional block reported by the asset API. */
  regionalUnavailable: string;
  [errorCode: string]: string;
}

export const DEFAULT_MESSAGES: CalmLensMessages = {
  dropzoneTitle: "Click to upload or drag and drop",
  dropzoneTitleDragging: "Drop to upload",
  chooseFile: "Select file",
  chooseFiles: "Select files",
  chooseAnother: "Choose another",
  maxFileSizeHint: "Up to {size}",
  selected: "",
  queued: "Waiting…",
  uploading: "Uploading…",
  checking: "Checking…",
  submitted: "Uploaded.",
  pending: "Uploaded. It will be shown once it has been checked.",
  allowed: "Uploaded.",
  limited: "Uploaded.",
  "age-restricted": "Uploaded. It will only be shown to people who can see sensitive content.",
  blocked: "This file can't be used because it may break our community guidelines.",
  purged: "This file can't be used because it breaks our community guidelines.",
  failed: "We couldn't upload this file. Please try again.",
  "file/not-accepted": "This type of file isn't accepted.",
  "file/too-large": "This file is too large.",
  "upload-preset/too-large": "This file is too large.",
  "upload-preset/content-type-not-allowed": "This type of file isn't accepted.",
  "upload-preset/daily-limit-reached": "You've reached today's upload limit. Try again tomorrow.",
  "upload-token/expired": "Your upload expired. Please try again.",
  "sdk/cancelled": "Cancelled.",
  retry: "Retry",
  remove: "Remove {name}",
  cancel: "Cancel {name}",
  sensitiveTitle: "Sensitive content",
  sensitiveBody: "This may not be suitable for everyone.",
  reveal: "View",
  unavailable: "Unavailable",
  regionalUnavailable: "Unavailable in your region",
};

export const resolveMessages = (overrides?: Partial<CalmLensMessages>): CalmLensMessages =>
  overrides ? ({ ...DEFAULT_MESSAGES, ...overrides } as CalmLensMessages) : DEFAULT_MESSAGES;

/** The unavailable notice every media binding shows for the same resolved state. */
export const getMediaUnavailableMessage = (
  state: MediaState,
  messages: CalmLensMessages,
): string =>
  state.kind === "unavailable" && state.reason === "regional"
    ? messages.regionalUnavailable
    : messages.unavailable;

/** Fills `{name}`-style placeholders. */
export const formatMessage = (message: string, values: Record<string, string>): string =>
  message.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);

/** The message for a file's current state. */
export const getUploadItemMessage = (item: UploadItem, messages: CalmLensMessages): string => {
  if (item.stage === "failed") {
    return (item.errorCode && messages[item.errorCode]) || messages.failed;
  }
  if (item.stage === "complete") return messages[item.status ?? "submitted"] ?? messages.submitted;
  return messages[item.stage];
};

/** How a finished file turned out, for styling: `accepted`, `restricted` or `rejected`. */
export const getUploadItemOutcome = (
  item: UploadItem,
): "accepted" | "restricted" | "rejected" | undefined => {
  if (item.stage === "failed") return "rejected";
  if (item.stage !== "complete") return undefined;
  if (item.status === "blocked" || item.status === "purged") return "rejected";
  return item.status === "age-restricted" ? "restricted" : "accepted";
};

/** A byte count for people, such as `1.2 MB`. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

/** Everything a file's row shows, worked out once for every framework's uploader. */
export interface UploadItemView {
  message: string;
  outcome?: "accepted" | "restricted" | "rejected";
  busy: boolean;
  /** Sent bytes from 0 to 100, or `undefined` for an indeterminate bar while checking. */
  progressPercent?: number;
  canRetry: boolean;
  /** The remove button's accessible name: cancel while the file is busy. */
  removeLabel: string;
  /** The file-type icon shown when there is no image preview, as SVG markup. */
  fileIcon: string;
  size: string;
}

export const describeUploadItem = (
  item: UploadItem,
  messages: CalmLensMessages,
): UploadItemView => {
  const busy = item.stage === "queued" || item.stage === "uploading" || item.stage === "checking";
  return {
    message: getUploadItemMessage(item, messages),
    outcome: getUploadItemOutcome(item),
    busy,
    progressPercent:
      item.stage === "uploading" && item.progress !== null
        ? Math.round(item.progress * 100)
        : undefined,
    canRetry: item.stage === "failed" && !item.errorCode?.startsWith("file/"),
    removeLabel: formatMessage(busy ? messages.cancel : messages.remove, { name: item.file.name }),
    fileIcon: item.previewUrl ? "" : renderFileIconSvg(getFileIcon(item.file), FILE_ICON_SIZE),
    size: formatBytes(item.file.size),
  };
};

/** The hint under the drop zone's title, or `undefined` without a size limit. */
export const getDropzoneHint = (messages: CalmLensMessages, maxFileSize?: number) =>
  maxFileSize === undefined
    ? undefined
    : formatMessage(messages.maxFileSizeHint, { size: formatBytes(maxFileSize) });

/** What an uploader shows around its file list, worked out once for every framework. */
export interface UploaderView {
  /**
   * Whether to show the drop zone. An uploader that takes one file swaps it for the file's row,
   * with a button to choose another, once a file is picked.
   */
  showDropzone: boolean;
  chooseLabel: string;
  hint?: string;
}

export const describeUploader = (
  snapshot: UploadSnapshot,
  options: Pick<UploadControllerOptions, "multiple" | "maxFileSize">,
  messages: CalmLensMessages,
): UploaderView => ({
  showDropzone: Boolean(options.multiple) || snapshot.items.length === 0,
  chooseLabel: options.multiple ? messages.chooseFiles : messages.chooseFile,
  hint: getDropzoneHint(messages, options.maxFileSize),
});
