import type { AssetInfo } from "../contract/AssetInfo.js";
import type {
  ASSET_RESOURCE_PATHS as SHARED_ASSET_RESOURCE_PATHS,
  UNSELECTABLE_ASSET_RESOURCES as SHARED_UNSELECTABLE,
} from "../contract/CdnUtils.js";
import { CalmLensError, invalidArgument, SDK_ERROR_CODES } from "./CalmLensError";
import { toHttpError } from "./CalmLensTransport";
import type {
  CdnAssetLocation,
  CdnAssetUrlOptions,
  CdnResource,
  GetAssetInfoOptions,
  SignAssetUrlOptions,
  ViewerClaims,
} from "./CalmLensTypes";
import { encodePathSegment, transformSelector } from "./CalmLensUtils";
import { parseViewerClaims } from "./CalmLensViewerClaims";

// The CDN's paths (shared/CdnUtils), kept here so the SDK loads none of the shared runtime; the
// types keep them in step, and every SDK's surface test checks each resource's path.
const ASSET_RESOURCE_PATHS = {
  original: "original",
  rendered: "rendered",
  preview: "preview",
  placeholder: "placeholder",
  hls: "hls/index.m3u8",
  embed: "embed",
  info: "info",
} as const satisfies typeof SHARED_ASSET_RESOURCE_PATHS;

/** The prefix of an asset URL segment that names the asset by its external ID. */
const EXTERNAL_ID_SEGMENT_PREFIX = "ext:";

/** Every CDN resource beneath an asset URL, as `getAssetUrl` and `signAssetUrl` accept them. */
export const CDN_RESOURCES = Object.keys(ASSET_RESOURCE_PATHS) as CdnResource[];

const UNSELECTABLE: ReadonlySet<string> = new Set<(typeof SHARED_UNSELECTABLE)[number]>([
  "original",
  "hls",
  "embed",
  "placeholder",
  "info",
]);

/** A signed URL's lifetime when `expiresIn` is omitted: 15 minutes. */
export const DEFAULT_SIGNED_URL_EXPIRES_IN = 60 * 15;

/** The longest signed URL lifetime the API accepts: 24 hours. */
export const MAX_SIGNED_URL_EXPIRES_IN = 60 * 60 * 24;

/**
 * The asset segment of a CDN URL: the asset ID, or `ext:` and the URL-encoded external ID. Exactly
 * one of them must be given.
 */
export const getAssetSegment = (options: { assetId?: unknown; externalId?: unknown }): string => {
  const { assetId, externalId } = options;
  if ((assetId === undefined) === (externalId === undefined)) {
    throw invalidArgument("Pass either assetId or externalId");
  }
  if (assetId !== undefined) return encodePathSegment(assetId, "Asset ID");
  if (typeof externalId !== "string" || !externalId) {
    throw invalidArgument("External ID is required");
  }
  return `${EXTERNAL_ID_SEGMENT_PREFIX}${encodeURIComponent(externalId)}`;
};

/**
 * The viewer claims a URL carries: the region, and `ageConfirmed` only when true. Unconfirmed age
 * and no region are the CDN's defaults, left out so default URLs stay cacheable.
 */
export const toUrlViewerClaims = (claims: unknown): ViewerClaims | undefined => {
  if (claims === undefined) return undefined;
  const parsed = parseViewerClaims(claims);
  if (!parsed) throw invalidArgument("Invalid viewerClaims");
  const { region, ageConfirmed } = parsed;
  if (!region && ageConfirmed !== true) return undefined;
  return { ...(region ? { region } : {}), ...(ageConfirmed === true ? { ageConfirmed } : {}) };
};

/** The `?viewerClaims=` query of a URL with these claims, or an empty string for the defaults. */
export const viewerClaimsQuery = (claims: unknown): string => {
  const sent = toUrlViewerClaims(claims);
  return sent ? `?${new URLSearchParams({ viewerClaims: JSON.stringify(sent) })}` : "";
};

/**
 * Appends a resource, its `@lens` and transform selector, and the viewer claims to an asset URL
 * (public or signed). Without `resource` the URL stays the asset URL, which takes no selector.
 */
export const appendAssetLocation = (assetUrl: string, location: CdnAssetLocation): string => {
  const { resource, lens, transform, viewerClaims } = location;
  const selected = lens !== undefined || transform !== undefined;
  let path = assetUrl;
  if (resource === undefined) {
    if (selected) throw invalidArgument("A lens or transform needs a resource, such as rendered");
  } else {
    if (typeof resource !== "string" || !Object.hasOwn(ASSET_RESOURCE_PATHS, resource)) {
      throw invalidArgument(`resource must be one of ${CDN_RESOURCES.join(", ")}`);
    }
    if (UNSELECTABLE.has(resource) && selected) {
      throw invalidArgument(`The ${resource} resource takes no lens or transform`);
    }
    path = `${assetUrl}/${ASSET_RESOURCE_PATHS[resource]}`;
    const selector = transformSelector(transform);
    const parts = [
      ...(lens !== undefined ? [`@${encodePathSegment(lens, "Lens")}`] : []),
      // Structured options are already path-safe: unreserved characters, escapes, `=`, `,`, `.`.
      ...(selector ? [typeof transform === "string" ? encodeURI(selector) : selector] : []),
    ];
    if (parts.length) path = `${path}/${parts.join(",")}`;
  }
  return `${path}${viewerClaimsQuery(viewerClaims)}`;
};

/** An asset's public URL beneath a CDN base URL, with any resource, selector and claims. */
export const buildAssetUrl = (
  cdnBaseUrl: string,
  projectId: unknown,
  options: CdnAssetUrlOptions,
): string => {
  const { assetId, externalId, resource, lens, transform, viewerClaims } = options;
  const base = `${cdnBaseUrl.replace(/\/+$/, "")}/assets/${encodePathSegment(
    projectId,
    "Project ID",
  )}/${getAssetSegment({ assetId, externalId })}`;
  return appendAssetLocation(base, { resource, lens, transform, viewerClaims });
};

/** Checks `signAssetUrl`'s own options as the API does, before anything is sent. */
export const validateSignAssetUrlOptions = (options: SignAssetUrlOptions): void => {
  const { expiresIn, original } = options;
  if (
    expiresIn !== undefined &&
    (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_SIGNED_URL_EXPIRES_IN)
  ) {
    throw invalidArgument(
      `expiresIn must be a whole number from 1 to ${MAX_SIGNED_URL_EXPIRES_IN}`,
    );
  }
  if (original !== undefined && typeof original !== "boolean") {
    throw invalidArgument("original must be a boolean");
  }
  getAssetSegment(options);
  // The location is appended to the signed URL: check it before signing.
  appendAssetLocation("", options);
};

/** An asset URL without its query: the viewer claims it carried, if any, are returned apart. */
const splitAssetUrl = (url: string): { base: string; claims?: unknown } => {
  const [path = "", query] = url.split("?", 2) as [string, string | undefined];
  const base = path.replace(/\/+$/, "");
  const raw = query ? new URLSearchParams(query).get("viewerClaims") : null;
  if (raw === null) return { base };
  try {
    return { base, claims: JSON.parse(raw) };
  } catch {
    throw invalidArgument("The asset URL's viewerClaims are not JSON");
  }
};

const isAssetInfo = (value: unknown): value is AssetInfo => {
  if (!value || typeof value !== "object") return false;
  const info = value as Record<string, unknown>;
  return (
    typeof info.id === "string" &&
    typeof info.projectId === "string" &&
    typeof info.type === "string" &&
    !!info.content &&
    typeof info.content === "object" &&
    (info.availability === "available" ||
      info.availability === "age-restricted" ||
      info.availability === "unavailable")
  );
};

/**
 * The display info of an asset URL (public or signed): `{url}/info`, an allowlist of the asset's
 * public fields and whether this viewer can see it now (`availability`). Viewer claims come from
 * `viewerClaims`, else from the URL. A refusal throws `CalmLensError` with the CDN's code, such as
 * `signed-url/expired` or `asset/not-found`.
 */
export const getAssetInfo = async (
  url: string,
  options: GetAssetInfoOptions = {},
): Promise<AssetInfo> => {
  if (typeof url !== "string" || !URL.canParse(url)) {
    throw invalidArgument("url must be an absolute asset URL");
  }
  const { base, claims } = splitAssetUrl(url);
  const infoUrl = `${base}/info${viewerClaimsQuery(options.viewerClaims ?? claims)}`;
  const fetcher = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetcher(infoUrl, {
      headers: { Accept: "application/json" },
      signal: options.signal,
    });
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new CalmLensError(SDK_ERROR_CODES.TRANSPORT_ERROR, {
      message: "The asset's info could not be fetched",
      cause,
    });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) throw toHttpError(response, bytes);
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {}
  if (!isAssetInfo(data)) {
    throw new CalmLensError(SDK_ERROR_CODES.INVALID_RESPONSE, {
      message: "The CDN returned no asset info",
      status: response.status,
    });
  }
  return data;
};
