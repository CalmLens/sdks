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
  fetchImpl?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
}

export interface ForwardResult {
  ok: boolean;
  status?: number;
  error?: string;
  durationMs: number;
}

const FORWARD_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

/** Fatal errors stop the CLI instead of retrying: they need the user to change something. */
const FATAL_ERROR_CODES = new Set([
  "auth/missing-token",
  "auth/invalid-api-key",
  "auth/project-mismatch",
  "project/not-found",
]);

export const createLocalSigningSecret = () => `whsec_local_${randomBytes(24).toString("hex")}`;

export const forwardEvent = async (
  event: Event,
  options: Pick<ListenOptions, "forwardTo" | "secret" | "fetchImpl">,
): Promise<ForwardResult> => {
  // Deliveries carry the event in the shape the feed lists it.
  const body = JSON.stringify(toWebhookEventPayload(event));
  const startedAt = Date.now();
  try {
    const headers = await createWebhookHeaders({
      secret: options.secret,
      body,
      // Each forward is its own delivery, with an ID shaped like a real one.
      deliveryId: newId("dlv"),
    });
    const response = await (options.fetchImpl ?? fetch)(options.forwardTo, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    return { ok: response.ok, status: response.status, durationMs: Date.now() - startedAt };
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return {
      ok: false,
      error: cause ?? (error instanceof Error ? error.message : String(error)),
      durationMs: Date.now() - startedAt,
    };
  }
};

const formatTime = (date: Date) => date.toTimeString().slice(0, 8);

export const formatForwardLine = (event: Event, result: ForwardResult, now = new Date()) => {
  const outcome = result.status
    ? `${result.status}${result.ok ? "" : " (handler returned an error)"}`
    : `failed: ${result.error}${result.error === "ECONNREFUSED" ? " (is your server running?)" : ""}`;
  return `${formatTime(now)}  ${event.type.padEnd(16)}  ${event.id}  → ${outcome} [${result.durationMs}ms]`;
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
      for (const event of page.items) {
        if (eventTypes.size > 0 && !eventTypes.has(event.type)) continue;
        log(formatForwardLine(event, await forwardEvent(event, options)));
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
