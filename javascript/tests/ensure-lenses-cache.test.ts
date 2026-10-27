import { describe, expect, test } from "bun:test";
import { ENSURE_LENSES_MAX_PER_REQUEST } from "../src/client/CalmLensServerClient";
import type { Lens } from "../src/contract/Lens.js";
import { CalmLensServerClient, type EnsureLensOptions } from "../src/server";

const projectId = "proj_8fK2mQx7Lp4NvB3tRz9Y";

const normalLens: EnsureLensOptions = {
  identifier: "picmagic-normal",
  name: "PicMagic normal",
  type: "image",
  active: true,
  version: 1,
  transforms: [
    {
      type: "imageTransform",
      options: { fit: "scale-down", width: 1024, format: "png" },
    },
  ],
};

const uhdLens: EnsureLensOptions = {
  ...normalLens,
  identifier: "picmagic-uhd",
  name: "PicMagic UHD",
  transforms: [
    {
      type: "imageTransform",
      options: { fit: "scale-down", width: 2048, format: "png" },
    },
  ],
};

const toLens = (options: EnsureLensOptions): Lens => ({
  id: `lens-${options.identifier}`,
  projectId,
  userId: null,
  ...options,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
});

describe("ensureLenses cache", () => {
  test("coalesces concurrent batches, caches identical definitions, and invalidates prior versions", async () => {
    const requestUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = (await request.json()) as { lenses: EnsureLensOptions[] };
      requestUrls.push(request.url);
      return Response.json({ lenses: body.lenses.map(toLens) });
    };
    const client = new CalmLensServerClient({
      apiKey: "test-api-key",
      projectId,
      fetch: fetchImpl,
    });

    await Promise.all([
      client.ensureLenses({ lenses: [normalLens, uhdLens] }),
      client.ensureLenses({ lenses: [uhdLens, normalLens] }),
    ]);
    expect(requestUrls).toEqual([`https://api.calmlens.com/v1/projects/${projectId}/lenses`]);

    await client.ensureLens({
      ...normalLens,
      description: null,
      transforms: [
        {
          type: "imageTransform",
          options: { format: "png", width: 1024, fit: "scale-down" },
        },
      ],
    });
    expect(requestUrls).toHaveLength(1);

    const normalLensV2 = { ...normalLens, name: "PicMagic normal v2", version: 2 };
    await client.ensureLenses({ lenses: [normalLensV2] });
    expect(requestUrls).toHaveLength(2);

    await client.ensureLens(normalLens);
    expect(requestUrls).toHaveLength(3);
  });

  test("sends more than the per-request limit in consecutive requests, in order", async () => {
    const requests: { method: string; identifiers: string[] }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = (await request.json()) as { lenses: EnsureLensOptions[] };
      requests.push({
        method: request.method,
        identifiers: body.lenses.map((lens) => lens.identifier),
      });
      return Response.json({ lenses: body.lenses.map(toLens) });
    };
    const client = new CalmLensServerClient({
      apiKey: "test-api-key",
      projectId,
      fetch: fetchImpl,
    });
    const identifiers = Array.from(
      { length: ENSURE_LENSES_MAX_PER_REQUEST + 1 },
      (_, i) => `lens-${i}`,
    );

    const lenses = await client.ensureLenses({
      lenses: identifiers.map((identifier) => ({ ...normalLens, identifier })),
    });

    expect(requests).toEqual([
      { method: "PUT", identifiers: identifiers.slice(0, 100) },
      { method: "PUT", identifiers: identifiers.slice(100) },
    ]);
    expect(lenses.map((lens) => lens.identifier)).toEqual(identifiers);
    expect(lenses.map((lens) => lens.id)).toEqual(
      identifiers.map((identifier) => `lens-${identifier}`),
    );
  });
});
