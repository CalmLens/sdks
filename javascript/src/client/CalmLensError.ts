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
  /** An HTTP failure without a CalmLens error body, for example from a proxy, or a redirect. */
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
 * A known error code. Codes added to the API after this SDK version are still delivered as plain
 * strings, so compare against `string` and fall back to the HTTP status.
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
  /** The response body as text, cut to its first 4 KiB, for API errors. */
  body?: string;
}

/**
 * What went wrong, from the most general: every kind is also its parent kind (`not-found` is an
 * `api` error, `configuration` an `invalid-argument` error). Each has its own error class.
 */
export type CalmLensErrorKind =
  | "error"
  | "api"
  | "bad-request"
  | "authentication"
  | "permission-denied"
  | "not-found"
  | "conflict"
  | "payload-too-large"
  | "unprocessable-entity"
  | "rate-limit"
  | "server"
  | "connection"
  | "timeout"
  | "cancelled"
  | "invalid-argument"
  | "configuration"
  | "invalid-response"
  | "webhook-verification";

const KIND_PARENTS: Record<CalmLensErrorKind, CalmLensErrorKind | null> = {
  error: null,
  api: "error",
  "bad-request": "api",
  authentication: "api",
  "permission-denied": "api",
  "not-found": "api",
  conflict: "api",
  "payload-too-large": "api",
  "unprocessable-entity": "api",
  "rate-limit": "api",
  server: "api",
  connection: "error",
  timeout: "error",
  cancelled: "error",
  "invalid-argument": "error",
  configuration: "invalid-argument",
  "invalid-response": "error",
  "webhook-verification": "error",
};

const STATUS_KINDS: Partial<Record<number, CalmLensErrorKind>> = {
  400: "bad-request",
  401: "authentication",
  403: "permission-denied",
  404: "not-found",
  409: "conflict",
  413: "payload-too-large",
  422: "unprocessable-entity",
  429: "rate-limit",
};

/** The kinds of the SDK's own codes, whatever the status. */
const CODE_KINDS: Partial<Record<string, CalmLensErrorKind>> = {
  "sdk/transport-error": "connection",
  "sdk/timeout": "timeout",
  "sdk/cancelled": "cancelled",
  "sdk/invalid-response": "invalid-response",
  "sdk/response-too-large": "invalid-response",
  "sdk/invalid-argument": "invalid-argument",
  "sdk/invalid-config": "configuration",
  "sdk/no-fetch": "configuration",
  "sdk/invalid-webhook-signature": "webhook-verification",
  "sdk/invalid-webhook-payload": "webhook-verification",
};

/**
 * The kind of an error with `code` and `status`: the SDK's own codes by code; any other error by
 * its HTTP status when the API answered (`api` for a status without a kind of its own, or a
 * hidden one); and an error the SDK raised before sending, such as `upload/unsupported-type`, as
 * `invalid-argument`.
 */
export const errorKindOf = (code: string, status: number | undefined): CalmLensErrorKind => {
  const byCode = CODE_KINDS[code];
  if (byCode) return byCode;
  // A response whose status the runtime hides, such as a redirect in a browser, is still an
  // answer; any other error without one was raised before sending.
  if (status === undefined) return code === "sdk/http-error" ? "api" : "invalid-argument";
  if (status >= 500) return "server";
  return STATUS_KINDS[status] ?? "api";
};

/** Whether `kind` is `ancestor` or one of its descendants. */
export const isErrorKind = (kind: CalmLensErrorKind, ancestor: CalmLensErrorKind): boolean => {
  for (let current: CalmLensErrorKind | null = kind; current; current = KIND_PARENTS[current]) {
    if (current === ancestor) return true;
  }
  return false;
};

/** The longest API error body an error keeps. */
export const MAX_ERROR_BODY_LENGTH = 4096;

const BRAND = Symbol.for("calmlens.sdk.CalmLensError");
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set<string>([
  SDK_ERROR_CODES.TRANSPORT_ERROR,
  SDK_ERROR_CODES.TIMEOUT,
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
  /** The kind this class is for; each kind's class sets its own. */
  static readonly kind: CalmLensErrorKind = "error";
  /** What went wrong: one of `CalmLensErrorKind`, also its ancestors' (see `isKind`). */
  readonly kind!: CalmLensErrorKind;
  /** The response body as text, cut to its first 4 KiB, for an API error; a proxy's HTML stays visible. */
  readonly body?: string;
  /** A stable identifier such as `asset/not-found` or `sdk/timeout`. */
  readonly code!: CalmLensErrorCode | (string & {});
  /** The HTTP status, when the API responded. */
  readonly status?: number;
  /** Structured diagnostics from the API, such as validation issues. */
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
    const kind = errorKindOf(id, options.status);
    // `new CalmLensError(...)` makes the error its kind's class, so `instanceof` works however
    // an error was made.
    if (new.target === CalmLensError) {
      const KindClass = ERROR_CLASSES[kind];
      // biome-ignore lint/correctness/noConstructorReturn: an error is always its kind's class.
      if (KindClass !== CalmLensError) return new KindClass(code, options);
    }
    this.name = (new.target as { name: string }).name;
    this.kind = kind;
    this.body = options.body?.slice(0, MAX_ERROR_BODY_LENGTH);
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

  /**
   * `error instanceof CalmLensNotFoundError` (or any kind's class) is true for errors of that kind
   * and its descendants, from any copy of the SDK.
   */
  static [Symbol.hasInstance](this: { kind: CalmLensErrorKind }, value: unknown): boolean {
    if (!CalmLensError.isCalmLensError(value)) return false;
    // `this` is the class `instanceof` names, so each kind's class checks its own kind.
    // biome-ignore lint/complexity/noThisInStatic: CalmLensError.kind would always be "error".
    const expected = this.kind;
    // Every error is a CalmLensError, including one from a copy that predates kinds.
    if (expected === "error") return true;
    const { kind } = value as CalmLensError;
    return kind in KIND_PARENTS && isErrorKind(kind, expected);
  }

  /** Whether this error is of `kind` or a kind beneath it, such as `api` for a `not-found` error. */
  isKind(kind: CalmLensErrorKind): boolean {
    return isErrorKind(this.kind, kind);
  }

  /**
   * Whether the SDK raised this error itself, with no HTTP response: before sending (an invalid
   * argument or option, or content it checks first, such as `upload/unsupported-type`), or because
   * no response arrived (a timeout, a cancellation or a connection failure). The code is the one
   * the API would use; there is no `status` or `requestId`, so branch on `code`.
   */
  isLocal(): boolean {
    return this.status === undefined;
  }

  /** The resource does not exist or is not visible to this API key. */
  isNotFound(): boolean {
    return this.status === 404;
  }

  /**
   * Whether repeating the same request may succeed: transport failures, timeouts (a request's
   * `timeoutMs` or `waitForDecision`'s deadline), throttling (429), internal and gateway errors (500, 502, 503, 504)
   * and idempotent requests still in progress. Only repeat a create or upload with the same
   * `idempotencyKey`.
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

/** The API, or a proxy in front of it, answered with a non-2xx status. */
export class CalmLensApiError extends CalmLensError {
  static override readonly kind: CalmLensErrorKind = "api";
}
/** HTTP 400: the request was invalid. */
export class CalmLensBadRequestError extends CalmLensApiError {
  static override readonly kind: CalmLensErrorKind = "bad-request";
}
/** HTTP 401: the API key is missing or invalid. */
export class CalmLensAuthenticationError extends CalmLensApiError {
  static override readonly kind: CalmLensErrorKind = "authentication";
}
/** HTTP 403: the API key lacks a grant, or the viewer can't see the asset. */
export class CalmLensPermissionDeniedError extends CalmLensApiError {
  static override readonly kind: CalmLensErrorKind = "permission-denied";
}
/** HTTP 404: the resource doesn't exist or isn't visible to the API key. */
export class CalmLensNotFoundError extends CalmLensApiError {
  static override readonly kind: CalmLensErrorKind = "not-found";
}
/** HTTP 409: the request conflicts with the resource's state, such as a changed revision. */
export class CalmLensConflictError extends CalmLensApiError {
  static override readonly kind: CalmLensErrorKind = "conflict";
}
/** HTTP 413: the content is over a size limit. */
export class CalmLensPayloadTooLargeError extends CalmLensApiError {
  static override readonly kind: CalmLensErrorKind = "payload-too-large";
}
/** HTTP 422: the content can't be processed. */
export class CalmLensUnprocessableEntityError extends CalmLensApiError {
  static override readonly kind: CalmLensErrorKind = "unprocessable-entity";
}
/** HTTP 429: too many requests; `retryAfter` says how long to wait. */
export class CalmLensRateLimitError extends CalmLensApiError {
  static override readonly kind: CalmLensErrorKind = "rate-limit";
}
/** HTTP 500 or above: the API failed. */
export class CalmLensServerError extends CalmLensApiError {
  static override readonly kind: CalmLensErrorKind = "server";
}
/** No complete response: the connection failed or was cut (`sdk/transport-error`). */
export class CalmLensConnectionError extends CalmLensError {
  static override readonly kind: CalmLensErrorKind = "connection";
}
/** A request took longer than its timeout, or a wait reached its deadline (`sdk/timeout`). */
export class CalmLensTimeoutError extends CalmLensError {
  static override readonly kind: CalmLensErrorKind = "timeout";
}
/** The caller cancelled the call through a signal (`sdk/cancelled`). */
export class CalmLensCancelledError extends CalmLensError {
  static override readonly kind: CalmLensErrorKind = "cancelled";
}
/** The SDK refused the call before sending anything. */
export class CalmLensInvalidArgumentError extends CalmLensError {
  static override readonly kind: CalmLensErrorKind = "invalid-argument";
}
/** The client's configuration is invalid (`sdk/invalid-config`, `sdk/no-fetch`). */
export class CalmLensConfigurationError extends CalmLensInvalidArgumentError {
  static override readonly kind: CalmLensErrorKind = "configuration";
}
/** A response wasn't what the operation returns (`sdk/invalid-response`, `sdk/response-too-large`). */
export class CalmLensInvalidResponseError extends CalmLensError {
  static override readonly kind: CalmLensErrorKind = "invalid-response";
}
/** A webhook delivery couldn't be verified or parsed. */
export class CalmLensWebhookVerificationError extends CalmLensError {
  static override readonly kind: CalmLensErrorKind = "webhook-verification";
}

/** Each kind's class. */
export const ERROR_CLASSES: Record<CalmLensErrorKind, typeof CalmLensError> = {
  error: CalmLensError,
  api: CalmLensApiError,
  "bad-request": CalmLensBadRequestError,
  authentication: CalmLensAuthenticationError,
  "permission-denied": CalmLensPermissionDeniedError,
  "not-found": CalmLensNotFoundError,
  conflict: CalmLensConflictError,
  "payload-too-large": CalmLensPayloadTooLargeError,
  "unprocessable-entity": CalmLensUnprocessableEntityError,
  "rate-limit": CalmLensRateLimitError,
  server: CalmLensServerError,
  connection: CalmLensConnectionError,
  timeout: CalmLensTimeoutError,
  cancelled: CalmLensCancelledError,
  "invalid-argument": CalmLensInvalidArgumentError,
  configuration: CalmLensConfigurationError,
  "invalid-response": CalmLensInvalidResponseError,
  "webhook-verification": CalmLensWebhookVerificationError,
};
