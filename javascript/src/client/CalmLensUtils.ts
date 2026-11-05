import { DOMAIN, normalizeUploadMimeType } from "../contract/SharedConstants.js";
import { CalmLensError, invalidArgument, invalidConfig, SDK_ERROR_CODES } from "./CalmLensError";
import { TRANSFORM_OPTIONS_SCHEMA } from "./CalmLensTransformSchema";
import type {
  Asset,
  BatchAssetsOptions,
  CalmLensAppClientOptions,
  CalmLensServerClientOptions,
  CdnResource,
  CdnTransform,
  ClassifyTextOptions,
  ConnectionOptions,
  GetAssetUrlOptions,
  ImageTransformOptions,
  SubmitAssetOptions,
  WaitForAssetDecisionOptions,
} from "./CalmLensTypes";
import {
  UPLOAD_MIME_PREFIXES,
  UPLOAD_MIME_REJECTED,
  UPLOAD_MIME_SUFFIXES,
  UPLOAD_MIME_TYPES,
} from "./CalmLensUploadMimeTypes";
import { parseViewerClaims } from "./CalmLensViewerClaims";

const assertHttpUrl = (name: string, value: string | undefined) => {
  if (value === undefined) return;
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {}
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw invalidConfig(`${name} must be an absolute http(s) URL`);
  }
};

const assertInteger = (name: string, value: number | undefined, minimum: number) => {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) {
    throw invalidConfig(
      minimum === 0
        ? `${name} must be a non-negative integer`
        : `${name} must be a positive integer`,
    );
  }
};

const configPathSegment = (value: unknown, name: string) => {
  try {
    encodePathSegment(value as string, name);
  } catch (error) {
    throw invalidConfig((error as CalmLensError).message.replace(/^\[calmlens\] /, ""));
  }
};

/** Checks the options both clients share: where requests go and how they're sent. */
const validateConnectionOptions = (options: ConnectionOptions) => {
  if ("requestBackend" in options) {
    throw invalidConfig(
      "requestBackend is no longer supported; pass a fetch implementation as fetch",
    );
  }
  validateRequestOptions(options);
  assertInteger("maxResponseBytes", options.maxResponseBytes, 1);
  const { partSizeBytes } = options;
  if (
    partSizeBytes !== undefined &&
    (!Number.isSafeInteger(partSizeBytes) ||
      partSizeBytes < 5 * 1024 * 1024 ||
      partSizeBytes > 64 * 1024 * 1024)
  ) {
    throw invalidConfig(
      "partSizeBytes must be an integer from 5 MiB (5242880) to 64 MiB (67108864)",
    );
  }
  for (const name of ["fetch", "uploadFetch"] as const) {
    if (options[name] !== undefined && typeof options[name] !== "function") {
      throw invalidConfig(`${name} must be a function`);
    }
  }
  assertHttpUrl("baseUrl", options.baseUrl);
};

/**
 * Checks server client options before the client sets anything up. `CalmLensServerClient` and
 * `MockCalmLensServerClient` share it so both reject the same configuration.
 */
export const validateServerClientOptions = (options: CalmLensServerClientOptions) => {
  if (!options || typeof options !== "object") throw invalidConfig("Client options are required");
  if (!options.apiKey || typeof options.apiKey !== "string") {
    throw invalidConfig("API key is required");
  }
  if (!options.projectId) throw invalidConfig("Project ID is required");
  configPathSegment(options.projectId, "Project ID");
  validateConnectionOptions(options);
  if (options.cdnFetch !== undefined && typeof options.cdnFetch !== "function") {
    throw invalidConfig("cdnFetch must be a function");
  }
  assertHttpUrl("cdnBaseUrl", options.cdnBaseUrl);
};

/** Checks app client options before the client sets anything up. */
export const validateAppClientOptions = (options: CalmLensAppClientOptions) => {
  if (!options || typeof options !== "object") throw invalidConfig("Client options are required");
  if ("apiKey" in options && options.apiKey !== undefined) {
    throw invalidConfig(
      "CalmLensAppClient never takes an API key, which anyone using the browser or app could read. Upload through uploadPresetId, and keep the API key in CalmLensServerClient on your server.",
    );
  }
  if (!options.uploadPresetId) throw invalidConfig("Upload preset ID is required");
  configPathSegment(options.uploadPresetId, "Upload preset ID");
  if (
    options.token !== undefined &&
    typeof options.token !== "string" &&
    typeof options.token !== "function"
  ) {
    throw invalidConfig("token must be a string or a function that returns one");
  }
  validateConnectionOptions(options);
};

/** Checks the options `withRequestOptions` accepts. */
export const validateRequestOptions = (options: {
  timeoutMs?: number;
  uploadTimeoutMs?: number;
  maxRetries?: number;
}) => {
  assertInteger("timeoutMs", options.timeoutMs, 1);
  assertInteger("uploadTimeoutMs", options.uploadTimeoutMs, 1);
  assertInteger("maxRetries", options.maxRetries, 0);
};

/**
 * Option keys of methods that send no request of their own, or that take keys of their own beside
 * a request's; CalmLensOptionKeys, generated from the API, has the rest.
 */
const LOCAL_OPTION_KEYS: Readonly<Record<string, readonly string[]>> = {
  "assets.waitForDecision": ["assetId", "signal", "timeoutMs"],
  "cdn.getAssetUrl": ["assetIdentifier", "lens", "resource", "transform", "viewerClaims"],
  "cdn.serve": ["assetIdentifier", "init", "lens", "resource", "transform", "viewerClaims"],
  "uploadTokens.sign": ["expiresInSeconds", "externalId", "uploadPresetId"],
};
/** Uploads also take an `idempotencyKey`, which the SDK sends as a header. */
const IDEMPOTENT_OPERATIONS = [
  "assets.create",
  "assets.classify",
  "assets.uploadPart",
  "text.classify",
];

/**
 * Throws `sdk/invalid-argument` for an option `operation` doesn't take, such as a misspelt key,
 * instead of silently dropping it. `apiKeys` is the client's generated table of the keys each
 * method sends to the API. Anything other than an object is left to the method's own checks.
 */
export const checkOptionKeys = (
  options: unknown,
  operation: string,
  apiKeys: Readonly<Record<string, readonly string[]>>,
) => {
  if (!options || typeof options !== "object" || Array.isArray(options)) return;
  const allowed = LOCAL_OPTION_KEYS[operation] ?? apiKeys[operation];
  if (!allowed) throw new Error(`No option keys for ${operation}`);
  const unknown = Object.keys(options).filter(
    (key) =>
      !allowed.includes(key) &&
      !(key === "idempotencyKey" && IDEMPOTENT_OPERATIONS.includes(operation)),
  );
  if (unknown.length) {
    throw invalidArgument(
      `Unknown option${unknown.length > 1 ? "s" : ""} for ${operation}: ${unknown.join(", ")}`,
      { operation, options: unknown },
    );
  }
};

export const toTextAssetOptions = ({
  text,
  name,
  ...options
}: ClassifyTextOptions): SubmitAssetOptions => {
  if (typeof text !== "string" || !text.trim())
    throw invalidArgument("Text to classify must be a non-empty string");
  return { ...options, name: name ?? "text", content: { plainText: text, type: "text/plain" } };
};

/**
 * A random UUID v4. React Native has no `crypto` global, so this falls back to
 * `crypto.getRandomValues` and then to `Math.random`; the SDK only uses it for idempotency keys,
 * which need to be unique rather than secret.
 */
export const randomUuid = (): string => {
  const crypto = (globalThis as { crypto?: Partial<Crypto> }).crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto?.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.random() * 256;
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * Encodes an identifier as one URL path segment. `.` and `..` are rejected because URL
 * resolution would treat them as relative segments and send the request to another route.
 */
export const encodePathSegment = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value) throw invalidArgument(`${name} is required`);
  if (value === "." || value === "..") throw invalidArgument(`${name} cannot be "." or ".."`);
  return encodeURIComponent(value);
};

/**
 * Whether the API accepts an upload of this MIME type: an image, audio, video, text, document or
 * website type, not a container such as `application/octet-stream`. It refuses any other type with
 * `upload/invalid-mime-type`.
 */
export const isAcceptedUploadMimeType = (mimeType: string): boolean => {
  const type = normalizeUploadMimeType(mimeType);
  if (UPLOAD_MIME_REJECTED.includes(type)) return false;
  return (
    UPLOAD_MIME_PREFIXES.some((prefix) => type.startsWith(prefix)) ||
    UPLOAD_MIME_SUFFIXES.some((suffix) => type.endsWith(suffix)) ||
    UPLOAD_MIME_TYPES.includes(type)
  );
};

const TRANSFORM_OPTION_NAME = /^[a-z][a-zA-Z0-9]*$/;
// <generated: image-transform-colours>
// Generated by packages/sdk-contract/generate.ts from IMAGE_TRANSFORM_OPTIONS_SCHEMA; do not edit.
// Options that hold colours, written as hex without `#` in a selector.
const TRANSFORM_COLOUR_KEYS = new Set(["background", "border.color", "trim.border.color"]);
// </generated: image-transform-colours>
const HEX_COLOUR = /^#((?:[0-9a-f]{3}){1,2}|(?:[0-9a-f]{4}){1,2})$/i;

/** Percent-encodes everything except RFC 3986 unreserved characters (`A-Z a-z 0-9 - . _ ~`). */
const encodeTransformComponent = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const appendTransformOptions = (pairs: string[], key: string, value: unknown): void => {
  if (value === undefined || value === null) return;
  if (isPlainObject(value)) {
    for (const child of Object.keys(value).sort()) {
      if (!TRANSFORM_OPTION_NAME.test(child)) {
        throw invalidArgument(`Transform option "${key}.${child}" is not a valid name`);
      }
      appendTransformOptions(pairs, `${key}.${child}`, value[child]);
    }
    return;
  }
  let text: string;
  if (typeof value === "string") {
    const hex = TRANSFORM_COLOUR_KEYS.has(key) ? HEX_COLOUR.exec(value) : null;
    text = hex ? hex[1].toLowerCase() : value;
  } else if (typeof value === "boolean") text = String(value);
  else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
  else
    throw invalidArgument(`Transform option "${key}" must be a string, number, boolean or object`);
  pairs.push(`${key}=${encodeTransformComponent(text)}`);
};

interface TransformRule {
  type?: string;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  oneOf?: readonly TransformRule[];
  properties?: Readonly<Record<string, TransformRule>>;
  required?: readonly string[];
}

const hasRuleType = (type: string | undefined, value: unknown): boolean => {
  switch (type) {
    case "object":
      return isPlainObject(value);
    case "string":
    case "boolean":
      return typeof value === type;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    default:
      return true;
  }
};

/**
 * Checks transform options against the image transform schema, as the CDN does, and returns the
 * dotted keys it doesn't know and those whose values it refuses (or that are required and missing).
 * `null` options are left out of a selector, so they are not checked.
 */
export const checkTransformOptions = (
  options: Record<string, unknown>,
): { unknownKeys: string[]; invalidKeys: string[] } => {
  const unknownKeys: string[] = [];
  const invalidKeys: string[] = [];
  const check = (schema: TransformRule, value: unknown, key: string): void => {
    const rule = schema.oneOf ? schema.oneOf.find(({ type }) => hasRuleType(type, value)) : schema;
    if (
      !rule ||
      !hasRuleType(rule.type, value) ||
      (rule.enum && !rule.enum.includes(value)) ||
      (rule.minimum !== undefined && (value as number) < rule.minimum) ||
      (rule.maximum !== undefined && (value as number) > rule.maximum)
    ) {
      invalidKeys.push(key);
      return;
    }
    if (rule.type !== "object") return;
    const object = value as Record<string, unknown>;
    const path = (name: string) => (key ? `${key}.${name}` : name);
    for (const name of rule.required ?? []) {
      if (object[name] === undefined || object[name] === null) invalidKeys.push(path(name));
    }
    for (const name of Object.keys(object).sort()) {
      if (object[name] === undefined || object[name] === null) continue;
      const child = rule.properties?.[name];
      if (child) check(child, object[name], path(name));
      else unknownKeys.push(path(name));
    }
  };
  check(TRANSFORM_OPTIONS_SCHEMA as TransformRule, options, "");
  return { unknownKeys, invalidKeys };
};

/**
 * Reads a CDN selector, the path segment after `/rendered` as sent (still percent-encoded), as the
 * CDN does (packages/shared/src/TransformSelector.ts): an optional first `@lens`, then `key=value`
 * options with dotted keys for nested ones (a bare key is `true`). Values are numbers, `true`,
 * `false`, hex colours (`#` added) for colour options, or text. Throws on anything the CDN refuses
 * as `asset/invalid-transform`. Used by the mock CDN.
 */
export const parseTransformSelector = (
  selector: string,
): { lens?: string; options?: Record<string, unknown> } => {
  if (!selector) return {};
  const fail = () => new Error(`Invalid transform selector "${selector}"`);
  if (selector.includes("/")) throw fail();
  const decode = (text: string) => {
    try {
      return decodeURIComponent(text);
    } catch {
      throw fail();
    }
  };
  const entries = selector.split(",");
  let lens: string | undefined;
  if (entries[0]!.startsWith("@")) {
    lens = decode(entries.shift()!.slice(1));
    if (!/^[a-z0-9-]{1,50}$/.test(lens)) throw fail();
  }
  if (!entries.length) return { lens };
  const options: Record<string, unknown> = {};
  for (const entry of entries) {
    if (!entry || entry.startsWith("@")) throw fail();
    const separator = entry.indexOf("=");
    const key = separator === -1 ? entry : entry.slice(0, separator);
    const parts = key.split(".");
    if (!parts.every((part) => TRANSFORM_OPTION_NAME.test(part))) throw fail();
    let value: unknown = true;
    if (separator !== -1) {
      const text = decode(entry.slice(separator + 1));
      if (text === "") throw fail();
      value =
        TRANSFORM_COLOUR_KEYS.has(key) && HEX_COLOUR.test(`#${text}`)
          ? `#${text.toLowerCase()}`
          : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)
            ? Number(text)
            : text === "true" || text === "false"
              ? text === "true"
              : text;
    }
    let target = options;
    for (const part of parts.slice(0, -1)) {
      const next = target[part];
      if (next !== undefined && !isPlainObject(next)) throw fail();
      target = (target[part] ??= {}) as Record<string, unknown>;
    }
    const last = parts.at(-1)!;
    if (last in target) throw fail();
    target[last] = value;
  }
  return { lens, options };
};

/** Throws `sdk/invalid-argument` naming each transform option the CDN would refuse. */
const assertTransformOptions = (options: Record<string, unknown>) => {
  const { unknownKeys, invalidKeys } = checkTransformOptions(options);
  if (!unknownKeys.length && !invalidKeys.length) return;
  const problems = [
    ...(unknownKeys.length
      ? [`unknown option${unknownKeys.length > 1 ? "s" : ""} ${unknownKeys.join(", ")}`]
      : []),
    ...(invalidKeys.length
      ? [`invalid value${invalidKeys.length > 1 ? "s" : ""} for ${invalidKeys.join(", ")}`]
      : []),
  ];
  throw invalidArgument(
    `Transform options are invalid: ${problems.join("; ")}. Pass the options themselves, such as { width: 640, format: "webp" }.`,
    { unknownKeys, invalidKeys },
  );
};

/**
 * Serializes structured transform options as a CDN selector, such as `fit=cover,width=640`. Option
 * keys are sorted so equal transforms share a URL, nested keys are dotted (`border.color`),
 * colours are hex without `#`, and values are percent-encoded.
 */
export const serializeTransform = (transform: ImageTransformOptions): string => {
  if (!isPlainObject(transform)) throw invalidArgument("Transform options must be an object");
  assertTransformOptions(transform);
  const pairs: string[] = [];
  for (const key of Object.keys(transform).sort()) {
    if (!TRANSFORM_OPTION_NAME.test(key)) {
      throw invalidArgument(`Transform option "${key}" is not a valid name`);
    }
    appendTransformOptions(pairs, key, (transform as Record<string, unknown>)[key]);
  }
  if (pairs.length === 0) throw invalidArgument("A transform needs at least one option");
  return pairs.join(",");
};

/** Returns the selector string the API and CDN accept for a string or structured transform. */
export const transformSelector = (transform: CdnTransform | undefined): string | undefined => {
  if (transform === undefined || typeof transform !== "string") {
    return transform === undefined ? undefined : serializeTransform(transform);
  }
  // A transform is one path segment of options: it must not add a segment, lens, query or fragment.
  if (/[/?#]/.test(transform) || transform.includes("..") || transform.startsWith("@")) {
    throw invalidArgument('Transform cannot contain "/", "..", "?" or "#", or start with "@"');
  }
  return transform;
};

export const DEFAULT_CDN_BASE_URL = `https://cdn.${DOMAIN}/v1`;

/** The CDN resources a signed URL can be created for, as the API accepts them. */
export const SIGNED_CDN_RESOURCES = ["original", "rendered", "preview"] as const;

const CDN_RESOURCES: ReadonlySet<string> = new Set<CdnResource>([
  ...SIGNED_CDN_RESOURCES,
  "placeholder",
]);

/** The resources that take no lens or transform: the exact upload and the public placeholder. */
const UNSELECTABLE_CDN_RESOURCES: ReadonlySet<string> = new Set<CdnResource>([
  "original",
  "placeholder",
]);

/** A signed URL's lifetime when `expiresInSeconds` is omitted: 15 minutes. */
export const DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 15;

/** The longest signed URL lifetime the API accepts: 24 hours. */
const MAX_SIGNED_URL_SECONDS = 60 * 60 * 24;

/** The most assets one `assets.batch` request takes. */
export const ASSET_BATCH_MAX_ASSETS = 500;
/** The operations `assets.batch` runs. */
export const ASSET_BATCH_OPERATIONS = ["delete", "remove-content"] as const;

/** Refuses a batch the API would reject for its size, an ID or the operation. */
export const validateBatchAssetsOptions = ({ assetIds, operation }: BatchAssetsOptions) => {
  if (!Array.isArray(assetIds) || assetIds.length < 1 || assetIds.length > ASSET_BATCH_MAX_ASSETS) {
    throw invalidArgument(`assetIds must list 1 to ${ASSET_BATCH_MAX_ASSETS} asset IDs`);
  }
  if (assetIds.some((assetId) => typeof assetId !== "string" || !assetId)) {
    throw invalidArgument("Every asset ID must be a non-empty string");
  }
  if (!(ASSET_BATCH_OPERATIONS as readonly unknown[]).includes(operation)) {
    throw invalidArgument(`operation must be one of ${ASSET_BATCH_OPERATIONS.join(", ")}`);
  }
};

/**
 * Checks signed URL options as the API does: the `original`, `rendered` and `preview` resources
 * are signed (a placeholder needs no signature), the original takes no lens or transform, and the
 * lifetime is a whole number of seconds from 1 to 24 hours.
 */
export const validateSignedUrlOptions = (options: {
  resource?: unknown;
  lens?: unknown;
  transform?: unknown;
  expiresInSeconds?: unknown;
}): void => {
  const { resource = "rendered", lens, transform, expiresInSeconds } = options;
  if (!(SIGNED_CDN_RESOURCES as readonly unknown[]).includes(resource)) {
    throw invalidArgument(
      `A signed URL's resource must be one of ${SIGNED_CDN_RESOURCES.join(", ")}`,
    );
  }
  if (resource === "original" && (lens !== undefined || transform !== undefined)) {
    throw invalidArgument("The original resource takes no lens or transform");
  }
  if (
    expiresInSeconds !== undefined &&
    (!Number.isInteger(expiresInSeconds) ||
      (expiresInSeconds as number) < 1 ||
      (expiresInSeconds as number) > MAX_SIGNED_URL_SECONDS)
  ) {
    throw invalidArgument("expiresInSeconds must be a whole number from 1 to 86400");
  }
};

/**
 * Builds an asset's CDN URL without a client: no API key and no request, so it works in browsers.
 * `CalmLensServerClient`'s `cdn.getAssetUrl` uses it too.
 *
 * `resource` is `rendered` (default: the displayable file, an image in the best format the browser
 * accepts, a PDF, or browser-safe video or audio), `original` (the exact upload), `preview` (a
 * still image for the asset) or `placeholder` (a small blurred PNG that the CDN serves publicly
 * for every asset whatever its visibility or moderation status, without requiring age
 * confirmation). Lenses and transforms apply to `preview`, and to `rendered` when it is an image;
 * the CDN refuses them on rendered PDFs, video and audio with `asset/invalid-transform`.
 */
export const getAssetUrl = ({
  projectId,
  assetIdentifier,
  cdnBaseUrl = DEFAULT_CDN_BASE_URL,
  resource = "rendered",
  ...options
}: GetAssetUrlOptions): string => {
  if (!CDN_RESOURCES.has(resource)) {
    throw invalidArgument(`resource must be one of ${[...CDN_RESOURCES].join(", ")}`);
  }
  if (
    UNSELECTABLE_CDN_RESOURCES.has(resource) &&
    (options.lens !== undefined || options.transform !== undefined)
  ) {
    throw invalidArgument(`The ${resource} resource takes no lens or transform`);
  }
  const url = `${cdnBaseUrl.replace(/\/+$/, "")}/assets/${encodePathSegment(projectId, "Project ID")}/${encodePathSegment(assetIdentifier, "Asset identifier")}/${resource}`;
  return appendCdnSelector(url, options);
};

/**
 * Appends a CDN lens (`/@name`) followed by any direct transform selector to an asset URL, and
 * optional JSON `viewerClaims` when supplied.
 */
export const appendCdnSelector = (
  url: string,
  options: {
    lens?: string;
    transform?: CdnTransform;
    viewerClaims?: { region?: string; ageConfirmed?: boolean };
  },
): string => {
  const path = appendCdnPathSelector(url, options);
  const query = new URLSearchParams();
  if (options.viewerClaims !== undefined) {
    const claims = parseViewerClaims(options.viewerClaims);
    if (!claims) throw invalidArgument("Invalid viewerClaims");
    query.set("viewerClaims", JSON.stringify(claims));
  }
  return query.size ? `${path}?${query}` : path;
};

const appendCdnPathSelector = (
  url: string,
  options: { lens?: string; transform?: CdnTransform },
): string => {
  const transform = transformSelector(options.transform);
  const selector = [
    ...(options.lens ? [`@${encodePathSegment(options.lens, "Lens")}`] : []),
    // Structured options are already path-safe: unreserved characters, escapes, `=`, `,`, `.`.
    ...(transform
      ? [typeof options.transform === "string" ? encodeURI(transform) : transform]
      : []),
  ].join(",");
  return selector ? `${url}/${selector}` : url;
};

const appendQueryValue = (parts: string[], key: string, value: unknown): void => {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) appendQueryValue(parts, `${key}[${index}]`, item);
    return;
  }
  if (typeof value === "object") {
    for (const [field, item] of Object.entries(value)) {
      appendQueryValue(parts, `${key}[${field}]`, item);
    }
    return;
  }
  parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
};

/**
 * Serialises a query object the way the API parses it (qs bracket notation), for example
 * `ordering[0][field]=createdAt&ordering[0][direction]=desc`. Every key and value is
 * percent-encoded and missing values are omitted.
 */
export const stringifyQuery = (query: Record<string, unknown>): string => {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) appendQueryValue(parts, key, value);
  return parts.join("&");
};

/**
 * Whether an asset has a moderation decision (`classification.moderation.status` is no longer
 * `pending`) or failed processing; `assets.waitForDecision` returns at the first such state.
 */
export const isAssetDecided = (asset: Pick<Asset, "classification">): boolean =>
  asset.classification.moderation.status !== "pending" || asset.classification.status === "failed";

export const DECISION_POLL_FIRST_DELAY_MS = 500;
export const DECISION_POLL_DELAY_FACTOR = 1.5;
export const DECISION_POLL_MAX_DELAY_MS = 2_000;
export const DEFAULT_DECISION_TIMEOUT_MS = 60_000;

/**
 * Retrieves an asset until it has a decision, waiting 0.5s between checks and 1.5 times longer
 * each time, up to 2s. Rejects with `sdk/timeout` once `timeoutMs` passes without one.
 */
export const pollForDecision = async (
  retrieve: () => Promise<Asset>,
  {
    timeoutMs = DEFAULT_DECISION_TIMEOUT_MS,
    signal,
  }: Pick<WaitForAssetDecisionOptions, "timeoutMs" | "signal">,
  sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>,
  now: () => number = Date.now,
): Promise<Asset> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw invalidArgument("timeoutMs must be a non-negative number");
  }
  const deadline = now() + timeoutMs;
  let delay = DECISION_POLL_FIRST_DELAY_MS;
  for (;;) {
    if (signal?.aborted) {
      throw new CalmLensError(SDK_ERROR_CODES.CANCELLED, { message: "Request cancelled" });
    }
    const asset = await retrieve();
    if (isAssetDecided(asset)) return asset;
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new CalmLensError(SDK_ERROR_CODES.TIMEOUT, {
        message: `Asset ${asset.id} had no moderation decision after ${timeoutMs}ms (processing ${asset.classification.status}, moderation ${asset.classification.moderation.status})`,
        details: {
          assetId: asset.id,
          classificationStatus: asset.classification.status,
          moderationStatus: asset.classification.moderation.status,
        },
      });
    }
    await sleep(Math.min(delay, remaining), signal);
    delay = Math.min(DECISION_POLL_MAX_DELAY_MS, delay * DECISION_POLL_DELAY_FACTOR);
  }
};
