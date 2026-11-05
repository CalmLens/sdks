import type Hls from "hls.js";
import type { MediaState, MediaUrlSigner } from "./Media";

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

/** A video or audio element's source, from its media state, when it has a stream to play. */
const streamSource = (state: MediaState) =>
  (state.kind === "video" || state.kind === "audio") && state.stream
    ? { src: state.src, stream: state.stream }
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
        // An expired signature: a fresh stream URL replaces this player once it arrives.
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
 * Plays the adaptive stream of a media component's video or audio, when its state has one: as
 * the element's own source where the browser plays HLS (Safari and iOS), through hls.js where it
 * has Media Source Extensions (hls.js loads only then), and otherwise, or once the stream fails,
 * from the rendered file. Without a stream the component sets the file as the element's `src`
 * itself. Every web framework's media component drives one with its `MediaUrlSigner`.
 */
export class MediaStreamPlayer {
  #media?: HTMLMediaElement;
  #key?: string;
  #playback?: Playback;
  readonly #signer: MediaUrlSigner;

  constructor(signer: MediaUrlSigner) {
    this.#signer = signer;
  }

  /**
   * Call after every render with the video or audio element shown (or none) and the state: it
   * starts, replaces or stops the stream when either changed.
   */
  update(media: HTMLMediaElement | null | undefined, state: MediaState): void {
    const source = media ? streamSource(state) : undefined;
    const key = source && `${source.src}\n${source.stream}`;
    if (media === this.#media && key === this.#key) return;
    const previous = this.#media;
    const stopped = this.#playback !== undefined;
    this.stop();
    this.#media = media ?? undefined;
    this.#key = key;
    if (media && source) {
      this.#playback = play(media, source, () => this.#signer.recoverElement(media, "hls"));
    } else if (media && stopped && media === previous && "src" in state && state.src) {
      // The stream's player cleared the element; the component's own `src` is the file.
      media.src = state.src;
    }
  }

  /**
   * For a video or audio element's `error`: `true` when it is fetching a fresh signed URL for
   * what failed, or switched from the stream to the rendered file.
   */
  recover(media: HTMLMediaElement): boolean {
    const playback = media === this.#media ? this.#playback : undefined;
    if (this.#signer.recoverElement(media, playback?.streaming ? "hls" : "rendered")) {
      return true;
    }
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
