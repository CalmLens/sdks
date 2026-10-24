import { DOMAIN } from "../contract/SharedConstants.js";
import { CalmLensError, invalidArgument, invalidConfig, SDK_ERROR_CODES } from "./CalmLensError";
import { API_ERROR_CODES } from "./CalmLensErrorCodes";
import type {
  Asset,
  CalmLensAppClientOptions,
  CalmLensServerClientOptions,
  CdnResource,
  CdnTransform,
  ClassifyTextOptions,
  ConnectionOptions,
  GetAssetUrlOptions,
  LensTransform,
  SubmitAssetOptions,
  WaitForAssetDecisionOptions,
} from "./CalmLensTypes";

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

export const toTextAssetOptions = ({
  text,
  name,
  ...options
}: ClassifyTextOptions): SubmitAssetOptions => {
  if (typeof text !== "string" || !text.trim())
    throw new CalmLensError(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, {
      message: "Text to classify must be a non-empty string",
    });
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

const TRANSFORM_TYPE_PATTERN = /^[A-Za-z0-9_]+$/;

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
      appendTransformOptions(pairs, `${key}[${child}]`, value[child]);
    }
    return;
  }
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "boolean") text = String(value);
  else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
  else
    throw invalidArgument(`Transform option "${key}" must be a string, number, boolean or object`);
  pairs.push(`${encodeTransformComponent(key)}=${encodeTransformComponent(text)}`);
};

/**
 * Serializes structured transforms as a CDN selector, such as
 * `imageTransform[format=png,width=1024]`. Option keys are sorted so equal transforms share a
 * URL; nested keys (`border[color]`) and values are percent-encoded.
 */
export const serializeTransform = (transform: LensTransform | LensTransform[]): string => {
  const steps = Array.isArray(transform) ? transform : [transform];
  if (steps.length === 0) throw invalidArgument("Transform needs at least one step");
  return steps
    .map((step) => {
      if (!isPlainObject(step)) throw invalidArgument("Transform steps must be objects");
      if (typeof step.type !== "string" || !TRANSFORM_TYPE_PATTERN.test(step.type)) {
        throw invalidArgument("Transform type must contain only letters, digits and underscores");
      }
      if (step.options !== undefined && step.options !== null && !isPlainObject(step.options)) {
        throw invalidArgument("Transform options must be an object");
      }
      const pairs: string[] = [];
      for (const key of Object.keys(step.options ?? {}).sort()) {
        appendTransformOptions(pairs, key, (step.options as Record<string, unknown>)[key]);
      }
      return `${step.type}[${pairs.join(",")}]`;
    })
    .join(",");
};

/** Returns the selector string the API and CDN accept for a string or structured transform. */
export const transformSelector = (transform: CdnTransform | undefined): string | undefined =>
  transform === undefined || typeof transform === "string"
    ? transform
    : serializeTransform(transform);

export const DEFAULT_CDN_BASE_URL = `https://cdn.${DOMAIN}/v1`;

const CDN_RESOURCES: ReadonlySet<string> = new Set<CdnResource>([
  "content",
  "preview",
  "placeholder",
]);

/**
 * Builds an asset's CDN URL without a client: no API key and no request, so it works in browsers.
 * `CalmLensServerClient`'s `cdn.getAssetUrl` uses it too.
 *
 * `resource` is `content` (default), `preview` or `placeholder`. A placeholder is a small blurred
 * PNG that the CDN serves for public assets whatever their moderation status, so it takes no
 * lens, transform or `ageRestricted`.
 */
export const getAssetUrl = ({
  projectId,
  assetIdentifier,
  cdnBaseUrl = DEFAULT_CDN_BASE_URL,
  resource = "content",
  ...options
}: GetAssetUrlOptions): string => {
  if (!CDN_RESOURCES.has(resource)) {
    throw invalidArgument("resource must be content, preview or placeholder");
  }
  if (
    resource === "placeholder" &&
    (options.lens !== undefined || options.transform !== undefined || options.ageRestricted)
  ) {
    throw invalidArgument("A placeholder takes no lens, transform or ageRestricted");
  }
  if (options.ageRestricted !== undefined && typeof options.ageRestricted !== "boolean") {
    throw invalidArgument("ageRestricted must be true or false");
  }
  const url = `${cdnBaseUrl.replace(/\/+$/, "")}/assets/${encodePathSegment(projectId, "Project ID")}/${encodePathSegment(assetIdentifier, "Asset identifier")}/${resource}`;
  return appendCdnSelector(url, options);
};

/**
 * Appends a CDN lens (`/@name`) followed by any direct transform selector to an asset URL, and
 * `?ageRestricted=true` when requested.
 */
export const appendCdnSelector = (
  url: string,
  options: { lens?: string; transform?: CdnTransform; ageRestricted?: boolean },
): string => {
  const path = appendCdnPathSelector(url, options);
  return options.ageRestricted ? `${path}?ageRestricted=true` : path;
};

const appendCdnPathSelector = (
  url: string,
  options: { lens?: string; transform?: CdnTransform },
): string => {
  if (options.lens) {
    url = `${url}/@${encodePathSegment(options.lens, "Lens")}`;
  }
  if (!options.transform) {
    return url;
  }
  if (typeof options.transform !== "string") {
    // Already path-safe: unreserved characters, percent escapes, brackets, `=` and `,`.
    return `${url}${options.lens ? "," : "/"}${serializeTransform(options.transform)}`;
  }
  const transform = options.transform.replace(/^\/+/, "");
  // A transform keeps its own path separators, so it must not move up a path or add a query/fragment.
  if (transform.includes("..") || transform.includes("?") || transform.includes("#")) {
    throw invalidArgument('Transform cannot contain "..", "?" or "#"');
  }
  // The CDN matches literal `type[...]` brackets, which `encodeURI` would escape.
  return `${url}${options.lens ? "," : "/"}${encodeURI(transform).replace(/%5B/g, "[").replace(/%5D/g, "]")}`;
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
 * `ordering[0][field]=createdAt&ordering[0][direction]=DESC`. Every key and value is
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

const DECISION_POLL_FIRST_DELAY_MS = 500;
const DECISION_POLL_MAX_DELAY_MS = 5_000;
export const DEFAULT_DECISION_TIMEOUT_MS = 60_000;

/**
 * Retrieves an asset until it has a decision, waiting 0.5s between checks and 1.5 times longer
 * each time, up to 5s. Rejects with `sdk/timeout` once `timeoutMs` passes without one.
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
    delay = Math.min(DECISION_POLL_MAX_DELAY_MS, delay * 1.5);
  }
};
