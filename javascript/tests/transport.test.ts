import { expect, test } from "bun:test";
import {
  type Asset,
  type AssetPage,
  CalmLensError,
  CalmLensServerClient,
  type ClassificationReport,
  type Folder,
} from "../src/server";

// Retries have their own tests (retries.test.ts); here every failure must surface at once.
const options = { apiKey: "synthetic", projectId: "test", maxRetries: 0 };
const upload = { name: "test", content: { plainText: "hello", type: "text/plain" } };

test("rejects redirects before credentials reach another origin on every transport", async () => {
  let forwarded = 0;
  const destination = Bun.serve({
    port: 0,
    fetch: () => {
      forwarded++;
      return Response.json({
        id: "a",
        processing: { status: "done" },
        moderation: { status: "approved" },
      });
    },
  });
  const source = Bun.serve({ port: 0, fetch: () => Response.redirect(destination.url, 307) });
  try {
    const client = new CalmLensServerClient({
      ...options,
      baseUrl: source.url.toString(),
      cdnBaseUrl: source.url.toString(),
    });
    for (const call of [
      () => client.assets.moderate(upload),
      () => client.assets.retrieve({ assetId: "a" }),
      () => client.cdn.serve({ assetIdentifier: "a", init: { redirect: "follow" } }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(CalmLensError);
    }
    expect(forwarded).toBe(0);
  } finally {
    source.stop(true);
    destination.stop(true);
  }
});

test("invalid successful uploads and generic HTTP failures have typed diagnostics", async () => {
  for (const body of ["not-json", "", "null", "{}", '{"id":"a"}']) {
    const client = new CalmLensServerClient({
      ...options,
      uploadFetch: (async () => new Response(body, { status: 200 })) as typeof fetch,
    });
    await expect(client.assets.moderate(upload)).rejects.toMatchObject({
      code: "sdk/invalid-response",
      status: 200,
    });
  }
  const client = new CalmLensServerClient({
    ...options,
    uploadFetch: (async () => new Response("oops", { status: 502 })) as typeof fetch,
  });
  await expect(client.assets.moderate(upload)).rejects.toMatchObject({
    code: "sdk/http-error",
    status: 502,
  });
});

test("scoped cancellation applies to REST, uploads and CDN without changing defaults", async () => {
  const abort = new AbortController();
  abort.abort();
  const client = new CalmLensServerClient(options);
  const scoped = client.withRequestOptions({ signal: abort.signal });
  for (const call of [
    () => scoped.assets.moderate(upload),
    () => scoped.assets.retrieve({ assetId: "a" }),
    () => scoped.cdn.serve({ assetIdentifier: "a" }),
  ]) {
    await expect(call()).rejects.toMatchObject({ code: "sdk/cancelled" });
  }
  expect(() => new CalmLensServerClient({ ...options, timeoutMs: 0 })).toThrow(CalmLensError);
});

test("request deadlines include delayed response bodies", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"id":'));
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  });
  try {
    const client = new CalmLensServerClient({
      ...options,
      baseUrl: server.url.toString(),
      timeoutMs: 30,
    });
    await expect(client.assets.moderate(upload)).rejects.toMatchObject({ code: "sdk/timeout" });
    await expect(client.assets.retrieve({ assetId: "a" })).rejects.toMatchObject({
      code: "sdk/timeout",
    });
  } finally {
    server.stop(true);
  }
});

const failingFetch = (cause: Error) =>
  (async () => {
    throw cause;
  }) as unknown as typeof fetch;

/** A 200 response whose body stream fails after the first chunk, like a reset connection. */
const brokenBodyFetch = (cause: Error) =>
  (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":'));
          controller.error(cause);
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof fetch;

const transportCalls = (client: CalmLensServerClient) => [
  () => client.assets.retrieve({ assetId: "a" }),
  () => client.events.list({ after: "cursor" }),
  () => client.assets.moderate(upload),
  () => client.text.moderate({ text: "hello" }),
];

test("network failures are wrapped as sdk/transport-error with the original cause", async () => {
  const cause = new TypeError("fetch failed: ECONNRESET");
  const client = new CalmLensServerClient({
    ...options,
    fetch: failingFetch(cause),
    uploadFetch: failingFetch(cause),
    cdnFetch: failingFetch(cause),
  });
  for (const call of [
    ...transportCalls(client),
    () => client.cdn.serve({ assetIdentifier: "a" }),
  ]) {
    const error = await call().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(CalmLensError);
    expect(error).toMatchObject({ code: "sdk/transport-error", cause });
  }
});

test("failures while reading a response body are transport errors, not invalid responses", async () => {
  const cause = new TypeError("terminated");
  const client = new CalmLensServerClient({
    ...options,
    fetch: brokenBodyFetch(cause),
    uploadFetch: brokenBodyFetch(cause),
  });
  for (const call of transportCalls(client)) {
    await expect(call()).rejects.toMatchObject({ code: "sdk/transport-error", cause });
  }
});

test("truncated bodies, resets and bad compression from a real server are transport errors", async () => {
  const truncated = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket) {
        socket.end(
          'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{"id":',
        );
      },
    },
  });
  const reset = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket) {
        socket.terminate();
      },
    },
  });
  const badGzip = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(new Uint8Array([1, 2, 3, 4, 5]), {
        headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
      }),
  });
  try {
    for (const baseUrl of [
      `http://127.0.0.1:${truncated.port}/v1`,
      `http://127.0.0.1:${reset.port}/v1`,
      badGzip.url.toString(),
    ]) {
      const client = new CalmLensServerClient({ ...options, baseUrl });
      for (const call of transportCalls(client)) {
        const error = await call().catch((error: unknown) => error);
        expect(error).toBeInstanceOf(CalmLensError);
        expect((error as CalmLensError).code).toBe("sdk/transport-error");
        expect((error as CalmLensError).cause).toBeInstanceOf(Error);
      }
    }
  } finally {
    truncated.stop(true);
    reset.stop(true);
    badGzip.stop(true);
  }
});

test("a well-delivered body that is not JSON is still an invalid response", async () => {
  const notJson = (async () =>
    new Response("not json{", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
  const client = new CalmLensServerClient({
    ...options,
    fetch: notJson,
  });
  await expect(client.assets.retrieve({ assetId: "a" })).rejects.toMatchObject({
    code: "sdk/invalid-response",
    status: 200,
  });
});

test("invalid options are rejected before the client is set up", () => {
  for (const invalid of [
    { apiKey: "" },
    { projectId: "" },
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 1.5 },
    { timeoutMs: Number.NaN },
    { timeoutMs: "1000" as unknown as number },
    { baseUrl: "not a url" },
    { baseUrl: "ftp://api.example.com" },
    { cdnBaseUrl: "cdn.example.com/v1" },
  ]) {
    expect(() => new CalmLensServerClient({ ...options, ...invalid })).toThrow(CalmLensError);
  }
  expect(() => new CalmLensServerClient(undefined as never)).toThrow(CalmLensError);
  expect(
    () =>
      new CalmLensServerClient({ ...options, baseUrl: "http://localhost:6130/v1", timeoutMs: 1 }),
  ).not.toThrow();
});

// These imports must remain available in the published declaration bundle.
export type PublicModels = [Asset, AssetPage, Folder, ClassificationReport];
