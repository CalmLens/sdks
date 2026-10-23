import { describe, expect, test } from "bun:test";
import { type CalmLensError, CalmLensServerClient } from "../src/server";

const projectId = "project-1";
const asset = {
  id: "asset-1",
  upload: { status: "completed" },
  classification: { status: "completed", moderation: { status: "allowed" } },
};
const text = { name: "note.txt", content: { plainText: "hello", type: "text/plain" } };

/** A fetch that answers from `responses` in order and records each request. */
const scriptedFetch = (responses: Array<() => Response | Promise<Response>>) => {
  const requests: Request[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    const next = responses[requests.length - 1];
    if (!next) throw new Error(`Unexpected request ${requests.length}`);
    return next();
  }) as typeof fetch;
  return { fetchImpl, requests };
};

const apiError =
  (status: number, code: string, headers: Record<string, string> = {}) =>
  () =>
    Response.json({ code, message: code }, { status, headers });

describe("retries", () => {
  test("retries reads after gateway errors and throttling, then returns the result", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      () => new Response("bad gateway", { status: 502 }),
      apiError(429, "rate-limited", { "Retry-After": "0" }),
      () => Response.json(asset),
    ]);
    const client = new CalmLensServerClient({ apiKey: "key", projectId, fetch: fetchImpl });
    await expect(client.assets.retrieve({ assetId: "asset-1" })).resolves.toEqual(asset);
    expect(requests).toHaveLength(3);
  });

  test("retries a transport failure that happened before any response", async () => {
    let calls = 0;
    const client = new CalmLensServerClient({
      apiKey: "key",
      projectId,
      fetch: (async () => {
        calls++;
        if (calls === 1) throw new TypeError("fetch failed: ECONNRESET");
        return Response.json(asset);
      }) as unknown as typeof fetch,
    });
    await expect(client.assets.retrieve({ assetId: "asset-1" })).resolves.toEqual(asset);
    expect(calls).toBe(2);
  });

  test("retries uploads with the same Idempotency-Key, including while the first is in progress", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      apiError(409, "idempotency/request-in-progress", { "Retry-After": "0" }),
      apiError(503, "unavailable", { "Retry-After": "0" }),
      () => Response.json(asset),
    ]);
    const client = new CalmLensServerClient({ apiKey: "key", projectId, fetch: fetchImpl });
    await expect(client.assets.create(text)).resolves.toEqual(asset);
    expect(requests).toHaveLength(3);
    const keys = requests.map((request) => request.headers.get("idempotency-key"));
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(keys).size).toBe(1);
  });

  test("uses a new key for each call, or the caller's key when given", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      () => Response.json(asset),
      () => Response.json(asset),
      () => Response.json(asset),
    ]);
    const client = new CalmLensServerClient({ apiKey: "key", projectId, fetch: fetchImpl });
    await client.assets.create(text);
    await client.assets.create(text);
    await client.text.classify({ text: "hi", idempotencyKey: "comment-42" });
    const keys = requests.map((request) => request.headers.get("idempotency-key"));
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[2]).toBe("comment-42");
    // The key is a header, never part of the asset fields.
    expect(new URL(requests[2]!.url).searchParams.has("idempotencyKey")).toBe(false);
  });

  test("does not retry writes without an idempotency key", async () => {
    const { fetchImpl, requests } = scriptedFetch([apiError(503, "unavailable")]);
    const client = new CalmLensServerClient({ apiKey: "key", projectId, fetch: fetchImpl });
    const error = await client.assets
      .move({ assetId: "asset-1", folderId: null })
      .catch((caught: unknown) => caught as CalmLensError);
    expect(error).toMatchObject({ code: "unavailable", status: 503 });
    expect((error as CalmLensError).isRetryable()).toBe(true);
    expect(requests).toHaveLength(1);
  });

  test("does not retry a streamed body, which the first attempt consumed", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      apiError(503, "unavailable", { "Retry-After": "0" }),
    ]);
    const client = new CalmLensServerClient({ apiKey: "key", projectId, fetch: fetchImpl });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    await expect(
      client.assets.create({
        name: "a.pdf",
        content: { data: stream, type: "application/pdf", sizeInBytes: 3 },
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(requests).toHaveLength(1);
  });

  test("stops after maxRetries and returns long Retry-After delays to the caller", async () => {
    const throttled = apiError(429, "rate-limited", { "Retry-After": "0" });
    const limited = scriptedFetch([throttled, throttled]);
    const client = new CalmLensServerClient({
      apiKey: "key",
      projectId,
      fetch: limited.fetchImpl,
      maxRetries: 1,
    });
    await expect(client.assets.retrieve({ assetId: "a" })).rejects.toMatchObject({ status: 429 });
    expect(limited.requests).toHaveLength(2);

    const slow = scriptedFetch([apiError(429, "rate-limited", { "Retry-After": "3600" })]);
    const slowClient = new CalmLensServerClient({
      apiKey: "key",
      projectId,
      fetch: slow.fetchImpl,
    });
    await expect(slowClient.assets.retrieve({ assetId: "a" })).rejects.toMatchObject({
      status: 429,
      retryAfter: 3600,
    });
    expect(slow.requests).toHaveLength(1);
  });

  test("never retries client errors", async () => {
    const { fetchImpl, requests } = scriptedFetch([apiError(404, "asset/not-found")]);
    const client = new CalmLensServerClient({ apiKey: "key", projectId, fetch: fetchImpl });
    const error = (await client.assets
      .retrieve({ assetId: "a" })
      .catch((caught: unknown) => caught)) as CalmLensError;
    expect(error.isNotFound()).toBe(true);
    expect(error.isRetryable()).toBe(false);
    expect(requests).toHaveLength(1);
  });
});
