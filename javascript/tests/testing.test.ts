import { describe, expect, it, mock } from "bun:test";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { PUBLIC_ERROR_CODES } from "../src/contract/PublicErrorCodes.js";
import { MIN_MULTIPART_UPLOAD_PART_BYTES } from "../src/contract/SharedConstants.js";
import { CalmLensError, CalmLensServerClient } from "../src/server";
import {
  createMockApiKey,
  InMemoryMockDatabaseStorage,
  InMemoryMockImageStorage,
  MockCalmLensAppClient,
  MockCalmLensServerClient,
  type MockDatabaseStorage,
  type MockImageStorage,
} from "../src/testing";

const projectId = "123e4567-e89b-12d3-a456-426614174000";
const apiKey = createMockApiKey([
  { actions: ["assets:download"], folderId: null, includeSubfolders: true },
]);
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const largePartBytes = new Uint8Array(MIN_MULTIPART_UPLOAD_PART_BYTES);
largePartBytes.fill(1);
const fixtureRoot = resolve(import.meta.dir, "../test-files");
const imageFixtures = [
  { fileName: "test_small.png", type: "image/png" },
  { fileName: "test_cat_1.jpg", type: "image/jpeg" },
  { fileName: "test_gif.gif", type: "image/gif" },
] as const;
const multipartImageFixtures = [
  { fileName: "large.jpg", type: "image/jpeg" },
  { fileName: "racy.png", type: "image/png" },
] as const;

const createClient = (
  mockOptions: ConstructorParameters<typeof MockCalmLensServerClient>[0]["mockOptions"] = {},
  apiKeyValue = apiKey,
  clientOptions: { cdnBaseUrl?: string } = {},
) =>
  new MockCalmLensServerClient({
    apiKey: apiKeyValue,
    projectId,
    ...clientOptions,
    mockOptions: {
      createId: () => "987fcdeb-51a2-43d7-b890-123456789abc",
      now: () => 1_700_000_000_000,
      ...mockOptions,
    },
  });

const readFixtureBytes = async (fileName: string) =>
  new Uint8Array(await readFile(resolve(fixtureRoot, fileName)));

const expectServedBytesToEqual = async (
  client: MockCalmLensServerClient,
  assetId: string,
  expectedBytes: Uint8Array,
) => {
  const response = await client.cdn.serve({ assetIdentifier: assetId });
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(expectedBytes);
};

const splitForMockMultipart = (bytes: Uint8Array) => {
  expect(bytes.byteLength).toBeGreaterThan(MIN_MULTIPART_UPLOAD_PART_BYTES);
  return {
    firstPart: bytes.subarray(0, MIN_MULTIPART_UPLOAD_PART_BYTES),
    finalPart: bytes.subarray(MIN_MULTIPART_UPLOAD_PART_BYTES),
  };
};

describe("MockCalmLensServerClient", () => {
  it("creates, stores, retrieves, and lists base64 image assets", async () => {
    const imageStorage = new InMemoryMockImageStorage();
    const client = createClient({ imageStorage });

    const asset = await client.assets.create({
      name: "test-image.png",
      content: {
        base64: `data:image/png;base64,${pngBase64}`,
        type: "image/png",
      },
      visibility: "public",
    });

    expect(asset.id).toBe("987fcdeb-51a2-43d7-b890-123456789abc");
    expect(asset.type).toBe("image");
    expect(asset.classification.status).toBe("processing");
    expect(asset.classification.moderation.status).toBe("pending");
    expect(asset.content).toMatchObject({ status: "temporary", format: "image/png" });
    expect(asset.visibility).toBe("public");
    await expect(client.assets.retrieve({ assetId: asset.id })).resolves.toEqual(asset);
    await expect(imageStorage.getContent(asset.id)).resolves.toMatchObject({ type: "image/png" });

    const page = await client.assets.list({ pageSize: 10 });
    expect(page.items).toEqual([asset]);
    expect(page.nextCursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });

  it("creates normal image assets from byte-compatible inputs", async () => {
    const pngBytes = Buffer.from(pngBase64, "base64");

    for (const content of [
      { uint8Array: Uint8Array.from(pngBytes) },
      { buffer: Buffer.from(pngBytes) },
      { buffer: Uint8Array.from(pngBytes).buffer },
    ]) {
      const imageStorage = new InMemoryMockImageStorage();
      const client = createClient({ imageStorage });
      const asset = await client.assets.create({
        name: "typed-array-image.png",
        content: {
          ...content,
          type: "image/png",
        },
      });

      expect(asset.type).toBe("image");
      expect(asset.content.sizeInBytes).toBe(pngBytes.length);
      const stored = await imageStorage.getContent(asset.id);
      expect(stored?.parts.get(1)?.byteLength).toBe(pngBytes.length);
    }
  });

  it("serves fixture images uploaded through base64 without byte corruption", async () => {
    for (const fixture of imageFixtures) {
      const bytes = await readFixtureBytes(fixture.fileName);
      const client = createClient({
        createId: () => `base64-${basename(fixture.fileName).replaceAll(/[^a-zA-Z0-9]/g, "-")}`,
      });

      const asset = await client.assets.create({
        name: fixture.fileName,
        content: {
          base64: Buffer.from(bytes).toString("base64"),
          type: fixture.type,
        },
      });

      await expectServedBytesToEqual(client, asset.id, bytes);
    }
  });

  it("serves fixture images uploaded through uint8Array without byte corruption", async () => {
    for (const fixture of imageFixtures) {
      const bytes = await readFixtureBytes(fixture.fileName);
      const client = createClient({
        createId: () => `uint8-${basename(fixture.fileName).replaceAll(/[^a-zA-Z0-9]/g, "-")}`,
      });

      const asset = await client.assets.create({
        name: fixture.fileName,
        content: {
          uint8Array: bytes,
          type: fixture.type,
        },
      });

      await expectServedBytesToEqual(client, asset.id, bytes);
    }
  });

  it("serves fixture images uploaded through multipart base64 without byte corruption", async () => {
    for (const fixture of multipartImageFixtures) {
      const bytes = await readFixtureBytes(fixture.fileName);
      const { firstPart, finalPart } = splitForMockMultipart(bytes);
      const client = createClient({
        createId: () =>
          `multipart-base64-${basename(fixture.fileName).replaceAll(/[^a-zA-Z0-9]/g, "-")}`,
      });

      const uploading = await client.assets.create({
        name: fixture.fileName,
        part: {
          base64: Buffer.from(firstPart).toString("base64"),
          type: fixture.type,
        },
      });

      const completed = await client.assets.uploadPart({
        assetId: uploading.id,
        part: {
          base64: Buffer.from(finalPart).toString("base64"),
          partNumber: 2,
          isFinal: true,
        },
      });

      await expectServedBytesToEqual(client, completed.id, bytes);
    }
  });

  it("serves fixture images uploaded through multipart uint8Array without byte corruption", async () => {
    for (const fixture of multipartImageFixtures) {
      const bytes = await readFixtureBytes(fixture.fileName);
      const { firstPart, finalPart } = splitForMockMultipart(bytes);
      const client = createClient({
        createId: () =>
          `multipart-uint8-${basename(fixture.fileName).replaceAll(/[^a-zA-Z0-9]/g, "-")}`,
      });

      const uploading = await client.assets.create({
        name: fixture.fileName,
        part: {
          uint8Array: firstPart,
          type: fixture.type,
        },
      });

      const completed = await client.assets.uploadPart({
        assetId: uploading.id,
        part: {
          uint8Array: finalPart,
          partNumber: 2,
          isFinal: true,
        },
      });

      await expectServedBytesToEqual(client, completed.id, bytes);
    }
  });

  it("creates website assets from URLs", async () => {
    const client = createClient();

    const asset = await client.assets.create({
      name: "site",
      url: "https://example.com",
    });

    expect(asset.type).toBe("website");
    expect(asset.externalUrl).toBe("https://example.com");
  });

  it("supports multipart create and uploadPart flows", async () => {
    const imageStorage = new InMemoryMockImageStorage();
    const client = createClient({ imageStorage });

    const uploading = await client.assets.create({
      name: "large.png",
      part: {
        uint8Array: largePartBytes,
        type: "application/pdf",
      },
    });

    expect(uploading.upload).toMatchObject({ status: "uploading", partsReceived: 1 });
    expect(uploading.classification.status).toBe("pending");

    const updated = await client.assets.uploadPart({
      assetId: uploading.id,
      part: {
        uint8Array: [1, 2, 3],
        partNumber: 2,
        isFinal: true,
      },
    });

    expect(updated.upload).toMatchObject({ status: "completed", partsReceived: 2 });
    expect(updated.classification.status).toBe("processing");
    const stored = await imageStorage.getContent(uploading.id);
    expect(stored?.parts.size).toBe(2);
  });

  it("rejects invalid multipart create fields", async () => {
    const client = createClient();
    await expect(
      client.assets.create({
        name: "wrong-part.png",
        part: {
          base64: pngBase64,
          type: "image/png",
          partNumber: 2,
        },
      }),
    ).rejects.toMatchObject({ code: PUBLIC_ERROR_CODES.USE_UPLOAD_PART.getId() });

    for (const options of [
      {
        name: "not-multipart.png",
        content: { base64: pngBase64, type: "image/png" },
        isFinal: true,
      },
      {
        name: "too-small-part.bin",
        part: { uint8Array: [1, 2, 3], type: "application/pdf" },
      },
      {
        name: "invalid-base64-boundary.bin",
        part: { base64: "AQI", type: "application/pdf" },
      },
    ]) {
      const error = await client.assets.create(options as never).catch((caught) => caught);
      expect(error).toBeInstanceOf(CalmLensError);
      expect(error.code).toBe(PUBLIC_ERROR_CODES.INVALID_UPLOAD_PAYLOAD.getId());
    }
  });

  it("rejects unsupported upload MIME types", async () => {
    const client = createClient();
    for (const [options, mimeType] of [
      [
        {
          name: "invalid-octet-stream.bin",
          content: { base64: pngBase64, type: "application/octet-stream" },
        },
        "application/octet-stream",
      ],
      [
        {
          name: "invalid-multipart.bin",
          part: { base64: pngBase64, type: "multipart/form-data; boundary=abc", isFinal: true },
        },
        "multipart/form-data; boundary=abc",
      ],
    ] as const) {
      const error = await client.assets.create(options as never).catch((caught) => caught);
      expect(error).toBeInstanceOf(CalmLensError);
      expect(error.code).toBe(PUBLIC_ERROR_CODES.INVALID_UPLOAD_MIME_TYPE.getId());
      expect(error.details).toEqual({ mimeType });
    }
  });

  it("lists child assets using the database storage", async () => {
    const databaseStorage = new InMemoryMockDatabaseStorage();
    const client = createClient({ databaseStorage });
    const parent = await client.assets.create({ name: "parent", url: "https://example.com" });
    await databaseStorage.createAsset({
      ...parent,
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      name: "child",
      parentId: parent.id,
    });

    const children = await client.assets.listChildren({
      assetId: parent.id,
      pageSize: 10,
    });

    expect(children.items).toHaveLength(1);
    expect(children.items[0]?.name).toBe("child");
  });

  it("creates signed URLs without network calls", async () => {
    const client = createClient({ signedUrlBaseUrl: "https://mock.local" });
    const asset = await client.assets.create({ name: "site", url: "https://example.com" });

    const signedUrl = await client.assets.createSignedUrl({
      assetId: asset.id,
      resource: "rendered",
      expiresInSeconds: 60,
      lens: "thumbnail",
    });

    expect(signedUrl.url).toBe(
      `https://mock.local/assets/${asset.id}/rendered?expiresInSeconds=60&lens=thumbnail`,
    );
    expect(signedUrl.expiresAt).toBe(1_700_000_060_000);
  });

  it("builds CDN URLs and serves assets from the standard client", async () => {
    const fetchMock = mock(async () => new Response("asset-bytes", { status: 200 }));
    const client = new CalmLensServerClient({
      apiKey,
      projectId,
      cdnBaseUrl: "https://cdn.test/v1/",
      cdnFetch: fetchMock as typeof fetch,
    });

    expect(
      client.cdn.getAssetUrl({
        assetIdentifier: "asset-id",
        resource: "rendered",
        lens: "thumbnail",
      }),
    ).toBe(`https://cdn.test/v1/assets/${projectId}/asset-id/rendered/@thumbnail`);

    expect(
      client.cdn.getAssetUrl({
        assetIdentifier: "asset-id",
        resource: "rendered",
        lens: "thumbnail",
        allowAgeRestricted: true,
      }),
    ).toBe(
      `https://cdn.test/v1/assets/${projectId}/asset-id/rendered/@thumbnail?allowAgeRestricted=true`,
    );
    expect(client.cdn.getAssetUrl({ assetIdentifier: "asset-id", allowAgeRestricted: false })).toBe(
      `https://cdn.test/v1/assets/${projectId}/asset-id/rendered`,
    );

    expect(
      client.cdn.getAssetUrl({
        assetIdentifier: "asset-id",
        transform: "imageTransform[format=png,width=1024]",
      }),
    ).toBe(
      `https://cdn.test/v1/assets/${projectId}/asset-id/rendered/imageTransform[format=png,width=1024]`,
    );

    expect(
      client.cdn.getAssetUrl({
        assetIdentifier: "asset-id",
        transform: { type: "imageTransform", options: { width: 1024, format: "png" } },
      }),
    ).toBe(
      `https://cdn.test/v1/assets/${projectId}/asset-id/rendered/imageTransform[format=png,width=1024]`,
    );

    expect(
      client.cdn.getAssetUrl({
        assetIdentifier: "asset-id",
        transform: [
          { type: "imageTransform", options: { border: { color: "#fff", width: 2 } } },
          { type: "imageTransform", options: { format: "webp" } },
        ],
      }),
    ).toBe(
      `https://cdn.test/v1/assets/${projectId}/asset-id/rendered/imageTransform[border%5Bcolor%5D=%23fff,border%5Bwidth%5D=2],imageTransform[format=webp]`,
    );

    expect(() =>
      client.cdn.getAssetUrl({
        assetIdentifier: "asset-id",
        transform: { type: "../imageTransform", options: {} },
      }),
    ).toThrow(expect.objectContaining({ code: "sdk/invalid-argument" }));

    const response = await client.cdn.serve({
      assetIdentifier: "asset-id",
      resource: "original",
      init: { headers: { Accept: "image/png" } },
    });

    expect(await response.text()).toBe("asset-bytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://cdn.test/v1/assets/${projectId}/asset-id/original`);
    expect(new Headers(init.headers).get("accept")).toBe("image/png");
    expect(new Headers(init.headers).get("x-api-key")).toBe(apiKey);
    expect(init.redirect).toBe("manual");
  });

  it("ensures versioned custom lenses", async () => {
    const client = createClient();
    const initialDefinition = {
      identifier: "picmagic-normal",
      name: "PicMagic normal",
      type: "image" as const,
      active: true,
      version: 7,
      transforms: [
        {
          type: "imageTransform",
          options: { fit: "scale-down", width: 1024, format: "png" },
        },
      ],
    };
    const uhdDefinition = {
      ...initialDefinition,
      identifier: "picmagic-uhd",
      name: "PicMagic UHD",
      version: 20,
      transforms: [
        {
          type: "imageTransform",
          options: { fit: "scale-down", width: 2048, format: "png" },
        },
      ],
    };

    const [created, uhd] = await client.ensureLenses({
      lenses: [initialDefinition, uhdDefinition],
    });
    const [repeated] = await client.ensureLenses({
      lenses: [
        {
          ...initialDefinition,
          description: null,
          transforms: [
            {
              type: "imageTransform",
              options: { format: "png", width: 1024, fit: "scale-down" },
            },
          ],
        },
      ],
    });
    expect(repeated).toEqual(created);
    expect(uhd.identifier).toBe("picmagic-uhd");

    await expect(
      client.ensureLens({
        ...initialDefinition,
        name: "PicMagic updated without a version bump",
      }),
    ).rejects.toMatchObject({ code: "lens/version-conflict" });

    const updated = await client.ensureLens({
      ...initialDefinition,
      name: "PicMagic updated",
      version: 42,
    });
    expect(updated.version).toBe(42);
    expect(updated.name).toBe("PicMagic updated");

    const versionOnlyUpdate = await client.ensureLens({
      ...initialDefinition,
      name: "PicMagic updated",
      version: 100,
    });
    expect(versionOnlyUpdate.version).toBe(100);
  });

  it("serves in-memory asset content from the mock CDN", async () => {
    const client = createClient({}, apiKey, { cdnBaseUrl: "https://mock-cdn.test/v1" });
    const asset = await client.assets.create({
      name: "test-image.png",
      content: {
        base64: pngBase64,
        type: "image/png",
      },
    });

    const response = await client.cdn.serve({
      assetIdentifier: asset.id,
      lens: "thumbnail",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Mock-CalmLens-CDN-URL")).toBe(
      `https://mock-cdn.test/v1/assets/${projectId}/${asset.id}/rendered/@thumbnail`,
    );
    expect(new Uint8Array(await response.arrayBuffer()).length).toBeGreaterThan(0);
  });

  it("rejects private assets for mock API keys without assets:download", async () => {
    const client = createClient({}, createMockApiKey());
    const asset = await client.assets.create({
      name: "private-document.txt",
      content: {
        base64: pngBase64,
        type: "image/png",
      },
      visibility: "private",
    });

    const response = await client.cdn.serve({ assetIdentifier: asset.id });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "asset/api-key-missing-permission",
    });
  });

  it("serves public age-restricted assets only with assets:download or the allowAgeRestricted opt-in", async () => {
    const upload = {
      name: "public-image.png",
      content: { base64: pngBase64, type: "image/png" },
      visibility: "public",
      processingOptions: { keepContentAfterProcessing: true },
    } as const;
    const withoutGrant = createClient({ analyzedOutcome: "age-restricted" }, createMockApiKey());
    const restricted = await withoutGrant.assets.classify(upload);
    const refused = await withoutGrant.cdn.serve({ assetIdentifier: restricted.id });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "asset/api-key-missing-permission" });
    const optedIn = await withoutGrant.cdn.serve({
      assetIdentifier: restricted.id,
      allowAgeRestricted: true,
    });
    expect(optedIn.status).toBe(200);

    const allowedClient = createClient({ analyzedOutcome: "allowed" }, createMockApiKey());
    const allowed = await allowedClient.assets.classify(upload);
    expect((await allowedClient.cdn.serve({ assetIdentifier: allowed.id })).status).toBe(200);

    const withGrant = createClient(
      { analyzedOutcome: "age-restricted" },
      createMockApiKey([{ actions: ["assets:download"], folderId: null, includeSubfolders: true }]),
    );
    const granted = await withGrant.assets.classify(upload);
    const served = await withGrant.cdn.serve({ assetIdentifier: granted.id });
    expect(served.status).toBe(200);
    expect(served.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("serves private assets for mock API keys with assets:download", async () => {
    const client = createClient(
      {},
      createMockApiKey([{ actions: ["assets:download"], folderId: null, includeSubfolders: true }]),
    );
    const asset = await client.assets.create({
      name: "private-document.txt",
      content: {
        base64: pngBase64,
        type: "image/png",
      },
      visibility: "private",
    });

    const response = await client.cdn.serve({ assetIdentifier: asset.id });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it("serves in-memory asset content from the mock CDN by externalId", async () => {
    const client = createClient({}, apiKey, { cdnBaseUrl: "https://mock-cdn.test/v1" });
    const externalId = "UP-test-upload-id";
    const asset = await client.assets.create({
      name: "test-image.png",
      externalId,
      content: {
        base64: pngBase64,
        type: "image/png",
      },
    });

    expect(asset.externalId).toBe(externalId);

    const response = await client.cdn.serve({ assetIdentifier: externalId, lens: "thumbnail" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Mock-CalmLens-CDN-URL")).toBe(
      `https://mock-cdn.test/v1/assets/${projectId}/${externalId}/rendered/@thumbnail`,
    );
    expect(new Uint8Array(await response.arrayBuffer()).length).toBeGreaterThan(0);
  });

  it("returns a 404 response when mock CDN content is missing", async () => {
    const client = createClient();

    const response = await client.cdn.serve({ assetIdentifier: "missing" });

    expect(response.status).toBe(404);
  });

  it("accepts storage overrides through mockOptions", async () => {
    class TrackingDatabaseStorage
      extends InMemoryMockDatabaseStorage
      implements MockDatabaseStorage
    {
      createCount = 0;

      override async createAsset(asset: Parameters<MockDatabaseStorage["createAsset"]>[0]) {
        this.createCount += 1;
        return super.createAsset(asset);
      }
    }

    class TrackingImageStorage extends InMemoryMockImageStorage implements MockImageStorage {
      putContentCount = 0;

      override async putContent(
        assetId: string,
        content: Parameters<MockImageStorage["putContent"]>[1],
      ) {
        this.putContentCount += 1;
        return super.putContent(assetId, content);
      }
    }

    const databaseStorage = new TrackingDatabaseStorage();
    const imageStorage = new TrackingImageStorage();
    const client = createClient({ databaseStorage, imageStorage });

    await client.assets.create({
      name: "test-image.png",
      content: {
        base64: pngBase64,
        type: "image/png",
      },
    });

    expect(databaseStorage.createCount).toBe(1);
    expect(imageStorage.putContentCount).toBe(1);
  });

  it("rejects invalid create and retrieve input with the real client's error codes", async () => {
    const realClient = new CalmLensServerClient({
      apiKey: "key",
      projectId,
      fetch: (async () =>
        Response.json(
          { code: PUBLIC_ERROR_CODES.ASSET_NOT_FOUND.getId(), message: "not found" },
          { status: 404 },
        )) as typeof fetch,
    });
    const invalidPayload = PUBLIC_ERROR_CODES.INVALID_UPLOAD_PAYLOAD.getId();
    const invalidArgument = "sdk/invalid-argument";
    const cases: Array<
      [string, (client: CalmLensServerClient | MockCalmLensServerClient) => Promise<unknown>]
    > = [
      [invalidPayload, (client) => client.assets.create({ name: "missing-content" } as never)],
      [invalidPayload, (client) => client.assets.create({ url: "https://example.com" } as never)],
      [invalidArgument, (client) => client.assets.retrieve({ assetId: "" })],
      [
        PUBLIC_ERROR_CODES.ASSET_NOT_FOUND.getId(),
        (client) => client.assets.retrieve({ assetId: "987fcdeb-51a2-43d7-b890-000000000000" }),
      ],
    ];
    for (const [code, run] of cases) {
      for (const client of [realClient, createClient()]) {
        const error = (await run(client).catch((caught) => caught)) as CalmLensError;
        expect(error).toBeInstanceOf(CalmLensError);
        expect(error.code).toBe(code);
      }
    }
  });

  it("exposes webhook verification as a static method", async () => {
    await expect(
      CalmLensServerClient.verifyWebhookSignature({
        payload: "{}",
        secret: "key",
        timestamp: "1700000000",
        signature: "v1=9d713ed406bb7076d4123f0dc2c39d2df5c654ed4b0cd56b52c8b4c940bd63ae",
        now: 1700000000 * 1000,
      }),
    ).resolves.toBe(true);
  });

  it("manages folder hierarchy, uniqueness, and moves", async () => {
    let idCounter = 1;
    const client = createClient({
      createId: () => `00000000-0000-0000-0000-${String(idCounter++).padStart(12, "0")}`,
    });

    // 1. Create root folders
    const marketing = await client.folders.create({ name: "Marketing" });
    const product = await client.folders.create({ name: "Product" });

    expect(marketing.name).toBe("Marketing");
    expect(marketing.parentId).toBeNull();
    expect(product.name).toBe("Product");

    // 2. Reject duplicate name at same level
    await expect(client.folders.create({ name: "Marketing" })).rejects.toMatchObject({
      code: PUBLIC_ERROR_CODES.DUPLICATE_FOLDER_NAME.getId(),
    });

    // 3. Create nested child folder
    const campaigns = await client.folders.create({
      name: "Campaigns",
      parentId: marketing.id,
    });
    expect(campaigns.parentId).toBe(marketing.id);

    // 4. Same name under different parent is allowed
    const productCampaigns = await client.folders.create({
      name: "Campaigns",
      parentId: product.id,
    });
    expect(productCampaigns.name).toBe("Campaigns");
    expect(productCampaigns.parentId).toBe(product.id);

    // 5. List folders (sorted alphabetically)
    const list = await client.folders.list();
    expect(list.folders.map((f) => f.id)).toEqual([marketing.id, product.id]);
    expect(
      (await client.folders.list({ parentId: marketing.id })).folders.map((f) => f.id),
    ).toEqual([campaigns.id]);

    const first = await client.folders.list({ pageSize: 1 });
    expect(first.folders.map((folder) => folder.id)).toEqual([marketing.id]);
    expect(first.hasMore).toBe(true);
    const second = await client.folders.list({ pageIndex: 1, pageSize: 1 });
    expect(second.folders.map((folder) => folder.id)).toEqual([product.id]);
    expect(second.hasMore).toBe(false);
    const resolved = await client.folders.list({ ids: [campaigns.id], resolveOnly: true });
    expect(resolved.folders).toEqual([]);
    expect(resolved.ancestors.map((folder) => folder.id).sort()).toEqual(
      [marketing.id, campaigns.id].sort(),
    );

    // 6. Retrieve folder
    const retrieved = await client.folders.retrieve({ folderId: campaigns.id });
    expect(retrieved).toEqual(campaigns);

    // 7. Update folder name
    const renamed = await client.folders.update({
      folderId: campaigns.id,
      name: "Summer Campaigns",
    });
    expect(renamed.name).toBe("Summer Campaigns");

    // 8. Move folder under another parent
    const moved = await client.folders.move({
      folderId: campaigns.id,
      parentId: product.id,
    });
    expect(moved.parentId).toBe(product.id);

    // 9. Move folder to root
    const rootMoved = await client.folders.move({
      folderId: campaigns.id,
      parentId: null,
    });
    expect(rootMoved.parentId).toBeNull();

    // 10. Cycle prevention: create sub-child and try to move parent into child
    const subChild = await client.folders.create({
      name: "Social",
      parentId: campaigns.id,
    });
    await expect(
      client.folders.move({ folderId: campaigns.id, parentId: subChild.id }),
    ).rejects.toMatchObject({
      code: PUBLIC_ERROR_CODES.FOLDER_PARENT_CYCLE.getId(),
    });

    // 11. Delete prevention when folder has children
    await expect(client.folders.delete({ folderId: campaigns.id })).rejects.toMatchObject({
      code: PUBLIC_ERROR_CODES.FOLDER_NOT_EMPTY.getId(),
    });

    // 12. Delete empty subChild succeeds
    await client.folders.delete({ folderId: subChild.id });
    await expect(client.folders.retrieve({ folderId: subChild.id })).rejects.toMatchObject({
      code: PUBLIC_ERROR_CODES.FOLDER_NOT_FOUND.getId(),
    });
  });

  it("waits for decisions like the real client", async () => {
    const client = createClient();
    const pending = await client.assets.create({
      name: "note.txt",
      content: { plainText: "hello", type: "text/plain" },
    });
    await expect(
      client.assets.waitForDecision({ assetId: pending.id, timeoutMs: 0 }),
    ).rejects.toMatchObject({
      code: "sdk/timeout",
      details: { classificationStatus: "processing", moderationStatus: "pending" },
    });

    const decidedClient = createClient({ queuedOutcome: "failed" });
    const queued = await decidedClient.assets.create({
      name: "image.png",
      content: { base64: `data:image/png;base64,${pngBase64}`, type: "image/png" },
    });
    expect(await decidedClient.assets.waitForDecision({ assetId: queued.id })).toMatchObject({
      id: queued.id,
      upload: { status: "completed" },
      classification: { status: "failed", moderation: { status: "pending" } },
    });
    await expect(
      decidedClient.assets.waitForDecision({ assetId: "missing" }),
    ).rejects.toMatchObject({ code: PUBLIC_ERROR_CODES.ASSET_NOT_FOUND.getId() });
  });

  it("retries failed assets, and only failed ones", async () => {
    const client = createClient({ queuedOutcome: "failed" });
    const asset = await client.assets.create({
      name: "image.png",
      content: { base64: `data:image/png;base64,${pngBase64}`, type: "image/png" },
    });
    expect(asset.classification.status).toBe("failed");
    expect(asset.content.status).toBe("temporary");

    const retried = await client.assets.retry({ assetId: asset.id });
    expect(retried.classification.status).toBe("processing");
    expect(retried.classification.moderation.status).toBe("pending");
    await expect(client.assets.retry({ assetId: asset.id })).rejects.toMatchObject({
      code: PUBLIC_ERROR_CODES.ASSET_NOT_RETRYABLE.getId(),
    });
    await expect(
      client.assets.retry({ assetId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: PUBLIC_ERROR_CODES.ASSET_NOT_FOUND.getId() });
  });

  it("removes content kept only for processing once a decision is made", async () => {
    const client = createClient({ analyzedOutcome: "blocked" });
    const asset = await client.assets.classify({
      name: "image.png",
      content: { base64: `data:image/png;base64,${pngBase64}`, type: "image/png" },
    });
    expect(asset.classification.status).toBe("completed");
    expect(asset.classification.moderation.status).toBe("blocked");
    expect(asset.content).toMatchObject({ status: "removed", removalReason: "retention" });
    expect((await client.cdn.serve({ assetIdentifier: asset.id })).status).toBe(404);
  });

  it("deletes kept content of a purged asset for policy", async () => {
    const client = createClient({ analyzedOutcome: "purged" });
    const asset = await client.assets.classify({
      name: "image.png",
      content: { base64: `data:image/png;base64,${pngBase64}`, type: "image/png" },
      processingOptions: { keepContentAfterProcessing: true },
    });
    expect(asset.classification).toMatchObject({
      status: "completed",
      moderation: { status: "purged" },
    });
    expect(asset.content).toMatchObject({ status: "removed", removalReason: "policy" });
    expect((await client.cdn.serve({ assetIdentifier: asset.id })).status).toBe(404);
  });

  it("refuses to retry a failed asset whose content was removed", async () => {
    const client = createClient({ queuedOutcome: "failed" });
    const asset = await client.assets.create({
      name: "image.png",
      content: { base64: `data:image/png;base64,${pngBase64}`, type: "image/png" },
    });
    await client.assets.deleteContent({ assetId: asset.id });
    await expect(client.assets.retry({ assetId: asset.id })).rejects.toMatchObject({
      code: PUBLIC_ERROR_CODES.ASSET_CONTENT_UNAVAILABLE.getId(),
    });
  });

  it("removes content but keeps the record, and deletes assets", async () => {
    const client = createClient({ analyzedOutcome: "allowed", now: () => 1_700_000_000_000 });
    const asset = await client.assets.classify({
      name: "image.png",
      content: { base64: `data:image/png;base64,${pngBase64}`, type: "image/png" },
      processingOptions: { keepContentAfterProcessing: true },
    });
    expect(asset.content.status).toBe("stored");
    expect((await client.cdn.serve({ assetIdentifier: asset.id })).status).toBe(200);

    const removed = await client.assets.deleteContent({ assetId: asset.id });
    expect(removed.id).toBe(asset.id);
    expect(removed.classification.moderation.status).toBe("allowed");
    expect(removed.content).toMatchObject({
      status: "removed",
      removalReason: "requested",
      updatedAt: 1_700_000_000_000,
    });
    expect((await client.cdn.serve({ assetIdentifier: asset.id })).status).toBe(404);
    expect((await client.assets.retrieve({ assetId: asset.id })).content.removalReason).toBe(
      "requested",
    );

    await client.assets.delete({ assetId: asset.id });
    await expect(client.assets.retrieve({ assetId: asset.id })).rejects.toMatchObject({
      code: PUBLIC_ERROR_CODES.ASSET_NOT_FOUND.getId(),
    });
    await expect(client.assets.delete({ assetId: asset.id })).rejects.toMatchObject({
      code: PUBLIC_ERROR_CODES.ASSET_NOT_FOUND.getId(),
    });
    await expect(client.assets.deleteContent({ assetId: "" })).rejects.toMatchObject({
      code: "sdk/invalid-argument",
    });
  });

  it("moves assets between folders and to root, and enforces empty folder deletion", async () => {
    let idCounter = 100;
    const client = createClient({
      createId: () => `00000000-0000-0000-0000-${String(idCounter++).padStart(12, "0")}`,
    });

    const folder = await client.folders.create({ name: "Assets Folder" });

    // Create an asset
    const asset = await client.assets.create({
      name: "image.png",
      content: {
        base64: `data:image/png;base64,${pngBase64}`,
        type: "image/png",
      },
    });
    expect(asset.folderId).toBeNull();

    // Move asset into folder
    const movedAsset = await client.assets.move({
      assetId: asset.id,
      folderId: folder.id,
    });
    expect(movedAsset.folderId).toBe(folder.id);

    // Verify folder cannot be deleted while containing asset
    await expect(client.folders.delete({ folderId: folder.id })).rejects.toMatchObject({
      code: PUBLIC_ERROR_CODES.FOLDER_NOT_EMPTY.getId(),
    });

    // Move asset back to root
    const rootAsset = await client.assets.move({
      assetId: asset.id,
      folderId: null,
    });
    expect(rootAsset.folderId).toBeNull();

    // Now folder can be deleted
    await client.folders.delete({ folderId: folder.id });

    // Attempting to move asset to deleted/nonexistent folder fails
    await expect(
      client.assets.move({ assetId: asset.id, folderId: folder.id }),
    ).rejects.toMatchObject({
      code: PUBLIC_ERROR_CODES.FOLDER_NOT_FOUND.getId(),
    });

    // Attempting to move nonexistent asset fails
    await expect(
      client.assets.move({ assetId: "00000000-0000-0000-0000-999999999999", folderId: null }),
    ).rejects.toMatchObject({
      code: PUBLIC_ERROR_CODES.ASSET_NOT_FOUND.getId(),
    });
  });

  it("accepts and validates the same configuration as the real client", () => {
    const client = new MockCalmLensServerClient({
      apiKey,
      projectId,
      baseUrl: "http://localhost:6130/v1",
      cdnBaseUrl: "https://cdn.test/v1/",
      timeoutMs: 5_000,
    });
    expect(client.cdn.getAssetUrl({ assetIdentifier: "a" })).toBe(
      `https://cdn.test/v1/assets/${projectId}/a/rendered`,
    );
    for (const invalid of [
      { apiKey: "" },
      { projectId: "" },
      { timeoutMs: 0 },
      { baseUrl: "not a url" },
      { cdnBaseUrl: "mock:/no" },
    ]) {
      expect(() => new MockCalmLensServerClient({ apiKey, projectId, ...invalid })).toThrow(
        CalmLensError,
      );
      expect(() => new CalmLensServerClient({ apiKey, projectId, ...invalid })).toThrow(
        CalmLensError,
      );
    }
  });

  it("simulates transport errors and timeouts like the real client throws them", async () => {
    const client = createClient();
    client.failNextRequest();
    const transportError = await client.text
      .classify({ text: "hello" })
      .catch((error: unknown) => error);
    expect(transportError).toBeInstanceOf(CalmLensError);
    expect(transportError).toMatchObject({ code: "sdk/transport-error" });
    expect((transportError as Error).cause).toBeInstanceOf(TypeError);

    client.failNextRequest("timeout", { operation: "assets.retrieve" });
    const asset = await client.text.classify({ text: "hello" });
    const timeout = await client.assets
      .retrieve({ assetId: asset.id })
      .catch((error: unknown) => error);
    expect(timeout).toMatchObject({ code: "sdk/timeout" });
    expect((timeout as Error).cause).toMatchObject({ name: "TimeoutError" });

    const custom = new CalmLensError({ id: "rate-limit/exceeded" }, { status: 429 });
    client.failNextRequest(custom);
    client.failNextRequest("transport-error");
    await expect(client.events.list()).rejects.toBe(custom);
    await expect(client.folders.list()).rejects.toMatchObject({ code: "sdk/transport-error" });
    await expect(client.assets.retrieve({ assetId: asset.id })).resolves.toMatchObject({
      id: asset.id,
    });
    expect((await client.assets.list({})).items).toHaveLength(1);
  });

  it("records each call with its operation and options", async () => {
    const client = createClient();
    const moderated = await client.text.classify({ text: "hello", externalId: "comment-1" });
    await client.assets.retrieve({ assetId: moderated.id });
    await client.ensureLenses({
      lenses: [
        { identifier: "thumb", name: "Thumb", type: "imageTransform", active: true, version: 1 },
      ],
    });
    const { cursor } = await client.events.list();
    await client.events.list({ after: cursor, limit: 10 });

    expect(client.calls.map((call) => call.operation)).toEqual([
      "text.classify",
      "assets.retrieve",
      "ensureLenses",
      "events.list",
      "events.list",
    ]);
    expect(client.callsTo("text.classify")).toEqual([
      { operation: "text.classify", options: { text: "hello", externalId: "comment-1" } },
    ]);
    expect(client.callsTo("events.list")[1]?.options).toEqual({ after: cursor, limit: 10 });
  });

  it("updates assets like the real client", async () => {
    const client = createClient();
    const asset = await client.assets.create({ name: "site", url: "https://example.com" });
    const updated = await client.assets.update({
      assetId: asset.id,
      name: "renamed",
      visibility: "public",
    });
    expect(updated).toMatchObject({ id: asset.id, name: "renamed", visibility: "public" });
    expect((await client.assets.retrieve({ assetId: asset.id })).name).toBe("renamed");
    await expect(client.assets.update({ assetId: "missing", name: "x" })).rejects.toMatchObject({
      code: PUBLIC_ERROR_CODES.ASSET_NOT_FOUND.getId(),
    });
  });
});

describe("MockCalmLensAppClient", () => {
  const PRESET = "8f0f6a8e-2c1e-4c7a-9d55-0b6f4c1a2e10";
  const photo = { data: new Blob([new Uint8Array([1, 2, 3])]), type: "image/png" };
  const codeOf = async (run: () => Promise<unknown>) =>
    run().then(
      () => undefined,
      (error: CalmLensError) => error.code,
    );

  it("stores uploads in its server mock, which serves them from the CDN", async () => {
    const app = new MockCalmLensAppClient({
      uploadPresetId: PRESET,
      mockOptions: {
        queuedOutcome: (asset) => (asset.name.includes("bad") ? "blocked" : "allowed"),
      },
    });
    const good = await app.assets.create({ name: "good.png", content: photo });
    const bad = await app.assets.create({ name: "bad.png", content: photo });

    expect([good.status, bad.status]).toEqual(["allowed", "blocked"]);
    expect((await app.assets.retrieve({ assetId: good.id })).status).toBe("allowed");
    const served = await app.server.cdn.serve({ assetIdentifier: good.id });
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await app.server.cdn.serve({ assetIdentifier: bad.id })).status).toBe(403);
    expect(
      (await app.server.cdn.serve({ assetIdentifier: bad.id, resource: "placeholder" })).status,
    ).toBe(200);
  });

  it("applies the preset's token, type and size rules with the API's error codes", async () => {
    const app = new MockCalmLensAppClient({
      uploadPresetId: PRESET,
      mockOptions: {
        preset: { requireToken: true, allowedContentTypes: ["image/*"], maxFileSizeInBytes: 2 },
      },
    });
    expect(await codeOf(() => app.assets.create({ name: "a.png", content: photo }))).toBe(
      "upload-preset/token-required",
    );
    const withToken = new MockCalmLensAppClient({
      uploadPresetId: PRESET,
      token: "clut_test",
      mockOptions: {
        server: app.server,
        preset: { allowedContentTypes: ["image/*"], maxFileSizeInBytes: 2 },
      },
    });
    expect(await codeOf(() => withToken.assets.create({ name: "a.png", content: photo }))).toBe(
      "upload-preset/too-large",
    );
    expect(
      await codeOf(() =>
        withToken.assets.create({
          name: "a.txt",
          content: { plainText: "hi", type: "text/plain" },
        }),
      ),
    ).toBe("upload-preset/content-type-not-allowed");
  });

  it("hides decisions when the preset doesn't show them, and checks only its own uploads", async () => {
    const app = new MockCalmLensAppClient({
      uploadPresetId: PRESET,
      mockOptions: { queuedOutcome: "allowed", preset: { showDecisions: false } },
    });
    const upload = await app.assets.create({ name: "a.png", content: photo });
    expect(upload.status).toBeUndefined();
    const other = new MockCalmLensAppClient({
      uploadPresetId: PRESET,
      mockOptions: { server: app.server },
    });
    expect(await codeOf(() => other.assets.retrieve({ assetId: upload.id }))).toBe(
      "asset/not-found",
    );
  });
});
