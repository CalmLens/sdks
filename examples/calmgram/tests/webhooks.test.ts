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
        classification: { status: "completed", moderation: { decision: "approved", action: null } },
      },
      facts,
      createdAt: 1760000000000,
      updatedAt: 1760000000000,
    } as never),
  );

test("syncs the asset named in the delivery's data for decision events", () => {
  for (const type of ["asset.flagged", "asset.failed", "asset.approved", "asset.rejected"]) {
    expect(readWebhookDelivery(deliveryBody(type))).toEqual({
      eventId: `event-${type}`,
      syncAssetId: "asset-1",
    });
  }
});

test("ignores other events and test sends", () => {
  expect(readWebhookDelivery(deliveryBody("asset.uploaded")).syncAssetId).toBeNull();
  expect(
    readWebhookDelivery(deliveryBody("asset.approved", [{ key: "test", value: true }])).syncAssetId,
  ).toBeNull();
});

test("rejects a body that is not a delivery", () => {
  expect(() => readWebhookDelivery(JSON.stringify({ type: "asset.approved" }))).toThrow(Error);
});
