import type { AssetModerationStatus, CdnTransform, LensTransform } from "../client/CalmLensTypes";
import { getAssetUrl, serializeTransform, transformSelector } from "../client/CalmLensUtils";
import { placeholderHashToDataURL } from "../contract/PlaceholderHashDecode.js";

/** Image formats the media component offers before the original, best first. */
export type MediaFormat = "avif" | "webp";

export interface MediaOptions {
  projectId: string;
  /** The asset ID, or the `externalId` your app gave it. */
  assetId: string;
  /** The asset's stored moderation status. Defaults to `allowed`. */
  status?: AssetModerationStatus;
  /**
   * Whether your app lets this viewer see age-restricted media. Without it, age-restricted
   * assets show their blurred placeholder and a reveal button.
   */
  canView?: boolean;
  /** `image` (default), `video` or `audio`. */
  type?: "image" | "video" | "audio";
  /** `content` (default) or `preview`, which also converts HEIC to a format browsers show. */
  resource?: "content" | "preview";
  /** A named lens, such as `avatar`. */
  lens?: string;
  /** A transform applied after the lens, as a selector string or structured steps. */
  transform?: CdnTransform;
  /** Widths to offer in `srcset`, so browsers fetch the smallest that fits `sizes`. */
  widths?: number[];
  /**
   * Formats offered before the original. Defaults to `["avif"]`; pass `[]` to serve only the
   * original. Each format and width is a separate image transform.
   */
  formats?: MediaFormat[];
  /**
   * A signed URL from your server, used as-is instead of a CDN URL built here, for private
   * assets or when CalmLens must refuse age-restricted content to everyone else.
   */
  url?: string;
  /** Show the blurred placeholder while the media loads. Defaults to `true`. */
  placeholder?: boolean;
  /**
   * The asset's `content.previewImage.thumbhash`, if your app stores it. The placeholder is then
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
      sources: { type: string; srcSet: string }[];
      placeholderUrl?: string;
    }
  | { kind: "video"; src: string; poster?: string; placeholderUrl?: string }
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
 * What the media component should render for an asset: the image with its responsive sources,
 * the video or audio, a gated placeholder for an age-restricted asset the viewer can't see, or
 * nothing for blocked and purged assets. Every framework's component renders this.
 */
export const getMediaState = ({
  projectId,
  assetId,
  status = "allowed",
  canView = false,
  type = "image",
  resource = "content",
  lens,
  transform,
  widths,
  formats = ["avif"],
  url,
  placeholder = true,
  placeholderHash,
  placeholderUrl: customPlaceholderUrl,
  cdnBaseUrl,
}: MediaOptions): MediaState => {
  if (status === "blocked" || status === "purged") return { kind: "unavailable" };
  const asset = { projectId, assetIdentifier: assetId, cdnBaseUrl };
  const placeholderUrl = placeholder
    ? (decodePlaceholderHash(placeholderHash) ??
      customPlaceholderUrl ??
      // A private asset's placeholder needs the same access as its content, so a signed URL
      // gets none from the CDN.
      (url ? undefined : getAssetUrl({ ...asset, resource: "placeholder" })))
    : undefined;
  const restricted = status === "age-restricted";
  if (restricted && !canView) return { kind: "gated", placeholderUrl };

  const build = (options: { resource?: "content" | "preview"; extra?: LensTransform } = {}) =>
    getAssetUrl({
      ...asset,
      resource: options.resource ?? resource,
      lens,
      transform: joinTransforms(transform, options.extra),
      allowAgeRestricted: restricted || undefined,
    });

  if (type === "audio") return { kind: "audio", src: url ?? build() };
  if (type === "video") {
    return {
      kind: "video",
      src: url ?? build({ resource: "content" }),
      poster: url ? undefined : build({ resource: "preview" }),
      placeholderUrl,
    };
  }
  if (url) return { kind: "image", src: url, sources: [], placeholderUrl };

  const sorted = [...new Set(widths ?? [])]
    .filter((width) => Number.isSafeInteger(width) && width > 0)
    .sort((a, b) => a - b);
  const step = (options: Record<string, string | number>): LensTransform => ({
    type: "imageTransform",
    options,
  });
  const srcSetFor = (format?: MediaFormat) =>
    sorted.length
      ? sorted
          .map(
            (width) => `${build({ extra: step({ width, ...(format && { format }) }) })} ${width}w`,
          )
          .join(", ")
      : build({ extra: format ? step({ format }) : undefined });
  const largest = sorted.at(-1);
  return {
    kind: "image",
    src: largest ? build({ extra: step({ width: largest }) }) : build(),
    srcSet: sorted.length ? srcSetFor() : undefined,
    sources: formats.map((format) => ({ type: `image/${format}`, srcSet: srcSetFor(format) })),
    placeholderUrl,
  };
};
