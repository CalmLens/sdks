// The upload hooks shared by `calmlens/react` and `calmlens/react-native`. They hold no
// DOM or native code, so both libraries render the same queue the same way.

import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type CalmLensProvidedOptions,
  createUploadController,
  type UploadController,
  type UploadControllerOptions,
  type UploadFile,
  type UploadSnapshot,
  withProvidedOptions,
} from "./UploadController";

const CalmLensContext = createContext<CalmLensProvidedOptions<any> | undefined>(undefined);

export type CalmLensProviderProps<F extends UploadFile = File> = CalmLensProvidedOptions<F> & {
  children?: ReactNode;
};

/**
 * Gives every `CalmLensUploader` and `useCalmLensUpload` beneath it these upload options, such as
 * `uploadPresetId` and `tokenUrl`, so they needn't be passed to each one. An option a component
 * sets itself wins. A provider inside another adds to the outer one's options.
 */
export function CalmLensProvider<F extends UploadFile = File>({
  children,
  ...options
}: CalmLensProviderProps<F>) {
  const outer = useContext(CalmLensContext);
  const { uploadPresetId, token, tokenUrl, baseUrl, createClient, upload, checkStatus } = options;
  const value = useMemo(
    () =>
      withProvidedOptions(outer, {
        uploadPresetId,
        token,
        tokenUrl,
        baseUrl,
        createClient,
        upload,
        checkStatus,
      }) as CalmLensProvidedOptions<F>,
    [outer, uploadPresetId, token, tokenUrl, baseUrl, createClient, upload, checkStatus],
  );
  return createElement(CalmLensContext.Provider, { value }, children);
}

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
  own: UploadControllerOptions<F>,
  active = true,
) => {
  const options = withProvidedOptions(useContext(CalmLensContext), own);
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
