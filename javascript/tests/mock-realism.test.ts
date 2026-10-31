import { describe, expect, it } from "bun:test";
import { MIN_MULTIPART_UPLOAD_PART_BYTES } from "../src/contract/SharedConstants.js";
import type { CalmLensError } from "../src/server";
import { createMockApiKey, MockCalmLensServerClient, toWebhookEventPayload } from "../src/testing";

const projectId = "proj_8fK2mQx7Lp4NvB3tRz9Y";

const createClient = (mockOptions: { now?: () => number } = {}) => {
  let id = 0;
  let clock = 1_700_000_000_000;
  return new MockCalmLensServerClient({
    apiKey: createMockApiKey(),
    projectId,
    mockOptions: {
      createId: (prefix) => `${prefix}_${String(++id).padStart(20, "0")}`,
      now: () => clock++,
      ...mockOptions,
    },
  });
};

const text = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  content: { plainText: name, type: "text/plain" },
  ...extra,
});

const caught = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: CalmLensError) => error,
  );

describe("MockCalmLensServerClient errors", () => {
  it("carry the API's HTTP status, a request ID and response headers", async () => {
    const client = createClient();
    const error = (await caught(client.assets.retrieve({ assetId: "missing" })))!;
    expect(error).toMatchObject({ code: "asset/not-found", status: 404 });
    expect(error.requestId).toMatch(/^mock-request-\d+$/);
    expect(error.headers?.get("x-request-id")).toBe(error.requestId!);
    expect(error.isNotFound()).toBe(true);

    await client.folders.create({ name: "Docs" });
    expect(await caught(client.folders.create({ name: "Docs" }))).toMatchObject({
      code: "folder/duplicate-name",
      status: 409,
    });
    await client.assets.create(text("a", { externalId: "post-1" }));
    expect(await caught(client.assets.create(text("b", { externalId: "post-1" })))).toMatchObject({
      code: "asset/duplicate-external-id",
      status: 409,
    });
  });
});

describe("MockCalmLensServerClient listing", () => {
  it("applies ordering and RSQL filters, and refuses filters it can't evaluate", async () => {
    const client = createClient();
    await client.assets.classify(text("b-allowed"));
    await client.assets.create(text("a-pending"));
    await client.assets.classify(text("c-allowed"));

    const newestFirst = await client.assets.list();
    expect(newestFirst.items.map((asset) => asset.name)).toEqual([
      "c-allowed",
      "a-pending",
      "b-allowed",
    ]);

    const allowedByName = await client.assets.list({
      filter: "classification.moderation.status==allowed",
      ordering: [{ field: "createdAt", direction: "asc" }],
    });
    expect(allowedByName.items.map((asset) => asset.name)).toEqual(["b-allowed", "c-allowed"]);
    expect(allowedByName.hasMore).toBe(false);

    const either = await client.assets.list({ filter: "name==a-pending,name==c-allowed" });
    expect(either.items.map((asset) => asset.name).sort()).toEqual(["a-pending", "c-allowed"]);
    const both = await client.assets.list({
      filter: "classification.moderation.status==allowed;name!=b-allowed",
    });
    expect(both.items.map((asset) => asset.name)).toEqual(["c-allowed"]);

    expect(await caught(client.assets.list({ filter: "name=like=a*" }))).toMatchObject({
      code: "sdk/invalid-argument",
    });
  });

  it("iterates every page", async () => {
    const client = createClient();
    for (const name of ["a", "b", "c"]) await client.assets.create(text(name));
    const names: string[] = [];
    for await (const asset of client.assets.iterate({
      pageSize: 2,
      ordering: [{ field: "createdAt", direction: "asc" }],
    })) {
      names.push(asset.name);
    }
    expect(names).toEqual(["a", "b", "c"]);
    expect(client.callsTo("assets.list")).toHaveLength(2);
  });

  it("searches names, IDs and external IDs, best match first", async () => {
    const client = createClient();
    await client.assets.create(text("red car at night"));
    const exact = await client.assets.create(text("red car"));
    await client.assets.create(text("blue boat"));
    const result = await client.assets.search({ query: "Red Car" });
    expect(result.items.map((item) => item.asset.id)[0]).toBe(exact.id);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.matchedFields).toContain("name");
    expect(client.callsTo("assets.search")).toHaveLength(1);
  });
});

describe("MockCalmLensServerClient events", () => {
  it("returns enqueued events after a cursor, in pages, like the API", async () => {
    const client = createClient();
    const { nextCursor: start } = await client.events.list();
    const first = client.enqueueEvent({ type: "asset.uploaded" });
    const second = client.enqueueEvent({ type: "asset.allowed", assetId: "asset-1" });

    const page = await client.events.list({ cursor: start, pageSize: 1 });
    expect(page.items.map((event) => event.id)).toEqual([first.id]);
    expect(page.hasMore).toBe(true);
    const rest = await client.events.list({ cursor: page.nextCursor });
    expect(rest.items.map((event) => event.id)).toEqual([second.id]);
    expect(rest.hasMore).toBe(false);

    const seen: string[] = [];
    for await (const eventPage of client.events.pages({ cursor: start, pageSize: 1 })) {
      seen.push(...eventPage.items.map((event) => event.id));
    }
    expect(seen).toEqual([first.id, second.id]);
    // A webhook delivers the event in the shape events.list returns it.
    expect(toWebhookEventPayload(rest.items[0]!)).toEqual(rest.items[0]!);
    expect(rest.items[0]).toMatchObject({ assetId: "asset-1", description: null, asset: null });

    expect(await caught(client.events.list({ cursor: "bogus" }))).toMatchObject({
      code: "validation/invalid-cursor",
      status: 400,
    });
  });
});

describe("MockCalmLensServerClient assets.decide", () => {
  it("records the reviewer and note, and refuses decisions the API refuses", async () => {
    const client = createClient();
    const asset = await client.assets.classify(text("post"));
    const { nextCursor } = await client.events.list();

    const blocked = await client.assets.decide({
      assetId: asset.id,
      decision: "blocked",
      note: "  Spam  ",
    });
    expect(blocked.classification.moderation.manualReviews).toEqual([
      expect.objectContaining({
        decision: "blocked",
        note: "Spam",
        reviewerName: "An API key",
        appliedToAsset: true,
      }),
    ]);
    const [event] = (await client.events.list({ cursor: nextCursor })).items;
    expect(event?.facts).toEqual(
      expect.arrayContaining([
        { key: "decided-by", value: "reviewer" },
        { key: "reviewer-name", value: "An API key" },
        { key: "note", value: "Spam" },
      ]),
    );

    expect(
      await caught(client.assets.decide({ assetId: asset.id, decision: "allowed", note: " " })),
    ).toMatchObject({ code: "validation/too-small", status: 400, details: { path: "note" } });
    expect(
      await caught(
        client.assets.decide({ assetId: asset.id, decision: "purged", note: "Illegal" } as never),
      ),
    ).toMatchObject({ code: "validation/invalid-value", details: { path: "confirmPurge" } });

    await client.assets.decide({
      assetId: asset.id,
      decision: "purged",
      note: "Illegal",
      confirmPurge: true,
    });
    expect(
      await caught(client.assets.decide({ assetId: asset.id, decision: "allowed", note: "Fine" })),
    ).toMatchObject({ code: "asset/content-purged", status: 409 });
    expect(
      (await client.assets.decide({ assetId: asset.id, decision: "blocked", note: "Keep blocked" }))
        .classification.moderation.status,
    ).toBe("blocked");

    const uploading = await client.assets.create({
      name: "doc.pdf",
      part: {
        uint8Array: new Uint8Array(MIN_MULTIPART_UPLOAD_PART_BYTES).fill(1),
        type: "application/pdf",
        isFinal: false,
      },
    });
    expect(
      await caught(client.assets.decide({ assetId: uploading.id, decision: "blocked", note: "x" })),
    ).toMatchObject({ code: "asset/processing", status: 409 });
    const queued = await client.assets.create(text("queued"));
    expect(queued.classification.status).toBe("processing");
    expect(
      await caught(client.assets.decide({ assetId: queued.id, decision: "blocked", note: "x" })),
    ).toMatchObject({ code: "asset/processing", status: 409 });
  });
});

describe("MockCalmLensServerClient multipart and idempotency", () => {
  const firstPart = new Uint8Array(MIN_MULTIPART_UPLOAD_PART_BYTES).fill(1);

  it("rejects mismatched declared sizes without creating or completing an upload", async () => {
    const client = createClient();
    await expect(
      client.assets.create({
        name: "bad.txt",
        part: { base64: "aGVsbG8=", type: "text/plain", isFinal: true, sizeInBytes: 6 },
      }),
    ).rejects.toMatchObject({ code: "upload/invalid-payload" });
    expect((await client.assets.list()).items).toEqual([]);
    const uploading = await client.assets.create({
      name: "doc.pdf",
      part: { uint8Array: firstPart, type: "application/pdf", isFinal: false },
    });
    await expect(
      client.assets.uploadPart({
        assetId: uploading.id,
        part: { base64: "aGVsbG8=", partNumber: 2, isFinal: true, sizeInBytes: 6 },
      }),
    ).rejects.toMatchObject({ code: "upload/invalid-payload" });
    const unchanged = await client.assets.retrieve({ assetId: uploading.id });
    expect(unchanged.upload).toMatchObject({ status: "uploading", partsReceived: 1 });
  });

  it("applies the queue mode saved at the start and enforces part order", async () => {
    const client = createClient();
    const started = await client.assets.classify({
      name: "doc.pdf",
      part: { uint8Array: firstPart, type: "application/pdf" },
    });
    expect(started.upload.status).toBe("uploading");
    expect(
      await caught(
        client.assets.uploadPart({
          assetId: started.id,
          part: { uint8Array: [1], partNumber: 3, isFinal: true },
        }),
      ),
    ).toMatchObject({ code: "upload/invalid-part-number", details: { expectedPartNumber: 2 } });

    const finished = await client.assets.uploadPart({
      assetId: started.id,
      part: { uint8Array: [1], partNumber: 2, isFinal: true },
    });
    // Started with classify, so the saved choice is to wait for the decision.
    expect(finished.classification.status).toBe("completed");
    expect(finished.classification.moderation.status).toBe("allowed");
    expect(
      await caught(
        client.assets.uploadPart({
          assetId: started.id,
          part: { uint8Array: [1], partNumber: 3, isFinal: true },
        }),
      ),
    ).toMatchObject({ code: "upload/not-open", status: 409 });
  });
});

describe("MockCalmLensServerClient CDN", () => {
  it("serves JSON errors and content headers like the CDN", async () => {
    const client = createClient();
    const missing = await client.cdn.serve({ assetIdentifier: "missing" });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toBe("application/json");
    expect(await missing.json()).toMatchObject({ code: "asset/not-found" });

    const asset = await client.assets.create({
      name: "a.pdf",
      visibility: "public",
      content: { uint8Array: [1, 2, 3], type: "application/pdf" },
    });
    const served = await client.cdn.serve({ assetIdentifier: asset.id });
    expect(served.headers.get("content-length")).toBe("3");
    // Like the CDN, only images carry an ETag (their bytes never change).
    expect(served.headers.get("etag")).toBeNull();
    expect(served.url).toBe(client.cdn.getAssetUrl({ assetIdentifier: asset.id }));
    const head = await client.cdn.serve({ assetIdentifier: asset.id, init: { method: "HEAD" } });
    expect(await head.text()).toBe("");
  });
});
