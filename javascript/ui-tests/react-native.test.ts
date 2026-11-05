import { afterEach, describe, expect, it, mock } from "bun:test";
import { waitFor, within } from "@testing-library/dom";
import type { MediaPlayerSource } from "../src/react-native";
import { BINDINGS, type Mounted } from "./bindings";

const PROJECT_ID = "proj_8fK2mQx7Lp4NvB3tRz9Y";
const CDN = "https://cdn.calmlens.com/v1";
const native = BINDINGS.find((binding) => binding.name === "React Native");
if (!native) throw new Error("The React Native binding is missing");
const messages = { openPdf: "msg:open-pdf", play: "msg:play", unavailable: "msg:unavailable" };

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const view = () => within(mounted?.container ?? document.body);
type NativeProps = Parameters<typeof native.mountMedia>[0] & {
  renderPlayer?: (source: MediaPlayerSource) => null;
};
const mountNative = (props: NativeProps) =>
  native.mountMedia(props as Parameters<typeof native.mountMedia>[0]);
const apiAsset = (kind: "video" | "audio" | "pdf", peaks?: number[]) => ({
  id: "v1",
  projectId: PROJECT_ID,
  type: kind === "pdf" ? "multimedia-document" : kind,
  classification: { moderation: { status: "allowed" as const } },
  content: {
    status: "stored",
    rendered: { kind, width: null, height: null, peaks },
    preview: { width: 640, height: 360, thumbhash: null, averageColor: null },
  },
});

/** Records the pages `Linking.openURL` opens, which react-native-web opens with `window.open`. */
const captureOpens = () => {
  const opened: string[] = [];
  const original = window.open;
  window.open = ((target?: string | URL) => {
    opened.push(String(target));
    return null;
  }) as typeof window.open;
  return { opened, restore: () => (window.open = original) };
};

describe("React Native media", () => {
  it("hands video to the app's player with the rendered file and its poster", async () => {
    const renderPlayer = mock((_source: MediaPlayerSource) => null);
    mounted = mountNative({ asset: apiAsset("video"), alt: "A cat chasing a laser", renderPlayer });

    await waitFor(() =>
      expect(renderPlayer.mock.calls.at(-1)?.[0]).toMatchObject({
        kind: "video",
        src: `${CDN}/assets/${PROJECT_ID}/v1/rendered`,
        poster: `${CDN}/assets/${PROJECT_ID}/v1/preview`,
        alt: "A cat chasing a laser",
      }),
    );
  });

  it("hands audio's waveform and peaks to the app's player", async () => {
    const renderPlayer = mock((_source: MediaPlayerSource) => null);
    mounted = mountNative({ asset: apiAsset("audio", [0.4, 0.8]), renderPlayer });

    await waitFor(() =>
      expect(renderPlayer.mock.calls.at(-1)?.[0]).toMatchObject({
        kind: "audio",
        src: `${CDN}/assets/${PROJECT_ID}/v1/rendered`,
        poster: `${CDN}/assets/${PROJECT_ID}/v1/preview`,
        peaks: [0.4, 0.8],
      }),
    );
  });

  it("gives a blocked video to no player", async () => {
    const renderPlayer = mock((_source: MediaPlayerSource) => null);
    mounted = mountNative({
      projectId: PROJECT_ID,
      assetId: "v1",
      type: "video",
      status: "blocked",
      renderPlayer,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(renderPlayer).not.toHaveBeenCalled();
  });

  it("shows a video's poster without a player, with a button that opens the file", async () => {
    const { opened, restore } = captureOpens();
    try {
      mounted = mountNative({ asset: apiAsset("video"), alt: "A cat chasing a laser", messages });
      const poster = await view().findByRole("img", { name: "A cat chasing a laser" });
      expect(poster.getAttribute("src")).toBe(`${CDN}/assets/${PROJECT_ID}/v1/preview`);

      view().getByRole("link", { name: messages.play }).click();
      await waitFor(() => expect(opened).toEqual([`${CDN}/assets/${PROJECT_ID}/v1/rendered`]));
    } finally {
      restore();
    }
  });

  it("opens a PDF from its button", async () => {
    const { opened, restore } = captureOpens();
    try {
      mounted = mountNative({ asset: apiAsset("pdf"), messages });
      (await view().findByRole("link", { name: messages.openPdf })).click();
      await waitFor(() => expect(opened).toEqual([`${CDN}/assets/${PROJECT_ID}/v1/rendered`]));
    } finally {
      restore();
    }
  });

  it("fetches a fresh signed URL when the player fails, and hands it over with where to resume", async () => {
    let count = 0;
    const getSignedUrl = mock(
      async (resource: string) => `https://signed.example/${resource}?n=${++count}`,
    );
    const renderPlayer = mock((_source: MediaPlayerSource) => null);
    mounted = mountNative({
      projectId: PROJECT_ID,
      assetId: "v1",
      type: "video",
      getSignedUrl,
      renderPlayer,
      messages,
    });
    await waitFor(() =>
      expect(renderPlayer.mock.calls.at(-1)?.[0].src).toBe("https://signed.example/rendered?n=1"),
    );

    renderPlayer.mock.calls.at(-1)?.[0].onError({ position: 12, playing: true });
    await waitFor(() =>
      expect(renderPlayer.mock.calls.at(-1)?.[0]).toMatchObject({
        src: "https://signed.example/rendered?n=2",
        resumeFrom: { position: 12, playing: true },
      }),
    );
    expect(getSignedUrl.mock.calls).toEqual([["rendered"], ["rendered"]]);

    renderPlayer.mock.calls.at(-1)?.[0].onError();
    expect(await view().findByText(messages.unavailable)).toBeTruthy();
    expect(getSignedUrl).toHaveBeenCalledTimes(2);
  });
});
