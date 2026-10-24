// Mounts the uploader and the media component through each binding, so every behaviour test runs
// once per UI library against the same props.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { flushSync as flushSvelte, mount as mountSvelte, unmount as unmountSvelte } from "svelte";
import { createApp, h } from "vue";
import "../src/elements";
import * as react from "../src/react";
import * as svelte from "../src/svelte/index.js";
import type { MediaProps, UploaderProps } from "../src/ui";
import * as vue from "../src/vue";

export type Mounted = { container: HTMLElement; unmount: () => void };

export type Binding = {
  name: string;
  mountUploader: (props: UploaderProps) => Mounted;
  mountMedia: (props: MediaProps) => Mounted;
  /** Whether the binding checks for an image that loaded before it was mounted. */
  checksPreloadedImages: boolean;
};

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
const PROPERTIES = new Set(["token", "upload", "checkStatus", "createClient", "messages"]);

/** Sets props on a custom element: plain values as attributes, everything else as properties. */
const assign = (
  element: HTMLElement,
  props: Record<string, unknown>,
  events: Record<string, string>,
) => {
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (PROPERTIES.has(name)) (element as unknown as Record<string, unknown>)[name] = value;
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
];
