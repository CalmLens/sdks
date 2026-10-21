import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { renderErrorCodes } from "../scripts/generate-error-codes";
import { CalmLensError, CalmLensServerClient, SDK_VERSION } from "../src/server";

const projectId = "project-1";
const apiKey = "sk_live_secret_value";

const recordingFetch = (respond: (request: Request) => Response | Promise<Response>) => {
  const requests: Request[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    return respond(request);
  }) as typeof fetch;
  return { fetchImpl, requests };
};

describe("client identity and secrets", () => {
  test("sends a User-Agent with the package version and runtime", async () => {
    const { fetchImpl, requests } = recordingFetch(() =>
      Response.json({
        id: "a",
        upload: { status: "completed" },
        classification: { status: "completed", moderation: { decision: "approved" } },
      }),
    );
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    await client.assets.retrieve({ assetId: "a" });
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(SDK_VERSION).toBe(manifest.version);
    expect(requests[0]!.headers.get("user-agent")).toBe(
      `calmlens-js/${manifest.version} (bun/${Bun.version})`,
    );
  });

  test("keeps the API key out of inspect and JSON output", () => {
    const client = new CalmLensServerClient({ apiKey, projectId });
    expect(inspect(client, { depth: 10, showHidden: true })).not.toContain(apiKey);
    expect(JSON.stringify(client)).not.toContain(apiKey);
    expect(JSON.parse(JSON.stringify(client))).toMatchObject({ projectId });
    expect(inspect(client.withRequestOptions({ timeoutMs: 5 }))).not.toContain(apiKey);
  });

  test("rejects the removed requestBackend option with a clear code", () => {
    expect(
      () => new CalmLensServerClient({ apiKey, projectId, requestBackend: {} } as never),
    ).toThrow(expect.objectContaining({ code: "sdk/invalid-config" }));
  });
});

describe("browser guard", () => {
  const globals = globalThis as { window?: unknown; document?: unknown };
  afterEach(() => {
    delete globals.window;
    delete globals.document;
  });

  test("refuses to run with an API key in a web page unless explicitly allowed", async () => {
    globals.window = {};
    globals.document = {};
    expect(() => new CalmLensServerClient({ apiKey, projectId })).toThrow(
      expect.objectContaining({ code: "sdk/invalid-config" }),
    );
    const { fetchImpl, requests } = recordingFetch(() =>
      Response.json({
        id: "a",
        upload: { status: "completed" },
        classification: { status: "completed", moderation: { decision: "approved" } },
      }),
    );
    const client = new CalmLensServerClient({
      apiKey,
      projectId,
      fetch: fetchImpl,
      dangerouslyAllowBrowser: true,
    });
    await client.assets.retrieve({ assetId: "a" });
    // A custom User-Agent would force a CORS preflight in browsers.
    expect(requests[0]!.headers.has("user-agent")).toBe(false);
  });
});

describe("CalmLensError", () => {
  test("instanceof recognises errors from another copy of the SDK by their brand", () => {
    const foreign = Object.defineProperty(
      new Error("from the CommonJS build"),
      Symbol.for("calmlens.sdk.CalmLensError"),
      { value: true },
    );
    expect(foreign instanceof CalmLensError).toBe(true);
    expect(CalmLensError.isCalmLensError(foreign)).toBe(true);
    expect(new Error("plain") instanceof CalmLensError).toBe(false);
    expect(CalmLensError.isCalmLensError({ code: "asset/not-found" })).toBe(false);
  });

  test("the exported API error codes match shared/PublicErrorCodes", () => {
    const generated = readFileSync(
      new URL("../src/client/CalmLensErrorCodes.ts", import.meta.url),
      "utf8",
    );
    expect(generated).toBe(renderErrorCodes());
  });
});

describe("responses", () => {
  test("accepts asset statuses this SDK version does not know", async () => {
    const { fetchImpl } = recordingFetch(() =>
      Response.json({
        id: "a",
        content: { status: "archived", removalReason: null },
        upload: { status: "completed" },
        classification: {
          status: "paused",
          moderation: { decision: "escalated", action: "quarantine" },
        },
      }),
    );
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    const asset = await client.assets.create({
      name: "a.txt",
      content: { plainText: "hi", type: "text/plain" },
    });
    expect(asset.classification.status).toBe("paused");
    expect(asset.classification.moderation).toMatchObject({
      decision: "escalated",
      action: "quarantine",
    });
    expect(asset.content.status).toBe("archived");
  });

  test("refuses response bodies larger than maxResponseBytes", async () => {
    const { fetchImpl } = recordingFetch(() =>
      Response.json({
        id: "a",
        description: "x".repeat(1000),
        upload: { status: "completed" },
        classification: { status: "completed", moderation: { decision: "approved" } },
      }),
    );
    const client = new CalmLensServerClient({
      apiKey,
      projectId,
      fetch: fetchImpl,
      maxResponseBytes: 100,
    });
    await expect(client.assets.retrieve({ assetId: "a" })).rejects.toMatchObject({
      code: "sdk/response-too-large",
    });
  });

  test("ensureLenses fails when the API returns fewer lenses than requested", async () => {
    const { fetchImpl } = recordingFetch(() => Response.json({ lenses: [] }));
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    await expect(
      client.ensureLens({
        identifier: "thumb",
        name: "Thumb",
        type: "image",
        active: true,
        version: 1,
      }),
    ).rejects.toMatchObject({ code: "sdk/invalid-response" });
  });
});

describe("pagination", () => {
  test("assets.iterate and iterateChildren fetch every page", async () => {
    const pages = [["a", "b"], ["c", "d"], ["e"]];
    const { fetchImpl, requests } = recordingFetch((request) => {
      const pageIndex = [null, "next-a", "next-b"].indexOf(
        new URL(request.url).searchParams.get("cursor"),
      );
      const items = pages[pageIndex]!.map((id) => ({
        id,
        classification: { moderation: { decision: "approved" } },
      }));
      return Response.json({
        items,
        hasMore: pageIndex < pages.length - 1,
        nextCursor: ["next-a", "next-b", null][pageIndex],
        pageSize: 2,
      });
    });
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });

    const ids: string[] = [];
    for await (const asset of client.assets.iterate({
      pageSize: 2,
      filter: "classification.moderation.decision==approved",
    })) {
      ids.push(asset.id);
    }
    expect(ids).toEqual(["a", "b", "c", "d", "e"]);
    const listUrls = requests.map((request) => new URL(request.url));
    expect(listUrls.map((url) => url.searchParams.get("cursor"))).toEqual([
      null,
      "next-a",
      "next-b",
    ]);
    expect(
      listUrls.every(
        (url) => url.searchParams.get("filter") === "classification.moderation.decision==approved",
      ),
    ).toBe(true);

    const children: string[] = [];
    for await (const child of client.assets.iterateChildren({ assetId: "parent" })) {
      children.push(child.id);
    }
    expect(children).toEqual(["a", "b", "c", "d", "e"]);
    expect(new URL(requests[3]!.url).pathname).toBe("/v1/assets/parent/children");
  });

  test("events.pages follows the cursor until no more events are waiting", async () => {
    const feed: Record<string, { events: { id: string }[]; cursor: string; hasMore: boolean }> = {
      start: { events: [{ id: "e1" }], cursor: "c1", hasMore: true },
      c1: { events: [{ id: "e2" }], cursor: "c2", hasMore: false },
    };
    const { fetchImpl } = recordingFetch((request) =>
      Response.json(feed[new URL(request.url).searchParams.get("after")!]),
    );
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    const seen: string[] = [];
    let cursor = "start";
    for await (const page of client.events.pages({ after: "start", limit: 100 })) {
      seen.push(...page.events.map((event) => event.id));
      cursor = page.cursor;
    }
    expect(seen).toEqual(["e1", "e2"]);
    expect(cursor).toBe("c2");
  });
});

describe("deadlines for large transfers", () => {
  const delayedServer = (delayMs: number, body: () => BodyInit) =>
    Bun.serve({
      port: 0,
      fetch: async (request) => {
        await request.arrayBuffer();
        await Bun.sleep(delayMs);
        return new Response(body(), { headers: { "Content-Type": "application/json" } });
      },
    });

  test("binary uploads are not cut off by timeoutMs unless uploadTimeoutMs is set", async () => {
    const server = delayedServer(150, () =>
      JSON.stringify({
        id: "a",
        upload: { status: "completed" },
        classification: { status: "processing", moderation: { decision: "pending" } },
      }),
    );
    try {
      const options = { apiKey, projectId, baseUrl: server.url.toString(), timeoutMs: 50 };
      const upload = {
        name: "a.pdf",
        content: { buffer: new Uint8Array([1, 2, 3]).buffer, type: "application/pdf" },
      };
      await expect(new CalmLensServerClient(options).assets.create(upload)).resolves.toMatchObject({
        id: "a",
      });
      await expect(
        new CalmLensServerClient({ ...options, uploadTimeoutMs: 50, maxRetries: 0 }).assets.create(
          upload,
        ),
      ).rejects.toMatchObject({ code: "sdk/timeout" });
    } finally {
      server.stop(true);
    }
  });

  test("cdn.serve's deadline ends when headers arrive, so slow bodies still stream", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode("first,"));
              await Bun.sleep(150);
              controller.enqueue(new TextEncoder().encode("second"));
              controller.close();
            },
          }),
        ),
    });
    try {
      const client = new CalmLensServerClient({
        apiKey,
        projectId,
        cdnBaseUrl: server.url.toString(),
        timeoutMs: 50,
      });
      const response = await client.cdn.serve({ assetIdentifier: "a" });
      expect(await response.text()).toBe("first,second");
    } finally {
      server.stop(true);
    }
  });
});

describe("assets.waitForDecision", () => {
  const assetResponse = (processing: string, moderation = "pending") =>
    Response.json({
      id: "asset-1",
      upload: { status: "completed" },
      classification: { status: processing, moderation: { decision: moderation } },
    });

  test("checks the asset until it has a decision, then returns the decided asset", async () => {
    const states: Array<[string, string]> = [
      ["processing", "pending"],
      ["processing", "pending"],
      ["done", "rejected"],
    ];
    const { fetchImpl, requests } = recordingFetch(() => assetResponse(...states.shift()!));
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    const asset = await client.assets.waitForDecision({ assetId: "asset-1" });
    expect(asset).toMatchObject({
      id: "asset-1",
      classification: { moderation: { decision: "rejected" } },
    });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/v1/assets/asset-1",
      "/v1/assets/asset-1",
      "/v1/assets/asset-1",
    ]);
  });

  test("returns an asset whose processing failed without waiting for a decision", async () => {
    const states: Array<[string, string]> = [
      ["processing", "pending"],
      ["failed", "pending"],
    ];
    const { fetchImpl, requests } = recordingFetch(() => assetResponse(...states.shift()!));
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    const asset = await client.assets.waitForDecision({ assetId: "asset-1" });
    expect(asset).toMatchObject({
      upload: { status: "completed" },
      classification: { status: "failed", moderation: { decision: "pending" } },
    });
    expect(requests).toHaveLength(2);
  });

  test("rejects with sdk/timeout and the last status when no decision arrives in time", async () => {
    const { fetchImpl } = recordingFetch(() => assetResponse("processing"));
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    const error = await client.assets
      .waitForDecision({ assetId: "asset-1", timeoutMs: 0 })
      .catch((caught: CalmLensError) => caught);
    expect(error).toMatchObject({
      code: "sdk/timeout",
      details: {
        assetId: "asset-1",
        classificationStatus: "processing",
        moderationStatus: "pending",
      },
    });
  });

  test("stops waiting with sdk/cancelled when the signal aborts", async () => {
    const { fetchImpl, requests } = recordingFetch(() => assetResponse("processing"));
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    const controller = new AbortController();
    const waiting = client.assets
      .waitForDecision({ assetId: "asset-1", signal: controller.signal })
      .catch((caught: CalmLensError) => caught);
    await Bun.sleep(50);
    controller.abort();
    expect(await waiting).toMatchObject({ code: "sdk/cancelled" });
    expect(requests).toHaveLength(1);
  });
});
