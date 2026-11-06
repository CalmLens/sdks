// Web components for uploads and assets, for plain HTML, Angular, Solid, Lit and any other UI
// library: `<calmlens-uploader>` and `<calmlens-asset>`. Importing this module defines both
// elements. They render into the page (no shadow DOM), so the stylesheet and your own CSS apply.

import type { AssetAvailability, ViewerClaims } from "./client/CalmLensTypes";
import {
  type AssetDisplay,
  type AssetOptions,
  AssetSession,
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
import { createUploadController, type UploadController } from "./ui/UploadController";
import type { PdfAssetOptions, ViewerAsset } from "./ui/viewers";

export * from "./ui";
export type {
  CalmLensUpload,
  UploadControllerOptions,
  UploaderProps,
  UploadItem,
  UploadSnapshot,
} from "./ui/BrowserUpload";
export { createUploadController } from "./ui/BrowserUpload";
export * from "./viewers/Elements";

/** The `detail` of each event the elements dispatch. */
export interface CalmLensElementEvents {
  "calmlens-uploaded": CalmLensUpload;
  "calmlens-rejected": UploadItem;
  "calmlens-failed": UploadItem;
  "calmlens-removed": UploadItem;
  "calmlens-change": UploadSnapshot;
  "calmlens-load": undefined;
  "calmlens-error": undefined;
  "calmlens-availability-change": AssetAvailability;
  "calmlens-age-confirm-request": undefined;
  "calmlens-play": undefined;
  "calmlens-ended": undefined;
  "calmlens-timeupdate": number;
}

type Child = Node | string | false | null | undefined;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number | boolean | undefined> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
};

const icon = (name: IconName) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [attribute, value] of Object.entries(ICON_ATTRIBUTES))
    svg.setAttribute(attribute, value);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
};

/** A row's file-type icon, from the SDK's own SVG markup. */
const fileThumbnail = (svg: string) => {
  const thumbnail = el("span", {
    class: "calmlens-upload__thumb",
    "data-kind": "file",
    "aria-hidden": "true",
  });
  thumbnail.innerHTML = svg;
  return thumbnail;
};

const numberAttribute = (element: Element, name: string) => {
  const value = element.getAttribute(name);
  return value === null || value === "" ? undefined : Number(value);
};

/**
 * Moves properties set on an element before it was defined onto its setters. Until then they're
 * plain own properties, which would hide the class's accessors.
 */
const upgradeProperties = (element: HTMLElement, names: string[]) => {
  const record = element as unknown as Record<string, unknown>;
  for (const name of names) {
    if (!Object.hasOwn(element, name)) continue;
    const value = record[name];
    delete record[name];
    record[name] = value;
  }
};

// SSR and workers have no custom elements; the classes are only defined where they can run.
const BaseElement = (
  typeof HTMLElement === "undefined" ? class {} : HTMLElement
) as typeof HTMLElement;

/**
 * `<calmlens-uploader upload-preset-id="…" token-url="/api/upload-token">` uploads through an
 * upload preset and dispatches `calmlens-uploaded` with `{ assetId, status, file }` for each
 * finished upload. Attributes: `upload-preset-id`, `token-url`, `accept`, `max-file-size`
 * (bytes), `no-auto-upload`, `multiple`, `max-files`, `disabled`, `capture` and `base-url`. Set
 * the `token`, `upload`, `checkStatus`, `messages` and `controller` properties from script for
 * anything an attribute can't hold.
 */
export class CalmLensUploaderElement extends BaseElement {
  static observedAttributes = [
    "upload-preset-id",
    "token-url",
    "accept",
    "max-file-size",
    "no-auto-upload",
    "multiple",
    "max-files",
    "disabled",
    "capture",
    "base-url",
  ];

  #token?: UploadControllerOptions["token"];
  #upload?: UploadControllerOptions["upload"];
  #checkStatus?: UploadControllerOptions["checkStatus"];
  #createClient?: UploadControllerOptions["createClient"];
  #messages?: Partial<CalmLensMessages>;
  #controller?: UploadController<File>;
  /** Whether `controller` was set from script, so its options and uploads aren't this element's. */
  #external = false;
  #unsubscribe?: () => void;
  #dragging = false;
  #input?: HTMLInputElement;

  /** The upload token, or a function returning one per file, instead of `token-url`. */
  get token(): UploadControllerOptions["token"] {
    return this.#token;
  }
  set token(value: UploadControllerOptions["token"]) {
    this.#token = value;
    this.#updateOptions();
  }

  /** Uploads each file your own way instead of through `upload-preset-id`. */
  get upload(): UploadControllerOptions["upload"] {
    return this.#upload;
  }
  set upload(value: UploadControllerOptions["upload"]) {
    this.#upload = value;
    this.#updateOptions();
  }

  /** Checks a pending upload made with `upload`. */
  get checkStatus(): UploadControllerOptions["checkStatus"] {
    return this.#checkStatus;
  }
  set checkStatus(value: UploadControllerOptions["checkStatus"]) {
    this.#checkStatus = value;
    this.#updateOptions();
  }

  /** Creates the client for each upload, for example a `MockCalmLensAppClient` in tests. */
  get createClient(): UploadControllerOptions["createClient"] {
    return this.#createClient;
  }
  set createClient(value: UploadControllerOptions["createClient"]) {
    this.#createClient = value;
    this.#updateOptions();
  }

  get messages(): Partial<CalmLensMessages> | undefined {
    return this.#messages;
  }
  set messages(value: Partial<CalmLensMessages> | undefined) {
    this.#messages = value;
    this.#render();
  }

  /**
   * The upload queue, for reading items or calling `start`, `retry`, `remove` and `clear`. Set it
   * to show a queue your script created; its own options then apply instead of the attributes.
   */
  get controller(): UploadController<File> {
    this.#controller ??= createUploadController(this.#options());
    return this.#controller;
  }
  set controller(value: UploadController<File>) {
    if (value === this.#controller) return;
    this.#unsubscribe?.();
    if (!this.#external) this.#controller?.clear();
    this.#controller = value;
    this.#external = true;
    if (this.isConnected) {
      this.#subscribe();
      this.#render();
    }
  }

  #updateOptions() {
    if (!this.#external) this.#controller?.setOptions(this.#options());
  }

  #subscribe() {
    this.#unsubscribe = this.controller.subscribe((snapshot) => {
      this.#renderItems();
      this.dispatchEvent(new CustomEvent("calmlens-change", { detail: snapshot }));
    });
  }

  #options(): UploadControllerOptions {
    const emit = <K extends keyof CalmLensElementEvents>(
      type: K,
      detail: CalmLensElementEvents[K],
    ) => this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
    return {
      uploadPresetId: this.getAttribute("upload-preset-id") ?? undefined,
      upload: this.upload,
      checkStatus: this.checkStatus,
      createClient: this.createClient,
      token: this.token,
      tokenUrl: this.getAttribute("token-url") ?? undefined,
      accept: this.getAttribute("accept") ?? undefined,
      maxFileSize: numberAttribute(this, "max-file-size"),
      autoUpload: !this.hasAttribute("no-auto-upload"),
      multiple: this.hasAttribute("multiple"),
      maxFiles: numberAttribute(this, "max-files"),
      baseUrl: this.getAttribute("base-url") ?? undefined,
      onUploaded: (upload) => emit("calmlens-uploaded", upload),
      onRejected: (item) => emit("calmlens-rejected", item),
      onFailed: (item) => emit("calmlens-failed", item),
      onRemoved: (item) => emit("calmlens-removed", item),
    };
  }

  connectedCallback() {
    upgradeProperties(this, [
      "token",
      "upload",
      "checkStatus",
      "createClient",
      "messages",
      "controller",
    ]);
    this.classList.add("calmlens-uploader");
    this.#subscribe();
    this.#render();
  }

  disconnectedCallback() {
    this.#unsubscribe?.();
    if (!this.#external) this.controller.clear();
  }

  attributeChangedCallback() {
    this.#updateOptions();
    if (this.isConnected) this.#render();
  }

  #render() {
    if (!this.isConnected) return;
    this.#updateOptions();
    const { accept, multiple } = this.controller.options;
    const messages = resolveMessages(this.#messages);
    const disabled = this.hasAttribute("disabled");
    const view = describeUploader(this.controller.getSnapshot(), this.controller.options, messages);
    const input = el("input", {
      type: "file",
      hidden: true,
      accept,
      multiple,
      capture: this.getAttribute("capture") ?? undefined,
      disabled,
    });
    this.#input = input;
    input.addEventListener("change", () => {
      if (input.files) this.controller.addFiles(input.files);
      input.value = "";
    });
    const button = el(
      "button",
      { type: "button", class: "calmlens-button", "data-variant": "outline", disabled },
      [view.chooseLabel],
    );
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.#openPicker();
    });
    const title = el("p", { class: "calmlens-dropzone__title" }, [messages.dropzoneTitle]);
    const zone = el("div", { class: "calmlens-dropzone", "data-disabled": disabled }, [
      el("span", { class: "calmlens-dropzone__icon" }, [icon("upload")]),
      el("div", { class: "calmlens-dropzone__text" }, [
        title,
        view.hint && el("p", { class: "calmlens-dropzone__hint" }, [view.hint]),
      ]),
      button,
    ]);
    const setDragging = (dragging: boolean) => {
      this.#dragging = dragging;
      zone.toggleAttribute("data-dragging", dragging);
      title.textContent = dragging ? messages.dropzoneTitleDragging : messages.dropzoneTitle;
    };
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (!this.hasAttribute("disabled") && !this.#dragging) setDragging(true);
    };
    zone.addEventListener("click", () => this.#openPicker());
    zone.addEventListener("dragover", onDragOver);
    zone.addEventListener("dragenter", onDragOver);
    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget as Node | null)) setDragging(false);
    });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      setDragging(false);
      if (!this.hasAttribute("disabled") && event.dataTransfer) {
        this.controller.addFiles(event.dataTransfer.files);
      }
    });
    zone.addEventListener("paste", (event) => {
      const files = event.clipboardData?.files;
      if (!this.hasAttribute("disabled") && files?.length) this.controller.addFiles(files);
    });
    this.replaceChildren(zone, input, el("ul", { class: "calmlens-uploads", hidden: true }));
    this.#renderItems();
  }

  #openPicker() {
    if (!this.hasAttribute("disabled")) this.#input?.click();
  }

  #renderItems() {
    const list = this.querySelector<HTMLUListElement>(":scope > .calmlens-uploads");
    const zone = this.querySelector<HTMLElement>(":scope > .calmlens-dropzone");
    if (!list || !zone) return;
    const messages = resolveMessages(this.#messages);
    const snapshot = this.controller.getSnapshot();
    const { items } = snapshot;
    const view = describeUploader(snapshot, this.controller.options, messages);
    zone.hidden = !view.showDropzone;
    list.hidden = items.length === 0;
    // Rows are rebuilt on each change except their thumbnails, so previews don't flash.
    const thumbnails = new Map(
      [...list.querySelectorAll<HTMLElement>(".calmlens-upload")].map((row) => [
        row.dataset.key,
        row.querySelector(".calmlens-upload__thumb"),
      ]),
    );
    const disabled = this.hasAttribute("disabled");
    list.replaceChildren(
      ...items.map((item) => {
        const itemView = describeUploadItem(item, messages);
        const thumbnail =
          thumbnails.get(item.key) ??
          (item.previewUrl
            ? el("img", { class: "calmlens-upload__thumb", src: item.previewUrl, alt: "" })
            : fileThumbnail(itemView.fileIcon));
        const bar = el("div", { class: "calmlens-progress__bar" });
        if (itemView.progressPercent !== undefined)
          bar.style.width = `${itemView.progressPercent}%`;
        const chooseAnother =
          !view.showDropzone &&
          el(
            "button",
            {
              type: "button",
              class: "calmlens-button",
              "data-variant": "outline",
              "data-size": "small",
              disabled,
            },
            [messages.chooseAnother],
          );
        if (chooseAnother) chooseAnother.addEventListener("click", () => this.#openPicker());
        const retry =
          itemView.canRetry &&
          el(
            "button",
            {
              type: "button",
              class: "calmlens-icon-button",
              "aria-label": messages.retry,
              title: messages.retry,
            },
            [icon("retry")],
          );
        if (retry) retry.addEventListener("click", () => this.controller.retry(item.key));
        const remove = el(
          "button",
          {
            type: "button",
            class: "calmlens-icon-button",
            "aria-label": itemView.removeLabel,
            title: itemView.removeLabel,
          },
          [icon("remove")],
        );
        remove.addEventListener("click", () => this.controller.remove(item.key));
        const row = el(
          "li",
          { class: "calmlens-upload", "data-stage": item.stage, "data-outcome": itemView.outcome },
          [
            thumbnail,
            el("div", { class: "calmlens-upload__body" }, [
              el("span", { class: "calmlens-upload__name" }, [item.file.name]),
              el("span", { class: "calmlens-upload__size" }, [itemView.size]),
              itemView.busy &&
                el(
                  "div",
                  {
                    class: "calmlens-progress",
                    role: "progressbar",
                    "aria-label": itemView.message,
                    "aria-valuemin": 0,
                    "aria-valuemax": 100,
                    "aria-valuenow": itemView.progressPercent,
                  },
                  [bar],
                ),
              itemView.message &&
                el("p", { class: "calmlens-upload__message", role: "status" }, [itemView.message]),
            ]),
            el("div", { class: "calmlens-upload__actions" }, [chooseAnother, retry, remove]),
          ],
        );
        row.dataset.key = item.key;
        return row;
      }),
    );
  }
}

/**
 * `<calmlens-asset src="…" alt="…">` shows any asset from its asset URL (public, or signed by your
 * server), natively in the page, the same way `CalmLensAsset` does in React, Vue and Svelte. It
 * reads `{src}/info` once connected, unless the `info` property is set. Attributes: `src`,
 * `display` (`full` or `preview`), `viewer-claims` (JSON), `alt`, `fit`, `aspect-ratio`, `eager`,
 * `fetch-priority`, `lens`, `transform`, `widths` (comma-separated), `sizes`, `no-controls`,
 * `autoplay`, `muted`, `loop`, `no-stream`, `initial-page` and `page-size`. Properties: `info`,
 * `onExpired` (returns a fresh signed asset URL), `messages`, `pdf`, `getText` (a spreadsheet's
 * sheets), and `renderUnavailable` / `renderAgeGate` (return your own notice's node). Events:
 * `calmlens-load`, `calmlens-error`, `calmlens-availability-change` (detail: the availability),
 * `calmlens-age-confirm-request`, `calmlens-play`, `calmlens-ended` and `calmlens-timeupdate`
 * (detail: the position in seconds).
 */
export class CalmLensAssetElement extends BaseElement {
  static observedAttributes = [
    "src",
    "display",
    "viewer-claims",
    "alt",
    "fit",
    "aspect-ratio",
    "eager",
    "fetch-priority",
    "lens",
    "transform",
    "widths",
    "sizes",
    "no-controls",
    "autoplay",
    "muted",
    "loop",
    "no-stream",
    "initial-page",
    "page-size",
  ];

  #messages?: Partial<CalmLensMessages>;
  #info?: ViewerAsset;
  #onExpired?: () => string | Promise<string>;
  #pdf?: PdfAssetOptions;
  #getText?: () => Promise<string>;
  #renderUnavailable?: () => Node;
  #renderAgeGate?: (props: { placeholderUrl?: string; confirm: () => void }) => Node;
  #loadKey?: string;
  #availability?: string;
  #session = new AssetSession(() => this.#render());
  #streams = new MediaStreamPlayer((media) => {
    this.#session.mediaFailed({
      position: media.currentTime || 0,
      playing: !media.paused && !media.ended,
    });
    return true;
  });
  #viewers = new AssetViewerMount();

  get messages(): Partial<CalmLensMessages> | undefined {
    return this.#messages;
  }
  set messages(value: Partial<CalmLensMessages> | undefined) {
    this.#messages = value;
    this.#rerender();
  }

  /** The asset's display info, prefetched with `getAssetInfo`, so nothing waits for `/info`. */
  get info(): ViewerAsset | undefined {
    return this.#info;
  }
  set info(value: ViewerAsset | undefined) {
    this.#info = value;
    this.#render();
  }

  /** Returns a fresh asset URL from your server once a signed one expires. */
  get onExpired(): (() => string | Promise<string>) | undefined {
    return this.#onExpired;
  }
  set onExpired(value: (() => string | Promise<string>) | undefined) {
    this.#onExpired = value;
    this.#render();
  }

  /** Where a document's pdf.js loads its worker, fonts and decoders from. */
  get pdf(): PdfAssetOptions | undefined {
    return this.#pdf;
  }
  set pdf(value: PdfAssetOptions | undefined) {
    this.#pdf = value;
    this.#render();
  }

  /** Reads a spreadsheet's sheets yourself, such as from its text child asset. */
  get getText(): (() => Promise<string>) | undefined {
    return this.#getText;
  }
  set getText(value: (() => Promise<string>) | undefined) {
    this.#getText = value;
    this.#render();
  }

  /** Returns your own unavailable notice. */
  get renderUnavailable(): (() => Node) | undefined {
    return this.#renderUnavailable;
  }
  set renderUnavailable(value: (() => Node) | undefined) {
    this.#renderUnavailable = value;
    this.#rerender();
  }

  /** Returns your own age notice; call `confirm` from its reveal button. */
  get renderAgeGate():
    | ((props: { placeholderUrl?: string; confirm: () => void }) => Node)
    | undefined {
    return this.#renderAgeGate;
  }
  set renderAgeGate(value:
    | ((props: { placeholderUrl?: string; confirm: () => void }) => Node)
    | undefined,) {
    this.#renderAgeGate = value;
    this.#rerender();
  }

  connectedCallback() {
    upgradeProperties(this, [
      "messages",
      "info",
      "onExpired",
      "pdf",
      "getText",
      "renderUnavailable",
      "renderAgeGate",
    ]);
    this.classList.add("calmlens-asset");
    this.setAttribute("role", "figure");
    this.#render();
  }

  attributeChangedCallback() {
    this.#render();
  }

  disconnectedCallback() {
    this.#streams.stop();
    this.#viewers.destroy();
    // Connecting again renders afresh, starting any stream again.
    this.#loadKey = undefined;
  }

  #rerender() {
    this.#loadKey = undefined;
    this.#render();
  }

  #emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  }

  #options() {
    const list = (name: string) =>
      this.getAttribute(name)
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    let viewerClaims: ViewerClaims | undefined;
    try {
      viewerClaims = this.hasAttribute("viewer-claims")
        ? JSON.parse(this.getAttribute("viewer-claims")!)
        : undefined;
    } catch {}
    return {
      src: this.getAttribute("src") || undefined,
      display: (this.getAttribute("display") as AssetDisplay | null) ?? undefined,
      viewerClaims,
      info: this.#info,
      alt: this.getAttribute("alt") ?? "",
      image: {
        lens: this.getAttribute("lens") ?? undefined,
        transform: this.getAttribute("transform") ?? undefined,
        widths: list("widths")?.map(Number),
        sizes: this.getAttribute("sizes") ?? undefined,
      },
      video: {
        controls: !this.hasAttribute("no-controls"),
        autoPlay: this.hasAttribute("autoplay"),
        muted: this.hasAttribute("muted"),
        loop: this.hasAttribute("loop"),
        stream: !this.hasAttribute("no-stream"),
      },
      document: { initialPage: numberAttribute(this, "initial-page"), pdf: this.#pdf },
      spreadsheet: { pageSize: numberAttribute(this, "page-size"), getText: this.#getText },
      onExpired: this.#onExpired,
    } satisfies AssetOptions & { alt: string };
  }

  #render() {
    if (!this.isConnected) return;
    const options = this.#options();
    const state = this.#session.update(options);
    this.#session.load();
    const view = getAssetView(options, state);
    const ratio = getAssetAspectRatio(view, state.info, numberAttribute(this, "aspect-ratio"));
    this.style.aspectRatio = ratio ? String(ratio) : "";
    this.toggleAttribute("data-sized", Boolean(ratio));
    this.style.backgroundColor = state.info?.content?.preview?.averageColor ?? "";
    this.style.setProperty("--calmlens-fit", this.getAttribute("fit"));
    this.dataset.kind = view.kind;
    this.toggleAttribute("aria-busy", view.kind === "pending");
    const availability =
      view.kind === "unavailable"
        ? "unavailable"
        : view.kind === "age-restricted"
          ? "age-restricted"
          : view.kind === "pending"
            ? undefined
            : "available";
    if (availability && availability !== this.#availability) {
      this.#availability = availability;
      this.#emit("calmlens-availability-change", availability);
    }
    const viewerOptions = getMountedViewerOptions(options, this.#session);
    const loadKey = `${getAssetViewKey(view)} ${options.alt} ${options.image.sizes} ${options.video.controls}`;
    if (loadKey === this.#loadKey) {
      // The same content: a viewer takes the latest options (such as a fresh asset URL).
      if (isMountedViewerKind(view.kind)) {
        this.#viewers.update(
          this.querySelector(".calmlens-asset__viewer") as HTMLElement,
          view.kind,
          viewerOptions,
        );
      }
      return;
    }
    this.#loadKey = loadKey;
    this.dataset.state = "loading";
    this.#viewers.destroy();

    const messages = resolveMessages(this.#messages);
    const { alt } = options;
    const loaded = () => {
      this.#session.loaded();
      this.dataset.state = "loaded";
      this.querySelector(":scope > .calmlens-asset__placeholder")?.remove();
      this.#emit("calmlens-load");
    };
    const placeholderUrl = "placeholderUrl" in view ? view.placeholderUrl : undefined;
    const placeholder = placeholderUrl
      ? el("img", {
          class: "calmlens-asset__placeholder",
          src: placeholderUrl,
          alt: "",
          "aria-hidden": "true",
        })
      : undefined;
    const notice = (children: Child[]) => el("div", { class: "calmlens-asset__notice" }, children);
    const playable = (media: HTMLMediaElement) => {
      media.addEventListener("loadedmetadata", () => {
        this.#session.mediaLoaded(media);
        this.dataset.state = "loaded";
        this.#emit("calmlens-load");
      });
      media.addEventListener("error", () => {
        if (this.#streams.recover(media)) return;
        this.#session.mediaFailed({
          position: media.currentTime || 0,
          playing: !media.paused && !media.ended,
        });
      });
      media.addEventListener("play", () => this.#emit("calmlens-play"));
      media.addEventListener("ended", () => this.#emit("calmlens-ended"));
      media.addEventListener("timeupdate", () =>
        this.#emit("calmlens-timeupdate", media.currentTime),
      );
      return media;
    };
    const image = (shown: Extract<typeof view, { kind: "image" | "website" }>) => {
      const content = el("img", {
        class: "calmlens-asset__content",
        src: shown.src,
        srcset: shown.srcSet,
        sizes: shown.srcSet ? options.image.sizes : undefined,
        alt,
        width: shown.width,
        height: shown.height,
        loading: this.hasAttribute("eager") ? undefined : "lazy",
        decoding: "async",
        fetchpriority: this.getAttribute("fetch-priority") ?? undefined,
      });
      content.addEventListener("load", loaded);
      content.addEventListener("error", () => this.#session.failed());
      return content;
    };
    const present = (...nodes: (Node | undefined)[]) =>
      this.replaceChildren(...nodes.filter((node): node is Node => node !== undefined));

    if (view.kind === "unavailable") {
      this.dataset.state = "error";
      this.#emit("calmlens-error");
      present(
        this.#renderUnavailable?.() ??
          notice([
            el("p", {}, [
              icon("unavailable"),
              el("span", { class: "calmlens-asset__label" }, [messages.unavailable]),
            ]),
          ]),
      );
    } else if (view.kind === "age-restricted") {
      const confirm = () => this.#emit("calmlens-age-confirm-request");
      if (this.#renderAgeGate) {
        present(placeholder, this.#renderAgeGate({ placeholderUrl, confirm }));
      } else {
        const reveal = el("button", { type: "button", class: "calmlens-button" }, [
          messages.reveal,
        ]);
        reveal.addEventListener("click", confirm);
        present(
          placeholder,
          notice([
            el("strong", {}, [messages.sensitiveTitle]),
            el("p", {}, [messages.sensitiveBody]),
            reveal,
          ]),
        );
      }
    } else if (view.kind === "pending") {
      present(placeholder);
    } else if (view.kind === "image") {
      present(placeholder, image(view));
    } else if (view.kind === "website") {
      const bar = view.link
        ? el("div", { class: "calmlens-asset__bar" }, [
            el(
              "a",
              {
                class: "calmlens-button",
                href: view.link,
                target: "_blank",
                rel: "noopener noreferrer nofollow",
              },
              [formatMessage(messages.openWebsite, { host: new URL(view.link).host })],
            ),
          ])
        : undefined;
      present(
        placeholder,
        bar,
        el(
          "div",
          {
            class: "calmlens-asset__scroll",
            role: "region",
            "aria-label": alt || undefined,
            tabindex: 0,
          },
          [image(view)],
        ),
      );
    } else if (view.kind === "video") {
      present(
        playable(
          el("video", {
            class: "calmlens-asset__content",
            // A stream sets the element's source itself.
            src: view.stream ? undefined : view.src,
            poster: view.poster,
            controls: options.video.controls,
            autoplay: options.video.autoPlay,
            muted: options.video.muted,
            loop: options.video.loop,
            playsinline: true,
            preload: "metadata",
            "aria-label": alt || undefined,
          }),
        ),
      );
    } else if (view.kind === "audio") {
      const audio = playable(
        el("audio", {
          class: "calmlens-asset__content",
          src: view.stream ? undefined : view.src,
          controls: options.video.controls,
          autoplay: options.video.autoPlay,
          muted: options.video.muted,
          loop: options.video.loop,
          preload: "metadata",
          "aria-label": alt || undefined,
        }),
      );
      const progress = view.peaks && waveformProgress(view.peaks);
      if (progress) {
        audio.addEventListener("timeupdate", () => {
          const played = getPlayedPercent(audio);
          progress.setAttribute("aria-valuenow", String(played));
          progress.style.setProperty("--calmlens-played", `${played}%`);
        });
      }
      const waveform =
        view.waveformUrl || progress
          ? el("div", { class: "calmlens-asset__waveform" }, [
              view.waveformUrl &&
                el("img", {
                  class: "calmlens-asset__wave",
                  src: view.waveformUrl,
                  alt: "",
                  "aria-hidden": "true",
                }),
              progress,
            ])
          : undefined;
      present(waveform, audio);
    } else if (isMountedViewerKind(view.kind)) {
      const root = el("div", { class: "calmlens-asset__viewer" });
      present(root);
      this.#viewers.update(root, view.kind, viewerOptions, (viewerState) => {
        if (viewerState === "loading") return;
        this.dataset.state = viewerState;
        this.#emit(viewerState === "loaded" ? "calmlens-load" : "calmlens-error");
      });
    } else if (view.kind === "file") {
      const file = el("span", {
        class: "calmlens-asset__file",
        role: "img",
        "aria-label": alt || undefined,
        "aria-hidden": alt ? undefined : "true",
      });
      file.innerHTML = renderFileIconSvg(
        { family: view.icon, extension: "" },
        ASSET_FILE_ICON_SIZE,
      );
      present(file);
    }
    // A video or audio stream plays through the element just rendered.
    this.#streams.update(this.querySelector<HTMLMediaElement>("video, audio"), view);
  }
}

/** Audio's progress drawn over its waveform; decorative, as the audio's own controls report it. */
const waveformProgress = (peaks: readonly number[]) => {
  const bars = (played: boolean) =>
    el(
      "div",
      { class: "calmlens-asset__peaks", "data-played": played },
      getPeakHeights(peaks).map((height) => {
        const bar = el("span");
        bar.style.height = `${height}%`;
        return bar;
      }),
    );
  const progress = el(
    "div",
    {
      class: "calmlens-asset__progress",
      role: "progressbar",
      "aria-hidden": "true",
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-valuenow": 0,
    },
    [bars(false), bars(true)],
  );
  progress.style.setProperty("--calmlens-played", "0%");
  return progress;
};

/** Defines `<calmlens-uploader>` and `<calmlens-asset>`, if they aren't defined yet. */
export const defineCalmLensElements = (): void => {
  if (typeof customElements === "undefined") return;
  if (!customElements.get("calmlens-uploader")) {
    customElements.define("calmlens-uploader", CalmLensUploaderElement);
  }
  if (!customElements.get("calmlens-asset")) {
    customElements.define("calmlens-asset", CalmLensAssetElement);
  }
};

defineCalmLensElements();

declare global {
  interface HTMLElementTagNameMap {
    "calmlens-uploader": CalmLensUploaderElement;
    "calmlens-asset": CalmLensAssetElement;
  }
  interface HTMLElementEventMap {
    "calmlens-uploaded": CustomEvent<CalmLensUpload>;
    "calmlens-rejected": CustomEvent<UploadItem>;
    "calmlens-failed": CustomEvent<UploadItem>;
    "calmlens-removed": CustomEvent<UploadItem>;
    "calmlens-change": CustomEvent<UploadSnapshot>;
    "calmlens-load": CustomEvent<undefined>;
    "calmlens-error": CustomEvent<undefined>;
    "calmlens-availability-change": CustomEvent<AssetAvailability>;
    "calmlens-age-confirm-request": CustomEvent<undefined>;
    "calmlens-play": CustomEvent<undefined>;
    "calmlens-ended": CustomEvent<undefined>;
    "calmlens-timeupdate": CustomEvent<number>;
  }
}
