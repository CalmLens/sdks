import { hmacSha256Hex, timingSafeEqual } from "../contract/CryptoUtils.js";
import type { ReceivedWebhookEventPayload } from "../contract/WebhookPayload.js";
import { CalmLensError, invalidArgument, SDK_ERROR_CODES } from "./CalmLensError";
import type {
  VerifyWebhookSignatureOptions,
  WebhookHeadersInput,
  WebhookPayloadInput,
} from "./CalmLensTypes";

// Webhook verification (docs/connectors.md). The header names and tolerance mirror
// shared/WebhookPayload, which can't be bundled at runtime: its zod schemas pull in
// server-only packages. tests/webhooks.test.ts keeps the two in step.

export const WEBHOOK_DELIVERY_HEADER = "x-calmlens-delivery";
export const WEBHOOK_TIMESTAMP_HEADER = "x-calmlens-timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "x-calmlens-signature";
/** Deliveries whose timestamp is further than this from the receiver's clock are rejected. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

const readHeader = (headers: WebhookHeadersInput | undefined, name: string) => {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined | null>;
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name);
  const value = key === undefined ? undefined : record[key];
  return Array.isArray(value) ? value.join(",") : (value ?? undefined);
};

/** The raw body as text. Parsed objects are refused: re-serializing JSON changes the signed bytes. */
const payloadToText = (payload: WebhookPayloadInput): string => {
  if (typeof payload === "string") return payload;
  if (payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)) {
    const view = ArrayBuffer.isView(payload)
      ? new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
      : new Uint8Array(payload);
    return new TextDecoder("utf-8", { fatal: false }).decode(view);
  }
  throw invalidArgument(
    "Webhook payload must be the raw request body as a string, Uint8Array/Buffer or ArrayBuffer, not parsed JSON",
  );
};

/**
 * Verifies a webhook delivery: `x-calmlens-signature` must contain a `v1=` HMAC-SHA256 of
 * `"<x-calmlens-timestamp>.<raw body>"`, and the timestamp must be within `toleranceSeconds`
 * (default 300) of now. Returns `false` for anything missing, malformed or stale, and throws
 * `sdk/invalid-argument` when `payload` is not a raw body (for example, parsed JSON).
 */
export async function verifyWebhookSignature(
  options: VerifyWebhookSignatureOptions,
): Promise<boolean> {
  const {
    payload,
    secret,
    toleranceSeconds = WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
    now,
    headers,
  } = options;
  const body = payloadToText(payload);
  const signature = options.signature ?? readHeader(headers, WEBHOOK_SIGNATURE_HEADER);
  const timestamp = options.timestamp ?? readHeader(headers, WEBHOOK_TIMESTAMP_HEADER);
  if (!secret || !signature || timestamp === null || timestamp === undefined) return false;
  const timestampText = String(timestamp).trim();
  if (!/^\d+$/.test(timestampText)) return false;
  const nowMs = now === undefined ? Date.now() : now instanceof Date ? now.getTime() : now;
  if (Math.abs(Math.floor(nowMs / 1000) - Number(timestampText)) > toleranceSeconds) return false;

  const candidates = signature
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3).toLowerCase());
  if (candidates.length === 0) return false;

  const expected = await hmacSha256Hex(secret, `${timestampText}.${body}`);
  let matched = false;
  for (const candidate of candidates) {
    if (timingSafeEqual(expected, candidate)) matched = true;
  }
  return matched;
}

/**
 * Verifies a webhook delivery and parses its body. Throws `sdk/invalid-webhook-signature`
 * when the signature or timestamp does not verify, and `sdk/invalid-webhook-payload` when a
 * verified body is not a webhook event. Unknown event types, fact values and fields remain available.
 *
 * Event types and fact keys added to CalmLens after this SDK version are returned as they are,
 * so keep a default branch when you switch on `type`.
 */
export async function parseWebhookEvent(
  options: VerifyWebhookSignatureOptions,
): Promise<ReceivedWebhookEventPayload> {
  if (!(await verifyWebhookSignature(options))) {
    throw new CalmLensError(SDK_ERROR_CODES.INVALID_WEBHOOK_SIGNATURE, {
      message: "Webhook signature or timestamp did not verify",
    });
  }
  let event: unknown;
  try {
    event = JSON.parse(payloadToText(options.payload));
  } catch (cause) {
    throw new CalmLensError(SDK_ERROR_CODES.INVALID_WEBHOOK_PAYLOAD, {
      message: "Webhook body is not JSON",
      cause,
    });
  }
  if (!isWebhookEvent(event)) {
    throw new CalmLensError(SDK_ERROR_CODES.INVALID_WEBHOOK_PAYLOAD, {
      message: "Webhook body is not a CalmLens event",
    });
  }
  return event;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isOptional = (value: unknown, type: "string" | "object", nullable: boolean) =>
  value === undefined || (nullable && value === null) || typeof value === type;

/**
 * Whether `value` is a webhook body, by the rules of shared/WebhookPayload's
 * RECEIVED_WEBHOOK_EVENT_PAYLOAD_SCHEMA: the envelope fields CalmLens always sends, and the types
 * of the known `data` fields when present. Each fact needs a string `key` and a `value` (any JSON
 * value, `null` included). Unknown fields and fact values are accepted.
 */
const isWebhookEvent = (value: unknown): value is ReceivedWebhookEventPayload => {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.createdAt !== "number" ||
    !isObject(value.data)
  ) {
    return false;
  }
  const { severity, title, description, assetId, asset, facts } = value.data;
  return (
    isOptional(severity, "string", false) &&
    isOptional(title, "string", false) &&
    isOptional(description, "string", true) &&
    isOptional(assetId, "string", true) &&
    (asset === undefined || asset === null || (isObject(asset) && typeof asset.id === "string")) &&
    (facts === undefined ||
      (Array.isArray(facts) &&
        facts.every(
          (fact) =>
            isObject(fact) &&
            typeof fact.key === "string" &&
            "value" in fact &&
            isOptional(fact.url, "string", false),
        )))
  );
};

/**
 * Whether a webhook event is a test send from the portal or the CLI rather than a real event: it
 * carries the registered `{ key: "test", value: true }` fact.
 */
export const isTestWebhookEvent = (event: Pick<ReceivedWebhookEventPayload, "data">): boolean =>
  Array.isArray(event?.data?.facts) &&
  event.data.facts.some((fact) => fact?.key === "test" && fact.value === true);
