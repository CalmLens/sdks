import { afterEach, describe, expect, it, mock } from "bun:test";
import { waitFor, within } from "@testing-library/dom";
import type { MediaProps } from "../src/ui";
import { BINDINGS, type Mounted } from "./bindings";

const PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";
const CDN = "https://cdn.calmlens.com/v1";
const asset = { projectId: PROJECT_ID, assetId: "a1", alt: "A cat on a sofa" } as const;
const messages = { unavailable: "msg:unavailable", reveal: "msg:reveal" };

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
      image.dispatchEvent(new Event("load"));
      await waitFor(() => expect(decorative()).toEqual([]));
    });

    it("keeps an age-restricted image behind the reveal button until the viewer may see it", async () => {
      const onReveal = mock();
      mounted = binding.mountMedia({ ...asset, status: "age-restricted", onReveal, messages });

      const reveal = await view().findByRole("button", { name: messages.reveal });
      expect(view().queryByRole("img", { name: asset.alt })).toBeNull();
      expect(requested()).toEqual([`${CDN}/assets/${PROJECT_ID}/a1/placeholder`]);
      reveal.click();
      expect(onReveal).toHaveBeenCalledTimes(1);
    });

    it("loads an age-restricted image with the opt-in once the viewer may see it", async () => {
      mounted = binding.mountMedia({ ...asset, status: "age-restricted", canView: true, messages });

      const image = await view().findByRole("img", { name: asset.alt });
      expect(image.getAttribute("src")).toBe(
        `${CDN}/assets/${PROJECT_ID}/a1/rendered?allowAgeRestricted=true`,
      );
    });

    it("requests nothing for a blocked asset and says it is unavailable", async () => {
      mounted = binding.mountMedia({ ...asset, status: "blocked", messages });

      expect(await view().findByText(messages.unavailable)).toBeTruthy();
      expect(requested()).toEqual([]);
    });

    it("says the image is unavailable when it fails to load", async () => {
      mounted = binding.mountMedia({ ...asset, messages });
      const image = await view().findByRole("img", { name: asset.alt });
      image.dispatchEvent(new Event("error"));

      expect(await view().findByText(messages.unavailable)).toBeTruthy();
      expect(view().queryByRole("img", { name: asset.alt })).toBeNull();
    });

    it("offers each width in srcset for the sizes it is shown at", async () => {
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
    });

    it("plays a video's original file with its rendered image as the poster", async () => {
      mounted = binding.mountMedia({ ...asset, type: "video", messages });
      const video = await view().findByLabelText(asset.alt);

      expect(video.getAttribute("src")).toBe(`${CDN}/assets/${PROJECT_ID}/a1/original`);
      expect(video.getAttribute("poster")).toBe(`${CDN}/assets/${PROJECT_ID}/a1/rendered`);
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
