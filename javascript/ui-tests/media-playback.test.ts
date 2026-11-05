import { afterEach, describe, expect, it, mock } from "bun:test";
import { waitFor, within } from "@testing-library/dom";
import { BINDINGS, type Mounted } from "./bindings";

// Playback of rendered video, audio and PDFs from private assets: every file a player shows comes
// from `getSignedUrl`, and an expired URL is replaced without losing the viewer's place.

const PROJECT_ID = "proj_8fK2mQx7Lp4NvB3tRz9Y";
const ALT = "Product demo";
const messages = { unavailable: "msg:unavailable", openPdf: "msg:open-pdf", pdfTitle: "msg:pdf" };

const apiAsset = (kind: "video" | "audio" | "pdf") => ({
  id: "a1",
  projectId: PROJECT_ID,
  type: kind === "pdf" ? "multimedia-document" : kind,
  classification: { moderation: { status: "allowed" as const } },
  content: {
    status: "stored",
    rendered: { kind, width: kind === "video" ? 640 : null, height: kind === "video" ? 360 : null },
    preview: null,
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
const player = () => view().getByLabelText(ALT) as HTMLMediaElement;

/** Fails the shown player as an expired URL does, at `position`, playing or not. */
const expire = (media: HTMLMediaElement, position: number, playing: boolean) => {
  media.currentTime = position;
  Object.defineProperty(media, "paused", { configurable: true, value: !playing });
  media.dispatchEvent(new Event("error"));
};

/** Replaces `HTMLMediaElement.play` for one test, recording its calls. */
const stubPlay = () => {
  const play = mock(async () => {});
  const original = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = play;
  return { play, restore: () => (HTMLMediaElement.prototype.play = original) };
};

for (const binding of BINDINGS.filter((each) => each.playsMedia)) {
  describe(`${binding.name} media playback`, () => {
    it("gives a video player native controls and the asset's name", async () => {
      mounted = binding.mountMedia({ asset: apiAsset("video"), alt: ALT, messages });
      const video = await view().findByLabelText(ALT);

      expect(video.tagName).toBe("VIDEO");
      expect(video.hasAttribute("controls")).toBe(true);
    });

    it("embeds a private PDF and links to it with its signed URL", async () => {
      const getSignedUrl = signer();
      mounted = binding.mountMedia({ asset: apiAsset("pdf"), getSignedUrl, messages });
      const frame = await view().findByTitle(messages.pdfTitle);

      expect(getSignedUrl.mock.calls).toEqual([["rendered"]]);
      expect(frame.getAttribute("src")).toBe("https://signed.example/rendered?n=1");
      expect(view().getByRole("link", { name: messages.openPdf }).getAttribute("href")).toBe(
        "https://signed.example/rendered?n=1",
      );
    });

    it("resumes a paused video at its place, without playing it, after its URL expires", async () => {
      const { play, restore } = stubPlay();
      try {
        const getSignedUrl = signer();
        mounted = binding.mountMedia({
          asset: apiAsset("video"),
          getSignedUrl,
          alt: ALT,
          messages,
        });
        expire(await view().findByLabelText(ALT), 12, false);

        await waitFor(() =>
          expect(player().getAttribute("src")).toBe("https://signed.example/rendered?n=2"),
        );
        player().currentTime = 0;
        player().dispatchEvent(new Event("loadedmetadata"));
        expect(player().currentTime).toBe(12);
        expect(play).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it("replaces an audio URL each time it expires once the last one had loaded", async () => {
      const { play, restore } = stubPlay();
      try {
        const getSignedUrl = signer();
        mounted = binding.mountMedia({
          asset: apiAsset("audio"),
          getSignedUrl,
          alt: ALT,
          messages,
        });
        for (const next of [2, 3]) {
          expire(await view().findByLabelText(ALT), next * 10, true);
          await waitFor(() =>
            expect(player().getAttribute("src")).toBe(`https://signed.example/rendered?n=${next}`),
          );
          player().currentTime = 0;
          player().dispatchEvent(new Event("loadedmetadata"));
          expect(player().currentTime).toBe(next * 10);
        }

        expect(getSignedUrl).toHaveBeenCalledTimes(3);
        expect(play).toHaveBeenCalledTimes(2);
        expect(view().queryByText(messages.unavailable)).toBeNull();
      } finally {
        restore();
      }
    });

    it("says the video is unavailable when no fresh URL can be fetched", async () => {
      let calls = 0;
      const getSignedUrl = mock(async (resource: string) => {
        calls += 1;
        if (calls > 1) throw new Error("offline");
        return `https://signed.example/${resource}`;
      });
      mounted = binding.mountMedia({ asset: apiAsset("video"), getSignedUrl, alt: ALT, messages });
      expire(await view().findByLabelText(ALT), 5, true);

      expect((await view().findByText(messages.unavailable)).textContent).toBe(
        messages.unavailable,
      );
      expect(view().queryByLabelText(ALT)).toBeNull();
    });
  });
}
