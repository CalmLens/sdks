// Web components for uploads and media, for plain HTML, Angular, Solid, Lit and any other UI
// library: `<calmlens-uploader>` and `<calmlens-media>`. Importing this module defines both
// elements. They render into the page (no shadow DOM), so the stylesheet and your own CSS apply.

import type { AssetModerationStatus } from "./client/CalmLensTypes";
import { ICON_ATTRIBUTES, ICONS, type IconName } from "./ui/Icons";
import { getMediaState, type MediaOptions } from "./ui/Media";
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

/** The `detail` of each event the elements dispatch. */
export interface CalmLensElementEvents {
  "calmlens-uploaded": CalmLensUpload;
  "calmlens-rejected": UploadItem;
  "calmlens-failed": UploadItem;
  "calmlens-removed": UploadItem;
  "calmlens-change": UploadSnapshot;
  "calmlens-reveal": undefined;
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
 * (bytes), `multiple`, `max-files`, `disabled`, `capture`, `base-url` and `unstyled`. Set the
 * `token`, `upload`, `checkStatus` and `messages` properties from script for anything an
 * attribute can't hold.
 */
export class CalmLensUploaderElement extends BaseElement {
  static observedAttributes = [
    "upload-preset-id",
    "token-url",
    "accept",
    "max-file-size",
    "multiple",
    "max-files",
    "disabled",
    "capture",
    "base-url",
  ];

  #token?: UploadControllerOptions["token"];
  #upload?: UploadControllerOptions["upload"];
  #checkStatus?: UploadControllerOptions["checkStatus"];
  #messages?: Partial<CalmLensMessages>;
  #controller?: UploadController;
  #unsubscribe?: () => void;
  #dragging = false;
  #input?: HTMLInputElement;

  /** The upload token, or a function returning one per file, instead of `token-url`. */
  get token(): UploadControllerOptions["token"] {
    return this.#token;
  }
  set token(value: UploadControllerOptions["token"]) {
    this.#token = value;
    this.#controller?.setOptions(this.#options());
  }

  /** Uploads each file your own way instead of through `upload-preset-id`. */
  get upload(): UploadControllerOptions["upload"] {
    return this.#upload;
  }
  set upload(value: UploadControllerOptions["upload"]) {
    this.#upload = value;
    this.#controller?.setOptions(this.#options());
  }

  /** Checks a pending upload made with `upload`. */
  get checkStatus(): UploadControllerOptions["checkStatus"] {
    return this.#checkStatus;
  }
  set checkStatus(value: UploadControllerOptions["checkStatus"]) {
    this.#checkStatus = value;
    this.#controller?.setOptions(this.#options());
  }

  get messages(): Partial<CalmLensMessages> | undefined {
    return this.#messages;
  }
  set messages(value: Partial<CalmLensMessages> | undefined) {
    this.#messages = value;
    this.#render();
  }

  /** The upload queue, for reading items or calling `retry`, `remove` and `clear`. */
  get controller(): UploadController {
    this.#controller ??= createUploadController(this.#options());
    return this.#controller;
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
      token: this.token,
      tokenUrl: this.getAttribute("token-url") ?? undefined,
      accept: this.getAttribute("accept") ?? undefined,
      maxFileSize: numberAttribute(this, "max-file-size"),
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
    upgradeProperties(this, ["token", "upload", "checkStatus", "messages"]);
    if (!this.hasAttribute("unstyled")) injectCalmLensStyles();
    this.classList.add("calmlens-uploader");
    this.#unsubscribe = this.controller.subscribe((snapshot) => {
      this.#renderItems();
      this.dispatchEvent(new CustomEvent("calmlens-change", { detail: snapshot }));
    });
    this.#render();
  }

  disconnectedCallback() {
    this.#unsubscribe?.();
    this.controller.clear();
  }

  attributeChangedCallback() {
    this.#controller?.setOptions(this.#options());
    if (this.isConnected) this.#render();
  }

  #render() {
    if (!this.isConnected) return;
    this.controller.setOptions(this.#options());
    const messages = resolveMessages(this.#messages);
    const disabled = this.hasAttribute("disabled");
    const hint = getDropzoneHint(messages, numberAttribute(this, "max-file-size"));
    const input = el("input", {
      type: "file",
      hidden: true,
      accept: this.getAttribute("accept") ?? undefined,
      multiple: this.hasAttribute("multiple"),
      capture: this.getAttribute("capture") ?? undefined,
      disabled,
    });
    this.#input = input;
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => {
      if (input.files) this.controller.addFiles(input.files);
      input.value = "";
    });
    const openPicker = () => {
      if (!this.hasAttribute("disabled")) this.#input?.click();
    };
    const button = el("button", { type: "button", class: "calmlens-button", disabled }, [
      messages.chooseFiles,
    ]);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openPicker();
    });
    const title = el("p", { class: "calmlens-dropzone__title" }, [messages.dropzoneTitle]);
    const zone = el("div", { class: "calmlens-dropzone", "data-disabled": disabled }, [
      el("span", { class: "calmlens-dropzone__icon" }, [icon("upload")]),
      title,
      hint && el("p", { class: "calmlens-dropzone__hint" }, [hint]),
      button,
      input,
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
    zone.addEventListener("click", openPicker);
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
    this.replaceChildren(zone, el("ul", { class: "calmlens-uploads", hidden: true }));
    this.#renderItems();
  }

  #renderItems() {
    const list = this.querySelector<HTMLUListElement>(":scope > .calmlens-uploads");
    if (!list) return;
    const messages = resolveMessages(this.#messages);
    const { items } = this.controller.getSnapshot();
    list.hidden = items.length === 0;
    // Rows are rebuilt on each change except their thumbnails, so previews don't flash.
    const thumbnails = new Map(
      [...list.querySelectorAll<HTMLElement>(".calmlens-upload")].map((row) => [
        row.dataset.key,
        row.querySelector(".calmlens-upload__thumb"),
      ]),
    );
    list.replaceChildren(
      ...items.map((item) => {
        const view = describeUploadItem(item, messages);
        const thumbnail =
          thumbnails.get(item.key) ??
          (item.previewUrl
            ? el("img", { class: "calmlens-upload__thumb", src: item.previewUrl, alt: "" })
            : el("span", { class: "calmlens-upload__thumb", "aria-hidden": "true" }, [
                view.extension,
              ]));
        const bar = el("div", { class: "calmlens-progress__bar" });
        if (view.progressPercent !== undefined) bar.style.width = `${view.progressPercent}%`;
        const retry =
          view.canRetry &&
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
            "aria-label": view.removeLabel,
            title: view.removeLabel,
          },
          [icon("remove")],
        );
        remove.addEventListener("click", () => this.controller.remove(item.key));
        const row = el(
          "li",
          { class: "calmlens-upload", "data-stage": item.stage, "data-outcome": view.outcome },
          [
            thumbnail,
            el("div", { class: "calmlens-upload__body" }, [
              el("span", { class: "calmlens-upload__name" }, [
                item.file.name,
                el("span", { class: "calmlens-upload__size" }, [view.size]),
              ]),
              view.busy &&
                el(
                  "div",
                  {
                    class: "calmlens-progress",
                    role: "progressbar",
                    "aria-label": view.message,
                    "aria-valuemin": 0,
                    "aria-valuemax": 100,
                    "aria-valuenow": view.progressPercent,
                  },
                  [bar],
                ),
              el("p", { class: "calmlens-upload__message", role: "status" }, [view.message]),
            ]),
            el("div", { class: "calmlens-upload__actions" }, [retry, remove]),
          ],
        );
        row.dataset.key = item.key;
        return row;
      }),
    );
  }
}

/**
 * `<calmlens-media project-id="…" asset-id="…" status="allowed" alt="…">` shows an asset from the
 * CalmLens CDN with a blurred placeholder while it loads. Age-restricted assets show the
 * placeholder and a reveal button, which dispatches `calmlens-reveal`, until `can-view` is set.
 * Attributes: `project-id`, `asset-id`, `status`, `can-view`, `type`, `resource`, `lens`,
 * `transform`, `widths` (comma-separated), `url`, `no-placeholder`, `placeholder-hash`,
 * `placeholder-url`, `average-color`, `cdn-base-url`, `alt`, `aspect-ratio`, `width`, `height`,
 * `sizes`, `fit`, `position`, `eager`, `fetch-priority`, `no-controls` and `unstyled`.
 */
export class CalmLensMediaElement extends BaseElement {
  static observedAttributes = [
    "project-id",
    "asset-id",
    "status",
    "can-view",
    "type",
    "resource",
    "lens",
    "transform",
    "widths",
    "url",
    "no-placeholder",
    "placeholder-hash",
    "placeholder-url",
    "average-color",
    "cdn-base-url",
    "alt",
    "aspect-ratio",
    "width",
    "height",
    "sizes",
    "fit",
    "position",
    "eager",
    "fetch-priority",
    "no-controls",
  ];

  #messages?: Partial<CalmLensMessages>;
  #loadKey?: string;

  get messages(): Partial<CalmLensMessages> | undefined {
    return this.#messages;
  }
  set messages(value: Partial<CalmLensMessages> | undefined) {
    this.#messages = value;
    this.#loadKey = undefined;
    this.#render();
  }

  connectedCallback() {
    upgradeProperties(this, ["messages"]);
    if (!this.hasAttribute("unstyled")) injectCalmLensStyles();
    this.classList.add("calmlens-media");
    this.setAttribute("role", "figure");
    this.#render();
  }

  attributeChangedCallback() {
    this.#render();
  }

  #mediaOptions(): MediaOptions {
    const list = (name: string) =>
      this.getAttribute(name)
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    return {
      projectId: this.getAttribute("project-id") ?? "",
      assetId: this.getAttribute("asset-id") ?? "",
      status: (this.getAttribute("status") as AssetModerationStatus | null) ?? undefined,
      canView: this.hasAttribute("can-view"),
      type: (this.getAttribute("type") as MediaOptions["type"] | null) ?? undefined,
      resource: (this.getAttribute("resource") as MediaOptions["resource"] | null) ?? undefined,
      lens: this.getAttribute("lens") ?? undefined,
      transform: this.getAttribute("transform") ?? undefined,
      widths: list("widths")?.map(Number),
      url: this.getAttribute("url") ?? undefined,
      placeholder: !this.hasAttribute("no-placeholder"),
      placeholderHash: this.getAttribute("placeholder-hash") ?? undefined,
      placeholderUrl: this.getAttribute("placeholder-url") ?? undefined,
      cdnBaseUrl: this.getAttribute("cdn-base-url") ?? undefined,
    };
  }

  #render() {
    if (!this.isConnected) return;
    const options = this.#mediaOptions();
    if (!options.projectId || !options.assetId) return;
    const state = getMediaState(options);
    const loadKey = `${getMediaLoadKey(state)} ${this.getAttribute("alt")} ${this.getAttribute("sizes")} ${options.canView}`;
    const ratio = getMediaAspectRatio({
      aspectRatio: numberAttribute(this, "aspect-ratio"),
      width: numberAttribute(this, "width"),
      height: numberAttribute(this, "height"),
    });
    this.style.aspectRatio = ratio ? String(ratio) : "";
    this.toggleAttribute("data-sized", Boolean(ratio));
    this.style.backgroundColor = this.getAttribute("average-color") ?? "";
    this.style.setProperty("--calmlens-fit", this.getAttribute("fit"));
    this.style.setProperty("--calmlens-position", this.getAttribute("position"));
    this.dataset.kind = state.kind;
    if (loadKey === this.#loadKey) return;
    this.#loadKey = loadKey;
    this.dataset.state = "loading";

    const messages = resolveMessages(this.#messages);
    const alt = this.getAttribute("alt") ?? "";
    const sizes = this.getAttribute("sizes") ?? undefined;
    const placeholder =
      state.kind !== "audio" && state.kind !== "unavailable" && state.placeholderUrl
        ? el("img", {
            class: "calmlens-media__placeholder",
            src: state.placeholderUrl,
            alt: "",
            "aria-hidden": "true",
          })
        : undefined;
    const notice = (children: Child[]) => el("div", { class: "calmlens-media__notice" }, children);
    const unavailable = () => notice([el("p", {}, [icon("unavailable"), messages.unavailable])]);
    const fail = () => {
      this.dataset.state = "error";
      this.replaceChildren(unavailable());
    };
    const controls = !this.hasAttribute("no-controls");

    if (state.kind === "unavailable") {
      this.replaceChildren(unavailable());
    } else if (state.kind === "gated") {
      const reveal = el("button", { type: "button", class: "calmlens-button" }, [messages.reveal]);
      reveal.addEventListener("click", () =>
        this.dispatchEvent(new CustomEvent("calmlens-reveal", { bubbles: true })),
      );
      this.replaceChildren(
        ...[placeholder].filter((node) => node !== undefined),
        notice([
          el("strong", {}, [messages.sensitiveTitle]),
          el("p", {}, [messages.sensitiveBody]),
          reveal,
        ]),
      );
    } else if (state.kind === "image") {
      const image = el("img", {
        class: "calmlens-media__content",
        src: state.src,
        srcset: state.srcSet,
        sizes,
        alt,
        width: this.getAttribute("width") ?? undefined,
        height: this.getAttribute("height") ?? undefined,
        loading: this.hasAttribute("eager") ? undefined : "lazy",
        decoding: "async",
        fetchpriority: this.getAttribute("fetch-priority") ?? undefined,
      });
      image.addEventListener("load", () => {
        this.dataset.state = "loaded";
        placeholder?.remove();
      });
      image.addEventListener("error", fail);
      this.replaceChildren(...[placeholder, image].filter((node) => node !== undefined));
    } else {
      const media = el(state.kind, {
        class: "calmlens-media__content",
        src: state.src,
        poster: state.kind === "video" ? state.poster : undefined,
        controls,
        playsinline: state.kind === "video",
        preload: "metadata",
        "aria-label": alt || undefined,
      });
      media.addEventListener("error", fail);
      this.replaceChildren(media);
    }
  }
}

/** Defines `<calmlens-uploader>` and `<calmlens-media>`, if they aren't defined yet. */
export const defineCalmLensElements = (): void => {
  if (typeof customElements === "undefined") return;
  if (!customElements.get("calmlens-uploader")) {
    customElements.define("calmlens-uploader", CalmLensUploaderElement);
  }
  if (!customElements.get("calmlens-media")) {
    customElements.define("calmlens-media", CalmLensMediaElement);
  }
};

defineCalmLensElements();

declare global {
  interface HTMLElementTagNameMap {
    "calmlens-uploader": CalmLensUploaderElement;
    "calmlens-media": CalmLensMediaElement;
  }
  interface HTMLElementEventMap {
    "calmlens-uploaded": CustomEvent<CalmLensUpload>;
    "calmlens-rejected": CustomEvent<UploadItem>;
    "calmlens-failed": CustomEvent<UploadItem>;
    "calmlens-removed": CustomEvent<UploadItem>;
    "calmlens-change": CustomEvent<UploadSnapshot>;
    "calmlens-reveal": CustomEvent<undefined>;
  }
}
