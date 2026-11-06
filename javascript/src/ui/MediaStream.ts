import type Hls from "hls.js";
import type { AssetView } from "./Asset";

/** The MIME type of an HLS playlist, which Safari and iOS play natively. */
const HLS_MIME_TYPE = "application/vnd.apple.mpegurl";

/** Whether the browser has Media Source Extensions, which hls.js plays a stream through. */
const hasMediaSource = () =>
  typeof window !== "undefined" && ("MediaSource" in window || "ManagedMediaSource" in window);

/**
 * Loads hls.js's light build, which plays HLS without subtitles or DRM, only when a stream is to
 * play through Media Source Extensions.
 */
const loadHls = async (): Promise<typeof Hls> => (await import("hls.js/light")).default;

/** The stream URL each element last fell back from, so it keeps playing the file afterwards. */
const failedStreams = new WeakMap<HTMLMediaElement, string>();

type Playback = {
  /** Whether the element is playing the stream (natively or through hls.js), not the file. */
  streaming: boolean;
  fallBack(): void;
  stop(): void;
};

/** A video or audio element's source, from its view, when it has a stream to play. */
const streamSource = (view: AssetView) =>
  (view.kind === "video" || view.kind === "audio") && view.stream
    ? { src: view.src, stream: view.stream }
    : undefined;

const play = (
  media: HTMLMediaElement,
  { src, stream }: { src: string; stream: string },
  onExpired: () => boolean,
): Playback => {
  let hls: Hls | undefined;
  let stopped = false;
  const playback: Playback = {
    streaming: true,
    // Plays the rendered file instead, from then on for this stream.
    fallBack: () => {
      playback.streaming = false;
      failedStreams.set(media, stream);
      hls?.destroy();
      hls = undefined;
      if (!stopped) media.src = src;
    },
    stop: () => {
      stopped = true;
      hls?.destroy();
      hls = undefined;
    },
  };
  if (failedStreams.get(media) === stream) {
    playback.streaming = false;
    media.src = src;
  } else if (media.canPlayType(HLS_MIME_TYPE)) {
    // Safari and iOS play HLS themselves; an expired URL fails the element, which refreshes it.
    media.src = stream;
  } else if (hasMediaSource()) {
    loadHls().then((HlsPlayer) => {
      if (stopped || !playback.streaming) return;
      if (!HlsPlayer.isSupported()) return playback.fallBack();
      const player = new HlsPlayer();
      hls = player;
      let refreshing = false;
      player.on(HlsPlayer.Events.ERROR, (_event, data) => {
        if (refreshing || hls !== player) return;
        // An expired signed URL: a fresh asset URL replaces this player once it arrives.
        if (data.response?.code === 403 && onExpired()) {
          refreshing = true;
          player.stopLoad();
        } else if (data.fatal) playback.fallBack();
      });
      player.loadSource(stream);
      player.attachMedia(media);
    }, playback.fallBack);
  } else {
    playback.streaming = false;
    media.src = src;
  }
  return playback;
};

/**
 * Plays the adaptive stream of `CalmLensAsset`'s video or audio, when its view has one: as the
 * element's own source where the browser plays HLS (Safari and iOS), through hls.js where it has
 * Media Source Extensions (hls.js loads only then), and otherwise, or once the stream fails, from
 * the rendered file. Without a stream the component sets the file as the element's `src` itself.
 * `onExpired` runs when the stream's URL is refused, as an expired signed one is; it returns
 * `true` when a fresh asset URL is on its way, which replaces the stream once it renders.
 */
export class MediaStreamPlayer {
  #media?: HTMLMediaElement;
  #key?: string;
  #playback?: Playback;
  readonly #onExpired: (media: HTMLMediaElement) => boolean;

  constructor(onExpired: (media: HTMLMediaElement) => boolean) {
    this.#onExpired = onExpired;
  }

  /**
   * Call after every render with the video or audio element shown (or none) and the view: it
   * starts, replaces or stops the stream when either changed.
   */
  update(media: HTMLMediaElement | null | undefined, view: AssetView): void {
    const source = media ? streamSource(view) : undefined;
    const key = source && `${source.src}\n${source.stream}`;
    if (media === this.#media && key === this.#key) return;
    const previous = this.#media;
    const stopped = this.#playback !== undefined;
    this.stop();
    this.#media = media ?? undefined;
    this.#key = key;
    if (media && source) {
      this.#playback = play(media, source, () => this.#onExpired(media));
    } else if (media && stopped && media === previous && "src" in view && view.src) {
      // The stream's player cleared the element; the component's own `src` is the file.
      media.src = view.src;
    }
  }

  /**
   * For a video or audio element's `error`: `true` when it switched from the stream to the
   * rendered file. `false` means the file itself failed, for the component's session to handle.
   */
  recover(media: HTMLMediaElement): boolean {
    const playback = media === this.#media ? this.#playback : undefined;
    if (!playback?.streaming) return false;
    playback.fallBack();
    return true;
  }

  /** Stops the stream, when the component unmounts. */
  stop(): void {
    this.#playback?.stop();
    this.#playback = undefined;
    this.#media = undefined;
    this.#key = undefined;
  }
}
