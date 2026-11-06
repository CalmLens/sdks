import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { waitFor, within } from "@testing-library/dom";
import type { ViewerAsset } from "../src/ui";
import { BINDINGS, type Mounted } from "./bindings";

// CalmLensAsset in every binding: what it shows for each kind of asset from its asset URL and
// display info, when it reads `/info`, and how it follows the CDN when content stops loading.

const PROJECT_ID = "proj_8fK2mQx7Lp4NvB3tRz9Y";
const CDN = "https://cdn.calmlens.com/v1";
const SRC = `${CDN}/assets/${PROJECT_ID}/sig_grant`;
const FRESH = `${CDN}/assets/${PROJECT_ID}/sig_fresh`;
const ALT = "A cat on a sofa";
const messages = {
  unavailable: "msg:unavailable",
  reveal: "msg:reveal",
  sensitiveTitle: "msg:sensitive",
  openDocument: "msg:open-document",
  openWebsite: "msg:open {host}",
  play: "msg:play",
  open: "msg:open",
};

const preview = { width: 640, height: 360, thumbhash: null, averageColor: "#223344" };
const info = (
  type: string,
  content: NonNullable<ViewerAsset["content"]>,
  extra: Partial<ViewerAsset> = {},
): ViewerAsset => ({
  id: "asset-1",
  projectId: PROJECT_ID,
  type,
  externalUrl: null,
  availability: "available",
  content: { format: null, hls: null, preview: null, rendered: null, ...content },
  ...extra,
});
const IMAGE = info("image", {
  format: "image/png",
  rendered: { kind: "image", width: 640, height: 360 },
  preview,
});
const VIDEO = info("video", { rendered: { kind: "video", width: 640, height: 360 }, preview });
const AUDIO = info("audio", { rendered: { kind: "audio", peaks: [0.2, 0.8] }, preview });

/** Answers the component's requests: `/info` with `infoFor(url)`, anything else with text. */
let requests: string[] = [];
let infoFor: (url: string) => Response = () => Response.json(IMAGE);
let textFor: (url: string) => Response = () => new Response("hello <b>world</b>");
const originalFetch = globalThis.fetch;
beforeEach(() => {
  requests = [];
  infoFor = () => Response.json(IMAGE);
  textFor = () => new Response("hello <b>world</b>");
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    return new URL(url).pathname.endsWith("/info") ? infoFor(url) : textFor(url);
  }) as typeof fetch;
});

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.fetch = originalFetch;
});
const view = () => within(mounted?.container ?? document.body);
const infoRequests = () => requests.filter((url) => new URL(url).pathname.endsWith("/info"));
const settled = () => new Promise((resolve) => setTimeout(resolve, 30));

/**
 * Where a link goes: its `href`, or, for React Native's links, which open with `Linking.openURL`
 * (react-native-web's `window.open`), the page pressing it opens.
 */
const linkTarget = async (link: HTMLElement): Promise<string | null> => {
  if (link.hasAttribute("href")) return link.getAttribute("href");
  const opened: string[] = [];
  const original = window.open;
  window.open = ((target?: string | URL) => {
    opened.push(String(target));
    return null;
  }) as typeof window.open;
  try {
    link.click();
    await waitFor(() => expect(opened).toHaveLength(1));
    return opened[0] ?? null;
  } finally {
    window.open = original;
  }
};

for (const binding of BINDINGS) {
  describe(`${binding.name} CalmLensAsset`, () => {
    it("requests nothing before it has a src", async () => {
      mounted = binding.mountAsset({ alt: ALT, messages });
      await settled();

      expect(requests).toEqual([]);
      expect(view().queryByRole("img", { name: ALT })).toBeNull();
    });

    it("reads the info when it isn't passed, then shows the image beneath the asset URL", async () => {
      mounted = binding.mountAsset({ src: SRC, alt: ALT, messages });
      const image = await view().findByRole("img", { name: ALT });

      expect(image.getAttribute("src")).toBe(`${SRC}/rendered`);
      expect(infoRequests()).toEqual([`${SRC}/info`]);
    });

    it("renders from the passed info without reading it", async () => {
      mounted = binding.mountAsset({ src: SRC, info: IMAGE, alt: ALT, messages });
      const image = await view().findByRole("img", { name: ALT });
      await settled();

      expect(image.getAttribute("src")).toBe(`${SRC}/rendered`);
      expect(infoRequests()).toEqual([]);
    });

    it("sends the viewer claims with the info and every resource", async () => {
      const claims = encodeURIComponent(JSON.stringify({ region: "GB", ageConfirmed: true }));
      mounted = binding.mountAsset({
        src: SRC,
        viewerClaims: { region: "GB", ageConfirmed: true },
        alt: ALT,
        messages,
      });
      const image = await view().findByRole("img", { name: ALT });

      expect(infoRequests()).toEqual([`${SRC}/info?viewerClaims=${claims}`]);
      expect(image.getAttribute("src")).toBe(`${SRC}/rendered?viewerClaims=${claims}`);
    });

    it("shows the unavailable notice for content the viewer can't see", async () => {
      infoFor = () => Response.json({ ...IMAGE, availability: "unavailable" });
      mounted = binding.mountAsset({ src: SRC, alt: ALT, messages });

      expect((await view().findByText(messages.unavailable)).textContent).toBe(
        messages.unavailable,
      );
      expect(view().queryByRole("img", { name: ALT })).toBeNull();
    });

    it("keeps age-restricted content behind the notice, revealing on request", async () => {
      const onAgeConfirmRequest = mock(() => {});
      mounted = binding.mountAsset({
        src: SRC,
        info: { ...IMAGE, availability: "age-restricted" },
        alt: ALT,
        messages,
        onAgeConfirmRequest,
      });
      await view().findByText(messages.sensitiveTitle);
      expect(view().queryByRole("img", { name: ALT })).toBeNull();

      (await view().findByRole("button", { name: messages.reveal })).click();
      expect(onAgeConfirmRequest).toHaveBeenCalledTimes(1);
    });

    it("shows the notice when the CDN refuses content the info said was available", async () => {
      infoFor = () => Response.json({ ...IMAGE, availability: "unavailable" });
      mounted = binding.mountAsset({ src: SRC, info: IMAGE, alt: ALT, messages });
      await binding.settleImage(await view().findByRole("img", { name: ALT }), "error");

      expect((await view().findByText(messages.unavailable)).textContent).toBe(
        messages.unavailable,
      );
      expect(infoRequests()).toEqual([`${SRC}/info`]);
    });

    it("loads beneath a fresh asset URL from onExpired when the image fails", async () => {
      const onExpired = mock(async () => FRESH);
      mounted = binding.mountAsset({ src: SRC, info: IMAGE, alt: ALT, messages, onExpired });
      await binding.settleImage(await view().findByRole("img", { name: ALT }), "error");

      await waitFor(() =>
        expect(view().getByRole("img", { name: ALT }).getAttribute("src")).toBe(
          `${FRESH}/rendered`,
        ),
      );
      expect(onExpired).toHaveBeenCalledTimes(1);
    });

    it("refreshes an expired asset URL whose info the CDN refuses", async () => {
      infoFor = (url) =>
        url.startsWith(SRC)
          ? Response.json({ code: "signed-url/expired" }, { status: 403 })
          : Response.json(IMAGE);
      const onExpired = mock(async () => FRESH);
      mounted = binding.mountAsset({ src: SRC, alt: ALT, messages, onExpired });
      const image = await view().findByRole("img", { name: ALT });

      expect(image.getAttribute("src")).toBe(`${FRESH}/rendered`);
      expect(onExpired).toHaveBeenCalledTimes(1);
    });

    it("shows the preview still with display=preview", async () => {
      mounted = binding.mountAsset({
        src: SRC,
        info: VIDEO,
        display: "preview",
        image: { lens: "card" },
        alt: ALT,
        messages,
      });
      const still = await view().findByRole("img", { name: ALT });

      expect(still.getAttribute("src")).toBe(`${SRC}/preview/@card`);
    });

    it("shows a file icon for an asset with nothing to show", async () => {
      mounted = binding.mountAsset({
        src: SRC,
        info: info("multimedia-document", {}),
        display: "preview",
        alt: ALT,
        messages,
      });

      expect((await view().findByRole("img", { name: ALT })).getAttribute("src")).toBeNull();
    });

    it.skipIf(!binding.playsMedia)(
      "plays video from the rendered file with its poster",
      async () => {
        mounted = binding.mountAsset({ src: SRC, info: VIDEO, alt: ALT, messages });
        const video = await view().findByLabelText(ALT);

        expect(video.tagName).toBe("VIDEO");
        expect(video.getAttribute("src")).toBe(`${SRC}/rendered`);
        expect(video.getAttribute("poster")).toBe(`${SRC}/preview`);
        expect(video.hasAttribute("controls")).toBe(true);
      },
    );

    it.skipIf(!binding.playsMedia)("plays audio from the rendered file", async () => {
      mounted = binding.mountAsset({ src: SRC, info: AUDIO, alt: ALT, messages });
      const audio = await view().findByLabelText(ALT);

      expect(audio.tagName).toBe("AUDIO");
      expect(audio.getAttribute("src")).toBe(`${SRC}/rendered`);
    });

    it.skipIf(!binding.playsMedia)(
      "resumes a video beneath a fresh asset URL at its place after its URL expires",
      async () => {
        const onExpired = mock(async () => FRESH);
        mounted = binding.mountAsset({ src: SRC, info: VIDEO, alt: ALT, messages, onExpired });
        const video = (await view().findByLabelText(ALT)) as HTMLMediaElement;
        video.currentTime = 12;
        video.dispatchEvent(new Event("error"));

        await waitFor(() =>
          expect(view().getByLabelText(ALT).getAttribute("src")).toBe(`${FRESH}/rendered`),
        );
        const fresh = view().getByLabelText(ALT) as HTMLMediaElement;
        fresh.currentTime = 0;
        fresh.dispatchEvent(new Event("loadedmetadata"));
        expect(fresh.currentTime).toBe(12);
      },
    );

    it.skipIf(binding.playsMedia)(
      "offers to open video it has no player for, from its poster",
      async () => {
        mounted = binding.mountAsset({ src: SRC, info: VIDEO, alt: ALT, messages });

        const link = await view().findByRole("link", { name: messages.play });
        expect((await view().findByRole("img", { name: ALT })).getAttribute("src")).toBe(
          `${SRC}/preview`,
        );
        expect(await linkTarget(link)).toBe(`${SRC}/rendered`);
      },
    );

    it("links a website's screenshot to its page", async () => {
      mounted = binding.mountAsset({
        src: SRC,
        info: info(
          "website",
          { rendered: { kind: "image", width: 1280, height: 3000 }, preview },
          { externalUrl: "https://example.com/post" },
        ),
        alt: ALT,
        messages,
      });
      const link = await view().findByRole("link", { name: "msg:open example.com" });

      expect((await view().findByRole("img", { name: ALT })).getAttribute("src")).toBe(
        `${SRC}/rendered`,
      );
      expect(await linkTarget(link)).toBe("https://example.com/post");
    });

    it.skipIf(!binding.showsViewers)(
      "shows a text asset's text, escaped, read from its original file",
      async () => {
        mounted = binding.mountAsset({
          src: SRC,
          info: info("plaintext-document", {}),
          alt: ALT,
          messages,
        });

        expect((await view().findByText("hello <b>world</b>")).textContent).toBe(
          "hello <b>world</b>",
        );
        expect(requests).toEqual([`${SRC}/original`]);
      },
    );

    it.skipIf(!binding.showsViewers)(
      "shows the notice when the CDN refuses a text asset's file",
      async () => {
        textFor = () => Response.json({ code: "asset/not-available" }, { status: 403 });
        mounted = binding.mountAsset({
          src: SRC,
          info: info("plaintext-document", {}),
          alt: ALT,
          messages,
        });

        expect((await view().findByText(messages.unavailable)).textContent).toBe(
          messages.unavailable,
        );
      },
    );

    it.skipIf(!binding.showsViewers)(
      "shows a spreadsheet's sheets from the text it is given",
      async () => {
        mounted = binding.mountAsset({
          src: SRC,
          info: info("multimedia-document", {
            format: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          spreadsheet: {
            getText: async () => '# Sheet "Scores"\nRow 1: A=Name | B=Score\nRow 2: A=Ada | B=10\n',
          },
          alt: ALT,
          messages,
        });

        expect((await view().findByRole("cell", { name: "Ada" })).textContent).toBe("Ada");
        expect(requests).toEqual([]);
      },
    );

    it.skipIf(binding.showsViewers)(
      "offers to open a document it doesn't show, from its first page's still",
      async () => {
        mounted = binding.mountAsset({
          src: SRC,
          info: info("multimedia-document", { rendered: { kind: "pdf" }, preview }),
          alt: ALT,
          messages,
        });

        const link = await view().findByRole("link", { name: messages.open });
        expect((await view().findByRole("img", { name: ALT })).getAttribute("src")).toBe(
          `${SRC}/preview`,
        );
        expect(await linkTarget(link)).toBe(`${SRC}/rendered`);
      },
    );
  });
}
