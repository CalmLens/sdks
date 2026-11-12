// Mounts the uploader and CalmLensAsset through each binding, so every behaviour test runs
// once per UI library against the same props.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { flushSync as flushSvelte, mount as mountSvelte, unmount as unmountSvelte } from "svelte";
import { createApp, defineComponent, h } from "vue";
import "../src/elements";
import * as react from "../src/react";
import * as native from "../src/react-native";
import * as svelte from "../src/svelte/index.js";
import type { AssetProps, CalmLensProvidedOptions } from "../src/ui";
import type { UploaderProps } from "../src/ui/BrowserUpload";
import * as vue from "../src/vue";
import ProvidedUploader from "./ProvidedUploader.svelte";

export type Mounted = { container: HTMLElement; unmount: () => void };

export type Binding = {
  name: string;
  mountUploader: (props: UploaderProps) => Mounted;
  /** Mounts the uploader beneath the binding's provider, which gives it `provided`. */
  mountProvidedUploader?: (
    provided: CalmLensProvidedOptions<File>,
    props: UploaderProps,
  ) => Mounted;
  mountAsset: (props: AssetProps) => Mounted;
  /** Picks files the way the binding's users do: the file input, or the app's picker. */
  pick: (mounted: Mounted, files: File[]) => void;
  /** Finishes loading an image the component shows, successfully or not. */
  settleImage: (image: HTMLElement, outcome: "load" | "error") => Promise<void>;
  /** Whether the binding checks for an image that loaded before it was mounted. */
  checksPreloadedImages: boolean;
  /** Whether files can be dropped on the uploader. */
  acceptsDrops: boolean;
  /** Whether images get `srcset`, `sizes` and their intrinsic size, as HTML images do. */
  rendersHtmlImages: boolean;
  /** Whether video and audio play in the component's own player. */
  playsMedia: boolean;
  /** Whether documents, text and spreadsheets show in the page through their viewers. */
  showsViewers: boolean;
};

/** Picks files with the uploader's file input, as the browser's picker does. */
const pickWithInput = ({ container }: Mounted, files: File[]) => {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("The uploader has no file input");
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

const settleHtmlImage = async (image: HTMLElement, outcome: "load" | "error") => {
  image.dispatchEvent(new Event(outcome));
};

const HTML = {
  pick: pickWithInput,
  settleImage: settleHtmlImage,
  acceptsDrops: true,
  rendersHtmlImages: true,
  playsMedia: true,
  showsViewers: true,
};

/**
 * The images react-native-web loads, which it does with its own `Image` objects rather than the
 * `<img>` it renders, so a test settles them here.
 */
const nativeImageLoads: HTMLImageElement[] = [];
const BrowserImage = window.Image;
window.Image = class extends BrowserImage {
  constructor(width?: number, height?: number) {
    super(width, height);
    nativeImageLoads.push(this);
  }
} as typeof Image;

/** The files the next press of a React Native uploader's pick button returns, by container. */
const nativePicks = new WeakMap<HTMLElement, { files: File[] }>();

const containerFor = () => document.body.appendChild(document.createElement("div"));
const done = (container: HTMLElement, unmount: () => void): Mounted => ({
  container,
  unmount: () => {
    unmount();
    container.remove();
  },
});

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** The elements' options that are properties rather than attributes. */
const PROPERTIES = new Set([
  "token",
  "upload",
  "checkStatus",
  "createClient",
  "messages",
  "controller",
]);

/** Sets `CalmLensAsset`'s props on `<calmlens-asset>`, as attributes, properties and listeners. */
const assignAsset = (element: HTMLElement, props: AssetProps) => {
  const { image, video, document: documentOptions, spreadsheet, ...rest } = props;
  const record = element as unknown as Record<string, unknown>;
  const events: Record<string, string> = {
    onLoad: "calmlens-load",
    onError: "calmlens-error",
    onAvailabilityChange: "calmlens-availability-change",
    onAgeConfirmRequest: "calmlens-age-confirm-request",
    onPlay: "calmlens-play",
    onEnded: "calmlens-ended",
    onTimeUpdate: "calmlens-timeupdate",
  };
  for (const [name, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    if (name in events) {
      element.addEventListener(events[name] as string, (event) =>
        (value as (detail: unknown) => void)((event as CustomEvent).detail),
      );
    } else if (["info", "onExpired", "messages"].includes(name)) record[name] = value;
    else if (name === "viewerClaims") element.setAttribute("viewer-claims", JSON.stringify(value));
    else if (name === "lazy") element.toggleAttribute("eager", value === false);
    else element.setAttribute(kebab(name), String(value));
  }
  if (image?.lens) element.setAttribute("lens", image.lens);
  if (typeof image?.transform === "string") element.setAttribute("transform", image.transform);
  if (image?.widths) element.setAttribute("widths", image.widths.join(","));
  if (image?.sizes) element.setAttribute("sizes", image.sizes);
  if (video?.controls === false) element.setAttribute("no-controls", "");
  if (video?.stream === false) element.setAttribute("no-stream", "");
  if (video?.autoPlay) element.setAttribute("autoplay", "");
  if (video?.muted) element.setAttribute("muted", "");
  if (video?.loop) element.setAttribute("loop", "");
  if (documentOptions?.initialPage) {
    element.setAttribute("initial-page", String(documentOptions.initialPage));
  }
  if (documentOptions?.pdf) record.pdf = documentOptions.pdf;
  if (spreadsheet?.pageSize) element.setAttribute("page-size", String(spreadsheet.pageSize));
  if (spreadsheet?.getText) record.getText = spreadsheet.getText;
};

/** Sets props on a custom element: plain values as attributes, everything else as properties. */
const assign = (
  element: HTMLElement,
  props: Record<string, unknown>,
  events: Record<string, string>,
) => {
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (PROPERTIES.has(name)) (element as unknown as Record<string, unknown>)[name] = value;
    else if (name === "viewerClaims") element.setAttribute("viewer-claims", JSON.stringify(value));
    else if (name === "autoUpload") element.toggleAttribute("no-auto-upload", value === false);
    else if (name === "stream") element.toggleAttribute("no-stream", value === false);
    else if (name in events) {
      element.addEventListener(events[name] as string, (event) =>
        (value as (detail: unknown) => void)((event as CustomEvent).detail),
      );
    } else if (typeof value === "boolean") element.toggleAttribute(kebab(name), value);
    else if (typeof value === "string" || typeof value === "number") {
      element.setAttribute(kebab(name), String(value));
    } else if (Array.isArray(value)) element.setAttribute(kebab(name), value.join(","));
    else (element as unknown as Record<string, unknown>)[name] = value;
  }
};

export const BINDINGS: Binding[] = [
  {
    name: "React",
    ...HTML,
    checksPreloadedImages: true,
    mountUploader: (props) => {
      const container = containerFor();
      const root = createRoot(container);
      flushSync(() => root.render(createElement(react.CalmLensUploader, props)));
      return done(container, () => root.unmount());
    },
    mountProvidedUploader: (provided, props) => {
      const container = containerFor();
      const root = createRoot(container);
      flushSync(() =>
        root.render(
          createElement(
            react.CalmLensProvider<File>,
            provided,
            createElement(react.CalmLensUploader, props),
          ),
        ),
      );
      return done(container, () => root.unmount());
    },
    mountAsset: (props) => {
      const container = containerFor();
      const root = createRoot(container);
      flushSync(() => root.render(createElement(react.CalmLensAsset, props)));
      return done(container, () => root.unmount());
    },
  },
  {
    name: "Vue",
    ...HTML,
    checksPreloadedImages: true,
    mountUploader: (props) => {
      const container = containerFor();
      const app = createApp({ render: () => h(vue.CalmLensUploader, props) });
      app.mount(container);
      return done(container, () => app.unmount());
    },
    mountProvidedUploader: (provided, props) => {
      const container = containerFor();
      const Parent = defineComponent({
        setup() {
          vue.provideCalmLens(provided);
          return () => h(vue.CalmLensUploader, props);
        },
      });
      const app = createApp(Parent);
      app.mount(container);
      return done(container, () => app.unmount());
    },
    mountAsset: (props) => {
      const container = containerFor();
      const app = createApp({ render: () => h(vue.CalmLensAsset, props) });
      app.mount(container);
      return done(container, () => app.unmount());
    },
  },
  {
    name: "Svelte",
    ...HTML,
    checksPreloadedImages: true,
    mountUploader: (props) => {
      const container = containerFor();
      const component = mountSvelte(svelte.CalmLensUploader, { target: container, props });
      flushSvelte();
      return done(container, () => void unmountSvelte(component));
    },
    mountProvidedUploader: (provided, props) => {
      const container = containerFor();
      const component = mountSvelte(ProvidedUploader, {
        target: container,
        props: { ...props, provided },
      });
      flushSvelte();
      return done(container, () => void unmountSvelte(component));
    },
    mountAsset: (props) => {
      const container = containerFor();
      const component = mountSvelte(svelte.CalmLensAsset, { target: container, props });
      flushSvelte();
      return done(container, () => void unmountSvelte(component));
    },
  },
  {
    name: "Web components",
    ...HTML,
    // The element creates its image when it renders, so it never finds one already loaded.
    checksPreloadedImages: false,
    mountUploader: (props) => {
      const container = containerFor();
      const element = document.createElement("calmlens-uploader");
      assign(element, props as unknown as Record<string, unknown>, {
        onUploaded: "calmlens-uploaded",
        onRejected: "calmlens-rejected",
        onFailed: "calmlens-failed",
        onRemoved: "calmlens-removed",
      });
      container.append(element);
      return done(container, () => element.remove());
    },
    mountAsset: (props) => {
      const container = containerFor();
      const element = document.createElement("calmlens-asset");
      assignAsset(element, props);
      container.append(element);
      return done(container, () => element.remove());
    },
  },
  {
    name: "React Native",
    checksPreloadedImages: false,
    acceptsDrops: false,
    rendersHtmlImages: false,
    playsMedia: false,
    showsViewers: false,
    mountUploader: (props) => {
      const container = containerFor();
      const picked = { files: [] as File[] };
      nativePicks.set(container, picked);
      const root = createRoot(container);
      const pick = async () => picked.files.splice(0);
      flushSync(() =>
        root.render(createElement(native.CalmLensUploader<File>, { ...props, pick })),
      );
      return done(container, () => root.unmount());
    },
    mountProvidedUploader: (provided, props) => {
      const container = containerFor();
      const picked = { files: [] as File[] };
      nativePicks.set(container, picked);
      const root = createRoot(container);
      const pick = async () => picked.files.splice(0);
      flushSync(() =>
        root.render(
          createElement(
            native.CalmLensProvider<File>,
            provided,
            createElement(native.CalmLensUploader<File>, { ...props, pick }),
          ),
        ),
      );
      return done(container, () => root.unmount());
    },
    mountAsset: (props) => {
      const container = containerFor();
      const root = createRoot(container);
      flushSync(() => root.render(createElement(native.CalmLensAsset, props)));
      return done(container, () => root.unmount());
    },
    pick: ({ container }, files) => {
      const picked = nativePicks.get(container);
      const button = container.querySelector<HTMLElement>(
        `[data-testid="${native.CHOOSE_TEST_ID}"]`,
      );
      if (!picked || !button) throw new Error("The uploader has no pick button");
      picked.files = files;
      button.click();
    },
    settleImage: async (image, outcome) => {
      const src = image.getAttribute("src");
      const load = [...nativeImageLoads].reverse().find((candidate) => candidate.src === src);
      if (!load) throw new Error(`Nothing is loading ${src}`);
      (outcome === "load" ? load.onload : load.onerror)?.call(load, new Event(outcome));
    },
  },
];
