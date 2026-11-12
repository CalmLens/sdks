import { afterEach, describe, expect, test } from "bun:test";
import { CalmLensServerClient, type RequestAttempt } from "../src/server";
import { createMockApiKey, MockCalmLensServerClient } from "../src/testing";

const apiKey = "sk_test_setup";
const projectId = "project-1";

const recordingFetch = (respond: (request: Request) => Response | Promise<Response>) => {
  const requests: Request[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    return respond(request);
  }) as typeof fetch;
  return { fetchImpl, requests };
};

/** A 503 that asks for an immediate retry, then the responses in `then`. */
const unavailableOnce = (then: () => Response) => {
  let calls = 0;
  return () =>
    calls++ === 0
      ? Response.json(
          { code: "service/unavailable", message: "Try again" },
          { status: 503, headers: { "retry-after": "0", "x-request-id": "req_first" } },
        )
      : then();
};

const ENV_NAMES = [
  "CALMLENS_API_KEY",
  "CALMLENS_PROJECT_ID",
  "CALMLENS_BASE_URL",
  "CALMLENS_LOG",
] as const;
const savedEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of ENV_NAMES) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

describe("client setup from the environment", () => {
  test("reads the API key, project ID and base URL when the options leave them out", async () => {
    process.env.CALMLENS_API_KEY = "sk_from_env";
    process.env.CALMLENS_PROJECT_ID = "project-env";
    process.env.CALMLENS_BASE_URL = "https://api.example.test/v1/";
    const { fetchImpl, requests } = recordingFetch(() =>
      Response.json({ items: [], nextCursor: null, hasMore: false }),
    );
    await new CalmLensServerClient({ fetch: fetchImpl }).folders.list();
    expect(requests[0]!.url).toBe("https://api.example.test/v1/projects/project-env/folders");
    expect(requests[0]!.headers.get("x-api-key")).toBe("sk_from_env");
  });

  test("options win over the environment", async () => {
    process.env.CALMLENS_API_KEY = "sk_from_env";
    process.env.CALMLENS_PROJECT_ID = "project-env";
    const { fetchImpl, requests } = recordingFetch(() =>
      Response.json({ items: [], nextCursor: null, hasMore: false }),
    );
    await new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl }).folders.list();
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/projects/project-1/folders");
    expect(requests[0]!.headers.get("x-api-key")).toBe(apiKey);
  });

  test("without a key in the options or environment, construction fails with sdk/invalid-config", () => {
    delete process.env.CALMLENS_API_KEY;
    expect(() => new CalmLensServerClient({ projectId })).toThrow(
      expect.objectContaining({ code: "sdk/invalid-config" }),
    );
  });

  test("mock clients never read the environment", async () => {
    process.env.CALMLENS_PROJECT_ID = "project-env";
    process.env.CALMLENS_BASE_URL = "https://api.example.test/v1";
    const mock = new MockCalmLensServerClient({ apiKey: createMockApiKey() });
    expect(mock.toJSON().projectId).toBe("project-1");
    expect(mock.toJSON().baseUrl).not.toBe("https://api.example.test/v1");
  });
});

describe("appInfo", () => {
  test("is appended to the user agent as name/version (url)", async () => {
    const { fetchImpl, requests } = recordingFetch(() => Response.json({ id: "fldr_1" }));
    const client = new CalmLensServerClient({
      apiKey,
      projectId,
      fetch: fetchImpl,
      appInfo: { name: "Calmgram", version: "2.1.0", url: "https://calmgram.example" },
    });
    await client.folders.retrieve({ folderId: "fldr_1" });
    expect(requests[0]!.headers.get("user-agent")).toMatch(
      /^calmlens-js\/\S+ \(.+\) Calmgram\/2\.1\.0 \(https:\/\/calmgram\.example\)$/,
    );
  });
});

describe("per-call request options", () => {
  test("maxRetries applies to that call only", async () => {
    const { fetchImpl, requests } = recordingFetch(
      () => new Response(null, { status: 503, headers: { "retry-after": "0" } }),
    );
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl, maxRetries: 2 });
    await expect(
      client.folders.retrieve({ folderId: "fldr_1" }, { maxRetries: 0 }),
    ).rejects.toMatchObject({ status: 503 });
    expect(requests).toHaveLength(1);
    await expect(client.folders.retrieve({ folderId: "fldr_1" })).rejects.toMatchObject({
      status: 503,
    });
    expect(requests).toHaveLength(4);
  });

  test("timeoutMs applies to that call only", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: async () => {
        await Bun.sleep(200);
        return Response.json({ id: "fldr_1" });
      },
    });
    try {
      const client = new CalmLensServerClient({
        apiKey,
        projectId,
        baseUrl: `${server.url}v1`,
        maxRetries: 0,
      });
      await expect(
        client.folders.retrieve({ folderId: "fldr_1" }, { timeoutMs: 20 }),
      ).rejects.toMatchObject({ code: "sdk/timeout" });
      expect(await client.folders.retrieve({ folderId: "fldr_1" })).toMatchObject({
        id: "fldr_1",
      });
    } finally {
      server.stop(true);
    }
  });

  test("headers are added under the SDK's own, which win", async () => {
    const { fetchImpl, requests } = recordingFetch(() => Response.json({ id: "fldr_1" }));
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    await client.folders.retrieve(
      { folderId: "fldr_1" },
      { headers: { "x-trace": "abc", "x-api-key": "stolen" } },
    );
    expect(requests[0]!.headers.get("x-trace")).toBe("abc");
    expect(requests[0]!.headers.get("x-api-key")).toBe(apiKey);
  });

  test("extraQuery and extraBody reach the API without the option check", async () => {
    const { fetchImpl, requests } = recordingFetch(() =>
      Response.json({ id: "fldr_1", items: [], nextCursor: null, hasMore: false }),
    );
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    await client.folders.list({ pageSize: 5 }, { extraQuery: { preview: "yes" } });
    const url = new URL(requests[0]!.url);
    expect(url.searchParams.get("pageSize")).toBe("5");
    expect(url.searchParams.get("preview")).toBe("yes");

    await client.folders.create({ name: "Uploads" }, { extraBody: { colour: "blue" } });
    expect(await requests[1]!.json()).toEqual({ name: "Uploads", colour: "blue" });

    // The typo check still applies to the method's own options.
    await expect(
      client.folders.create({ name: "Uploads", colour: "blue" } as never),
    ).rejects.toMatchObject({ code: "sdk/invalid-argument" });
    expect(requests).toHaveLength(2);
  });

  test("extraQuery reaches every page an iteration fetches", async () => {
    const { fetchImpl, requests } = recordingFetch((request) =>
      new URL(request.url).searchParams.get("cursor")
        ? Response.json({ items: [{ id: "b" }], nextCursor: null, hasMore: false })
        : Response.json({ items: [{ id: "a" }], nextCursor: "next", hasMore: true }),
    );
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    const ids: string[] = [];
    for await (const folder of client.folders.list({}, { extraQuery: { preview: "yes" } })) {
      ids.push(folder.id);
    }
    expect(ids).toEqual(["a", "b"]);
    expect(requests.map((request) => new URL(request.url).searchParams.get("preview"))).toEqual([
      "yes",
      "yes",
    ]);
  });

  test("an idempotencyKey is sent and makes a write retryable", async () => {
    const { fetchImpl, requests } = recordingFetch(
      unavailableOnce(() => Response.json({ id: "fldr_1" })),
    );
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    const folder = await client.folders.create({ name: "Uploads" }, { idempotencyKey: "key-1" });
    expect(folder.id).toBe("fldr_1");
    expect(requests.map((request) => request.headers.get("idempotency-key"))).toEqual([
      "key-1",
      "key-1",
    ]);
  });

  test("refuses unknown request options and extraBody on a request without a body", async () => {
    const { fetchImpl, requests } = recordingFetch(() => Response.json({ id: "fldr_1" }));
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    await expect(
      client.folders.retrieve({ folderId: "fldr_1" }, { timeout: 5 } as never),
    ).rejects.toMatchObject({ code: "sdk/invalid-argument", details: { options: ["timeout"] } });
    await expect(
      client.folders.retrieve({ folderId: "fldr_1" }, { extraBody: { a: 1 } }),
    ).rejects.toMatchObject({ code: "sdk/invalid-argument" });
    expect(requests).toHaveLength(0);
  });

  test("waitForDecision checks with the call's request options", async () => {
    const { fetchImpl, requests } = recordingFetch(() =>
      Response.json({
        id: "asset-1",
        upload: { status: "completed" },
        classification: { status: "completed", moderation: { decision: "allowed" } },
      }),
    );
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    await client.assets.waitForDecision({ assetId: "asset-1" }, { headers: { "x-trace": "t" } });
    expect(requests[0]!.headers.get("x-trace")).toBe("t");
  });
});

describe("client.request", () => {
  test("sends any request with the client's key, retries and lastResponse", async () => {
    const { fetchImpl, requests } = recordingFetch(
      unavailableOnce(() =>
        Response.json({ ok: true }, { headers: { "x-request-id": "req_raw" } }),
      ),
    );
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    const result = await client.request<{ ok: boolean }>("GET", "/beta/things", {
      query: { anything: "goes" },
    });
    expect(result.ok).toBe(true);
    expect(result.lastResponse.requestId).toBe("req_raw");
    expect(requests).toHaveLength(2);
    expect(requests[1]!.url).toBe("https://api.calmlens.com/v1/beta/things?anything=goes");
    expect(requests[1]!.headers.get("x-api-key")).toBe(apiKey);
  });

  test("sends a body as it is and maps errors like any method", async () => {
    const { fetchImpl, requests } = recordingFetch(() =>
      Response.json({ code: "asset/not-found", message: "No asset" }, { status: 404 }),
    );
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    const failure = await client
      .request("POST", "/assets/asset_1/anything", { body: { unchecked: true } })
      .catch((error) => error);
    expect(failure).toMatchObject({ code: "asset/not-found", status: 404 });
    expect(await requests[0]!.json()).toEqual({ unchecked: true });
  });

  test("refuses a path that isn't relative to the base URL", async () => {
    const { fetchImpl, requests } = recordingFetch(() => Response.json({}));
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl });
    for (const path of ["assets", "https://evil.example/x", "//evil.example/x"]) {
      await expect(client.request("GET", path)).rejects.toMatchObject({
        code: "sdk/invalid-argument",
      });
    }
    expect(requests).toHaveLength(0);
  });
});

describe("observability", () => {
  test("onAttempt receives every attempt, with the delay before a retry", async () => {
    const attempts: RequestAttempt[] = [];
    const { fetchImpl } = recordingFetch(
      unavailableOnce(() =>
        Response.json(
          { items: [], nextCursor: null, hasMore: false },
          { headers: { "x-request-id": "r2" } },
        ),
      ),
    );
    const client = new CalmLensServerClient({
      apiKey,
      projectId,
      fetch: fetchImpl,
      onAttempt: (attempt) => attempts.push(attempt),
    });
    await client.folders.list({ parentId: "secret-query" });
    expect(attempts).toMatchObject([
      {
        operation: "folders.list",
        method: "GET",
        path: "/v1/projects/project-1/folders",
        attempt: 1,
        delayMs: 0,
        status: 503,
        requestId: "req_first",
        errorCode: "service/unavailable",
      },
      { operation: "folders.list", attempt: 2, delayMs: null, status: 200, requestId: "r2" },
    ]);
    expect(attempts.every((attempt) => attempt.durationMs >= 0)).toBe(true);
    expect(JSON.stringify(attempts)).not.toContain(apiKey);
    expect(JSON.stringify(attempts)).not.toContain("secret-query");
  });

  test("a hook that throws doesn't fail the request", async () => {
    const { fetchImpl } = recordingFetch(() => Response.json({ id: "fldr_1" }));
    const client = new CalmLensServerClient({
      apiKey,
      projectId,
      fetch: fetchImpl,
      onAttempt: () => {
        throw new Error("hook bug");
      },
    });
    expect(await client.folders.retrieve({ folderId: "fldr_1" })).toMatchObject({ id: "fldr_1" });
  });

  const capture = () => {
    const lines: { level: string; message: string }[] = [];
    return {
      lines,
      logger: {
        debug: (message: string) => lines.push({ level: "debug", message }),
        info: (message: string) => lines.push({ level: "info", message }),
      },
    };
  };

  test("info logs retries and failures, debug every attempt, never the key or query", async () => {
    for (const [logLevel, expected] of [
      ["info", ["info"]],
      ["debug", ["debug", "debug"]],
      ["off", []],
    ] as const) {
      const { lines, logger } = capture();
      const { fetchImpl } = recordingFetch(
        unavailableOnce(() => Response.json({ items: [], nextCursor: null, hasMore: false })),
      );
      const client = new CalmLensServerClient({
        apiKey,
        projectId,
        fetch: fetchImpl,
        logger,
        logLevel,
      });
      await client.folders.list({ parentId: "secret-query" });
      expect(
        lines.map((line) => line.level),
        logLevel,
      ).toEqual([...expected]);
      for (const { message } of lines) {
        expect(message).toContain("folders.list");
        expect(message).not.toContain(apiKey);
        expect(message).not.toContain("secret-query");
      }
    }
  });

  test("CALMLENS_LOG sets the level when the options don't", async () => {
    process.env.CALMLENS_LOG = "debug";
    const { lines, logger } = capture();
    const { fetchImpl } = recordingFetch(() => Response.json({ id: "fldr_1" }));
    const client = new CalmLensServerClient({ apiKey, projectId, fetch: fetchImpl, logger });
    await client.folders.retrieve({ folderId: "fldr_1" });
    expect(lines.map((line) => line.level)).toEqual(["debug"]);
  });

  test("refuses an unknown log level", () => {
    expect(
      () => new CalmLensServerClient({ apiKey, projectId, logLevel: "verbose" as never }),
    ).toThrow(expect.objectContaining({ code: "sdk/invalid-config" }));
  });
});
