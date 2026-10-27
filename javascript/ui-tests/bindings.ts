// Mounts the uploader and the media component through each binding, so every behaviour test runs
// once per UI library against the same props.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { flushSync as flushSvelte, mount as mountSvelte, unmount as unmountSvelte } from "svelte";
import { createApp, h } from "vue";
import "../src/elements";
import * as react from "../src/react";
import * as native from "../src/react-native";
import * as svelte from "../src/svelte/index.js";
import type { MediaProps, UploaderProps } from "../src/ui";
import * as vue from "../src/vue";

export type Mounted = { container: HTMLElement; unmount: () => void };

export type Binding = {
  name: string;
  mountUploader: (props: UploaderProps) => Mounted;
  mountMedia: (props: MediaProps) => Mounted;
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

/** Sets props on a custom element: plain values as attributes, everything else as properties. */
const assign = (
  element: HTMLElement,
  props: Record<string, unknown>,
  events: Record<string, string>,
) => {
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (PROPERTIES.has(name)) (element as unknown as Record<string, unknown>)[name] = value;
    else if (name === "autoUpload") element.toggleAttribute("no-auto-upload", value === false);
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
    mountMedia: (props) => {
      const container = containerFor();
      const root = createRoot(container);
      flushSync(() => root.render(createElement(react.CalmLensMedia, props)));
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
    mountMedia: (props) => {
      const container = containerFor();
      const app = createApp({ render: () => h(vue.CalmLensMedia, props) });
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
    mountMedia: (props) => {
      const container = containerFor();
      const component = mountSvelte(svelte.CalmLensMedia, { target: container, props });
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
    mountMedia: (props) => {
      const container = containerFor();
      const element = document.createElement("calmlens-media");
      assign(element, props as unknown as Record<string, unknown>, { onReveal: "calmlens-reveal" });
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
    mountUploader: (props) => {
      const container = containerFor();
      const picked = { files: [] as File[] };
      nativePicks.set(container, picked);
      const root = createRoot(container);
      const pick = async () => picked.files.splice(0);
      flushSync(() => root.render(createElement(native.CalmLensUploader, { ...props, pick })));
      return done(container, () => root.unmount());
    },
    mountMedia: (props) => {
      const container = containerFor();
      const root = createRoot(container);
      flushSync(() => root.render(createElement(native.CalmLensMedia, props)));
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
