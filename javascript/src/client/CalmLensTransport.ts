import { CalmLensError, MAX_ERROR_BODY_LENGTH, SDK_ERROR_CODES } from "./CalmLensError";
import { type CalmLensLogger, describeAttempt, type LogLevel } from "./CalmLensLogging";
import { withLastResponse } from "./CalmLensPagination";
import type { AppInfo, RequestAttempt } from "./CalmLensTypes";
import { getUserAgent, isBrowserRuntime } from "./CalmLensVersion";

/** Retry delays grow from this base, doubling per attempt, with jitter. */
export const RETRY_BASE_DELAY_MS = 500;
export const RETRY_MAX_DELAY_MS = 8_000;
/** A `Retry-After` longer than this is returned to the caller instead of waited out. */
export const RETRY_AFTER_MAX_MS = 60_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface TransportSettings {
  /** Absent for clients that upload through an upload preset. */
  apiKey?: string;
  fetch: typeof fetch;
  signal?: AbortSignal;
  maxRetries: number;
  maxResponseBytes: number;
  /** Replaces the wait between retries; mock clients wait without real time passing. */
  sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  /** Appended to the user agent. */
  appInfo?: AppInfo;
  /** Where attempts are logged, and how much. */
  logger?: CalmLensLogger;
  logLevel?: LogLevel;
  /** Called after every attempt. */
  onAttempt?: (attempt: RequestAttempt) => void;
  /** The clock attempt durations are measured with; mock clients pass their own. */
  now?: () => number;
}

export interface TransportRequest {
  /** The client method sending the request, such as `assets.retrieve`, for hooks and logs. */
  operation?: string;
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  /** Sent as `Idempotency-Key`; it also makes a POST safe to retry. */
  idempotencyKey?: string;
  /** Deadline per attempt in milliseconds, or undefined for none. */
  timeoutMs?: number;
  /** "body": the deadline covers reading the response body. "headers": it ends when headers arrive. */
  deadline: "body" | "headers";
  fetch?: typeof fetch;
  /** Extra fetch options, such as `cache`; credentials, redirects and signals stay the SDK's. */
  init?: RequestInit;
  /** Cancels this request, as well as the client's signal. */
  signal?: AbortSignal;
  /** Overrides the client's `maxRetries` for this request. */
  maxRetries?: number;
}

const timeoutReason = () => {
  const reason = new Error("The operation timed out.");
  reason.name = "TimeoutError";
  return reason;
};

/**
 * Links the callers' signals and a per-attempt deadline. `AbortSignal.any` holds its sources
 * weakly, so a long-lived caller signal doesn't collect a listener per streamed response;
 * runtimes without it get explicit listeners that `release` removes.
 */
const createAttemptSignal = (
  signals: Array<AbortSignal | undefined>,
  timeoutMs: number | undefined,
) => {
  const callers = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  const deadline = new AbortController();
  let timedOut = false;
  let signal: AbortSignal;
  let onAbort: ((event: Event) => void) | undefined;
  if (typeof AbortSignal.any === "function") {
    signal = AbortSignal.any([...callers, deadline.signal]);
  } else {
    const controller = new AbortController();
    signal = controller.signal;
    onAbort = (event: Event) => controller.abort((event.target as AbortSignal).reason);
    for (const source of [...callers, deadline.signal]) {
      if (source.aborted) controller.abort(source.reason);
      else source.addEventListener("abort", onAbort, { once: true });
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          deadline.abort(timeoutReason());
        }, timeoutMs);
  return {
    signal,
    isTimedOut: () => timedOut,
    isCancelled: () => callers.some((caller) => caller.aborted),
    clearDeadline: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
    release: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (onAbort) {
        for (const caller of callers) caller.removeEventListener("abort", onAbort);
      }
    },
  };
};

type AttemptSignal = ReturnType<typeof createAttemptSignal>;

/**
 * A redirect the SDK must not follow: it would send the API key to another origin. Browsers report
 * a manual redirect as an opaque response; other runtimes return the 3xx with its Location.
 */
const isRedirect = (response: Response) =>
  response.type === "opaqueredirect" ||
  (response.status >= 300 && response.status < 400 && response.headers.has("location"));

/** Turns anything thrown while sending or reading a request into a `CalmLensError`. */
const toFailure = (cause: unknown, attempt: AttemptSignal): CalmLensError => {
  if (CalmLensError.isCalmLensError(cause)) return cause;
  if (attempt.isCancelled()) {
    return new CalmLensError(SDK_ERROR_CODES.CANCELLED, { message: "Request cancelled", cause });
  }
  if (attempt.isTimedOut()) {
    return new CalmLensError(SDK_ERROR_CODES.TIMEOUT, { message: "Request timed out", cause });
  }
  return new CalmLensError(SDK_ERROR_CODES.TRANSPORT_ERROR, { message: "Request failed", cause });
};

export const sleep = (ms: number, signal: AbortSignal | undefined) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CalmLensError(SDK_ERROR_CODES.CANCELLED, { message: "Request cancelled" }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CalmLensError(SDK_ERROR_CODES.CANCELLED, { message: "Request cancelled" }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Exponential backoff with jitter: half the delay is fixed, the other half random. */
export const getRetryDelayMs = (attempt: number, random: () => number = Math.random): number => {
  const delay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
  return Math.round(delay / 2 + random() * (delay / 2));
};

/** Parses `Retry-After` as seconds or an HTTP date, in seconds from `now`. */
export const parseRetryAfter = (value: string | null, now = Date.now()): number | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
};

/** Bodies that can be sent again unchanged. Streams are consumed by the first attempt. */
const isReplayableBody = (body: BodyInit | null | undefined) =>
  body === undefined ||
  body === null ||
  typeof body === "string" ||
  body instanceof Blob ||
  body instanceof ArrayBuffer ||
  ArrayBuffer.isView(body) ||
  body instanceof URLSearchParams;

const isApiErrorPayload = (
  value: unknown,
): value is {
  code: string;
  message?: string;
  details?: Record<string, unknown>;
  requestId?: string;
} => !!value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string";

/** Reads at most `limit` bytes of a body, failing with `sdk/response-too-large` beyond that. */
const readBody = async (response: Response, limit: number): Promise<Uint8Array> => {
  const declared = Number(response.headers.get("content-length"));
  const tooLarge = () =>
    new CalmLensError(SDK_ERROR_CODES.RESPONSE_TOO_LARGE, {
      message: `Response body exceeds ${limit} bytes`,
      status: response.status,
      requestId: response.headers.get("x-request-id") ?? undefined,
      headers: response.headers,
    });
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const responseInfo = (response: Response) => ({
  status: response.status,
  requestId: response.headers.get("x-request-id") ?? undefined,
  headers: response.headers,
  retryAfter: parseRetryAfter(response.headers.get("retry-after")),
});

/** The `CalmLensError` for a non-2xx response whose body has been read. */
export const toHttpError = (response: Response, bytes: Uint8Array): CalmLensError => {
  // Only what the error keeps is decoded, so a large error page costs little.
  const body = new TextDecoder()
    .decode(bytes.subarray(0, MAX_ERROR_BODY_LENGTH * 4))
    .slice(0, MAX_ERROR_BODY_LENGTH);
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {}
  if (isApiErrorPayload(data)) {
    const { code, message, details, requestId } = data;
    const info = responseInfo(response);
    return new CalmLensError(code, {
      message: message ?? code,
      ...info,
      requestId: info.requestId ?? (typeof requestId === "string" ? requestId : undefined),
      details,
      body,
    });
  }
  return new CalmLensError(SDK_ERROR_CODES.HTTP_ERROR, {
    message: `HTTP ${response.status}`,
    ...responseInfo(response),
    body,
  });
};

/** A URL's path without its query, which can hold viewer claims, for hooks and logs. */
const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split(/[?#]/)[0] ?? "";
  }
};

/** Sends requests with the client's credentials, deadlines, retries and response limits. */
export class CalmLensTransport {
  private readonly sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>;

  constructor(private readonly settings: TransportSettings) {
    this.sleep = settings.sleep ?? sleep;
  }

  private headersFor(request: TransportRequest): Record<string, string> {
    const headers = new Headers(request.init?.headers);
    for (const [name, value] of Object.entries(request.headers ?? {})) headers.set(name, value);
    if (!headers.has("accept") && request.deadline === "body") {
      headers.set("accept", "application/json");
    }
    if (this.settings.apiKey) headers.set("x-api-key", this.settings.apiKey);
    // Browsers set their own User-Agent, and a custom one would need a CORS preflight.
    if (!isBrowserRuntime()) headers.set("user-agent", getUserAgent(this.settings.appInfo));
    if (request.idempotencyKey) headers.set("idempotency-key", request.idempotencyKey);
    return Object.fromEntries(headers.entries());
  }

  /** Waits before a retry. Either the client's or the request's signal cancels the wait. */
  private async backoff(ms: number, request: TransportRequest) {
    const callers = createAttemptSignal(this.signalsFor(request), undefined);
    try {
      await this.sleep(ms, callers.signal);
    } finally {
      callers.release();
    }
  }

  private signalsFor(request: TransportRequest) {
    return [this.settings.signal, request.signal, request.init?.signal ?? undefined];
  }

  private maxRetriesFor(request: TransportRequest) {
    return request.maxRetries ?? this.settings.maxRetries;
  }

  /** Tells the hook and the logger how an attempt went. Neither ever sees a key or a body. */
  private report(attempt: RequestAttempt) {
    const { onAttempt, logger, logLevel } = this.settings;
    try {
      onAttempt?.(attempt);
    } catch {
      // A failing hook must not fail the request.
    }
    if (!logger || !logLevel || logLevel === "off") return;
    const failed = attempt.status === null || attempt.status >= 400;
    if (logLevel === "debug") logger.debug(describeAttempt(attempt));
    else if (attempt.delayMs !== null || failed) logger.info(describeAttempt(attempt));
  }

  private canRetry(request: TransportRequest) {
    return (
      this.maxRetriesFor(request) > 0 &&
      (request.method === "GET" || request.method === "HEAD" || !!request.idempotencyKey) &&
      isReplayableBody(request.body)
    );
  }

  /**
   * Sends a request and returns the response, retrying transport failures, timeouts, 429, 500, 502–504 and
   * `idempotency/request-in-progress` when the request is safe to repeat. Non-2xx responses
   * throw unless `allowHttpErrors` is set. Call `release` once the body has been read.
   */
  async send(
    request: TransportRequest,
    { allowHttpErrors = false }: { allowHttpErrors?: boolean } = {},
  ): Promise<{ response: Response; attempt: AttemptSignal }> {
    const fetchImpl = request.fetch ?? this.settings.fetch;
    const retryable = this.canRetry(request);
    const headers = this.headersFor(request);
    const now = this.settings.now ?? Date.now;
    const path = pathOf(request.url);
    for (let attemptNumber = 0; ; attemptNumber++) {
      const canRetryAgain = retryable && attemptNumber < this.maxRetriesFor(request);
      const attempt = createAttemptSignal(this.signalsFor(request), request.timeoutMs);
      const started = now();
      const report = (
        outcome: { response?: Response; error?: CalmLensError },
        delayMs: number | null,
      ) =>
        this.report({
          operation: request.operation ?? null,
          method: request.method,
          path,
          attempt: attemptNumber + 1,
          delayMs,
          status: outcome.response?.status ?? outcome.error?.status ?? null,
          requestId:
            outcome.response?.headers.get("x-request-id") ?? outcome.error?.requestId ?? null,
          durationMs: Math.max(0, now() - started),
          errorCode: outcome.error?.code ?? null,
        });
      let response: Response;
      try {
        // Not `throwIfAborted()`: React Native's AbortSignal doesn't have it.
        if (attempt.signal.aborted) throw attempt.signal.reason;
        response = await fetchImpl(request.url, {
          ...request.init,
          method: request.method,
          headers,
          body: request.body,
          // Cloudflare Workers reject `redirect: "error"`, so redirects are refused below instead.
          redirect: "manual",
          signal: attempt.signal,
          duplex: "half",
        } as RequestInit);
        if (isRedirect(response)) {
          await response.body?.cancel().catch(() => {});
          // An HTTP failure like any other non-2xx: repeating the request redirects again.
          throw new CalmLensError(SDK_ERROR_CODES.HTTP_ERROR, {
            message: `Unexpected redirect (HTTP ${response.status})`,
            ...responseInfo(response),
            // Browsers hide a manual redirect's status, reporting 0.
            status: response.status || undefined,
          });
        }
      } catch (cause) {
        attempt.release();
        const failure = toFailure(cause, attempt);
        // Transport failures and timeouts; a cancellation is never retried.
        if (canRetryAgain && failure.isRetryable()) {
          const delayMs = getRetryDelayMs(attemptNumber);
          report({ error: failure }, delayMs);
          await this.backoff(delayMs, request);
          continue;
        }
        report({ error: failure }, null);
        throw failure;
      }
      if (request.deadline === "headers") attempt.clearDeadline();
      if (response.ok) {
        report({ response }, null);
        return { response, attempt };
      }
      if (allowHttpErrors) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const delayMs =
          retryAfter !== undefined ? retryAfter * 1000 : getRetryDelayMs(attemptNumber);
        if (
          !canRetryAgain ||
          !RETRYABLE_STATUSES.has(response.status) ||
          delayMs > RETRY_AFTER_MAX_MS
        ) {
          report({ response }, null);
          return { response, attempt };
        }
        report({ response }, delayMs);
        attempt.release();
        await response.body?.cancel().catch(() => {});
        await this.backoff(delayMs, request);
        continue;
      }

      let error: CalmLensError;
      try {
        error = toHttpError(response, await readBody(response, this.settings.maxResponseBytes));
      } catch (cause) {
        error = toFailure(cause, attempt);
      } finally {
        attempt.release();
      }
      const retryDelayMs =
        error.retryAfter !== undefined ? error.retryAfter * 1000 : getRetryDelayMs(attemptNumber);
      const shouldRetry =
        canRetryAgain && retryDelayMs <= RETRY_AFTER_MAX_MS && error.isRetryable();
      if (shouldRetry) {
        report({ error }, retryDelayMs);
        await this.backoff(retryDelayMs, request);
        continue;
      }
      report({ error }, null);
      throw error;
    }
  }

  /**
   * Sends a request and parses its JSON response body. An object or array result carries the
   * response's status, request ID and headers as its non-enumerable `lastResponse`.
   */
  async json<T>(request: TransportRequest): Promise<T> {
    const { response, attempt } = await this.send(request);
    try {
      const bytes = await readBody(response, this.settings.maxResponseBytes);
      if (bytes.byteLength === 0 && (response.status === 204 || request.method === "DELETE")) {
        return undefined as T;
      }
      let data: T;
      try {
        data = JSON.parse(new TextDecoder().decode(bytes)) as T;
      } catch (cause) {
        throw new CalmLensError(SDK_ERROR_CODES.INVALID_RESPONSE, {
          message: `Invalid JSON response (HTTP ${response.status})`,
          ...responseInfo(response),
          cause,
        });
      }
      return withLastResponse(data, {
        status: response.status,
        requestId: response.headers.get("x-request-id") ?? undefined,
        headers: response.headers,
        idempotencyKey: request.idempotencyKey,
      });
    } catch (cause) {
      throw toFailure(cause, attempt);
    } finally {
      attempt.release();
    }
  }
}
