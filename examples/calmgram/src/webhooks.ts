// What a verified CalmLens webhook delivery asks the app to do. Deliveries are
// `{ id, type, createdAt, projectId, data: { assetId, asset, facts, ... } }`; the asset ID lives
// under `data`, not on the delivery itself.

/**
 * Events that can change an asset's moderation status. There is one event per status, sent for
 * automated decisions and reviewer decisions alike.
 */
const ASSET_DECISION_EVENTS = new Set([
  "asset.failed",
  "asset.allowed",
  "asset.age-restricted",
  "asset.blocked",
  "asset.purged",
]);

interface WebhookFact {
  key: string;
  value: unknown;
}

interface WebhookDelivery {
  id: string;
  type: string;
  data?: { assetId?: string | null; facts?: WebhookFact[] } | null;
}

export interface WebhookAction {
  /** The delivery ID, used to ignore retried deliveries. */
  eventId: string;
  /** The asset whose current state should be fetched, or null when there is nothing to sync. */
  syncAssetId: string | null;
}

/** Reads a verified delivery's raw body. Throws on a body that is not a delivery. */
export const readWebhookDelivery = (rawBody: string): WebhookAction => {
  const delivery = JSON.parse(rawBody) as WebhookDelivery;
  if (typeof delivery?.id !== "string" || typeof delivery.type !== "string") {
    throw new Error("Not a CalmLens webhook delivery");
  }
  const data = delivery.data ?? {};
  // Test sends from the portal carry the registered `test` fact and change nothing.
  const isTest = data.facts?.some((fact) => fact.key === "test" && fact.value === true) ?? false;
  const assetId = typeof data.assetId === "string" && data.assetId ? data.assetId : null;
  return {
    eventId: delivery.id,
    syncAssetId: !isTest && ASSET_DECISION_EVENTS.has(delivery.type) ? assetId : null,
  };
};
