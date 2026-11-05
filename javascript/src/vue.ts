// Vue 3 components for uploads and media: `CalmLensUploader`, `CalmLensMedia` and the
// `useCalmLensUpload` composable for your own upload UI. The uploader emits `uploaded`,
// `rejected`, `failed` and `removed`; listen for `reveal` on the media component.

import {
  computed,
  defineComponent,
  h,
  type MaybeRefOrGetter,
  onMounted,
  onScopeDispose,
  type PropType,
  ref,
  type ShallowRef,
  shallowRef,
  toValue,
  type VNodeArrayChildren,
  watch,
  watchEffect,
} from "vue";
import type { AssetModerationStatus, CdnTransform } from "./client/CalmLensTypes";
import type {
  CalmLensUpload,
  UploadControllerOptions,
  UploadItem,
  UploadSnapshot,
} from "./ui/BrowserUpload";
import { renderFileIconSvg } from "./ui/FileIcons";
import { ICON_ATTRIBUTES, ICONS, type IconName } from "./ui/Icons";
import {
  type GetSignedMediaUrl,
  getMediaState,
  getPeakHeights,
  getPlayedPercent,
  type MediaAsset,
  type MediaKind,
  type MediaOptions,
  MediaUrlSigner,
  resolveMediaProps,
} from "./ui/Media";
import { MediaStreamPlayer } from "./ui/MediaStream";
import {
  type CalmLensMessages,
  describeUploader,
  describeUploadItem,
  getMediaUnavailableMessage,
  resolveMessages,
} from "./ui/Messages";
import {
  getMediaAspectRatio,
  getMediaLoadKey,
  getShownPlaceholder,
  MEDIA_FILE_ICON_SIZE,
} from "./ui/Props";
import {
  createUploadController,
  type UploadController,
  type UploadFile,
} from "./ui/UploadController";

export * from "./ui";
export type {
  CalmLensUpload,
  UploadControllerOptions,
  UploaderProps,
  UploadItem,
  UploadSnapshot,
} from "./ui/BrowserUpload";
export { createUploadController } from "./ui/BrowserUpload";

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

/**
 * Uploads files through an upload preset and keeps `snapshot` up to date as each one uploads and
 * is checked. Use it to build your own upload UI; `CalmLensUploader` is built on it. Uploads
 * still running when the component unmounts are cancelled.
 */
export const useCalmLensUpload = <F extends UploadFile = File>(
  options: MaybeRefOrGetter<UploadControllerOptions<F>>,
): UseCalmLensUploadResult<F> => {
  const controller = createUploadController(toValue(options));
  watchEffect(() => controller.setOptions(toValue(options)));
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
  return h("div", { class: "calmlens-media__waveform" }, [
    url && h("img", { class: "calmlens-media__wave", src: url, alt: "", "aria-hidden": "true" }),
    // Decorative: the audio element's own controls report its progress.
    peaks &&
      h(
        "div",
        {
          class: "calmlens-media__progress",
          role: "progressbar",
          "aria-hidden": "true",
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": played,
          style: { "--calmlens-played": `${played}%` },
        },
        [
          h("div", { class: "calmlens-media__peaks" }, bars()),
          h("div", { class: "calmlens-media__peaks", "data-played": "" }, bars()),
        ],
      ),
  ]);
};

/**
 * Shows an asset from the CalmLens CDN: an image with responsive widths and a blurred placeholder
 * while it loads, a video with its poster, audio with its waveform, a PDF, or a file's preview
 * still or icon. Age-restricted assets stay behind the placeholder and a reveal button until
 * `ageConfirmed` is set; blocked and purged assets show an unavailable notice.
 */
export const CalmLensMedia = defineComponent({
  name: "CalmLensMedia",
  props: {
    /** An asset from the API, which supplies the project, ID, status, type and preview. */
    asset: optional(Object as PropType<MediaAsset>),
    /** Required without `asset`. */
    projectId: optional(String),
    /** Required without `asset`. */
    assetId: optional(String),
    status: optional(String as PropType<AssetModerationStatus>),
    contentRemoved: optional(Boolean),
    type: optional(String as PropType<MediaKind>),
    hasPreview: optional(Boolean),
    hasStream: optional(Boolean),
    /** Whether video and audio play their adaptive stream when the asset has one. */
    stream: { type: Boolean, default: true },
    peaks: optional(Array as PropType<readonly number[]>),
    resource: optional(String as PropType<"original" | "rendered">),
    lens: optional(String),
    transform: optional([String, Object, Array] as PropType<CdnTransform>),
    widths: optional(Array as PropType<number[]>),
    url: optional(String),
    getSignedUrl: optional(Function as PropType<GetSignedMediaUrl>),
    placeholder: { type: Boolean, default: true },
    placeholderHash: optional(String),
    placeholderUrl: optional(String),
    averageColor: optional(String),
    cdnBaseUrl: optional(String),
    viewerClaims: optional(Object as PropType<NonNullable<MediaOptions["viewerClaims"]>>),
    alt: { type: String, default: "" },
    aspectRatio: optional(Number),
    width: optional(Number),
    height: optional(Number),
    sizes: optional(String),
    fit: optional(String as PropType<"cover" | "contain">),
    position: optional(String),
    lazy: { type: Boolean, default: true },
    fetchPriority: optional(String as PropType<"high" | "low" | "auto">),
    controls: { type: Boolean, default: true },
    messages: messagesProp,
    /** Bound by `@reveal`; declared as a prop so the button shows only when something listens. */
    onReveal: optional(Function as PropType<() => void>),
  },
  setup(props) {
    const messages = computed(() => resolveMessages(props.messages));
    const resolved = computed(() => resolveMediaProps(props as MediaOptions & typeof props));
    const signed = ref(0);
    const signer = new MediaUrlSigner(() => {
      signed.value++;
    });
    const state = computed(() => {
      void signed.value;
      return getMediaState(resolved.value, signer.urls(resolved.value));
    });
    const loadKey = computed(() => getMediaLoadKey(state.value));
    const load = ref<LoadState>("loading");
    const played = ref(0);
    const image = ref<HTMLImageElement>();
    const media = ref<HTMLMediaElement>();
    const streams = new MediaStreamPlayer(signer);
    // A video or audio stream plays through its element, so it starts after the render.
    watch([media, state], () => streams.update(media.value, state.value), { flush: "post" });
    onScopeDispose(() => streams.stop());
    watch(loadKey, () => {
      load.value = "loading";
    });
    // An image that loaded before hydration fires no load event.
    onMounted(() => {
      if (image.value?.complete && image.value.naturalWidth > 0) load.value = "loaded";
    });
    const onError = () => {
      load.value = "error";
    };
    const onMediaError = (event: Event) => {
      if (!streams.recover(event.target as HTMLMediaElement)) load.value = "error";
    };
    const onLoadedMetadata = (event: Event) => signer.loaded(event.target as HTMLMediaElement);

    return () => {
      const current = state.value;
      const text = messages.value;
      const view = resolved.value;
      const ratio = getMediaAspectRatio(view);
      const failed = load.value === "error";
      const placeholderUrl = failed
        ? undefined
        : getShownPlaceholder(current, load.value === "loaded");
      const notice = (children: VNodeArrayChildren) =>
        h("figcaption", { class: "calmlens-media__notice" }, children);
      return h(
        "figure",
        {
          class: "calmlens-media",
          "data-kind": current.kind,
          "data-state": load.value,
          "data-sized": ratio ? "" : undefined,
          style: {
            aspectRatio: ratio,
            backgroundColor: view.averageColor,
            "--calmlens-fit": props.fit,
            "--calmlens-position": props.position,
          },
        },
        [
          placeholderUrl &&
            h("img", {
              class: "calmlens-media__placeholder",
              src: placeholderUrl,
              alt: "",
              "aria-hidden": "true",
            }),
          current.kind === "image" &&
            !failed &&
            h("img", {
              key: loadKey.value,
              ref: image,
              class: "calmlens-media__content",
              src: current.src,
              srcset: current.srcSet,
              sizes: props.sizes,
              alt: props.alt,
              width: view.width,
              height: view.height,
              loading: props.lazy ? "lazy" : undefined,
              decoding: "async",
              fetchpriority: props.fetchPriority,
              onLoad: () => {
                load.value = "loaded";
              },
              onError,
            }),
          current.kind === "video" &&
            !failed &&
            h("video", {
              ref: media,
              class: "calmlens-media__content",
              // A stream sets the element's source itself.
              ...(current.stream ? {} : { src: current.src }),
              poster: current.poster,
              controls: props.controls,
              playsinline: true,
              preload: "metadata",
              "aria-label": props.alt || undefined,
              onLoadedmetadata: onLoadedMetadata,
              onError: onMediaError,
            }),
          current.kind === "audio" &&
            !failed &&
            waveform(current.waveformUrl, current.peaks, played.value),
          current.kind === "audio" &&
            !failed &&
            h("audio", {
              ref: media,
              class: "calmlens-media__content",
              ...(current.stream ? {} : { src: current.src }),
              controls: props.controls,
              preload: "metadata",
              "aria-label": props.alt || undefined,
              onLoadedmetadata: onLoadedMetadata,
              onTimeupdate: (event: Event) => {
                played.value = getPlayedPercent(event.target as HTMLMediaElement);
              },
              onError: onMediaError,
            }),
          current.kind === "pdf" &&
            h("iframe", {
              class: "calmlens-media__content",
              src: current.src,
              title: props.alt || text.pdfTitle,
            }),
          current.kind === "pdf" &&
            h(
              "a",
              {
                class: "calmlens-button calmlens-media__open",
                href: current.src,
                target: "_blank",
                rel: "noopener noreferrer",
              },
              text.openPdf,
            ),
          current.kind === "file" &&
            h("span", {
              class: "calmlens-media__file",
              role: "img",
              "aria-label": props.alt || undefined,
              "aria-hidden": props.alt ? undefined : "true",
              innerHTML: renderFileIconSvg(
                { family: current.icon, extension: "" },
                MEDIA_FILE_ICON_SIZE,
              ),
            }),
          current.kind === "gated" &&
            notice([
              h("strong", text.sensitiveTitle),
              h("p", text.sensitiveBody),
              props.onReveal &&
                h(
                  "button",
                  { type: "button", class: "calmlens-button", onClick: props.onReveal },
                  text.reveal,
                ),
            ]),
          (current.kind === "unavailable" || failed) &&
            notice([
              h("p", [
                icon("unavailable"),
                h(
                  "span",
                  { class: "calmlens-media__label" },
                  getMediaUnavailableMessage(current, text),
                ),
              ]),
            ]),
        ],
      );
    };
  },
});
