import type { AssetModerationStatus, CdnTransform, LensTransform } from "../client/CalmLensTypes";
import { getAssetUrl, serializeTransform, transformSelector } from "../client/CalmLensUtils";
import { EU_COUNTRIES } from "../contract/Jurisdiction.js";
import { placeholderHashToDataURL } from "../contract/PlaceholderHashDecode.js";

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
      delivery?: { region: string; action: string | null; ageCheckStandard: "any" | "verified" };
      policy?: { decision?: { regions?: { region: string; action: string }[] } };
    } | null;
  } | null;
  content?: {
    status?: string | null;
    image?: {
      thumbhash?: string | null;
      averageColor?: string | null;
      width?: number | null;
      height?: number | null;
    } | null;
  } | null;
}

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
  /** Viewer country; forwarded to every CDN request. Your integration determines it. */
  region?: string;
  /** The asset's stored moderation status. Defaults to `allowed`. */
  status?: AssetModerationStatus;
  /**
   * Whether CalmLens has removed the asset's content, from its `content.status`. Removed content
   * shows the unavailable notice and requests nothing. Set from `asset` when you pass one.
   */
  contentRemoved?: boolean;
  /**
   * Whether your app lets this viewer see age-restricted media. Without it, age-restricted
   * assets show their blurred placeholder and a reveal button.
   */
  ageConfirmed?: boolean;
  /** `image` (default), `video` or `audio`. */
  type?: "image" | "video" | "audio";
  /**
   * `rendered` (default), which the CDN serves in the best format the browser accepts and where
   * lenses and transforms apply, or `original`, the exact uploaded file. Video and audio always
   * play the original.
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
   * assets or when CalmLens must refuse age-restricted content to everyone else.
   */
  url?: string;
  /** Show the blurred placeholder while the media loads. Defaults to `true`. */
  placeholder?: boolean;
  /**
   * The asset's `content.image.thumbhash`, if your app stores it. The placeholder is then
   * drawn in the browser instead of requested from the CDN, which also works for private assets
   * and signed URLs.
   */
  placeholderHash?: string;
  /** Your own placeholder image URL, used when there is no `placeholderHash`. */
  placeholderUrl?: string;
  /** The CDN base URL, for local development. */
  cdnBaseUrl?: string;
}

export type MediaState =
  | { kind: "unavailable" }
  | { kind: "gated"; placeholderUrl?: string }
  | {
      kind: "image";
      src: string;
      srcSet?: string;
      /** One URL per width in `widths`, smallest first, for apps that pick their own. */
      sources?: MediaImageSource[];
      placeholderUrl?: string;
    }
  | { kind: "video"; src: string; placeholderUrl?: string }
  | { kind: "audio"; src: string };

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

const joinTransforms = (base: CdnTransform | undefined, extra?: LensTransform) =>
  [transformSelector(base), extra && serializeTransform(extra)].filter(Boolean).join(",") ||
  undefined;

/**
 * What the media component should render for an asset: the image with its responsive widths,
 * the video or audio, a gated placeholder for an age-restricted asset the viewer can't see, or
 * nothing for blocked and purged assets. Every framework's component renders this.
 */
/** The display props an asset can supply, which media components read alongside the options. */
type AssetDisplay = { width?: number; height?: number; averageColor?: string };

/**
 * Fills the props left unset from `asset`, if there is one: the project and ID, its moderation
 * status, `video` or `audio` for those asset types, and its stored preview's ThumbHash, average
 * colour and size. Every framework's media component calls this before rendering.
 */
export const resolveMediaProps = <T extends MediaOptions & AssetDisplay>(
  props: T,
): T & { projectId: string; assetId: string } => {
  const { asset } = props;
  if (!asset) return props as T & { projectId: string; assetId: string };
  const preview = asset.content?.image;
  const regionEntries = asset.classification?.moderation?.policy?.decision?.regions ?? [];
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
  const delivery = asset.classification?.moderation?.delivery;
  const resolved = delivery?.region === props.region ? delivery : undefined;
  if (resolved) {
    const effective = resolved.action ? statuses[resolved.action] : "allowed";
    if (effective && ranks[effective] > ranks[status]) status = effective;
  }
  for (const entry of resolved ? [] : regionEntries) {
    if (
      !props.region ||
      entry.region === props.region ||
      (entry.region === "EU" && EU_COUNTRIES.has(props.region))
    ) {
      const regionalStatus = statuses[entry.action];
      if (regionalStatus && ranks[regionalStatus] > ranks[status]) status = regionalStatus;
    }
  }
  const kind = asset.type === "video" || asset.type === "audio" ? asset.type : undefined;
  return {
    ...props,
    projectId: props.projectId ?? asset.projectId,
    assetId: props.assetId ?? asset.id,
    status,
    contentRemoved: props.contentRemoved ?? asset.content?.status === "removed",
    type: props.type ?? kind,
    placeholderHash: props.placeholderHash ?? preview?.thumbhash ?? undefined,
    averageColor: props.averageColor ?? preview?.averageColor ?? undefined,
    width: props.width ?? preview?.width ?? undefined,
    height: props.height ?? preview?.height ?? undefined,
  } as T & { projectId: string; assetId: string };
};

export const getMediaState = (options: MediaOptions): MediaState =>
  buildMediaState(resolveMediaProps(options));

const buildMediaState = ({
  projectId,
  assetId,
  status = "allowed",
  contentRemoved = false,
  ageConfirmed = false,
  type = "image",
  resource = "rendered",
  lens,
  transform,
  widths,
  url,
  placeholder = true,
  placeholderHash,
  placeholderUrl: customPlaceholderUrl,
  cdnBaseUrl,
  region,
}: MediaSettings & { projectId: string; assetId: string }): MediaState => {
  if (status === "blocked" || status === "purged" || contentRemoved) return { kind: "unavailable" };
  const asset = { projectId, assetIdentifier: assetId, cdnBaseUrl, region };
  const placeholderUrl = placeholder
    ? (decodePlaceholderHash(placeholderHash) ??
      customPlaceholderUrl ??
      // The CDN draws placeholders only for images. A private asset's placeholder needs the same
      // access as its content, so a signed URL gets none from the CDN.
      (url || type !== "image" ? undefined : getAssetUrl({ ...asset, resource: "placeholder" })))
    : undefined;
  const restricted = status === "age-restricted";
  if (restricted && !ageConfirmed) return { kind: "gated", placeholderUrl };

  const build = (options: { resource?: "original" | "rendered"; extra?: LensTransform } = {}) => {
    const chosen = options.resource ?? resource;
    // Lenses and transforms apply only to the rendered resource.
    const rendered = chosen === "rendered";
    return getAssetUrl({
      ...asset,
      resource: chosen,
      lens: rendered ? lens : undefined,
      transform: rendered ? joinTransforms(transform, options.extra) : undefined,
      ageConfirmed: restricted || undefined,
    });
  };

  if (type === "audio") return { kind: "audio", src: url ?? build({ resource: "original" }) };
  // The CDN renders no still for video, so a video plays its original file with no poster.
  if (type === "video") {
    return { kind: "video", src: url ?? build({ resource: "original" }), placeholderUrl };
  }
  if (url) return { kind: "image", src: url, placeholderUrl };

  // One URL per width; the CDN picks each one's format from the browser's Accept header.
  const widthsInOrder = [...new Set(widths ?? [])]
    .filter((width) => Number.isSafeInteger(width) && width > 0)
    .sort((a, b) => a - b);
  const sources = widthsInOrder.map((width) => ({
    src: build({ extra: { type: "imageTransform", options: { width } } }),
    width,
  }));
  return {
    kind: "image",
    src: sources.at(-1)?.src ?? build(),
    srcSet: sources.length
      ? sources.map(({ src, width }) => `${src} ${width}w`).join(", ")
      : undefined,
    sources: sources.length ? sources : undefined,
    placeholderUrl,
  };
};
