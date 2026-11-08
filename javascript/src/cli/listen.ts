import { randomBytes } from "node:crypto";
import { newId } from "../contract/Ids.js";
import { CalmLensError, type EventsPage } from "../index";
import { createWebhookHeaders, toWebhookEventPayload } from "../testing";

type Event = EventsPage["items"][number];

// `calmlens listen`: polls the project's event feed and forwards each event to a local URL,
// signed and shaped exactly like a webhook delivery, so handlers can be built without a
// public HTTPS endpoint.

export interface EventSource {
  events: {
    list: (options: { cursor?: string; pageSize?: number }) => Promise<EventsPage>;
  };
}

export interface ListenOptions {
  client: EventSource;
  forwardTo: string;
  secret: string;
  /** Only forward these event types. Empty forwards everything. */
  eventTypes?: string[];
  intervalMs?: number;
  signal?: AbortSignal;
  log?: (line: string) => void;
  /**
   * Called once the starting cursor is fetched, i.e. the key and project were accepted, with the
   * requested event types (every type when none were requested) the key lacks the permission to
   * receive, which the feed never includes.
   */
  onReady?: (ready: { unavailableTypes: string[] }) => void;
  /** Waits between attempts of a failed delivery; defaults to `RETRY_DELAYS_MS`. */
  retryDelaysMs?: readonly number[];
  fetchImpl?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
}

export interface ForwardResult {
  ok: boolean;
  status?: number;
  error?: string;
  durationMs: number;
  /** Seconds from a `Retry-After` header on a `429` or `503` response. */
  retryAfterSeconds?: number;
}

const FORWARD_TIMEOUT_MS = 10_000;
/**
 * A failed delivery is retried like a real one, up to 7 attempts in all, but on a schedule
 * shortened for local development (about a minute overall instead of about 20 hours).
 */
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;
/** The longest wait a `Retry-After` header can ask for locally. */
const MAX_RETRY_AFTER_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;

/** Fatal errors stop the CLI instead of retrying: they need the user to change something. */
const FATAL_ERROR_CODES = new Set([
  "api-key/missing",
  "api-key/invalid",
  "api-key/project-mismatch",
  "project/not-found",
]);

export const createLocalSigningSecret = () => `whsec_local_${randomBytes(24).toString("hex")}`;

export const forwardEvent = async (
  event: Event,
  options: Pick<ListenOptions, "forwardTo" | "secret" | "fetchImpl"> & {
    /** Every attempt of one delivery shares its ID; a new delivery gets a new one. */
    deliveryId?: string;
  },
): Promise<ForwardResult> => {
  // Deliveries carry the event in the shape the feed lists it.
  const body = JSON.stringify(toWebhookEventPayload(event));
  const startedAt = Date.now();
  try {
    // Each attempt is signed again, with its own timestamp, as real deliveries are.
    const headers = await createWebhookHeaders({
      secret: options.secret,
      body,
      deliveryId: options.deliveryId ?? newId("dlv"),
    });
    const response = await (options.fetchImpl ?? fetch)(options.forwardTo, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    const retryAfter = Number(response.headers.get("retry-after"));
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      ...((response.status === 429 || response.status === 503) &&
      Number.isFinite(retryAfter) &&
      retryAfter > 0
        ? { retryAfterSeconds: retryAfter }
        : {}),
    };
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return {
      ok: false,
      error: cause ?? (error instanceof Error ? error.message : String(error)),
      durationMs: Date.now() - startedAt,
    };
  }
};

/** Network errors, timeouts, `408`, `425`, `429` and `5xx` are retried, as for real webhooks. */
export const isRetryable = (result: ForwardResult) =>
  !result.ok &&
  (result.status === undefined ||
    result.status === 408 ||
    result.status === 425 ||
    result.status === 429 ||
    result.status >= 500);

const formatTime = (date: Date) => date.toTimeString().slice(0, 8);

export const formatForwardLine = (
  event: Event,
  result: ForwardResult,
  now = new Date(),
  retry?: { attempt: number; attempts: number; delayMs?: number },
) => {
  const outcome = result.status
    ? `${result.status}${result.ok ? "" : " (handler returned an error)"}`
    : `failed: ${result.error}${result.error === "ECONNREFUSED" ? " (is your server running?)" : ""}`;
  const attempt =
    retry && retry.attempts > 1 && (retry.attempt > 1 || !result.ok)
      ? ` attempt ${retry.attempt} of ${retry.attempts}${
          retry.delayMs === undefined
            ? isRetryable(result)
              ? ", giving up"
              : ""
            : `, retrying in ${Math.round(retry.delayMs / 1000)}s`
        }`
      : "";
  return `${formatTime(now)}  ${event.type.padEnd(16)}  ${event.id}  → ${outcome} [${result.durationMs}ms]${attempt}`;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Delivers one event, retrying network errors, timeouts and retryable responses with backoff.
 * Every attempt has the same delivery ID and is signed again. Logs a line per attempt and
 * resolves with the last attempt's result, early if `signal` aborts.
 */
export const deliverEvent = async (
  event: Event,
  options: Pick<
    ListenOptions,
    "forwardTo" | "secret" | "fetchImpl" | "signal" | "log" | "retryDelaysMs"
  >,
): Promise<ForwardResult> => {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  const attempts = delays.length + 1;
  const deliveryId = newId("dlv");
  for (let attempt = 1; ; attempt++) {
    const result = await forwardEvent(event, { ...options, deliveryId });
    const baseDelay = delays[attempt - 1];
    const delayMs =
      isRetryable(result) && baseDelay !== undefined
        ? Math.max(baseDelay, Math.min(MAX_RETRY_AFTER_MS, (result.retryAfterSeconds ?? 0) * 1000))
        : undefined;
    log(formatForwardLine(event, result, new Date(), { attempt, attempts, delayMs }));
    if (delayMs === undefined || options.signal?.aborted) return result;
    await sleep(delayMs, options.signal);
    if (options.signal?.aborted) return result;
  }
};

/** The requested event types (every type when none are requested) the feed excludes. */
export const unavailableEventTypes = (
  excludedTypes: readonly string[],
  requested: ReadonlySet<string>,
): string[] =>
  requested.size ? excludedTypes.filter((type) => requested.has(type)) : [...excludedTypes];

/** The event types line: what is requested, minus what the key can't receive. */
export const describeEventTypes = (
  requested: string[] | undefined,
  unavailableTypes: string[],
): string => {
  const unavailable = new Set(unavailableTypes);
  if (!requested?.length)
    return unavailable.size
      ? "Event types: all this key can receive (see the warning below)"
      : "Event types: all";
  const receivable = requested.filter((type) => !unavailable.has(type));
  return `Event types: ${receivable.length ? receivable.join(", ") : "none this key can receive"}`;
};

export const unavailableWarning = (unavailableTypes: string[]): string =>
  [
    `Warning: this API key can't receive ${unavailableTypes.join(", ")}.`,
    "  The key lacks the permission these events need, so they won't be forwarded. Give the key",
    "  that permission on the API keys page of the CalmLens portal, or use a key that has it.",
    "",
  ].join("\n");

/**
 * The page with each asset's events in `assetSequence` order. The feed can list an event stored
 * a moment late after newer ones; each asset's events keep the places they had in the page, so
 * events about different assets keep their order.
 */
export const inAssetOrder = (events: readonly Event[]): Event[] => {
  const byAsset = new Map<string, Event[]>();
  for (const event of events)
    if (event.assetId) byAsset.set(event.assetId, [...(byAsset.get(event.assetId) ?? []), event]);
  for (const assetEvents of byAsset.values())
    assetEvents.sort((a, b) => (a.assetSequence ?? 0) - (b.assetSequence ?? 0));
  const next = new Map<string, number>();
  return events.map((event) => {
    if (!event.assetId) return event;
    const index = next.get(event.assetId) ?? 0;
    next.set(event.assetId, index + 1);
    return byAsset.get(event.assetId)![index]!;
  });
};

/**
 * Forwards new events until `signal` aborts. Resolves normally on abort; rejects with the
 * underlying error for fatal API errors (bad key, wrong project).
 */
export const listen = async (options: ListenOptions): Promise<void> => {
  const { client, signal } = options;
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const intervalMs = options.intervalMs ?? 2000;
  const eventTypes = new Set(options.eventTypes ?? []);

  const start = await client.events.list({});
  let cursor = start.nextCursor;
  options.onReady?.({ unavailableTypes: unavailableEventTypes(start.excludedTypes, eventTypes) });
  let failures = 0;

  while (!signal?.aborted) {
    try {
      const page = await client.events.list({ cursor, pageSize: 100 });
      if (failures > 0) log(`${formatTime(new Date())}  Reconnected to CalmLens.`);
      failures = 0;
      for (const event of inAssetOrder(page.items)) {
        if (eventTypes.size > 0 && !eventTypes.has(event.type)) continue;
        await deliverEvent(event, { ...options, log });
        if (signal?.aborted) return;
      }
      cursor = page.nextCursor;
      if (!page.hasMore) await sleep(intervalMs, signal);
    } catch (error) {
      if (error instanceof CalmLensError && FATAL_ERROR_CODES.has(error.code)) throw error;
      failures++;
      const backoffMs = Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** failures);
      if (failures === 1) {
        const message = error instanceof Error ? error.message : String(error);
        log(`${formatTime(new Date())}  Couldn't reach CalmLens (${message}). Retrying…`);
      }
      await sleep(backoffMs, signal);
    }
  }
};
