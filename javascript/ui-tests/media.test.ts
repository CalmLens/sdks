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
  openPdf: "msg:open-pdf",
  pdfTitle: "msg:pdf-title",
  play: "msg:play",
};
const url = (resource: string, assetId = "a1") =>
  `${CDN}/assets/${PROJECT_ID}/${assetId}/${resource}`;
/** An API asset whose rendered resource serves `kind`, with or without a preview still. */
const apiAsset = (
  kind: "image" | "video" | "audio" | "pdf" | null,
  { preview = true, peaks }: { preview?: boolean; peaks?: number[] } = {},
) => ({
  id: "a1",
  projectId: PROJECT_ID,
  type: kind === "pdf" ? "multimedia-document" : (kind ?? "plaintext-document"),
  classification: { moderation: { status: "allowed" as const } },
  content: {
    status: "stored",
    rendered: kind
      ? { kind, width: kind === "audio" ? null : 640, height: kind === "audio" ? null : 360, peaks }
      : null,
    preview: preview ? { width: 640, height: 360, thumbhash: null, averageColor: "#223344" } : null,
  },
});
/** A `getSignedUrl` that signs each resource with a counter, so each fetch has its own URL. */
const signer = () => {
  let count = 0;
  return mock(async (resource: string) => `https://signed.example/${resource}?n=${++count}`);
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
            moderation: { status: "allowed", regions: [{ region: "DE", status: "blocked" }] },
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
            moderation: { status: "allowed", regions: [{ region: "DE", status: "blocked" }] },
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
      "plays a video's rendered file with its preview still as the poster",
      async () => {
        mounted = binding.mountMedia({ asset: apiAsset("video"), alt: asset.alt, messages });
        const video = await view().findByLabelText(asset.alt);

        expect(video.tagName).toBe("VIDEO");
        expect(video.getAttribute("src")).toBe(url("rendered"));
        expect(video.getAttribute("poster")).toBe(url("preview"));
      },
    );

    it.skipIf(!binding.playsMedia)("requests no poster for a video without a preview", async () => {
      mounted = binding.mountMedia({
        asset: apiAsset("video", { preview: false }),
        alt: asset.alt,
        messages,
      });
      const video = await view().findByLabelText(asset.alt);

      expect(video.getAttribute("src")).toBe(url("rendered"));
      expect(video.getAttribute("poster")).toBeNull();
    });

    it.skipIf(!binding.playsMedia)(
      "plays audio with native controls under its waveform, and highlights the played peaks",
      async () => {
        mounted = binding.mountMedia({
          asset: apiAsset("audio", { peaks: [0.2, 0.9, 0.5, 0.1] }),
          alt: asset.alt,
          messages,
        });
        const audio = (await view().findByLabelText(asset.alt)) as HTMLAudioElement;

        expect(audio.tagName).toBe("AUDIO");
        expect(audio.hasAttribute("controls")).toBe(true);
        expect(audio.getAttribute("src")).toBe(url("rendered"));
        expect(decorative()).toEqual([url("preview")]);
        const progress = view().getByRole("progressbar", { hidden: true });
        expect(progress.getAttribute("aria-hidden")).toBe("true");
        expect(progress.getAttribute("aria-valuenow")).toBe("0");

        Object.defineProperty(audio, "duration", { configurable: true, value: 40 });
        audio.currentTime = 10;
        audio.dispatchEvent(new Event("timeupdate"));
        await waitFor(() => expect(progress.getAttribute("aria-valuenow")).toBe("25"));
      },
    );

    it.skipIf(!binding.playsMedia)("draws no progress for audio without peaks", async () => {
      mounted = binding.mountMedia({ asset: apiAsset("audio"), alt: asset.alt, messages });
      await view().findByLabelText(asset.alt);

      expect(decorative()).toEqual([url("preview")]);
      expect(view().queryByRole("progressbar", { hidden: true })).toBeNull();
    });

    it.skipIf(!binding.playsMedia)(
      "shows a PDF in the page with a link that opens it in a new tab",
      async () => {
        mounted = binding.mountMedia({ asset: apiAsset("pdf"), messages });
        const frame = await view().findByTitle(messages.pdfTitle);
        const link = view().getByRole("link", { name: messages.openPdf });

        expect(frame.tagName).toBe("IFRAME");
        expect(frame.getAttribute("src")).toBe(url("rendered"));
        expect(link.getAttribute("href")).toBe(url("rendered"));
        expect(link.getAttribute("target")).toBe("_blank");
      },
    );

    it("shows the preview still of an asset with no rendered file", async () => {
      mounted = binding.mountMedia({ asset: apiAsset(null), alt: asset.alt, messages });
      const image = await view().findByRole("img", { name: asset.alt });

      expect(image.getAttribute("src")).toBe(url("preview"));
    });

    it("shows a file icon, requesting nothing, for an asset with no rendered file or preview", async () => {
      mounted = binding.mountMedia({
        asset: apiAsset(null, { preview: false }),
        alt: asset.alt,
        messages,
      });

      await view().findByRole("img", { name: asset.alt });
      expect(requested()).toEqual([]);
    });

    it.skipIf(!binding.playsMedia)(
      "fetches a signed URL for each resource a private video shows",
      async () => {
        const getSignedUrl = signer();
        mounted = binding.mountMedia({
          asset: apiAsset("video"),
          getSignedUrl,
          alt: asset.alt,
          messages,
        });
        const video = await view().findByLabelText(asset.alt);

        expect(getSignedUrl.mock.calls.map(([resource]) => resource).sort()).toEqual([
          "preview",
          "rendered",
        ]);
        expect(video.getAttribute("src")).toMatch(/^https:\/\/signed\.example\/rendered\?n=\d$/);
        expect(video.getAttribute("poster")).toMatch(/^https:\/\/signed\.example\/preview\?n=\d$/);
        expect(requested().filter((src) => src?.startsWith(CDN))).toEqual([]);
      },
    );

    it("fetches a signed URL for a private image and shows it", async () => {
      const getSignedUrl = signer();
      mounted = binding.mountMedia({ ...asset, getSignedUrl, messages });
      const image = await view().findByRole("img", { name: asset.alt });

      expect(getSignedUrl.mock.calls).toEqual([["rendered"]]);
      expect(image.getAttribute("src")).toBe("https://signed.example/rendered?n=1");
    });

    it("asks for no signed URL while an asset is behind the age notice", async () => {
      const getSignedUrl = signer();
      mounted = binding.mountMedia({
        ...asset,
        status: "age-restricted",
        onReveal: () => {},
        getSignedUrl,
        messages,
      });

      await view().findByRole("button", { name: messages.reveal });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it("says the media is unavailable when its signed URL can't be fetched", async () => {
      const getSignedUrl = mock(async () => {
        throw new Error("offline");
      });
      mounted = binding.mountMedia({ ...asset, getSignedUrl, messages });

      expect(await view().findByText(messages.unavailable)).toBeTruthy();
      expect(view().queryByRole("img", { name: asset.alt })).toBeNull();
    });

    it.skipIf(!binding.playsMedia)(
      "fetches a fresh signed URL when a video's expires mid-playback, and resumes where it stopped",
      async () => {
        const play = mock(async () => {});
        const originalPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = play;
        try {
          const getSignedUrl = signer();
          mounted = binding.mountMedia({
            asset: apiAsset("video", { preview: false }),
            getSignedUrl,
            alt: asset.alt,
            messages,
          });
          const first = (await view().findByLabelText(asset.alt)) as HTMLVideoElement;
          expect(first.getAttribute("src")).toBe("https://signed.example/rendered?n=1");
          first.currentTime = 42;
          Object.defineProperty(first, "paused", { configurable: true, value: false });
          first.dispatchEvent(new Event("error"));

          await waitFor(() =>
            expect(view().getByLabelText(asset.alt).getAttribute("src")).toBe(
              "https://signed.example/rendered?n=2",
            ),
          );
          expect(getSignedUrl.mock.calls).toEqual([["rendered"], ["rendered"]]);
          const fresh = view().getByLabelText(asset.alt) as HTMLVideoElement;
          fresh.currentTime = 0;
          fresh.dispatchEvent(new Event("loadedmetadata"));
          expect(fresh.currentTime).toBe(42);
          expect(play).toHaveBeenCalledTimes(1);
        } finally {
          HTMLMediaElement.prototype.play = originalPlay;
        }
      },
    );

    it.skipIf(!binding.playsMedia)(
      "says the audio is unavailable when its fresh signed URL fails before loading too",
      async () => {
        const getSignedUrl = signer();
        mounted = binding.mountMedia({
          asset: apiAsset("audio", { preview: false }),
          getSignedUrl,
          alt: asset.alt,
          messages,
        });
        (await view().findByLabelText(asset.alt)).dispatchEvent(new Event("error"));
        await waitFor(() =>
          expect(view().getByLabelText(asset.alt).getAttribute("src")).toBe(
            "https://signed.example/rendered?n=2",
          ),
        );
        view().getByLabelText(asset.alt).dispatchEvent(new Event("error"));

        expect(await view().findByText(messages.unavailable)).toBeTruthy();
        expect(getSignedUrl).toHaveBeenCalledTimes(2);
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
            rendered: { kind: "image", width: 800, height: 600 },
            preview: { thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI", width: 400, height: 300 },
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
