import { describe, expect, it } from "bun:test";
import * as sdk from "../src/client/CalmLensWebhooks";
import type { Event } from "../src/contract/Event.js";
import * as shared from "../src/contract/WebhookPayload.js";
import {
  CalmLensError,
  parseWebhookEvent,
  type VerifyWebhookSignatureOptions,
  verifyWebhookSignature,
} from "../src/server";
import * as builders from "../src/testing/MockWebhooks";

const event: Event = {
  id: "event-1",
  projectId: "123e4567-e89b-12d3-a456-426614174000",
  type: "asset.blocked",
  severity: "high",
  title: "Asset blocked",
  description: "Blocked by your policy",
  assetId: "asset-1",
  facts: [
    { key: "asset-name", value: "photo.jpg" },
    { key: "decided-by", value: "automated" },
    { key: "flagged-categories", value: ["harassment"] },
  ],
  createdAt: 1760000000000,
  updatedAt: 1760000000001,
} as Event;

describe("webhook payload and headers", () => {
  it("match shared/WebhookPayload, which the server uses", async () => {
    expect(builders.toWebhookEventPayload(event)).toEqual(shared.toWebhookEventPayload(event));
    const minimal = { ...event, description: undefined, assetId: undefined, facts: [] };
    expect(builders.toWebhookEventPayload(minimal)).toEqual(shared.toWebhookEventPayload(minimal));
    expect(
      shared.WEBHOOK_EVENT_PAYLOAD_SCHEMA.parse(builders.toWebhookEventPayload(event)),
    ).toEqual(builders.toWebhookEventPayload(event));

    const options = { secret: "key", body: "{}", deliveryId: "d1", timestampSeconds: 1700000000 };
    expect(await builders.createWebhookHeaders(options)).toEqual(
      await shared.createWebhookHeaders(options),
    );
    expect(sdk.WEBHOOK_DELIVERY_HEADER).toBe(shared.WEBHOOK_DELIVERY_HEADER);
    expect(sdk.WEBHOOK_TIMESTAMP_HEADER).toBe(shared.WEBHOOK_TIMESTAMP_HEADER);
    expect(sdk.WEBHOOK_SIGNATURE_HEADER).toBe(shared.WEBHOOK_SIGNATURE_HEADER);
    expect(sdk.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS).toBe(
      shared.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
    );
  });

  it("signs the shared test vector", async () => {
    expect(await builders.createWebhookSignatureHeader("key", 1700000000, "{}")).toBe(
      "v1=9d713ed406bb7076d4123f0dc2c39d2df5c654ed4b0cd56b52c8b4c940bd63ae",
    );
  });
});

describe("verifyWebhookSignature", () => {
  // Shared test vector (packages/sdk-contract/README.md).
  const vector = {
    payload: "{}",
    secret: "key",
    timestamp: "1700000000",
    signature: "v1=9d713ed406bb7076d4123f0dc2c39d2df5c654ed4b0cd56b52c8b4c940bd63ae",
    now: 1700000000 * 1000,
  };

  it("accepts the shared test vector", async () => {
    await expect(verifyWebhookSignature(vector)).resolves.toBe(true);
    await expect(verifyWebhookSignature({ ...vector, timestamp: 1700000000 })).resolves.toBe(true);
    await expect(
      verifyWebhookSignature({ ...vector, now: new Date(1700000000 * 1000) }),
    ).resolves.toBe(true);
  });

  it("accepts any matching v1 entry in a signature list", async () => {
    await expect(
      verifyWebhookSignature({
        ...vector,
        signature: `v0=abc, v1=${"0".repeat(64)}, ${vector.signature}`,
      }),
    ).resolves.toBe(true);
  });

  it("rejects tampered, unsigned or malformed deliveries", async () => {
    const cases: Array<Partial<VerifyWebhookSignatureOptions>> = [
      { payload: "{ }" },
      { secret: "other" },
      { timestamp: "1700000001" },
      { signature: vector.signature.slice(3) },
      { signature: `v0=${vector.signature.slice(3)}` },
      { signature: `${vector.signature.slice(0, -1)}0` },
      { signature: "" },
      { timestamp: "" },
      { timestamp: "17e8" },
    ];
    for (const override of cases) {
      await expect(verifyWebhookSignature({ ...vector, ...override })).resolves.toBe(false);
    }
    await expect(verifyWebhookSignature({ ...vector, signature: null })).resolves.toBe(false);
    await expect(verifyWebhookSignature({ ...vector, timestamp: undefined })).resolves.toBe(false);
  });

  it("rejects timestamps outside the tolerance", async () => {
    const at = (offsetSeconds: number, toleranceSeconds?: number) =>
      verifyWebhookSignature({
        ...vector,
        now: vector.now + offsetSeconds * 1000,
        toleranceSeconds,
      });
    await expect(at(300)).resolves.toBe(true);
    await expect(at(-300)).resolves.toBe(true);
    await expect(at(301)).resolves.toBe(false);
    await expect(at(-301)).resolves.toBe(false);
    await expect(at(600, 600)).resolves.toBe(true);
    // Real clock: the 2023 vector is long expired.
    await expect(verifyWebhookSignature({ ...vector, now: undefined })).resolves.toBe(false);
  });
});

describe("raw body inputs", () => {
  const vector = {
    secret: "key",
    timestamp: "1700000000",
    signature: "v1=9d713ed406bb7076d4123f0dc2c39d2df5c654ed4b0cd56b52c8b4c940bd63ae",
    now: 1700000000 * 1000,
  };

  it("verifies the body as a Buffer, Uint8Array or ArrayBuffer, like express.raw() gives it", async () => {
    const bytes = new TextEncoder().encode("{}");
    for (const payload of [Buffer.from("{}"), bytes, bytes.buffer]) {
      await expect(verifyWebhookSignature({ ...vector, payload })).resolves.toBe(true);
    }
    const tampered = Buffer.from("{ }");
    await expect(verifyWebhookSignature({ ...vector, payload: tampered })).resolves.toBe(false);
  });

  it("verifies a byte view into a larger buffer using only its own bytes", async () => {
    const backing = new TextEncoder().encode("xx{}yy");
    const view = backing.subarray(2, 4);
    await expect(verifyWebhookSignature({ ...vector, payload: view })).resolves.toBe(true);
  });

  it("refuses parsed JSON instead of re-serializing it", async () => {
    const error = await verifyWebhookSignature({ ...vector, payload: {} as never }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CalmLensError);
    expect((error as CalmLensError).code).toBe("sdk/invalid-argument");
  });

  it("reads the signature and timestamp from Headers or a Node header record", async () => {
    const headers = {
      "x-calmlens-signature": vector.signature,
      "x-calmlens-timestamp": vector.timestamp,
    };
    for (const source of [new Headers(headers), headers]) {
      await expect(
        verifyWebhookSignature({ payload: "{}", headers: source, secret: "key", now: vector.now }),
      ).resolves.toBe(true);
    }
    await expect(
      verifyWebhookSignature({ payload: "{}", headers: {}, secret: "key", now: vector.now }),
    ).resolves.toBe(false);
  });
});

describe("parseWebhookEvent", () => {
  const secret = "whsec_test";
  const timestampSeconds = 1760000000;
  const now = timestampSeconds * 1000;
  const body = JSON.stringify(builders.toWebhookEventPayload(event));

  it("returns the verified event", async () => {
    const signature = await builders.createWebhookSignatureHeader(secret, timestampSeconds, body);
    const parsed = await parseWebhookEvent({
      payload: Buffer.from(body),
      signature,
      timestamp: timestampSeconds,
      secret,
      now,
    });
    expect(parsed).toEqual(builders.toWebhookEventPayload(event));
  });

  it("throws sdk/invalid-webhook-signature for a delivery that does not verify", async () => {
    const signature = await builders.createWebhookSignatureHeader(secret, timestampSeconds, body);
    for (const options of [
      { payload: `${body} `, signature, timestamp: timestampSeconds },
      { payload: body, signature, timestamp: timestampSeconds + 1 },
      { payload: body, signature, timestamp: timestampSeconds, now: now + 301_000 },
    ]) {
      await expect(parseWebhookEvent({ secret, now, ...options })).rejects.toMatchObject({
        code: "sdk/invalid-webhook-signature",
      });
    }
  });

  it("throws sdk/invalid-webhook-payload for a signed body that is not an event", async () => {
    for (const payload of [
      "not json",
      "[]",
      JSON.stringify({ id: "e", type: "x" }),
      // Every event CalmLens sends has its creation time.
      JSON.stringify({ id: "e", type: "x", projectId: "p", data: {} }),
    ]) {
      const signature = await builders.createWebhookSignatureHeader(
        secret,
        timestampSeconds,
        payload,
      );
      await expect(
        parseWebhookEvent({ payload, signature, timestamp: timestampSeconds, secret, now }),
      ).rejects.toMatchObject({ code: "sdk/invalid-webhook-payload" });
    }
  });
});
