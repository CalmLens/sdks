import { afterEach, describe, expect, it, mock } from "bun:test";
import { waitFor } from "@testing-library/dom";
import type { MediaPlayerSource } from "../src/react-native";
import { BINDINGS, type Mounted } from "./bindings";

const PROJECT_ID = "proj_8fK2mQx7Lp4NvB3tRz9Y";
const CDN = "https://cdn.calmlens.com/v1";
const native = BINDINGS.find((binding) => binding.name === "React Native");
if (!native) throw new Error("The React Native binding is missing");

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe("React Native media", () => {
  it("hands video to the app's player with the original file", async () => {
    const renderPlayer = mock((_source: MediaPlayerSource) => null);
    mounted = native.mountMedia({
      projectId: PROJECT_ID,
      assetId: "v1",
      type: "video",
      alt: "A cat chasing a laser",
      renderPlayer,
    } as Parameters<typeof native.mountMedia>[0]);

    await waitFor(() =>
      expect(renderPlayer.mock.calls.at(-1)?.[0]).toEqual({
        kind: "video",
        src: `${CDN}/assets/${PROJECT_ID}/v1/original`,
        alt: "A cat chasing a laser",
      }),
    );
  });

  it("gives a blocked video to no player", async () => {
    const renderPlayer = mock((_source: MediaPlayerSource) => null);
    mounted = native.mountMedia({
      projectId: PROJECT_ID,
      assetId: "v1",
      type: "video",
      status: "blocked",
      renderPlayer,
    } as Parameters<typeof native.mountMedia>[0]);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(renderPlayer).not.toHaveBeenCalled();
  });
});
