// Mounts the asset viewers through each binding, so every viewer test runs once per UI library
// against the same props.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { flushSync as flushSvelte, mount as mountSvelte, unmount as unmountSvelte } from "svelte";
import { createApp, h } from "vue";
import "../src/elements";
import * as react from "../src/react";
import * as svelte from "../src/svelte/index.js";
import type { AssetViewerName, AssetViewerOptionsByKind } from "../src/ui";
import * as vue from "../src/vue";

const REACT = {
  image: react.CalmLensImageViewer,
  website: react.CalmLensWebsiteViewer,
  text: react.CalmLensTextViewer,
  document: react.CalmLensDocumentViewer,
  spreadsheet: react.CalmLensSpreadsheetViewer,
};
const VUE = {
  image: vue.CalmLensImageViewer,
  website: vue.CalmLensWebsiteViewer,
  text: vue.CalmLensTextViewer,
  document: vue.CalmLensDocumentViewer,
  spreadsheet: vue.CalmLensSpreadsheetViewer,
};
const SVELTE = {
  image: svelte.CalmLensImageViewer,
  website: svelte.CalmLensWebsiteViewer,
  text: svelte.CalmLensTextViewer,
  document: svelte.CalmLensDocumentViewer,
  spreadsheet: svelte.CalmLensSpreadsheetViewer,
};

export type MountedViewer = { container: HTMLElement; unmount: () => void };

export type ViewerBinding = {
  name: string;
  /** Mounts a viewer; `src` defaults to the public asset URL of the asset's ID and project. */
  mount: <K extends AssetViewerName>(
    kind: K,
    props: Omit<AssetViewerOptionsByKind[K], "src"> & { src?: string },
  ) => MountedViewer;
};

const TAGS = {
  image: "calmlens-image-viewer",
  website: "calmlens-website-viewer",
  text: "calmlens-text-viewer",
  document: "calmlens-document-viewer",
  spreadsheet: "calmlens-spreadsheet-viewer",
} as const;

/** The elements' options that are attributes rather than properties. */
const ATTRIBUTES: Record<string, string> = {
  label: "label",
  src: "src",
  sizes: "sizes",
  pageSize: "page-size",
  initialPage: "initial-page",
};

const withSrc = (props: { src?: string; asset: { id: string; projectId?: string } }) => ({
  ...props,
  src: props.src ?? `https://cdn.calmlens.com/v1/assets/${props.asset.projectId}/${props.asset.id}`,
});

const containerFor = () => document.body.appendChild(document.createElement("div"));
const done = (container: HTMLElement, unmount: () => void): MountedViewer => ({
  container,
  unmount: () => {
    unmount();
    container.remove();
  },
});

const BINDINGS: ViewerBinding[] = [
  {
    name: "React",
    mount: (kind, props) => {
      const container = containerFor();
      const root = createRoot(container);
      const component = REACT[kind] as (props: object) => unknown;
      flushSync(() => root.render(createElement(component as never, props)));
      return done(container, () => root.unmount());
    },
  },
  {
    name: "Vue",
    mount: (kind, props) => {
      const container = containerFor();
      const app = createApp({ render: () => h(VUE[kind] as never, props) });
      app.mount(container);
      return done(container, () => app.unmount());
    },
  },
  {
    name: "Svelte",
    mount: (kind, props) => {
      const container = containerFor();
      const component = mountSvelte(SVELTE[kind] as never, {
        target: container,
        props: props as never,
      });
      flushSvelte();
      return done(container, () => void unmountSvelte(component));
    },
  },
  {
    name: "Web components",
    mount: (kind, props) => {
      const container = containerFor();
      const element = document.createElement(TAGS[kind]);
      for (const [name, value] of Object.entries(props)) {
        if (value === undefined) continue;
        const attribute = ATTRIBUTES[name];
        if (attribute) element.setAttribute(attribute, String(value));
        else if (name === "viewerClaims")
          element.setAttribute("viewer-claims", JSON.stringify(value));
        else (element as unknown as Record<string, unknown>)[name] = value;
      }
      container.append(element);
      return done(container, () => element.remove());
    },
  },
];

/** Every binding, each given the default `src` its tests leave out. */
export const VIEWER_BINDINGS: ViewerBinding[] = BINDINGS.map((binding) => ({
  ...binding,
  mount: (kind, props) => binding.mount(kind, withSrc(props) as never),
}));
