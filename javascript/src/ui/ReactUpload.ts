// The upload hooks shared by `@calmlens/sdk/react` and `@calmlens/sdk/react-native`. They hold no
// DOM or native code, so both libraries render the same queue the same way.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createUploadController,
  type UploadController,
  type UploadControllerOptions,
  type UploadFile,
  type UploadSnapshot,
} from "./UploadController";

export interface UseCalmLensUploadResult<F extends UploadFile = UploadFile>
  extends UploadSnapshot<F> {
  controller: UploadController<F>;
  addFiles: UploadController<F>["addFiles"];
  retry: UploadController<F>["retry"];
  cancel: UploadController<F>["cancel"];
  remove: UploadController<F>["remove"];
  clear: UploadController<F>["clear"];
  start: UploadController<F>["start"];
}

/** Re-renders with a controller's snapshot. */
export const useUploadSnapshot = <F extends UploadFile>(
  controller: UploadController<F>,
): UseCalmLensUploadResult<F> => {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return useMemo(
    () => ({
      ...snapshot,
      controller,
      addFiles: (files) => controller.addFiles(files),
      retry: (key) => controller.retry(key),
      cancel: (key) => controller.cancel(key),
      remove: (key) => controller.remove(key),
      clear: () => controller.clear(),
      start: () => controller.start(),
    }),
    [snapshot, controller],
  );
};

/** A controller this component owns: it takes the latest options and cancels on unmount. */
export const useOwnController = <F extends UploadFile>(
  options: UploadControllerOptions<F>,
  active = true,
) => {
  const [controller] = useState(() => createUploadController(options));
  // The latest callbacks, without restarting uploads when a parent re-renders.
  if (active) controller.setOptions(options);
  // Cancels uploads on unmount. The cancel waits a tick so StrictMode's simulated unmount, which
  // mounts again straight away, keeps them.
  const pendingClear = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(pendingClear.current);
    return () => {
      pendingClear.current = setTimeout(() => controller.clear());
    };
  }, [controller]);
  return controller;
};

/**
 * Uploads files through an upload preset and re-renders as each one uploads and is checked. Use
 * it to build your own upload UI; `CalmLensUploader` is built on it. Uploads still running when
 * the component unmounts are cancelled.
 */
export const useCalmLensUpload = <F extends UploadFile = UploadFile>(
  options: UploadControllerOptions<F>,
): UseCalmLensUploadResult<F> => useUploadSnapshot(useOwnController(options));
