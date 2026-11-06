import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createSSRApp, h } from "vue";
import { renderToString as renderVue } from "vue/server-renderer";
import * as react from "../src/react";
import type { ViewerAsset } from "../src/ui";
import * as vue from "../src/vue";

// Server rendering: with the info passed, the first HTML holds the real element and requests
// nothing; without it, a sized box.

const SRC = "https://cdn.calmlens.com/v1/assets/proj_8fK2mQx7Lp4NvB3tRz9Y/sig_grant";
const preview = { width: 600, height: 800, thumbhash: null, averageColor: null };
const info = (type: string, content: NonNullable<ViewerAsset["content"]>): ViewerAsset => ({
  id: "asset-1",
  projectId: "proj_8fK2mQx7Lp4NvB3tRz9Y",
  type,
  externalUrl: null,
  availability: "available",
  content: { format: null, hls: null, preview: null, rendered: null, ...content },
});
const IMAGE = info("image", { rendered: { kind: "image", width: 4, height: 3 }, preview });
const DOCUMENT = info("multimedia-document", { rendered: { kind: "pdf" }, preview });

let requests = 0;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return new Response("{}");
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Parses server HTML into a detached document, to query it as a browser would. */
const parse = (html: string) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

const renderers = [
  {
    name: "React",
    render: async (props: object) =>
      renderToString(createElement(react.CalmLensAsset, { ...props, unstyled: true })),
  },
  {
    name: "Vue",
    render: (props: object) =>
      renderVue(createSSRApp({ render: () => h(vue.CalmLensAsset, props) })),
  },
];

for (const { name, render } of renderers) {
  describe(`${name} server rendering`, () => {
    it("renders the image itself when the info is passed, requesting nothing", async () => {
      const root = parse(await render({ src: SRC, info: IMAGE, alt: "A cat" }));

      expect(root.querySelector('img[alt="A cat"]')?.getAttribute("src")).toBe(`${SRC}/rendered`);
      expect(requests).toBe(0);
    });

    it("renders a document's first page and a link that opens it until the viewer loads", async () => {
      const root = parse(
        await render({
          src: SRC,
          info: DOCUMENT,
          alt: "Report",
          messages: { openDocument: "Open" },
        }),
      );

      expect(root.querySelector('img[alt="Report"]')?.getAttribute("src")).toBe(`${SRC}/preview`);
      expect(root.querySelector("a")?.getAttribute("href")).toBe(`${SRC}/rendered`);
    });

    it("reads no info on the server when it isn't passed", async () => {
      const root = parse(await render({ src: SRC, alt: "A cat" }));

      expect(root.querySelector("img[alt]")).toBeNull();
      expect(requests).toBe(0);
    });
  });
}
