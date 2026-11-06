import { afterEach, describe, expect, it, mock } from "bun:test";
import { waitFor, within } from "@testing-library/dom";
import type { MediaPlayerSource } from "../src/react-native";
import type { ViewerAsset } from "../src/ui";
import { BINDINGS, type Mounted } from "./bindings";

const PROJECT_ID = "proj_8fK2mQx7Lp4NvB3tRz9Y";
const SRC = `https://cdn.calmlens.com/v1/assets/${PROJECT_ID}/sig_grant`;
const native = BINDINGS.find((binding) => binding.name === "React Native");
if (!native) throw new Error("The React Native binding is missing");
const messages = { play: "msg:play", unavailable: "msg:unavailable" };

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const view = () => within(mounted?.container ?? document.body);
type NativeProps = Parameters<typeof native.mountAsset>[0] & {
  renderPlayer?: (source: MediaPlayerSource) => null;
};
const mountNative = (props: NativeProps) =>
  native.mountAsset(props as Parameters<typeof native.mountAsset>[0]);
const info = (kind: "video" | "audio", peaks?: number[], stream = false): ViewerAsset => ({
  id: "v1",
  projectId: PROJECT_ID,
  type: kind,
  externalUrl: null,
  availability: "available",
  content: {
    format: null,
    rendered: { kind, width: null, height: null, peaks },
    hls: stream ? { renditions: [] } : null,
    preview: { width: 640, height: 360, thumbhash: null, averageColor: null },
  },
});

describe("React Native CalmLensAsset playback", () => {
  it("hands video to the app's player with the rendered file and its poster", async () => {
    const renderPlayer = mock((_source: MediaPlayerSource) => null);
    mounted = mountNative({ src: SRC, info: info("video"), alt: "A laser", renderPlayer });

    await waitFor(() =>
      expect(renderPlayer.mock.calls.at(-1)?.[0]).toMatchObject({
        kind: "video",
        src: `${SRC}/rendered`,
        poster: `${SRC}/preview`,
        alt: "A laser",
        controls: true,
      }),
    );
  });

  it("hands the app's player the stream when there is one, and the rendered file once it fails", async () => {
    const renderPlayer = mock((_source: MediaPlayerSource) => null);
    mounted = mountNative({ src: SRC, info: info("video", undefined, true), renderPlayer });

    await waitFor(() =>
      expect(renderPlayer.mock.calls.at(-1)?.[0]).toMatchObject({
        src: `${SRC}/hls/index.m3u8`,
        streaming: true,
      }),
    );
    renderPlayer.mock.calls.at(-1)?.[0].onError({ position: 8, playing: true });
    await waitFor(() =>
      expect(renderPlayer.mock.calls.at(-1)?.[0]).toMatchObject({
        src: `${SRC}/rendered`,
        streaming: false,
        resumeFrom: { position: 8, playing: true },
      }),
    );
  });

  it("hands audio's waveform and peaks to the app's player", async () => {
    const renderPlayer = mock((_source: MediaPlayerSource) => null);
    mounted = mountNative({ src: SRC, info: info("audio", [0.4, 0.8]), renderPlayer });

    await waitFor(() =>
      expect(renderPlayer.mock.calls.at(-1)?.[0]).toMatchObject({
        kind: "audio",
        src: `${SRC}/rendered`,
        poster: `${SRC}/preview`,
        peaks: [0.4, 0.8],
      }),
    );
  });

  it("gives unavailable video to no player", async () => {
    const renderPlayer = mock((_source: MediaPlayerSource) => null);
    mounted = mountNative({
      src: SRC,
      info: { ...info("video"), availability: "unavailable" },
      renderPlayer,
      messages,
    });

    await view().findByText(messages.unavailable);
    expect(renderPlayer).not.toHaveBeenCalled();
  });

  it("hands the player a fresh asset URL from onExpired when it fails, with where to resume", async () => {
    const fresh = `https://cdn.calmlens.com/v1/assets/${PROJECT_ID}/sig_fresh`;
    const onExpired = mock(async () => fresh);
    const renderPlayer = mock((_source: MediaPlayerSource) => null);
    mounted = mountNative({ src: SRC, info: info("video"), onExpired, renderPlayer, messages });
    await waitFor(() => expect(renderPlayer.mock.calls.at(-1)?.[0].src).toBe(`${SRC}/rendered`));

    renderPlayer.mock.calls.at(-1)?.[0].onError({ position: 12, playing: true });
    await waitFor(() =>
      expect(renderPlayer.mock.calls.at(-1)?.[0]).toMatchObject({
        src: `${fresh}/rendered`,
        resumeFrom: { position: 12, playing: true },
      }),
    );
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
