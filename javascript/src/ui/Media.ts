import type { AssetModerationStatus, CdnTransform, LensTransform } from "../client/CalmLensTypes";
import { getAssetUrl, serializeTransform, transformSelector } from "../client/CalmLensUtils";
import { placeholderHashToDataURL } from "../contract/PlaceholderHashDecode.js";

/**
 * The parts of an asset, as the API or a webhook returns it, that the media component reads.
 * Assets from `CalmLensServerClient` fit as they are.
 */
export interface MediaAsset {
  id: string;
  projectId: string;
  type?: string | null;
  classification?: { moderation?: { status?: AssetModerationStatus | null } | null } | null;
  content?: {
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
  /** The asset's stored moderation status. Defaults to `allowed`. */
  status?: AssetModerationStatus;
  /**
   * Whether your app lets this viewer see age-restricted media. Without it, age-restricted
   * assets show their blurred placeholder and a reveal button.
   */
  canView?: boolean;
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
  | { kind: "image"; src: string; srcSet?: string; placeholderUrl?: string }
  | { kind: "video"; src: string; placeholderUrl?: string }
  | { kind: "audio"; src: string };

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
  const kind = asset.type === "video" || asset.type === "audio" ? asset.type : undefined;
  return {
    ...props,
    projectId: props.projectId ?? asset.projectId,
    assetId: props.assetId ?? asset.id,
    status: props.status ?? asset.classification?.moderation?.status ?? undefined,
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
  canView = false,
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
}: MediaSettings & { projectId: string; assetId: string }): MediaState => {
  if (status === "blocked" || status === "purged") return { kind: "unavailable" };
  const asset = { projectId, assetIdentifier: assetId, cdnBaseUrl };
  const placeholderUrl = placeholder
    ? (decodePlaceholderHash(placeholderHash) ??
      customPlaceholderUrl ??
      // The CDN draws placeholders only for images. A private asset's placeholder needs the same
      // access as its content, so a signed URL gets none from the CDN.
      (url || type !== "image" ? undefined : getAssetUrl({ ...asset, resource: "placeholder" })))
    : undefined;
  const restricted = status === "age-restricted";
  if (restricted && !canView) return { kind: "gated", placeholderUrl };

  const build = (options: { resource?: "original" | "rendered"; extra?: LensTransform } = {}) => {
    const chosen = options.resource ?? resource;
    // Lenses and transforms apply only to the rendered resource.
    const rendered = chosen === "rendered";
    return getAssetUrl({
      ...asset,
      resource: chosen,
      lens: rendered ? lens : undefined,
      transform: rendered ? joinTransforms(transform, options.extra) : undefined,
      allowAgeRestricted: restricted || undefined,
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
  const atWidth = (width: number) =>
    build({ extra: { type: "imageTransform", options: { width } } });
  const largest = widthsInOrder.at(-1);
  return {
    kind: "image",
    src: largest ? atWidth(largest) : build(),
    srcSet: widthsInOrder.length
      ? widthsInOrder.map((width) => `${atWidth(width)} ${width}w`).join(", ")
      : undefined,
    placeholderUrl,
  };
};
