import { afterEach, describe, expect, it, mock } from "bun:test";
import { waitFor, within } from "@testing-library/dom";
import type { CalmLensMediaElement } from "../src/elements";
import type { MediaProps } from "../src/ui";
import { BINDINGS, type Mounted } from "./bindings";

const PROJECT_ID = "proj_8fK2mQx7Lp4NvB3tRz9Y";
const CDN = "https://cdn.calmlens.com/v1";
const asset = { projectId: PROJECT_ID, assetId: "a1", alt: "A cat on a sofa" } as const;
const messages = {
  regionalUnavailable: "msg:regional-unavailable",
  unavailable: "msg:unavailable",
  reveal: "msg:reveal",
};

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const view = () => within(mounted?.container ?? document.body);
/**
 * The URLs of images that only decorate, such as the blurred placeholder. Strings, because
 * printing a failed comparison of DOM elements never finishes.
 */
const decorative = () =>
  [...(mounted?.container.querySelectorAll("img") ?? [])]
    .filter((img) => img.getAttribute("aria-hidden") === "true" || img.alt === "")
    .map((img) => img.getAttribute("src"));
/** Every URL the component asked the browser to load. */
const requested = () =>
  [...(mounted?.container.querySelectorAll("img, video, audio") ?? [])].flatMap((media) =>
    ["src", "srcset", "poster"].map((name) => media.getAttribute(name)).filter(Boolean),
  );

for (const binding of BINDINGS) {
  describe(`${binding.name} media`, () => {
    it("shows the image under its alt text and drops the placeholder once it loads", async () => {
      mounted = binding.mountMedia({ ...asset, aspectRatio: 1.5, messages });
      const image = await view().findByRole("img", { name: asset.alt });

      expect(image.getAttribute("src")).toBe(`${CDN}/assets/${PROJECT_ID}/a1/rendered`);
      expect(decorative()).toEqual([`${CDN}/assets/${PROJECT_ID}/a1/placeholder`]);
      await binding.settleImage(image, "load");
      await waitFor(() => expect(decorative()).toEqual([]));
    });

    it("keeps an age-restricted image behind the reveal button until the viewer may see it", async () => {
      const onReveal = mock();
      mounted = binding.mountMedia({ ...asset, status: "age-restricted", onReveal, messages });

      const reveal = await view().findByRole("button", { name: messages.reveal });
      expect(view().queryByRole("img", { name: asset.alt })).toBeNull();
      await waitFor(() =>
        expect(requested()).toEqual([`${CDN}/assets/${PROJECT_ID}/a1/placeholder`]),
      );
      reveal.click();
      expect(onReveal).toHaveBeenCalledTimes(1);
    });

    it("loads an age-restricted image with the opt-in once the viewer may see it", async () => {
      mounted = binding.mountMedia({
        ...asset,
        status: "age-restricted",
        viewerClaims: { ageConfirmed: true },
        messages,
      });

      const image = await view().findByRole("img", { name: asset.alt });
      expect(image.getAttribute("src")).toBe(
        `${CDN}/assets/${PROJECT_ID}/a1/rendered?viewerClaims=%7B%22ageConfirmed%22%3Atrue%7D`,
      );
    });

    it("requests nothing for a blocked asset and says it is unavailable", async () => {
      mounted = binding.mountMedia({ ...asset, status: "blocked", messages });

      expect(await view().findByText(messages.unavailable)).toBeTruthy();
      expect(requested()).toEqual([]);
    });

    it("uses the unavailable notice for matching regional findings without requesting media", async () => {
      mounted = binding.mountMedia({
        ...asset,
        viewerClaims: { region: "DE", ageConfirmed: true },
        messages,
        asset: {
          id: "a1",
          projectId: PROJECT_ID,
          classification: {
            moderation: {
              status: "allowed",
              policy: { decision: { regions: [{ region: "DE", action: "block" }] } },
            },
          },
        },
      });
      const notice = await view().findByText(messages.unavailable);
      expect(notice.textContent).toBe(messages.unavailable);
      expect(requested()).toEqual([]);
    });

    it("keeps the ordinary notice for a base block even with stale regional attribution", async () => {
      mounted = binding.mountMedia({
        ...asset,
        viewerClaims: { region: "DE" },
        messages,
        asset: {
          id: "a1",
          projectId: PROJECT_ID,
          classification: { moderation: { status: "blocked" } },
        },
      });
      expect((await view().findByText(messages.unavailable)).textContent).toBe(
        messages.unavailable,
      );
      expect(view().queryByText(messages.regionalUnavailable)).toBeNull();
      expect(requested()).toEqual([]);
    });

    it("keeps the ordinary notice when content removal overrides regional attribution", async () => {
      mounted = binding.mountMedia({
        ...asset,
        viewerClaims: { region: "DE" },
        contentRemoved: true,
        messages,
        asset: {
          id: "a1",
          projectId: PROJECT_ID,
          classification: {
            moderation: {
              status: "allowed",
              policy: { decision: { regions: [{ region: "DE", action: "block" }] } },
            },
          },
        },
      });
      expect((await view().findByText(messages.unavailable)).textContent).toBe(
        messages.unavailable,
      );
      expect(view().queryByText(messages.regionalUnavailable)).toBeNull();
      expect(requested()).toEqual([]);
    });

    it("says the image is unavailable when it fails to load", async () => {
      mounted = binding.mountMedia({ ...asset, messages });
      const image = await view().findByRole("img", { name: asset.alt });
      await binding.settleImage(image, "error");

      expect(await view().findByText(messages.unavailable)).toBeTruthy();
      expect(view().queryByRole("img", { name: asset.alt })).toBeNull();
    });

    it.skipIf(!binding.rendersHtmlImages)(
      "offers each width in srcset for the sizes it is shown at",
      async () => {
        mounted = binding.mountMedia({
          ...asset,
          widths: [800, 400],
          sizes: "(min-width: 768px) 50vw, 100vw",
          messages,
        });
        const image = await view().findByRole("img", { name: asset.alt });
        const base = `${CDN}/assets/${PROJECT_ID}/a1/rendered`;

        expect(image.getAttribute("srcset")).toBe(`${base}/width=400 400w, ${base}/width=800 800w`);
        expect(image.getAttribute("sizes")).toBe("(min-width: 768px) 50vw, 100vw");
      },
    );

    it.skipIf(!binding.playsMedia)(
      "plays a video's original file with no poster, as the CDN renders no still for video",
      async () => {
        mounted = binding.mountMedia({ ...asset, type: "video", messages });
        const video = await view().findByLabelText(asset.alt);

        expect(video.getAttribute("src")).toBe(`${CDN}/assets/${PROJECT_ID}/a1/original`);
        expect(video.getAttribute("poster")).toBeNull();
      },
    );

    it("shows an API asset with its own status and preview", async () => {
      mounted = binding.mountMedia({
        asset: {
          id: "a1",
          projectId: PROJECT_ID,
          type: "image",
          classification: { moderation: { status: "age-restricted" } },
          content: {
            image: { thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI", width: 800, height: 600 },
          },
        },
        viewerClaims: { ageConfirmed: true },
        alt: asset.alt,
        messages,
      });
      const image = await view().findByRole("img", { name: asset.alt });

      expect(image.getAttribute("src")).toBe(
        `${CDN}/assets/${PROJECT_ID}/a1/rendered?viewerClaims=%7B%22ageConfirmed%22%3Atrue%7D`,
      );
      if (binding.rendersHtmlImages) expect(image.getAttribute("width")).toBe("800");
      expect(decorative()).toHaveLength(1);
      expect(decorative()[0]).toStartWith("data:image/png;base64,");
    });

    it.skipIf(!binding.checksPreloadedImages)(
      "shows an image that finished loading before the component could listen for it",
      async () => {
        const prototype = HTMLImageElement.prototype;
        const complete = Object.getOwnPropertyDescriptor(prototype, "complete");
        const naturalWidth = Object.getOwnPropertyDescriptor(prototype, "naturalWidth");
        Object.defineProperty(prototype, "complete", { configurable: true, get: () => true });
        Object.defineProperty(prototype, "naturalWidth", { configurable: true, get: () => 640 });
        try {
          mounted = binding.mountMedia({ ...asset, messages } satisfies MediaProps);
          await view().findByRole("img", { name: asset.alt });
          await waitFor(() => expect(decorative()).toEqual([]));
        } finally {
          if (complete) Object.defineProperty(prototype, "complete", complete);
          else delete (prototype as { complete?: boolean }).complete;
          if (naturalWidth) Object.defineProperty(prototype, "naturalWidth", naturalWidth);
          else delete (prototype as { naturalWidth?: number }).naturalWidth;
        }
      },
    );
  });
}

it("updates the web component when an allowed asset becomes blocked", async () => {
  const element = document.createElement("calmlens-media") as CalmLensMediaElement;
  const apiAsset = {
    id: "a1",
    projectId: PROJECT_ID,
    classification: { moderation: { status: "allowed" as const } },
  };
  element.messages = messages;
  element.setAttribute("alt", asset.alt);
  element.setAttribute("viewer-claims", JSON.stringify({ region: "DE" }));
  element.asset = apiAsset;
  const container = document.createElement("div");
  container.append(element);
  document.body.append(container);
  mounted = { container, unmount: () => container.remove() };
  expect((await view().findByRole("img")).getAttribute("src")).toContain("viewerClaims=");
  element.asset = {
    ...apiAsset,
    classification: { moderation: { ...apiAsset.classification.moderation, status: "blocked" } },
  };
  expect((await view().findByText(messages.unavailable)).textContent).toBe(messages.unavailable);
  expect(view().queryByText(messages.regionalUnavailable)).toBeNull();
});
