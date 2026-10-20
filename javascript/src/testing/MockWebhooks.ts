import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "../client/CalmLensWebhooks";
import { hmacSha256Hex } from "../contract/CryptoUtils.js";
import type { Event } from "../contract/Event.js";
import type { WebhookEventPayload } from "../contract/WebhookPayload.js";

// Builds webhook deliveries the way CalmLens sends them, for testing a webhook handler without
// a connector. Mirrors shared/WebhookPayload; tests/webhooks.test.ts keeps the two in step.

/** The JSON body of a webhook delivery for a stored event (or an event from `events.list`). */
export const toWebhookEventPayload = (event: Event): WebhookEventPayload =>
  ({
    id: event.id,
    type: event.type,
    createdAt: event.createdAt,
    projectId: event.projectId,
    data: {
      severity: event.severity,
      title: event.title,
      description: event.description ?? null,
      assetId: event.assetId ?? null,
      asset: event.asset ?? null,
      facts: event.facts,
    },
  }) as WebhookEventPayload;

/** `v1=<hex HMAC-SHA256 of "<timestamp>.<body>">`, the `x-calmlens-signature` header value. */
export const createWebhookSignatureHeader = async (
  secret: string,
  timestamp: number | string,
  body: string,
): Promise<string> => `v1=${await hmacSha256Hex(secret, `${timestamp}.${body}`)}`;

/** Headers for one signed delivery of `body`, as CalmLens sends them. */
export const createWebhookHeaders = async (options: {
  secret: string;
  body: string;
  deliveryId: string;
  timestampSeconds?: number;
}): Promise<Record<string, string>> => {
  const timestamp = options.timestampSeconds ?? Math.floor(Date.now() / 1000);
  return {
    "content-type": "application/json",
    [WEBHOOK_DELIVERY_HEADER]: options.deliveryId,
    [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
    [WEBHOOK_SIGNATURE_HEADER]: await createWebhookSignatureHeader(
      options.secret,
      timestamp,
      options.body,
    ),
  };
};
