import { expect, test } from "bun:test";
import { toWebhookEventPayload } from "@calmlens/sdk/testing";
import { readWebhookDelivery } from "../src/webhooks";

// Deliveries are built by the SDK, so the test follows the real webhook payload shape.
const deliveryBody = (type: string, facts: { key: string; value: unknown }[] = []) =>
  JSON.stringify(
    toWebhookEventPayload({
      id: `event-${type}`,
      projectId: "project-1",
      type,
      severity: "low",
      title: "Asset event",
      assetId: "asset-1",
      asset: {
        id: "asset-1",
        externalId: null,
        content: { status: "stored" },
        upload: { status: "completed" },
        classification: { status: "completed", moderation: { status: "allowed" } },
      },
      facts,
      createdAt: 1760000000000,
    } as never),
  );

test("syncs the asset named in the delivery for decision events", () => {
  for (const type of [
    "asset.failed",
    "asset.allowed",
    "asset.limited",
    "asset.age-restricted",
    "asset.blocked",
    "asset.purged",
  ]) {
    expect(readWebhookDelivery(deliveryBody(type))).toEqual({
      eventId: `event-${type}`,
      syncAssetId: "asset-1",
    });
  }
});

test("ignores other events and test sends", () => {
  expect(readWebhookDelivery(deliveryBody("asset.uploaded")).syncAssetId).toBeNull();
  expect(readWebhookDelivery(deliveryBody("asset.classified")).syncAssetId).toBeNull();
  expect(
    readWebhookDelivery(deliveryBody("asset.allowed", [{ key: "test", value: true }])).syncAssetId,
  ).toBeNull();
});

test("rejects a body that is not a delivery", () => {
  expect(() => readWebhookDelivery(JSON.stringify({ type: "asset.allowed" }))).toThrow(Error);
});
