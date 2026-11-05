import type {
  AssetModerationStatus,
  CdnTransform,
  SignedCdnResource,
  ViewerClaims,
} from "../client/CalmLensTypes";
import { getAssetUrl, serializeTransform, transformSelector } from "../client/CalmLensUtils";
import { EU_COUNTRIES } from "../client/CalmLensViewerClaims";
import { placeholderHashToDataURL } from "../contract/PlaceholderHashDecode.js";
import type { UploadFileIconFamily } from "./FileIcons";

/**
 * The parts of an asset, as the API or a webhook returns it, that the media component reads.
 * Assets from `CalmLensServerClient` fit as they are.
 */
export interface MediaAsset {
  id: string;
  projectId: string;
  type?: string | null;
  classification?: {
    moderation?: {
      status?: AssetModerationStatus | null;
      regions?: { region: string; action: string }[];
    } | null;
  } | null;
  content?: {
    status?: string | null;
    /** The displayable file the CDN serves at `/rendered`, or `null` when the asset has none. */
    rendered?: {
      kind: MediaRenderedKind;
      width?: number | null;
      height?: number | null;
      peaks?: readonly number[] | null;
    } | null;
    /** The still image the CDN serves at `/preview`, or `null` when the asset has none. */
    preview?: {
      width?: number | null;
      height?: number | null;
      thumbhash?: string | null;
      averageColor?: string | null;
    } | null;
  } | null;
}

/** What an asset's rendered resource serves, from its `content.rendered.kind`. */
export type MediaRenderedKind = "image" | "video" | "audio" | "pdf";

/**
 * What the media component shows: the rendered resource's kind, or `file` for an asset with no
 * rendered file, which shows its preview still or a file icon.
 */
export type MediaKind = MediaRenderedKind | "file";

/**
 * Fetches a signed URL for one of a private asset's resources from your server, which creates it
 * with `assets.createSignedUrl` (and any lens, transform and viewer claims).
 */
export type GetSignedMediaUrl = (resource: SignedCdnResource) => Promise<string>;

/**
 * The signed URLs fetched so far, by resource: `null` when fetching one failed. The media
 * components keep these themselves; pass them to `getMediaState` to build your own.
 */
export type SignedMediaUrls = Partial<Record<SignedCdnResource, string | null>>;

/** Which asset to show: an asset from the API, or its project and ID. */
export type MediaSource =
  | {
      /**
       * An asset from the API. It supplies the project, ID, moderation status, media type and
       * stored preview (placeholder, average colour and size); props you pass win over it.
       */
      asset: MediaAsset;
      projectId?: string;
      assetId?: string;
    }
  | {
      asset?: undefined;
      projectId: string /** The asset ID, or its `externalId`. */;
      assetId: string;
    };

export type MediaOptions = MediaSource & MediaSettings;

export interface MediaSettings {
  /** Optional customer assertions. Defaults to connection country and age confirmation false. */
  viewerClaims?: ViewerClaims;
  /** The asset's stored moderation status. Defaults to `allowed`. */
  status?: AssetModerationStatus;
  /**
   * Whether CalmLens has removed the asset's content, from its `content.status`. Removed content
   * shows the unavailable notice and requests nothing. Set from `asset` when you pass one.
   */
  contentRemoved?: boolean;
  /**
   * What to show, as the asset's `content.rendered.kind`: `image` (default), `video`, `audio` or
   * `pdf`, or `file` for an asset with no rendered file, which shows its preview still (with
   * `hasPreview`) or a file icon. Set from `asset` when you pass one.
   */
  type?: MediaKind;
  /**
   * Whether the asset has a preview still, as its `content.preview` is set: a video's poster, an
   * audio waveform, or the picture shown for a file. Set from `asset` when you pass one.
   */
  hasPreview?: boolean;
  /** Audio's waveform peaks from 0 to 1, from `content.rendered.peaks`, drawn as its progress. */
  peaks?: readonly number[];
  /**
   * For images, `rendered` (default), which the CDN serves in the best format the browser accepts
   * and where lenses and transforms apply, or `original`, the exact uploaded file. Video, audio
   * and PDFs always play the rendered file.
   */
  resource?: "original" | "rendered";
  /** A named lens, such as `avatar`. */
  lens?: string;
  /** A transform applied after the lens, as a selector string or structured steps. */
  transform?: CdnTransform;
  /** Widths to offer in `srcset`, so browsers fetch the smallest that fits `sizes`. */
  widths?: number[];
  /**
   * A signed URL from your server, used as-is instead of a CDN URL built here, for private
   * assets: the file shown (the rendered resource, or the preview still of a `file`). Include any
   * viewer claims when creating the signed URL. Without `getSignedUrl`, no other private resource,
   * such as a video's poster, is requested.
   */
  url?: string;
  /**
   * Fetches signed URLs for a private asset from your server, once per resource the component
   * shows (`rendered`, `original` or `preview`), and again when a video or audio URL expires
   * mid-playback, which then resumes where it stopped. Nothing is requested while the asset is
   * blocked or behind the age notice.
   */
  getSignedUrl?: GetSignedMediaUrl;
  /** Show the blurred placeholder while the media loads. Defaults to `true`. */
  placeholder?: boolean;
  /**
   * The asset's `content.preview.thumbhash`, if your app stores it. The placeholder is then
   * drawn in the browser instead of requested from the CDN.
   */
  placeholderHash?: string;
  /** Your own placeholder image URL, used when there is no `placeholderHash`. */
  placeholderUrl?: string;
  /** The CDN base URL, for local development. */
  cdnBaseUrl?: string;
}

export type MediaState =
  | { kind: "unavailable"; reason?: "regional" }
  | { kind: "gated"; placeholderUrl?: string }
  /** Waiting for `getSignedUrl`. */
  | { kind: "pending"; placeholderUrl?: string }
  | {
      kind: "image";
      src: string;
      srcSet?: string;
      /** One URL per width in `widths`, smallest first, for apps that pick their own. */
      sources?: MediaImageSource[];
      placeholderUrl?: string;
    }
  | { kind: "video"; src: string; poster?: string; placeholderUrl?: string }
  | { kind: "audio"; src: string; waveformUrl?: string; peaks?: readonly number[] }
  | { kind: "pdf"; src: string; placeholderUrl?: string }
  /** An asset with no rendered file or preview still, shown as its file-type icon. */
  | { kind: "file"; icon: UploadFileIconFamily | "unknown" };

/** An image at one of the widths in `widths`. */
export interface MediaImageSource {
  src: string;
  width: number;
}

/**
 * The image URL to load for a box `displayWidth` pixels wide: the smallest width that covers it,
 * or the largest when none does. Without `widths`, or before the box is measured, the image's own
 * `src`. React Native, which has no `srcset`, calls this with its measured size.
 */
export const pickMediaSource = (
  state: Extract<MediaState, { kind: "image" }>,
  displayWidth: number | undefined,
): string => {
  const { sources } = state;
  if (!sources?.length || !displayWidth) return state.src;
  return (
    (sources.find((source) => source.width >= displayWidth) ?? sources.at(-1))?.src ?? state.src
  );
};

const decodedPlaceholders = new Map<string, string | undefined>();

/** Renders a ThumbHash as a PNG data URL, once per hash; `undefined` for an invalid hash. */
const decodePlaceholderHash = (hash: string | undefined): string | undefined => {
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

/** The display props an asset can supply, which media components read alongside the options. */
type AssetDisplay = { width?: number; height?: number; averageColor?: string };

/**
 * Fills the props left unset from `asset`, if there is one: the project and ID, its moderation
 * status, what its rendered resource serves, its preview still (ThumbHash, average colour and
 * whether it has one), audio's waveform peaks, and the size of the file shown. Every framework's
 * media component calls this before rendering.
 */
export const resolveMediaProps = <T extends MediaOptions & AssetDisplay>(
  props: T,
): T & { projectId: string; assetId: string } => {
  const { asset } = props;
  if (!asset) return props as T & { projectId: string; assetId: string };
  const rendered = asset.content?.rendered;
  const preview = asset.content?.preview;
  const regionEntries = asset.classification?.moderation?.regions ?? [];
  const ranks: Record<string, number> = {
    pending: 0,
    allowed: 0,
    limited: 1,
    "age-restricted": 2,
    blocked: 3,
    purged: 4,
  };
  const statuses: Record<string, AssetModerationStatus> = {
    limit: "limited",
    "age-restrict": "age-restricted",
    block: "blocked",
    purge: "purged",
  };
  let status = props.status ?? asset.classification?.moderation?.status ?? "allowed";
  for (const entry of regionEntries) {
    const region = props.viewerClaims?.region;
    if (
      region &&
      (entry.region === region || (entry.region === "EU" && EU_COUNTRIES.has(region)))
    ) {
      const regionalStatus = statuses[entry.action];
      if (regionalStatus && ranks[regionalStatus] > ranks[status]) status = regionalStatus;
    }
  }
  // An asset without its content described (a partial object) shows as its type says.
  const kind: MediaKind | undefined =
    rendered === undefined
      ? asset.type === "video" || asset.type === "audio"
        ? asset.type
        : undefined
      : (rendered?.kind ?? "file");
  const type = props.type ?? kind;
  // Audio's preview is its waveform, which says nothing about the size of the player.
  const previewSize = type === "audio" ? undefined : preview;
  return {
    ...props,
    projectId: props.projectId ?? asset.projectId,
    assetId: props.assetId ?? asset.id,
    status,
    contentRemoved: props.contentRemoved ?? asset.content?.status === "removed",
    type,
    hasPreview: props.hasPreview ?? (preview === undefined ? undefined : preview !== null),
    peaks: props.peaks ?? rendered?.peaks ?? undefined,
    placeholderHash: props.placeholderHash ?? preview?.thumbhash ?? undefined,
    averageColor: props.averageColor ?? preview?.averageColor ?? undefined,
    width: props.width ?? rendered?.width ?? previewSize?.width ?? undefined,
    height: props.height ?? rendered?.height ?? previewSize?.height ?? undefined,
  } as T & { projectId: string; assetId: string };
};

/** The file-type icon for an asset with nothing to show, from its type. */
const FILE_ICONS: Record<string, UploadFileIconFamily> = {
  image: "images",
  video: "video",
  audio: "audio",
  "plaintext-document": "documents",
  "multimedia-document": "documents",
};

/**
 * What the media component should render for an asset: the image with its responsive widths,
 * the video with its poster, the audio with its waveform, the PDF, a preview still or file icon
 * for other files, a gated placeholder for an age-restricted asset the viewer can't see, or
 * nothing for blocked and purged assets. Every framework's component renders this.
 *
 * With `getSignedUrl`, pass the URLs fetched so far as `signedUrls`; the state is `pending` until
 * every one it needs is there (see `getSignedMediaResources`).
 */
export const getMediaState = (options: MediaOptions, signedUrls?: SignedMediaUrls): MediaState =>
  describeMedia(resolveMediaProps(options), signedUrls).state;

/**
 * The resources a media component asks `getSignedUrl` for, for the state it would show: none
 * without `getSignedUrl`, or for a blocked or gated asset.
 */
export const getSignedMediaResources = (options: MediaOptions): SignedCdnResource[] =>
  describeMedia(resolveMediaProps(options), undefined).signed;

/** Changes when the signed URLs fetched for a media component no longer apply. */
export const getSignedMediaKey = (options: MediaOptions): string => {
  const resolved = resolveMediaProps(options);
  return JSON.stringify([
    resolved.projectId,
    resolved.assetId,
    resolved.type,
    resolved.resource,
    resolved.lens,
    resolved.transform,
    resolved.viewerClaims,
  ]);
};

const describeMedia = (
  {
    asset: source,
    projectId,
    assetId,
    status = "allowed",
    contentRemoved = false,
    type = "image",
    hasPreview = false,
    peaks,
    resource = "rendered",
    lens,
    transform,
    widths,
    url,
    getSignedUrl,
    placeholder = true,
    placeholderHash,
    placeholderUrl: customPlaceholderUrl,
    cdnBaseUrl,
    viewerClaims,
  }: MediaOptions & { projectId: string; assetId: string },
  signedUrls: SignedMediaUrls | undefined,
): { state: MediaState; signed: SignedCdnResource[] } => {
  const signed: SignedCdnResource[] = [];
  const done = (state: MediaState) => ({ state, signed });
  if (status === "blocked" || status === "purged" || contentRemoved) {
    return { state: { kind: "unavailable" }, signed: [] };
  }
  // Claims make the CDN's responses private and uncacheable, so send only the ones that say
  // something: a region, or a confirmed age (unconfirmed is the default).
  const region = viewerClaims?.region;
  const ageConfirmed = viewerClaims?.ageConfirmed === true;
  const claims =
    region || ageConfirmed
      ? { ...(region ? { region } : {}), ...(ageConfirmed ? { ageConfirmed } : {}) }
      : undefined;
  const asset = { projectId, assetIdentifier: assetId, cdnBaseUrl, viewerClaims: claims };
  // The CDN draws placeholders from the image or the preview still. They are public, private
  // assets' included; only a regional project's needs the viewer's region.
  const placeholderUrl = placeholder
    ? (decodePlaceholderHash(placeholderHash) ??
      customPlaceholderUrl ??
      (type === "image" || hasPreview
        ? getAssetUrl({
            projectId,
            assetIdentifier: assetId,
            cdnBaseUrl,
            resource: "placeholder",
            viewerClaims: region ? { region } : undefined,
          })
        : undefined))
    : undefined;
  const restricted = status === "age-restricted";
  if (restricted && !ageConfirmed) return { state: { kind: "gated", placeholderUrl }, signed: [] };

  // With `getSignedUrl`, every URL comes from it; the shown file's failing leaves nothing to show.
  let waiting = false;
  let failed = false;
  const fetched = (chosen: SignedCdnResource, shown: boolean): string | undefined => {
    signed.push(chosen);
    const value = signedUrls?.[chosen];
    if (value === undefined) waiting = true;
    else if (value === null && shown) failed = true;
    return value ?? undefined;
  };
  const build = (
    chosen: SignedCdnResource,
    options: { width?: number; selectable?: boolean } = {},
  ) => {
    // Lenses and transforms apply to images and preview stills, never to the original.
    const selectable = options.selectable !== false && chosen !== "original";
    return getAssetUrl({
      ...asset,
      resource: chosen,
      lens: selectable ? lens : undefined,
      transform: selectable ? withWidth(transform, options.width) : undefined,
    });
  };
  /** The file shown: the given `url`, a signed URL, or a CDN URL. */
  const shown = (chosen: SignedCdnResource, selectable = true) =>
    url ?? (getSignedUrl ? fetched(chosen, true) : build(chosen, { selectable }));
  /** A preview still beside the file, such as a poster; never requested without its signature. */
  const still = () =>
    !hasPreview
      ? undefined
      : getSignedUrl
        ? fetched("preview", false)
        : url
          ? undefined
          : build("preview", { selectable: false });
  const settle = (state: MediaState) =>
    failed
      ? done({ kind: "unavailable" })
      : waiting
        ? done({ kind: "pending", placeholderUrl })
        : done(state);

  if (type === "audio") {
    const src = shown("rendered", false);
    const waveformUrl = still();
    return settle({
      kind: "audio",
      src: src ?? "",
      waveformUrl,
      peaks: peaks?.length ? peaks : undefined,
    });
  }
  if (type === "video") {
    const src = shown("rendered", false);
    const poster = still();
    return settle({ kind: "video", src: src ?? "", poster, placeholderUrl });
  }
  if (type === "pdf") return settle({ kind: "pdf", src: shown("rendered", false) ?? "" });
  if (type === "file" && !hasPreview) {
    return done({ kind: "file", icon: FILE_ICONS[source?.type ?? ""] ?? "unknown" });
  }
  // An image, or a file's preview still, which takes lenses, transforms and widths as images do.
  const chosen = type === "file" ? "preview" : resource;
  if (url || getSignedUrl)
    return settle({ kind: "image", src: shown(chosen) ?? "", placeholderUrl });

  // One URL per width; the CDN picks each one's format from the browser's Accept header.
  const widthsInOrder = [...new Set(widths ?? [])]
    .filter((width) => Number.isSafeInteger(width) && width > 0)
    .sort((a, b) => a - b);
  const sources = widthsInOrder.map((width) => ({ src: build(chosen, { width }), width }));
  return done({
    kind: "image",
    src: sources.at(-1)?.src ?? build(chosen),
    srcSet: sources.length
      ? sources.map(({ src, width }) => `${src} ${width}w`).join(", ")
      : undefined,
    sources: sources.length ? sources : undefined,
    placeholderUrl,
  });
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

/**
 * Keeps the signed URLs a media component shows: it asks `getSignedUrl` for each resource the
 * state needs, once per asset, and for a fresh `rendered` URL when a video or audio URL fails
 * mid-playback. Every framework's media component drives one; `onChange` runs whenever a URL
 * arrives, so the component renders again with `getMediaState(options, signer.urls(options))`.
 */
export class MediaUrlSigner {
  #key?: string;
  #urls: SignedMediaUrls = {};
  #requested = new Set<SignedCdnResource>();
  #getSignedUrl?: GetSignedMediaUrl;
  #refreshing = false;
  #resume?: MediaPlayback;
  readonly #onChange: () => void;

  constructor(onChange: () => void) {
    this.#onChange = onChange;
  }

  /** The URLs fetched so far for these options, after asking for any still missing. */
  urls(options: MediaOptions): SignedMediaUrls {
    this.#getSignedUrl = options.getSignedUrl;
    const key = getSignedMediaKey(options);
    if (key !== this.#key) {
      this.#key = key;
      this.#urls = {};
      this.#requested.clear();
      this.#refreshing = false;
      this.#resume = undefined;
    }
    if (options.getSignedUrl) {
      for (const resource of getSignedMediaResources(options)) {
        if (!this.#requested.has(resource)) this.#fetch(resource);
      }
    }
    return this.#urls;
  }

  /**
   * Fetches a fresh `rendered` URL after a video or audio element failed, to resume `playback`
   * once it loads. `false` when there is no `getSignedUrl`, or the last fresh URL failed before it
   * loaded, so the error stands.
   */
  recover(playback: MediaPlayback): boolean {
    if (!this.#getSignedUrl || this.#refreshing) return false;
    this.#refreshing = true;
    this.#resume = playback;
    this.#fetch("rendered");
    return true;
  }

  /** Where to resume a recovered player, once: React Native hands it to your player. */
  takeResume(): MediaPlayback | undefined {
    const resume = this.#resume;
    this.#resume = undefined;
    return resume;
  }

  /**
   * For `loadedmetadata`: the URL works, so a later failure may refresh it again, and a recovered
   * element resumes where it stopped.
   */
  loaded(media?: HTMLMediaElement): void {
    this.#refreshing = false;
    if (!media) return;
    const resume = this.takeResume();
    if (!resume) return;
    if (resume.position > 0) media.currentTime = resume.position;
    if (resume.playing) void media.play()?.catch(() => {});
  }

  /** For a video or audio element's `error`: `true` when it is fetching a fresh URL. */
  recoverElement(media: HTMLMediaElement): boolean {
    return this.recover({
      position: media.currentTime || 0,
      playing: !media.paused && !media.ended,
    });
  }

  #fetch(resource: SignedCdnResource) {
    const getSignedUrl = this.#getSignedUrl;
    if (!getSignedUrl) return;
    const key = this.#key;
    this.#requested.add(resource);
    const settle = (value: string | null) => {
      if (key !== this.#key) return;
      this.#urls = { ...this.#urls, [resource]: value };
      this.#onChange();
    };
    Promise.resolve()
      .then(() => getSignedUrl(resource))
      .then(
        (value) => settle(typeof value === "string" && value ? value : null),
        () => settle(null),
      );
  }
}
