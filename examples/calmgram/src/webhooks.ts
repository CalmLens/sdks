// What a verified CalmLens webhook delivery asks the app to do. A delivery's body is the event
// itself, in the same shape `events.list` returns: `{ id, type, assetId, asset, facts, ... }`.

/**
 * Events that can change an asset's moderation status. There is one event per status, sent for
 * automated decisions and reviewer decisions alike.
 */
const ASSET_DECISION_EVENTS = new Set([
  "asset.failed",
  "asset.allowed",
  "asset.limited",
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
  assetId?: string | null;
  facts?: WebhookFact[];
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
  // Test sends from the portal carry the registered `test` fact and change nothing.
  const isTest =
    delivery.facts?.some((fact) => fact.key === "test" && fact.value === true) ?? false;
  const assetId =
    typeof delivery.assetId === "string" && delivery.assetId ? delivery.assetId : null;
  return {
    eventId: delivery.id,
    syncAssetId: !isTest && ASSET_DECISION_EVENTS.has(delivery.type) ? assetId : null,
  };
};
