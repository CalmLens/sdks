// Vue 3 components for uploads and assets: `CalmLensUploader`, `CalmLensAsset` and the
// `useCalmLensUpload` composable for your own upload UI. The uploader emits `uploaded`,
// `rejected`, `failed` and `removed`; `CalmLensAsset` emits `age-confirm-request`, `load`,
// `error`, `availability-change`, `play`, `ended` and `timeupdate`.

import {
  type App,
  computed,
  defineComponent,
  h,
  type InjectionKey,
  inject,
  type MaybeRefOrGetter,
  onMounted,
  onScopeDispose,
  type PropType,
  provide,
  ref,
  type ShallowRef,
  shallowRef,
  toValue,
  type VNodeArrayChildren,
  watch,
  watchEffect,
} from "vue";
import type { AssetAvailability, ViewerClaims } from "./client/CalmLensTypes";
import {
  type AssetDisplay,
  type AssetDocumentOptions,
  type AssetImageOptions,
  AssetSession,
  type AssetSpreadsheetOptions,
  type AssetVideoOptions,
  type AssetView,
  getAssetAspectRatio,
  getAssetView,
  getAssetViewKey,
  getPeakHeights,
  getPlayedPercent,
} from "./ui/Asset";
import {
  AssetViewerMount,
  getMountedViewerOptions,
  isMountedViewerKind,
} from "./ui/AssetViewerMount";
import type {
  CalmLensUpload,
  UploadControllerOptions,
  UploadItem,
  UploadSnapshot,
} from "./ui/BrowserUpload";
import { renderFileIconSvg } from "./ui/FileIcons";
import { ICON_ATTRIBUTES, ICONS, type IconName } from "./ui/Icons";
import { MediaStreamPlayer } from "./ui/MediaStream";
import {
  type CalmLensMessages,
  describeUploader,
  describeUploadItem,
  formatMessage,
  resolveMessages,
} from "./ui/Messages";
import { ASSET_FILE_ICON_SIZE } from "./ui/Props";
import {
  type CalmLensProvidedOptions,
  createUploadController,
  type UploadController,
  type UploadFile,
  withProvidedOptions,
} from "./ui/UploadController";
import type { ViewerAsset } from "./ui/viewers";

export * from "./ui";
export type {
  CalmLensUpload,
  UploadControllerOptions,
  UploaderProps,
  UploadItem,
  UploadSnapshot,
} from "./ui/BrowserUpload";
export { createUploadController } from "./ui/BrowserUpload";
export * from "./viewers/Vue";

const icon = (name: IconName) => h("svg", ICON_ATTRIBUTES, [h("path", { d: ICONS[name] })]);

export interface UseCalmLensUploadResult<F extends UploadFile = File> {
  snapshot: Readonly<ShallowRef<UploadSnapshot<F>>>;
  controller: UploadController<F>;
  addFiles: UploadController<F>["addFiles"];
  retry: UploadController<F>["retry"];
  cancel: UploadController<F>["cancel"];
  remove: UploadController<F>["remove"];
  clear: UploadController<F>["clear"];
  start: UploadController<F>["start"];
}

/** Keeps a ref to a controller's snapshot, following the controller if it changes. */
const subscribeSnapshot = <F extends UploadFile>(
  controller: MaybeRefOrGetter<UploadController<F>>,
) => {
  const snapshot = shallowRef(toValue(controller).getSnapshot());
  watch(
    () => toValue(controller),
    (current, _previous, onCleanup) => {
      onCleanup(
        current.subscribe((next) => {
          snapshot.value = next;
        }),
      );
    },
    { immediate: true },
  );
  return snapshot;
};

const CALMLENS_PROVIDED_KEY: InjectionKey<CalmLensProvidedOptions<any>> = Symbol("calmlens");

/**
 * Gives every `CalmLensUploader` and `useCalmLensUpload` in this component's descendants these
 * upload options, such as `uploadPresetId` and `tokenUrl`, so they needn't be passed to each one.
 * Call it in `setup`, or pass the app to provide them app-wide. An option a component sets itself
 * wins, and a nested call adds to the outer one's options.
 */
export const provideCalmLens = <F extends UploadFile = File>(
  options: CalmLensProvidedOptions<F>,
  app?: App,
): void => {
  if (app) {
    app.provide(CALMLENS_PROVIDED_KEY, options);
    return;
  }
  provide(
    CALMLENS_PROVIDED_KEY,
    withProvidedOptions(inject(CALMLENS_PROVIDED_KEY, undefined), options),
  );
};

/**
 * Uploads files through an upload preset and keeps `snapshot` up to date as each one uploads and
 * is checked. Use it to build your own upload UI; `CalmLensUploader` is built on it. Uploads
 * still running when the component unmounts are cancelled.
 */
export const useCalmLensUpload = <F extends UploadFile = File>(
  own: MaybeRefOrGetter<UploadControllerOptions<F>>,
): UseCalmLensUploadResult<F> => {
  const provided = inject(CALMLENS_PROVIDED_KEY, undefined);
  const options = () => withProvidedOptions(provided, toValue(own));
  const controller = createUploadController(options());
  watchEffect(() => controller.setOptions(options()));
  const snapshot = subscribeSnapshot(controller);
  onScopeDispose(() => controller.clear());
  return {
    snapshot,
    controller,
    addFiles: (files) => controller.addFiles(files),
    retry: (key) => controller.retry(key),
    cancel: (key) => controller.cancel(key),
    remove: (key) => controller.remove(key),
    clear: () => controller.clear(),
    start: () => controller.start(),
  };
};

const optional = <T>(type: PropType<T>) => ({ type, default: undefined });
const messagesProp = optional(Object as PropType<Partial<CalmLensMessages>>);

/**
 * A drop zone and file list that uploads through an upload preset, shows each file's progress
 * and moderation decision, and emits `uploaded` for finished uploads.
 */
export const CalmLensUploader = defineComponent({
  name: "CalmLensUploader",
  props: {
    uploadPresetId: optional(String),
    upload: optional(Function as PropType<UploadControllerOptions["upload"]>),
    checkStatus: optional(Function as PropType<UploadControllerOptions["checkStatus"]>),
    createClient: optional(Function as PropType<UploadControllerOptions["createClient"]>),
    token: optional([String, Function] as PropType<UploadControllerOptions["token"]>),
    tokenUrl: optional(String),
    accept: optional(String),
    maxFileSize: optional(Number),
    autoUpload: { type: Boolean, default: true },
    multiple: { type: Boolean, default: false },
    maxFiles: optional(Number),
    concurrency: optional(Number),
    decisionTimeoutMs: optional(Number),
    baseUrl: optional(String),
    disabled: { type: Boolean, default: false },
    capture: optional(String as PropType<"user" | "environment">),
    messages: messagesProp,
    controller: optional(Object as PropType<UploadController<File>>),
  },
  emits: {
    uploaded: (_upload: CalmLensUpload) => true,
    rejected: (_item: UploadItem) => true,
    failed: (_item: UploadItem) => true,
    removed: (_item: UploadItem) => true,
  },
  setup(props, { emit }) {
    const own = useCalmLensUpload<File>(() => ({
      uploadPresetId: props.uploadPresetId,
      upload: props.upload,
      checkStatus: props.checkStatus,
      createClient: props.createClient,
      token: props.token,
      tokenUrl: props.tokenUrl,
      accept: props.accept,
      maxFileSize: props.maxFileSize,
      autoUpload: props.autoUpload,
      multiple: props.multiple,
      maxFiles: props.maxFiles,
      concurrency: props.concurrency,
      decisionTimeoutMs: props.decisionTimeoutMs,
      baseUrl: props.baseUrl,
      onUploaded: (value) => emit("uploaded", value),
      onRejected: (item) => emit("rejected", item),
      onFailed: (item) => emit("failed", item),
      onRemoved: (item) => emit("removed", item),
    }));
    const controller = computed(() => props.controller ?? own.controller);
    const snapshot = subscribeSnapshot(controller);
    const messages = computed(() => resolveMessages(props.messages));
    const dragging = ref(false);
    const input = ref<HTMLInputElement>();
    const openPicker = () => {
      if (!props.disabled) input.value?.click();
    };
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (!props.disabled) dragging.value = true;
    };

    return () => {
      const text = messages.value;
      const queue = controller.value;
      const { accept, multiple } = queue.options;
      const items = snapshot.value.items;
      const view = describeUploader(snapshot.value, queue.options, text);
      return h("div", { class: "calmlens-uploader" }, [
        view.showDropzone &&
          h(
            "div",
            {
              class: "calmlens-dropzone",
              "data-dragging": dragging.value || undefined,
              "data-disabled": props.disabled || undefined,
              onClick: openPicker,
              onDragover: onDragOver,
              onDragenter: onDragOver,
              onDragleave: (event: DragEvent) => {
                const zone = event.currentTarget as HTMLElement;
                if (!zone.contains(event.relatedTarget as Node | null)) dragging.value = false;
              },
              onDrop: (event: DragEvent) => {
                event.preventDefault();
                dragging.value = false;
                if (!props.disabled && event.dataTransfer) queue.addFiles(event.dataTransfer.files);
              },
              onPaste: (event: ClipboardEvent) => {
                const files = event.clipboardData?.files;
                if (!props.disabled && files?.length) queue.addFiles(files);
              },
            },
            [
              h("span", { class: "calmlens-dropzone__icon" }, [icon("upload")]),
              h("div", { class: "calmlens-dropzone__text" }, [
                h(
                  "p",
                  { class: "calmlens-dropzone__title" },
                  dragging.value ? text.dropzoneTitleDragging : text.dropzoneTitle,
                ),
                view.hint && h("p", { class: "calmlens-dropzone__hint" }, view.hint),
              ]),
              h(
                "button",
                {
                  type: "button",
                  class: "calmlens-button",
                  "data-variant": "outline",
                  disabled: props.disabled,
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation();
                    openPicker();
                  },
                },
                view.chooseLabel,
              ),
            ],
          ),
        h("input", {
          ref: input,
          type: "file",
          hidden: true,
          accept,
          multiple,
          capture: props.capture,
          disabled: props.disabled,
          onChange: (event: Event) => {
            const target = event.target as HTMLInputElement;
            if (target.files) queue.addFiles(target.files);
            target.value = "";
          },
        }),
        items.length > 0 &&
          h(
            "ul",
            { class: "calmlens-uploads" },
            items.map((item) => {
              const itemView = describeUploadItem(item, text);
              return h(
                "li",
                {
                  key: item.key,
                  class: "calmlens-upload",
                  "data-stage": item.stage,
                  "data-outcome": itemView.outcome,
                },
                [
                  item.previewUrl
                    ? h("img", { class: "calmlens-upload__thumb", src: item.previewUrl, alt: "" })
                    : h("span", {
                        class: "calmlens-upload__thumb",
                        "data-kind": "file",
                        "aria-hidden": "true",
                        innerHTML: itemView.fileIcon,
                      }),
                  h("div", { class: "calmlens-upload__body" }, [
                    h("span", { class: "calmlens-upload__name" }, item.file.name),
                    h("span", { class: "calmlens-upload__size" }, itemView.size),
                    itemView.busy &&
                      h(
                        "div",
                        {
                          class: "calmlens-progress",
                          role: "progressbar",
                          "aria-label": itemView.message,
                          "aria-valuemin": 0,
                          "aria-valuemax": 100,
                          "aria-valuenow": itemView.progressPercent,
                        },
                        [
                          h("div", {
                            class: "calmlens-progress__bar",
                            style:
                              itemView.progressPercent === undefined
                                ? undefined
                                : { width: `${itemView.progressPercent}%` },
                          }),
                        ],
                      ),
                    itemView.message &&
                      h(
                        "p",
                        { class: "calmlens-upload__message", role: "status" },
                        itemView.message,
                      ),
                  ]),
                  h("div", { class: "calmlens-upload__actions" }, [
                    !view.showDropzone &&
                      h(
                        "button",
                        {
                          type: "button",
                          class: "calmlens-button",
                          "data-variant": "outline",
                          "data-size": "small",
                          disabled: props.disabled,
                          onClick: openPicker,
                        },
                        text.chooseAnother,
                      ),
                    itemView.canRetry &&
                      h(
                        "button",
                        {
                          type: "button",
                          class: "calmlens-icon-button",
                          "aria-label": text.retry,
                          title: text.retry,
                          onClick: () => queue.retry(item.key),
                        },
                        [icon("retry")],
                      ),
                    h(
                      "button",
                      {
                        type: "button",
                        class: "calmlens-icon-button",
                        "aria-label": itemView.removeLabel,
                        title: itemView.removeLabel,
                        onClick: () => queue.remove(item.key),
                      },
                      [icon("remove")],
                    ),
                  ]),
                ],
              );
            }),
          ),
      ]);
    };
  },
});

type LoadState = "loading" | "loaded" | "error";

/** Audio's waveform: the preview still, with the played part of its peaks drawn over it. */
const waveform = (
  url: string | undefined,
  peaks: readonly number[] | undefined,
  played: number,
) => {
  if (!url && !peaks) return undefined;
  const bars = () =>
    getPeakHeights(peaks ?? []).map((height) => h("span", { style: { height: `${height}%` } }));
  return h("div", { class: "calmlens-asset__waveform" }, [
    url && h("img", { class: "calmlens-asset__wave", src: url, alt: "", "aria-hidden": "true" }),
    // Decorative: the audio element's own controls report its progress.
    peaks &&
      h(
        "div",
        {
          class: "calmlens-asset__progress",
          role: "progressbar",
          "aria-hidden": "true",
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": played,
          style: { "--calmlens-played": `${played}%` },
        },
        [
          h("div", { class: "calmlens-asset__peaks" }, bars()),
          h("div", { class: "calmlens-asset__peaks", "data-played": "" }, bars()),
        ],
      ),
  ]);
};

/**
 * Shows any asset from its asset URL (public, or signed by your server), natively in the page: an
 * image with responsive widths, a website's screenshot and link, video and audio with their
 * adaptive stream, a document, text or spreadsheet viewer, or a preview still or file icon. It
 * reads `{src}/info` once mounted, unless `info` is given, in which case the first render, on the
 * server too, is the real element. Emits `load`, `error`, `availability-change`, `play`, `ended`
 * and `timeupdate`; listen for `age-confirm-request` to show the reveal button on age-restricted
 * content. The `unavailable` and `age-gate` slots (`{ placeholderUrl, confirm }`) replace the
 * notices.
 */
export const CalmLensAsset = defineComponent({
  name: "CalmLensAsset",
  props: {
    /** The asset URL, public or signed. Nothing is requested until it is set. */
    src: optional(String),
    display: optional(String as PropType<AssetDisplay>),
    viewerClaims: optional(Object as PropType<ViewerClaims>),
    /** The asset's display info, prefetched with `getAssetInfo`. */
    info: optional(Object as PropType<ViewerAsset>),
    alt: { type: String, default: "" },
    fit: optional(String as PropType<"cover" | "contain">),
    aspectRatio: optional(Number),
    lazy: { type: Boolean, default: true },
    fetchPriority: optional(String as PropType<"high" | "low" | "auto">),
    image: optional(Object as PropType<AssetImageOptions>),
    video: optional(Object as PropType<AssetVideoOptions>),
    document: optional(Object as PropType<AssetDocumentOptions>),
    spreadsheet: optional(Object as PropType<AssetSpreadsheetOptions>),
    /** Returns a fresh asset URL from your server once a signed one expires. */
    onExpired: optional(Function as PropType<() => string | Promise<string>>),
    messages: messagesProp,
    /** Bound by `@age-confirm-request`; a prop so the reveal button shows only when bound. */
    onAgeConfirmRequest: optional(Function as PropType<() => void>),
  },
  emits: {
    load: () => true,
    error: () => true,
    "availability-change": (_availability: AssetAvailability) => true,
    play: () => true,
    ended: () => true,
    timeupdate: (_currentTime: number) => true,
  },
  setup(props, { emit, slots }) {
    const messages = computed(() => resolveMessages(props.messages));
    const version = ref(0);
    const session = new AssetSession(() => {
      version.value++;
    });
    const options = computed(() => ({
      src: props.src,
      display: props.display,
      viewerClaims: props.viewerClaims,
      info: props.info,
      image: props.image,
      video: props.video,
      document: props.document,
      spreadsheet: props.spreadsheet,
      onExpired: props.onExpired,
      alt: props.alt,
    }));
    const state = computed(() => {
      void version.value;
      return session.update(options.value);
    });
    const view = computed(() => getAssetView(options.value, state.value));
    const loadKey = computed(() => getAssetViewKey(view.value));
    const load = ref<LoadState>("loading");
    const played = ref(0);
    const mounted = ref(false);
    const image = ref<HTMLImageElement>();
    const media = ref<HTMLMediaElement>();
    const viewerRoot = ref<HTMLElement>();
    const failedAt = (element: HTMLMediaElement) => ({
      position: element.currentTime || 0,
      playing: !element.paused && !element.ended,
    });
    const streams = new MediaStreamPlayer((element) => {
      session.mediaFailed(failedAt(element));
      return true;
    });
    const viewers = new AssetViewerMount();
    // The info is read once mounted, never during server rendering.
    watchEffect(() => {
      void state.value;
      if (mounted.value) session.load();
    });
    // A video or audio stream plays through its element, so it starts after the render.
    watch([media, view], () => streams.update(media.value, view.value), { flush: "post" });
    watch(
      [viewerRoot, view, options, state],
      () => {
        const kind = view.value.kind;
        viewers.update(
          viewerRoot.value,
          isMountedViewerKind(kind) ? kind : undefined,
          getMountedViewerOptions(options.value, session),
          (viewerState) => {
            if (viewerState !== "loading") load.value = viewerState;
          },
        );
      },
      { flush: "post" },
    );
    onScopeDispose(() => {
      streams.stop();
      viewers.destroy();
    });
    watch(loadKey, () => {
      load.value = "loading";
    });
    watch(load, (value) => {
      if (value === "loaded") emit("load");
      if (value === "error") emit("error");
    });
    const availability = computed(() =>
      view.value.kind === "unavailable"
        ? "unavailable"
        : view.value.kind === "age-restricted"
          ? "age-restricted"
          : view.value.kind === "pending"
            ? undefined
            : "available",
    );
    watch(
      availability,
      (value) => {
        if (value) emit("availability-change", value);
      },
      { immediate: true },
    );
    onMounted(() => {
      mounted.value = true;
      // An image that loaded before hydration fires no load event.
      if (image.value?.complete && image.value.naturalWidth > 0) load.value = "loaded";
    });
    const onMediaError = (event: Event) => {
      const element = event.target as HTMLMediaElement;
      if (!streams.recover(element)) session.mediaFailed(failedAt(element));
    };
    const playerEvents = {
      onLoadedmetadata: (event: Event) => {
        session.mediaLoaded(event.target as HTMLMediaElement);
        load.value = "loaded";
      },
      onError: onMediaError,
      onPlay: () => emit("play"),
      onEnded: () => emit("ended"),
      onTimeupdate: (event: Event) => {
        const element = event.target as HTMLMediaElement;
        played.value = getPlayedPercent(element);
        emit("timeupdate", element.currentTime);
      },
    };

    return () => {
      const current = view.value;
      const text = messages.value;
      const ratio = getAssetAspectRatio(current, state.value.info, props.aspectRatio);
      const placeholderUrl =
        "placeholderUrl" in current &&
        (current.kind === "age-restricted" || current.kind === "pending" || load.value !== "loaded")
          ? current.placeholderUrl
          : undefined;
      const notice = (children: VNodeArrayChildren) =>
        h("figcaption", { class: "calmlens-asset__notice" }, children);
      const video = props.video ?? {};
      const imageElement = (shown: Extract<AssetView, { kind: "image" | "website" }>) =>
        h("img", {
          key: loadKey.value,
          ref: image,
          class: "calmlens-asset__content",
          src: shown.src,
          srcset: shown.srcSet,
          sizes: shown.srcSet ? props.image?.sizes : undefined,
          alt: props.alt,
          width: shown.width,
          height: shown.height,
          loading: props.lazy ? "lazy" : undefined,
          decoding: "async",
          fetchpriority: props.fetchPriority,
          onLoad: () => {
            session.loaded();
            load.value = "loaded";
          },
          onError: () => session.failed(),
        });
      const viewerShown = isMountedViewerKind(current.kind) && mounted.value;
      const confirm = props.onAgeConfirmRequest;
      return h(
        "figure",
        {
          class: "calmlens-asset",
          "data-kind": current.kind,
          "data-state": load.value,
          "data-sized": ratio ? "" : undefined,
          "aria-busy": current.kind === "pending" ? "true" : undefined,
          style: {
            aspectRatio: ratio,
            backgroundColor: state.value.info?.content?.preview?.averageColor ?? undefined,
            "--calmlens-fit": props.fit,
          },
        },
        [
          placeholderUrl &&
            h("img", {
              class: "calmlens-asset__placeholder",
              src: placeholderUrl,
              alt: "",
              "aria-hidden": "true",
            }),
          current.kind === "image" && imageElement(current),
          current.kind === "website" &&
            current.link &&
            h("div", { class: "calmlens-asset__bar" }, [
              h(
                "a",
                {
                  class: "calmlens-button",
                  href: current.link,
                  target: "_blank",
                  rel: "noopener noreferrer nofollow",
                },
                formatMessage(text.openWebsite, { host: new URL(current.link).host }),
              ),
            ]),
          current.kind === "website" &&
            h(
              "div",
              {
                class: "calmlens-asset__scroll",
                role: "region",
                "aria-label": props.alt || undefined,
                tabindex: 0,
              },
              [imageElement(current)],
            ),
          current.kind === "video" &&
            h("video", {
              ref: media,
              class: "calmlens-asset__content",
              // A stream sets the element's source itself.
              ...(current.stream ? {} : { src: current.src }),
              poster: current.poster,
              controls: video.controls ?? true,
              autoplay: video.autoPlay,
              muted: video.muted,
              loop: video.loop,
              playsinline: true,
              preload: "metadata",
              "aria-label": props.alt || undefined,
              ...playerEvents,
            }),
          current.kind === "audio" && waveform(current.waveformUrl, current.peaks, played.value),
          current.kind === "audio" &&
            h("audio", {
              ref: media,
              class: "calmlens-asset__content",
              ...(current.stream ? {} : { src: current.src }),
              controls: video.controls ?? true,
              autoplay: video.autoPlay,
              muted: video.muted,
              loop: video.loop,
              preload: "metadata",
              "aria-label": props.alt || undefined,
              ...playerEvents,
            }),
          current.kind === "document" &&
            !viewerShown &&
            current.still &&
            h("img", {
              class: "calmlens-asset__content",
              src: current.still,
              alt: props.alt,
              decoding: "async",
            }),
          current.kind === "document" &&
            !viewerShown &&
            h(
              "a",
              {
                class: "calmlens-button calmlens-asset__open",
                href: current.src,
                target: "_blank",
                rel: "noopener noreferrer",
              },
              text.openDocument,
            ),
          // The viewer owns this element's children; Vue renders none.
          viewerShown && h("div", { ref: viewerRoot, class: "calmlens-asset__viewer" }),
          current.kind === "file" &&
            h("span", {
              class: "calmlens-asset__file",
              role: "img",
              "aria-label": props.alt || undefined,
              "aria-hidden": props.alt ? undefined : "true",
              innerHTML: renderFileIconSvg(
                { family: current.icon, extension: "" },
                ASSET_FILE_ICON_SIZE,
              ),
            }),
          current.kind === "age-restricted" &&
            (slots["age-gate"]?.({ placeholderUrl: current.placeholderUrl, confirm }) ??
              notice([
                h("strong", text.sensitiveTitle),
                h("p", text.sensitiveBody),
                confirm &&
                  h(
                    "button",
                    { type: "button", class: "calmlens-button", onClick: confirm },
                    text.reveal,
                  ),
              ])),
          current.kind === "unavailable" &&
            (slots.unavailable?.() ??
              notice([
                h("p", [
                  icon("unavailable"),
                  h("span", { class: "calmlens-asset__label" }, text.unavailable),
                ]),
              ])),
        ],
      );
    };
  },
});
