import type { Component } from "svelte";
import type {
  CalmLensUpload as CoreCalmLensUpload,
  UploadControllerOptions as CoreUploadControllerOptions,
  UploaderProps as CoreUploaderProps,
  UploadItem as CoreUploadItem,
  UploadSnapshot as CoreUploadSnapshot,
  MediaProps,
  UploadController,
  UploadFile,
} from "../ui.js";

// The browser's files are `File`s, so the upload types default to `File` here.
export type UploadItem<F extends UploadFile = File> = CoreUploadItem<F>;
export type CalmLensUpload<F extends UploadFile = File> = CoreCalmLensUpload<F>;
export type UploadSnapshot<F extends UploadFile = File> = CoreUploadSnapshot<F>;
export type UploadControllerOptions<F extends UploadFile = File> = CoreUploadControllerOptions<F>;
export type UploaderProps<F extends UploadFile = File> = CoreUploaderProps<F>;
/** Creates an upload queue for the components, such as one a form starts on submit. */
export declare const createUploadController: <F extends UploadFile = File>(
  options: UploadControllerOptions<F>,
) => UploadController<F>;

/**
 * A drop zone and file list that uploads through an upload preset, shows each file's progress
 * and moderation decision, and reports finished uploads to `onUploaded`.
 */
export declare const CalmLensUploader: Component<UploaderProps>;

/**
 * Shows an asset from the CalmLens CDN with responsive widths and a blurred placeholder while
 * it loads. Age-restricted assets stay behind the placeholder and a reveal button until
 * `ageConfirmed` is set; blocked and purged assets show an unavailable notice.
 */
export declare const CalmLensMedia: Component<MediaProps>;

export * from "../ui.js";
