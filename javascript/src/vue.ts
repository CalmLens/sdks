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
import { ICON_ATTRIBUTES, ICONS, type IconName } from "./ui/Icons";
import { getMediaState, type MediaAsset, type MediaOptions, resolveMediaProps } from "./ui/Media";
import {
  type CalmLensMessages,
  describeUploadItem,
  getDropzoneHint,
  resolveMessages,
} from "./ui/Messages";
import { getMediaAspectRatio, getMediaLoadKey } from "./ui/Props";
import { injectCalmLensStyles } from "./ui/Styles";
import {
  type CalmLensUpload,
  createUploadController,
  type UploadController,
  type UploadControllerOptions,
  type UploadItem,
  type UploadSnapshot,
} from "./ui/UploadController";

export * from "./ui";

const icon = (name: IconName) => h("svg", ICON_ATTRIBUTES, [h("path", { d: ICONS[name] })]);

const useStyles = (unstyled: () => boolean | undefined) => {
  onMounted(() => {
    if (!unstyled()) injectCalmLensStyles();
  });
};

export interface UseCalmLensUploadResult {
  snapshot: Readonly<ShallowRef<UploadSnapshot>>;
  controller: UploadController;
  addFiles: UploadController["addFiles"];
  retry: UploadController["retry"];
  remove: UploadController["remove"];
  clear: UploadController["clear"];
}

/**
 * Uploads files through an upload preset and keeps `snapshot` up to date as each one uploads and
 * is checked. Use it to build your own upload UI; `CalmLensUploader` is built on it. Uploads
 * still running when the component unmounts are cancelled.
 */
export const useCalmLensUpload = (
  options: MaybeRefOrGetter<UploadControllerOptions>,
): UseCalmLensUploadResult => {
  const controller = createUploadController(toValue(options));
  watchEffect(() => controller.setOptions(toValue(options)));
  const snapshot = shallowRef(controller.getSnapshot());
  const unsubscribe = controller.subscribe((next) => {
    snapshot.value = next;
  });
  onScopeDispose(() => {
    unsubscribe();
    controller.clear();
  });
  return {
    snapshot,
    controller,
    addFiles: (files) => controller.addFiles(files),
    retry: (key) => controller.retry(key),
    remove: (key) => controller.remove(key),
    clear: () => controller.clear(),
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
    multiple: { type: Boolean, default: false },
    maxFiles: optional(Number),
    concurrency: optional(Number),
    decisionTimeoutMs: optional(Number),
    baseUrl: optional(String),
    disabled: { type: Boolean, default: false },
    capture: optional(String as PropType<"user" | "environment">),
    messages: messagesProp,
    unstyled: { type: Boolean, default: false },
  },
  emits: {
    uploaded: (_upload: CalmLensUpload) => true,
    rejected: (_item: UploadItem) => true,
    failed: (_item: UploadItem) => true,
    removed: (_item: UploadItem) => true,
  },
  setup(props, { emit }) {
    useStyles(() => props.unstyled);
    const upload = useCalmLensUpload(() => ({
      uploadPresetId: props.uploadPresetId,
      upload: props.upload,
      checkStatus: props.checkStatus,
      createClient: props.createClient,
      token: props.token,
      tokenUrl: props.tokenUrl,
      accept: props.accept,
      maxFileSize: props.maxFileSize,
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
      const hint = getDropzoneHint(text, props.maxFileSize);
      const items = upload.snapshot.value.items;
      return h("div", { class: "calmlens-uploader" }, [
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
              if (!props.disabled && event.dataTransfer) upload.addFiles(event.dataTransfer.files);
            },
            onPaste: (event: ClipboardEvent) => {
              const files = event.clipboardData?.files;
              if (!props.disabled && files?.length) upload.addFiles(files);
            },
          },
          [
            h("span", { class: "calmlens-dropzone__icon" }, [icon("upload")]),
            h(
              "p",
              { class: "calmlens-dropzone__title" },
              dragging.value ? text.dropzoneTitleDragging : text.dropzoneTitle,
            ),
            hint && h("p", { class: "calmlens-dropzone__hint" }, hint),
            h(
              "button",
              {
                type: "button",
                class: "calmlens-button",
                disabled: props.disabled,
                onClick: (event: MouseEvent) => {
                  event.stopPropagation();
                  openPicker();
                },
              },
              text.chooseFiles,
            ),
            h("input", {
              ref: input,
              type: "file",
              hidden: true,
              accept: props.accept,
              multiple: props.multiple,
              capture: props.capture,
              disabled: props.disabled,
              onClick: (event: MouseEvent) => event.stopPropagation(),
              onChange: (event: Event) => {
                const target = event.target as HTMLInputElement;
                if (target.files) upload.addFiles(target.files);
                target.value = "";
              },
            }),
          ],
        ),
        items.length > 0 &&
          h(
            "ul",
            { class: "calmlens-uploads" },
            items.map((item) => {
              const view = describeUploadItem(item, text);
              return h(
                "li",
                {
                  key: item.key,
                  class: "calmlens-upload",
                  "data-stage": item.stage,
                  "data-outcome": view.outcome,
                },
                [
                  item.previewUrl
                    ? h("img", { class: "calmlens-upload__thumb", src: item.previewUrl, alt: "" })
                    : h(
                        "span",
                        { class: "calmlens-upload__thumb", "aria-hidden": "true" },
                        view.extension,
                      ),
                  h("div", { class: "calmlens-upload__body" }, [
                    h("span", { class: "calmlens-upload__name" }, [
                      item.file.name,
                      h("span", { class: "calmlens-upload__size" }, view.size),
                    ]),
                    view.busy &&
                      h(
                        "div",
                        {
                          class: "calmlens-progress",
                          role: "progressbar",
                          "aria-label": view.message,
                          "aria-valuemin": 0,
                          "aria-valuemax": 100,
                          "aria-valuenow": view.progressPercent,
                        },
                        [
                          h("div", {
                            class: "calmlens-progress__bar",
                            style:
                              view.progressPercent === undefined
                                ? undefined
                                : { width: `${view.progressPercent}%` },
                          }),
                        ],
                      ),
                    h("p", { class: "calmlens-upload__message", role: "status" }, view.message),
                  ]),
                  h("div", { class: "calmlens-upload__actions" }, [
                    view.canRetry &&
                      h(
                        "button",
                        {
                          type: "button",
                          class: "calmlens-icon-button",
                          "aria-label": text.retry,
                          title: text.retry,
                          onClick: () => upload.retry(item.key),
                        },
                        [icon("retry")],
                      ),
                    h(
                      "button",
                      {
                        type: "button",
                        class: "calmlens-icon-button",
                        "aria-label": view.removeLabel,
                        title: view.removeLabel,
                        onClick: () => upload.remove(item.key),
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

/**
 * Shows an asset from the CalmLens CDN with responsive widths and a blurred placeholder while
 * it loads. Age-restricted assets stay behind the placeholder and a reveal button until
 * `canView` is set; blocked and purged assets show an unavailable notice.
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
    canView: { type: Boolean, default: false },
    type: optional(String as PropType<"image" | "video" | "audio">),
    resource: optional(String as PropType<"original" | "rendered">),
    lens: optional(String),
    transform: optional([String, Object, Array] as PropType<CdnTransform>),
    widths: optional(Array as PropType<number[]>),
    url: optional(String),
    placeholder: { type: Boolean, default: true },
    placeholderHash: optional(String),
    placeholderUrl: optional(String),
    averageColor: optional(String),
    cdnBaseUrl: optional(String),
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
    unstyled: { type: Boolean, default: false },
    /** Bound by `@reveal`; declared as a prop so the button shows only when something listens. */
    onReveal: optional(Function as PropType<() => void>),
  },
  setup(props) {
    useStyles(() => props.unstyled);
    const messages = computed(() => resolveMessages(props.messages));
    const resolved = computed(() => resolveMediaProps(props as MediaOptions & typeof props));
    const state = computed(() => getMediaState(resolved.value));
    const loadKey = computed(() => getMediaLoadKey(state.value));
    const load = ref<LoadState>("loading");
    const image = ref<HTMLImageElement>();
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

    return () => {
      const current = state.value;
      const text = messages.value;
      const view = resolved.value;
      const ratio = getMediaAspectRatio(view);
      const failed = load.value === "error";
      const placeholderUrl =
        current.kind === "audio" || current.kind === "unavailable"
          ? undefined
          : current.placeholderUrl;
      const showPlaceholder =
        placeholderUrl &&
        (current.kind === "gated" || (current.kind === "image" && load.value !== "loaded"));
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
          showPlaceholder &&
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
              class: "calmlens-media__content",
              src: current.src,
              poster: current.poster,
              controls: props.controls,
              playsinline: true,
              preload: "metadata",
              "aria-label": props.alt || undefined,
              onError: () => {
                load.value = "error";
              },
            }),
          current.kind === "audio" &&
            !failed &&
            h("audio", {
              class: "calmlens-media__content",
              src: current.src,
              controls: props.controls,
              preload: "metadata",
              "aria-label": props.alt || undefined,
              onError: () => {
                load.value = "error";
              },
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
                h("span", { class: "calmlens-media__label" }, text.unavailable),
              ]),
            ]),
        ],
      );
    };
  },
});
