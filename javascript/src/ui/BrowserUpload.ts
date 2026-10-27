// The upload queue as the browser components use it: their files are browser `File`s, so these
// default to `File` where the shared core defaults to any `UploadFile`. `@calmlens/sdk/react`,
// `/vue`, `/svelte` and `/elements` export these in place of the core's.

import type { UploaderProps as CoreUploaderProps } from "./Props";
import type { UseCalmLensUploadResult as CoreUseCalmLensUploadResult } from "./ReactUpload";
import {
  type CalmLensUpload as CoreCalmLensUpload,
  type UploadControllerOptions as CoreUploadControllerOptions,
  type UploadItem as CoreUploadItem,
  type UploadSnapshot as CoreUploadSnapshot,
  createUploadController as createCoreUploadController,
  type UploadController,
  type UploadFile,
} from "./UploadController";

export type UploadItem<F extends UploadFile = File> = CoreUploadItem<F>;
export type CalmLensUpload<F extends UploadFile = File> = CoreCalmLensUpload<F>;
export type UploadSnapshot<F extends UploadFile = File> = CoreUploadSnapshot<F>;
export type UploadControllerOptions<F extends UploadFile = File> = CoreUploadControllerOptions<F>;
export type UploaderProps<F extends UploadFile = File> = CoreUploaderProps<F>;
export type UseCalmLensUploadResult<F extends UploadFile = File> = CoreUseCalmLensUploadResult<F>;

/** Creates an upload queue for the browser components, such as one a form starts on submit. */
export const createUploadController = <F extends UploadFile = File>(
  options: UploadControllerOptions<F>,
): UploadController<F> => createCoreUploadController(options);
