// The upload hooks shared by `@calmlens/sdk/react` and `@calmlens/sdk/react-native`. They hold no
// DOM or native code, so both libraries render the same queue the same way.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createUploadController,
  type UploadController,
  type UploadControllerOptions,
  type UploadSnapshot,
} from "./UploadController";

export interface UseCalmLensUploadResult extends UploadSnapshot {
  controller: UploadController;
  addFiles: UploadController["addFiles"];
  retry: UploadController["retry"];
  cancel: UploadController["cancel"];
  remove: UploadController["remove"];
  clear: UploadController["clear"];
  start: UploadController["start"];
}

/** Re-renders with a controller's snapshot. */
export const useUploadSnapshot = (controller: UploadController): UseCalmLensUploadResult => {
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
export const useOwnController = (options: UploadControllerOptions, active = true) => {
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
export const useCalmLensUpload = (options: UploadControllerOptions): UseCalmLensUploadResult =>
  useUploadSnapshot(useOwnController(options));
