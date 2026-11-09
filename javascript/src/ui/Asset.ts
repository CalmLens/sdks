// What `CalmLensAsset` shows, in every binding: the view for an asset URL and its display info,
// and the session that fetches the info, refreshes an expired signed URL and follows the CDN's
// refusals. Framework-free and DOM-free, so React Native uses it too.

import { appendAssetLocation, getAssetInfo, toUrlViewerClaims } from "../client/CalmLensCdn";
import { CalmLensError } from "../client/CalmLensError";
import type {
  AssetAvailability,
  CdnResource,
  CdnTransform,
  ViewerClaims,
} from "../client/CalmLensTypes";
import { serializeTransform, transformSelector } from "../client/CalmLensUtils";
import { placeholderHashToDataURL } from "../contract/PlaceholderHashDecode.js";
import type { UploadFileIconFamily } from "./FileIcons";
import { getAssetViewerKind, type PdfAssetOptions, type ViewerAsset } from "./viewers/ViewerAsset";

/** `full` shows the asset itself; `preview` shows its still, for grids and lists. */
export type AssetDisplay = "full" | "preview";

/** How images, preview stills and website screenshots load. */
export interface AssetImageOptions {
  /** A named lens, such as `avatar`. */
  lens?: string;
  /** A transform applied after the lens, as a selector string or structured options. */
  transform?: CdnTransform;
  /** Widths to offer in `srcset`, so browsers fetch the smallest that fits `sizes`. */
  widths?: number[];
  /** The `sizes` attribute for `widths`, such as `(min-width: 768px) 50vw, 100vw`. */
  sizes?: string;
}

/** How video and audio play. */
export interface AssetVideoOptions {
  autoPlay?: boolean;
  /** Needed for `autoPlay` in most browsers. */
  muted?: boolean;
  loop?: boolean;
  /** The player's controls. Defaults to `true`. */
  controls?: boolean;
  /**
   * Whether to play the adaptive stream when the asset has one; defaults to `true`. It plays
   * natively where the browser plays HLS (Safari and iOS), and otherwise through hls.js, which
   * loads only then; browsers with neither, and a stream that fails, play the rendered file.
   */
  stream?: boolean;
}

/** How documents (PDFs, and documents and presentations rendered as one) show. */
export interface AssetDocumentOptions {
  /** The page shown first, from 1. */
  initialPage?: number;
  /** Where pdf.js loads its worker, fonts and decoders from. */
  pdf?: PdfAssetOptions;
}

/** How spreadsheets show. */
export interface AssetSpreadsheetOptions {
  /** Rows shown at a time. Defaults to 100. */
  pageSize?: number;
  /**
   * Reads the sheets' text yourself, such as from the spreadsheet's text child asset. A
   * spreadsheet's sheets are not beneath its own asset URL, so without it the viewer shows its
   * failure notice.
   */
  getText?: () => Promise<string>;
}

/** The options every binding's `CalmLensAsset` reads to decide what it shows. */
export interface AssetOptions {
  /**
   * The asset URL: public (`cdn.getAssetUrl`) or signed (`cdn.signAssetUrl`). Nothing is requested
   * until it is set.
   */
  src?: string;
  /** Defaults to `full`. */
  display?: AssetDisplay;
  /** The viewer's region and age confirmation, added to every request. */
  viewerClaims?: ViewerClaims;
  /**
   * The asset's display info, prefetched with `getAssetInfo` (on your server, for server
   * rendering). Without it, the component fetches `{src}/info` once mounted.
   */
  info?: ViewerAsset;
  image?: AssetImageOptions;
  video?: AssetVideoOptions;
  document?: AssetDocumentOptions;
  spreadsheet?: AssetSpreadsheetOptions;
  /**
   * Returns a fresh asset URL once a signed one expires; your server signs it. Without it, an
   * expired URL shows the unavailable notice.
   */
  onExpired?: () => string | Promise<string>;
}

/** An image at one of the widths in `image.widths`. */
export interface AssetImageSource {
  src: string;
  width: number;
}

/** What `CalmLensAsset` renders. */
export type AssetView =
  /** No `src` yet, or its info is loading: a box sized from `aspectRatio`. */
  | { kind: "pending"; placeholderUrl?: string }
  | { kind: "unavailable" }
  /** Age-restricted for this viewer: the blurred placeholder behind a notice. */
  | { kind: "age-restricted"; placeholderUrl?: string }
  | {
      kind: "image";
      src: string;
      srcSet?: string;
      /** One URL per width, smallest first, for apps that pick their own (React Native). */
      sources?: AssetImageSource[];
      width?: number;
      height?: number;
      placeholderUrl?: string;
    }
  /** A website's screenshot, with a link to the page when it is an http(s) address. */
  | {
      kind: "website";
      src: string;
      srcSet?: string;
      sources?: AssetImageSource[];
      width?: number;
      height?: number;
      placeholderUrl?: string;
      link?: string;
    }
  /** Video, whose `stream`, when there is one, plays in place of the rendered file `src`. */
  | {
      kind: "video";
      src: string;
      stream?: string;
      poster?: string;
      width?: number;
      height?: number;
      placeholderUrl?: string;
    }
  /** Audio, whose `stream`, when there is one, plays in place of the rendered file `src`. */
  | { kind: "audio"; src: string; stream?: string; waveformUrl?: string; peaks?: readonly number[] }
  /**
   * A PDF, or a document rendered as one, shown by the document viewer once it loads; until then,
   * its first page's still (`still`) and a link that opens it (`src`).
   */
  | { kind: "document"; src: string; still?: string }
  /** Text, shown by the text viewer. */
  | { kind: "text" }
  /** A spreadsheet, shown by the spreadsheet viewer. */
  | { kind: "spreadsheet" }
  /** An asset with nothing to show, as its file-type icon. */
  | { kind: "file"; icon: UploadFileIconFamily | "unknown" };

const decodedPlaceholders = new Map<string, string | undefined>();

/** Renders a ThumbHash as a PNG data URL, once per hash; `undefined` for an invalid hash. */
const decodePlaceholderHash = (hash: string | null | undefined): string | undefined => {
  if (!hash) return undefined;
  if (!decodedPlaceholders.has(hash)) {
    let decoded: string | undefined;
    try {
      decoded = placeholderHashToDataURL(hash);
    } catch {}
    if (decodedPlaceholders.size > 500) decodedPlaceholders.clear();
    decodedPlaceholders.set(hash, decoded);
  }
  return decodedPlaceholders.get(hash);
};

// A width joins the options of the transform; a structured transform's own width is replaced.
const withWidth = (base: CdnTransform | undefined, width?: number): CdnTransform | undefined => {
  if (width === undefined) return base;
  if (base === undefined || typeof base !== "string") return { ...base, width };
  return [transformSelector(base), serializeTransform({ width })].filter(Boolean).join(",");
};

/** The file-type icon for an asset with nothing to show, from its type. */
const FILE_ICONS: Record<string, UploadFileIconFamily> = {
  image: "images",
  video: "video",
  audio: "audio",
  "plaintext-document": "documents",
  "multimedia-document": "documents",
  website: "documents",
};

/** A web page's address, if the viewer may link to it. */
const pageLink = (address: string | null | undefined): string | undefined => {
  if (!address) return undefined;
  try {
    const url = new URL(address);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/** The asset URL without any query; claims are added per resource. */
const baseOf = (src: string) => src.split("?", 1)[0]!.replace(/\/+$/, "");

/** The viewer claims an asset URL carries in its query, if any. */
const claimsOf = (src: string): ViewerClaims | undefined => {
  const query = src.split("?", 2)[1];
  const raw = query ? new URLSearchParams(query).get("viewerClaims") : null;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as ViewerClaims;
  } catch {
    return undefined;
  }
};

/** The claims requests carry: the options', else the URL's. Invalid claims are left out. */
const effectiveClaims = (src: string | undefined, claims: ViewerClaims | undefined) => {
  try {
    return toUrlViewerClaims(claims ?? (src ? claimsOf(src) : undefined));
  } catch {
    return undefined;
  }
};

/**
 * What `CalmLensAsset` shows for an asset URL and its display info: the image with its
 * responsive widths, a website's screenshot and link, video with its poster and stream, audio with
 * its waveform, a document, text or spreadsheet viewer, a preview still, a file icon, the age
 * notice or the unavailable notice. `unavailable` is the session's verdict after the CDN refused
 * the asset.
 */
export const getAssetView = (
  options: Pick<AssetOptions, "display" | "viewerClaims" | "image" | "video">,
  state: { src?: string; info?: ViewerAsset; unavailable?: boolean },
): AssetView => {
  const { src, info } = state;
  if (state.unavailable) return { kind: "unavailable" };
  if (!src) return { kind: "pending" };
  const base = baseOf(src);
  const claims = effectiveClaims(src, options.viewerClaims);
  const url = (resource: CdnResource, location: { lens?: string; transform?: CdnTransform } = {}) =>
    appendAssetLocation(base, {
      resource,
      ...location,
      // The placeholder is public whatever the asset's age rating; only its region matters.
      viewerClaims:
        resource === "placeholder"
          ? claims?.region
            ? { region: claims.region }
            : undefined
          : claims,
    });
  if (!info) return { kind: "pending" };
  const content = info.content ?? {};
  const { rendered, preview } = content;
  const placeholderUrl =
    decodePlaceholderHash(preview?.thumbhash) ??
    (preview || rendered?.kind === "image" ? url("placeholder") : undefined);
  if (info.availability === "unavailable") return { kind: "unavailable" };
  if (info.availability === "age-restricted") return { kind: "age-restricted", placeholderUrl };

  const image = options.image ?? {};
  const still = (
    resource: "rendered" | "preview",
    size?: { width?: number | null; height?: number | null } | null,
  ) => {
    const widths = [...new Set(image.widths ?? [])]
      .filter((width) => Number.isSafeInteger(width) && width > 0)
      .sort((a, b) => a - b);
    const build = (width?: number) =>
      url(resource, { lens: image.lens, transform: withWidth(image.transform, width) });
    const sources = widths.map((width) => ({ src: build(width), width }));
    return {
      src: sources.at(-1)?.src ?? build(),
      srcSet: sources.length
        ? sources.map(({ src: source, width }) => `${source} ${width}w`).join(", ")
        : undefined,
      sources: sources.length ? sources : undefined,
      width: size?.width ?? undefined,
      height: size?.height ?? undefined,
      placeholderUrl,
    };
  };
  const icon = (): AssetView => ({ kind: "file", icon: FILE_ICONS[info.type ?? ""] ?? "unknown" });

  if (options.display === "preview") {
    if (preview) return { kind: "image", ...still("preview", preview) };
    if (rendered?.kind === "image") return { kind: "image", ...still("rendered", rendered) };
    return icon();
  }
  switch (getAssetViewerKind(info)) {
    case "image":
      return { kind: "image", ...still("rendered", rendered) };
    case "website":
      return rendered
        ? { kind: "website", ...still("rendered", rendered), link: pageLink(info.externalUrl) }
        : icon();
    case "media": {
      const streams = options.video?.stream !== false && content.hls?.status === "ready";
      if (rendered?.kind === "audio") {
        return {
          kind: "audio",
          src: url("rendered"),
          stream: streams ? url("hls") : undefined,
          waveformUrl: preview ? url("preview") : undefined,
          peaks: rendered.peaks?.length ? rendered.peaks : undefined,
        };
      }
      return {
        kind: "video",
        src: url("rendered"),
        stream: streams ? url("hls") : undefined,
        poster: preview ? url("preview") : undefined,
        width: rendered?.width ?? undefined,
        height: rendered?.height ?? undefined,
        placeholderUrl,
      };
    }
    case "document":
      return {
        kind: "document",
        src: url("rendered"),
        still: preview ? url("preview") : undefined,
      };
    case "text":
      return { kind: "text" };
    case "spreadsheet":
      return { kind: "spreadsheet" };
    default:
      return preview ? { kind: "image", ...still("preview", preview) } : icon();
  }
};

/** Width divided by height of what the view shows, when it is known, so the box keeps its size. */
export const getAssetAspectRatio = (
  view: AssetView,
  info: ViewerAsset | undefined,
  aspectRatio?: number,
): number | undefined => {
  if (aspectRatio) return aspectRatio;
  if ("width" in view && view.width && view.height) return view.width / view.height;
  const size = info?.content?.rendered ?? info?.content?.preview;
  return size?.width && size.height && view.kind !== "audio" ? size.width / size.height : undefined;
};

/** A key that changes whenever the view must load something new. */
export const getAssetViewKey = (view: AssetView): string => {
  switch (view.kind) {
    case "image":
    case "website":
      return `${view.kind} ${view.src} ${view.srcSet ?? ""}`;
    case "video":
      return `video ${view.src} ${view.stream ?? ""} ${view.poster ?? ""}`;
    case "audio":
      return `audio ${view.src} ${view.stream ?? ""} ${view.waveformUrl ?? ""}`;
    case "document":
      return `document ${view.src}`;
    case "file":
      return `file ${view.icon}`;
    default:
      return view.kind;
  }
};

/**
 * The image URL to load for a box `displayWidth` pixels wide: the smallest width that covers it,
 * or the largest when none does. Without widths, or before the box is measured, the view's own
 * `src`. React Native, which has no `srcset`, calls this with its measured size.
 */
export const pickAssetSource = (
  view: Extract<AssetView, { kind: "image" | "website" }>,
  displayWidth: number | undefined,
): string => {
  const { sources } = view;
  if (!sources?.length || !displayWidth) return view.src;
  return (
    (sources.find((source) => source.width >= displayWidth) ?? sources.at(-1))?.src ?? view.src
  );
};

/** Audio's waveform peaks as bar heights, in percent of the waveform's height. */
export const getPeakHeights = (peaks: readonly number[]): number[] =>
  peaks.map((peak) => Math.round(Math.min(1, Math.max(0.02, peak)) * 1000) / 10);

/** How much of a media element has played, in percent, to one decimal place. */
export const getPlayedPercent = (media: { currentTime: number; duration: number }): number =>
  Number.isFinite(media.duration) && media.duration > 0
    ? Math.round(Math.min(1, Math.max(0, media.currentTime / media.duration)) * 1000) / 10
    : 0;

/** Where a video or audio element was when its URL failed, to resume once a fresh one loads. */
export interface MediaPlayback {
  position: number;
  playing: boolean;
}

/** What a session knows: the asset URL in use, the display info, and the CDN's verdict. */
export interface AssetSessionState {
  src?: string;
  info?: ViewerAsset;
  /** The CDN refused the asset, or its URL expired with no fresh one. */
  unavailable: boolean;
}

const codeOf = (error: unknown) => (CalmLensError.isCalmLensError(error) ? error.code : undefined);

/**
 * One `CalmLensAsset`'s connection to the CDN. Each render calls `update` with the options and
 * renders `getAssetView` of what it returns; once mounted, `load` fetches `{src}/info` when `info`
 * isn't given. Nothing is requested before `src` is set. A resource that fails to load
 * (`failed`) is retried once beneath a fresh asset URL from `onExpired`; then, or without
 * `onExpired`, the info is read again, and the CDN's answer decides: content it now refuses shows
 * the unavailable or age notice, whatever the info said before. `onChange` runs whenever the state
 * changes, so the component renders again.
 */
export class AssetSession {
  readonly #onChange: () => void;
  #options: AssetOptions = {};
  #given?: string;
  #src?: string;
  #claimsKey?: string;
  #info?: ViewerAsset;
  #infoKey?: string;
  #loading?: string;
  #override?: AssetAvailability;
  #unavailable = false;
  #refreshing = false;
  #resume?: MediaPlayback;
  #generation = 0;

  constructor(onChange: () => void) {
    this.#onChange = onChange;
  }

  /** The state for these options. It sends nothing: call `load` once mounted. */
  update(options: AssetOptions): AssetSessionState {
    this.#options = options;
    if (options.src !== this.#given) {
      this.#generation++;
      this.#given = options.src;
      this.#src = options.src;
      this.#info = undefined;
      this.#infoKey = undefined;
      this.#loading = undefined;
      this.#override = undefined;
      this.#unavailable = false;
      this.#refreshing = false;
      this.#resume = undefined;
    }
    const claimsKey = JSON.stringify(effectiveClaims(this.#src, options.viewerClaims) ?? null);
    if (claimsKey !== this.#claimsKey) {
      this.#claimsKey = claimsKey;
      this.#override = undefined;
    }
    return this.state;
  }

  /** The current state, without new options. */
  get state(): AssetSessionState {
    // Info fetched for an earlier URL of the same asset (before a refresh) or other claims stays
    // shown until the new one arrives, so the element isn't replaced meanwhile.
    const info = this.#options.info ?? this.#info;
    return {
      src: this.#src,
      info: info && this.#override ? { ...info, availability: this.#override } : info,
      unavailable: this.#unavailable,
    };
  }

  /** Fetches the display info when it is needed and not yet fetched or loading. Call once mounted. */
  load(): void {
    if (!this.#src || this.#options.info || this.#unavailable) return;
    const key = this.#key();
    if (this.#infoKey === key || this.#loading === key) return;
    this.#loading = key;
    void this.#readInfo().then(
      (info) => {
        if (this.#loading !== key) return;
        this.#loading = undefined;
        this.#info = info;
        this.#infoKey = key;
        this.#onChange();
      },
      (error) => {
        if (this.#loading !== key) return;
        this.#loading = undefined;
        this.#refused(error);
      },
    );
  }

  /**
   * For a resource that failed to load, such as an image's `error`: retries once beneath a fresh
   * asset URL, or asks the CDN whether the viewer may still see the asset.
   */
  failed(): void {
    if (this.#unavailable) return;
    if (this.#options.onExpired && !this.#refreshing) {
      void this.refresh().catch(() => {});
      return;
    }
    const generation = this.#generation;
    void this.#readInfo().then(
      (info) => {
        if (generation !== this.#generation) return;
        if (info.availability === "available") this.#unavailable = true;
        else this.#override = info.availability;
        this.#onChange();
      },
      (error) => {
        if (generation === this.#generation) this.#refused(error);
      },
    );
  }

  /** For a resource that loaded: a later failure may refresh the asset URL again. */
  loaded(): void {
    this.#refreshing = false;
  }

  /** For a refusal the component read itself: `asset/not-available` shows the unavailable notice. */
  unavailable(): void {
    this.#override = "unavailable";
    this.#onChange();
  }

  /**
   * A fresh asset URL from `onExpired`, which every resource then loads beneath. Rejects without
   * `onExpired`, or when it fails, and the component shows the unavailable notice.
   */
  async refresh(): Promise<string> {
    const { onExpired } = this.#options;
    const generation = this.#generation;
    if (!onExpired) {
      this.#unavailable = true;
      this.#onChange();
      throw new Error("No onExpired to refresh the asset URL");
    }
    this.#refreshing = true;
    try {
      const src = await onExpired();
      if (typeof src !== "string" || !src) throw new Error("onExpired returned no asset URL");
      if (generation === this.#generation) {
        this.#src = src;
        this.#onChange();
      }
      return src;
    } catch (error) {
      if (generation === this.#generation) {
        this.#unavailable = true;
        this.#onChange();
      }
      throw error;
    }
  }

  /** For a video or audio element's `error`: where it was, so it resumes beneath a fresh URL. */
  mediaFailed(playback: MediaPlayback): void {
    this.#resume = playback;
    this.failed();
  }

  /** For `loadedmetadata`: the URL works, and a recovered element resumes where it stopped. */
  mediaLoaded(media?: HTMLMediaElement): void {
    this.loaded();
    const resume = this.takeResume();
    if (!media || !resume) return;
    if (resume.position > 0) media.currentTime = resume.position;
    if (resume.playing) void media.play()?.catch(() => {});
  }

  /** Where to resume a recovered player, once: React Native hands it to your player. */
  takeResume(): MediaPlayback | undefined {
    const resume = this.#resume;
    this.#resume = undefined;
    return resume;
  }

  #key() {
    return `${this.#src ?? ""}\n${this.#claimsKey ?? ""}`;
  }

  #readInfo() {
    return getAssetInfo(baseOf(this.#src!), {
      viewerClaims: effectiveClaims(this.#src, this.#options.viewerClaims) ?? {},
    });
  }

  /** The info couldn't be read: an expired signed URL is refreshed, anything else is unavailable. */
  #refused(error: unknown) {
    const code = codeOf(error);
    if (code === "signed-url/expired" && this.#options.onExpired && !this.#refreshing) {
      void this.refresh().catch(() => {});
      return;
    }
    if (code === "viewer/age-confirmation-required") this.#override = "age-restricted";
    else this.#unavailable = true;
    this.#onChange();
  }
}
