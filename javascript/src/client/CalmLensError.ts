import { API_ERROR_CODES, type ApiErrorCode } from "./CalmLensErrorCodes";

export type CalmLensErrorDetails = Record<string, unknown>;

/** Codes for failures the SDK detects itself, before or instead of an API error response. */
export const SDK_ERROR_CODES = {
  /** The request could not be completed: DNS, TLS, a refused or reset connection, a truncated body. */
  TRANSPORT_ERROR: "sdk/transport-error",
  /** The request did not finish within `timeoutMs`. */
  TIMEOUT: "sdk/timeout",
  /** The caller's `AbortSignal` cancelled the request. */
  CANCELLED: "sdk/cancelled",
  /** A successful response whose body is not the JSON the operation returns. */
  INVALID_RESPONSE: "sdk/invalid-response",
  /** An HTTP failure without a CalmLens error body, for example from a proxy. */
  HTTP_ERROR: "sdk/http-error",
  /** A response body larger than `maxResponseBytes`. */
  RESPONSE_TOO_LARGE: "sdk/response-too-large",
  /** A method argument is missing or invalid, for example an empty asset ID. */
  INVALID_ARGUMENT: "sdk/invalid-argument",
  /** The client options are invalid, for example a missing API key. */
  INVALID_CONFIG: "sdk/invalid-config",
  /** No `fetch` implementation is available in this runtime. */
  NO_FETCH: "sdk/no-fetch",
  /** A webhook delivery whose signature or timestamp did not verify. */
  INVALID_WEBHOOK_SIGNATURE: "sdk/invalid-webhook-signature",
  /** A verified webhook delivery whose body is not a webhook event. */
  INVALID_WEBHOOK_PAYLOAD: "sdk/invalid-webhook-payload",
} as const;

export type SdkErrorCode = (typeof SDK_ERROR_CODES)[keyof typeof SDK_ERROR_CODES];

/** Every error code the SDK can throw: the documented API codes and the SDK's own `sdk/*` codes. */
export const CALMLENS_ERROR_CODES = { ...API_ERROR_CODES, ...SDK_ERROR_CODES } as const;

/**
 * A known error code. API validation codes (`validation/*`) and codes added to the API after
 * this SDK version are still delivered as plain strings, so compare against `string`.
 */
export type CalmLensErrorCode = ApiErrorCode | SdkErrorCode;

export interface CalmLensErrorOptions {
  message?: string;
  status?: number;
  details?: CalmLensErrorDetails;
  cause?: unknown;
  /** The `X-Request-Id` response header. */
  requestId?: string;
  /** The response headers, when there was a response. */
  headers?: Headers;
  /** Seconds to wait before retrying, from the `Retry-After` response header. */
  retryAfter?: number;
}

const BRAND = Symbol.for("calmlens.sdk.CalmLensError");
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const RETRYABLE_CODES = new Set<string>([
  SDK_ERROR_CODES.TRANSPORT_ERROR,
  API_ERROR_CODES.IDEMPOTENT_REQUEST_IN_PROGRESS,
]);

/**
 * Every failure the SDK reports, whether the API returned an error or the request never
 * completed. Branch on `code`; `status`, `requestId`, `headers` and `retryAfter` describe the
 * HTTP response when there was one, and `cause` holds the underlying error.
 *
 * `instanceof CalmLensError` and `CalmLensError.isCalmLensError(value)` both recognise errors
 * from any copy of the SDK, so they work when ESM and CommonJS builds are loaded side by side.
 */
export class CalmLensError extends Error {
  /** A stable identifier such as `asset/not-found` or `sdk/timeout`. */
  readonly code: CalmLensErrorCode | (string & {});
  /** The HTTP status, when the API responded. */
  readonly status?: number;
  /** Structured diagnostics from the API, such as validation issues and `traceId`. */
  readonly details?: CalmLensErrorDetails;
  /** The `X-Request-Id` response header. Include it when you contact support. */
  readonly requestId?: string;
  /** The response headers, when the API responded. */
  readonly headers?: Headers;
  /** Seconds to wait before retrying, from the `Retry-After` response header. */
  readonly retryAfter?: number;

  constructor(
    code: CalmLensErrorCode | (string & {}) | { id: string; defaultMessage?: string },
    options: CalmLensErrorOptions = {},
  ) {
    const id = typeof code === "string" ? code : code.id;
    const defaultMessage = typeof code === "string" ? undefined : code.defaultMessage;
    super(`[calmlens] ${options.message ?? defaultMessage ?? id}`, { cause: options.cause });
    this.name = "CalmLensError";
    this.code = id;
    this.status = options.status;
    this.details = options.details;
    this.requestId = options.requestId;
    this.headers = options.headers;
    this.retryAfter = options.retryAfter;
    Object.defineProperty(this, BRAND, { value: true });
  }

  /** True for any `CalmLensError`, including one created by another copy or build of the SDK. */
  static isCalmLensError(value: unknown): value is CalmLensError {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as Record<symbol, unknown>)[BRAND] === true
    );
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return CalmLensError.isCalmLensError(value);
  }

  /** The resource does not exist or is not visible to this API key. */
  isNotFound(): boolean {
    return this.status === 404;
  }

  /**
   * Whether repeating the same request may succeed: transport failures, throttling (429),
   * gateway errors (502, 503, 504) and idempotent requests still in progress. Only repeat a
   * create or upload with the same `idempotencyKey`.
   */
  isRetryable(): boolean {
    return (
      RETRYABLE_CODES.has(this.code) ||
      (this.status !== undefined && RETRYABLE_STATUSES.has(this.status))
    );
  }
}

export const calmLensError = (
  code: CalmLensErrorCode | (string & {}) | { id: string; defaultMessage?: string },
  options?: CalmLensErrorOptions,
) => new CalmLensError(code, options);

export const invalidArgument = (message: string, details?: CalmLensErrorDetails) =>
  new CalmLensError(SDK_ERROR_CODES.INVALID_ARGUMENT, { message, details });

export const invalidConfig = (message: string) =>
  new CalmLensError(SDK_ERROR_CODES.INVALID_CONFIG, { message });
