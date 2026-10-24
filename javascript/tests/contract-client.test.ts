// Replays the shared fixtures that check the real client's requests and results, written by
// packages/sdk-contract (format in its README.md) to sdks/go/testdata: requests.json, paths.json,
// errors.json, client-cases.json and surface.json's defaults. The fixtures are recorded from this
// SDK, so replaying the committed copies is what catches a regression here.
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
} from "../src/client/CalmLensConnection";
import { ENSURE_LENSES_MAX_PER_REQUEST } from "../src/client/CalmLensServerClient";
import {
  RETRY_AFTER_MAX_MS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
} from "../src/client/CalmLensTransport";
import {
  DECISION_POLL_DELAY_FACTOR,
  DECISION_POLL_FIRST_DELAY_MS,
  DECISION_POLL_MAX_DELAY_MS,
  DEFAULT_DECISION_TIMEOUT_MS,
  DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS,
} from "../src/client/CalmLensUtils";
import { UPLOAD_TOKEN_DEFAULT_TTL_SECONDS } from "../src/contract/UploadToken.js";
import { CalmLensError, CalmLensServerClient } from "../src/server";
import { testdata } from "./testdata";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const invoke = async (client: CalmLensServerClient, operation: string, args: unknown) => {
  const collect = async (iterator: AsyncIterable<unknown>) => {
    const items: unknown[] = [];
    try {
      for await (const item of iterator) items.push(item);
    } catch (error) {
      throw Object.assign(new Error("iteration failed"), { partial: items, error });
    }
    return items;
  };
  const anyArgs = args as never;
  switch (operation) {
    case "assets.iterate":
      return collect(client.assets.iterate(anyArgs));
    case "assets.iterateChildren":
      return collect(client.assets.iterateChildren(anyArgs));
    case "events.iterate":
      return collect(client.events.pages(anyArgs));
    case "ensureLens":
      return client.ensureLens(anyArgs);
    case "ensureLenses":
      return client.ensureLenses(anyArgs);
  }
  const [resource, method] = operation.split(".") as [string, string];
  return (client as any)[resource][method](args);
};

/** The error fields every runner compares, `null` where there is none. */
const errorFields = (error: unknown) => {
  expect(error).toBeInstanceOf(CalmLensError);
  const { code, status, requestId, retryAfter, details } = error as CalmLensError;
  return {
    code,
    status: status ?? null,
    requestId: requestId ?? null,
    retryAfter: retryAfter ?? null,
    details: details ? JSON.parse(JSON.stringify(details)) : null,
  };
};

const fail = (operation: string) => () => {
  throw new Error(`${operation} succeeded`);
};

// ---- requests.json --------------------------------------------------------------------------

describe("request fixtures", () => {
  const fixtures: {
    operation: string;
    options: unknown;
    request: { method: string; path: string; query: Record<string, string>; body: unknown };
    response: Json;
  }[] = testdata("requests.json");
  for (const [index, { operation, options, request, response }] of fixtures.entries()) {
    test(`${index + 1}: ${operation} sends the recorded request and returns the response`, async () => {
      const sent: unknown[] = [];
      const client = new CalmLensServerClient({
        apiKey: "key",
        projectId: "project-1",
        maxRetries: 0,
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          const text = init?.body == null ? "" : await new Response(init.body).text();
          const isJson = new Headers(init?.headers)
            .get("content-type")
            ?.startsWith("application/json");
          sent.push({
            method: init?.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            body: isJson && text ? JSON.parse(text) : text || null,
          });
          return Response.json(response);
        }) as typeof fetch,
      });
      const result = await invoke(client, operation, options);
      expect(sent).toEqual([request]);
      // Deletes return nothing; ensureLenses returns the lenses; everything else the body.
      const expected = operation.endsWith(".delete")
        ? undefined
        : operation === "ensureLenses"
          ? (response as { lenses: Json }).lenses
          : response;
      expect(result).toEqual(expected);
    });
  }
});

// ---- paths.json -----------------------------------------------------------------------------

describe("path fixtures", () => {
  const { rejections, cdnUrls } = testdata("paths.json") as {
    rejections: { operation: string; options: unknown; error: string }[];
    cdnUrls: { options: Record<string, unknown>; url?: string; error?: string }[];
  };
  for (const { operation, options, error } of rejections) {
    test(`${operation} refuses ${JSON.stringify(options)} with ${error} before sending`, async () => {
      let sent = 0;
      const client = new CalmLensServerClient({
        apiKey: "key",
        projectId: "project-1",
        fetch: (async () => {
          sent++;
          return Response.json({});
        }) as unknown as typeof fetch,
      });
      const code = await invoke(client, operation, options).then(
        () => "accepted",
        (failure: CalmLensError) => failure.code,
      );
      expect({ code, sent }).toEqual({ code: error, sent: 0 });
    });
  }
  const client = new CalmLensServerClient({ apiKey: "key", projectId: "project-1" });
  for (const { options, url, error } of cdnUrls) {
    test(`CDN URL for ${JSON.stringify(options)}`, () => {
      let actual: { url?: string; error?: string };
      try {
        actual = { url: client.cdn.getAssetUrl(options as never) };
      } catch (failure) {
        actual = { error: (failure as CalmLensError).code };
      }
      expect(actual).toEqual(url === undefined ? { error } : { url });
    });
  }
});

// ---- errors.json ----------------------------------------------------------------------------

describe("API error fixtures", () => {
  const fixtures: {
    code: string;
    operation: string;
    args: unknown;
    response: { status: number; headers: Record<string, string>; body: Json };
    expected: ReturnType<typeof errorFields>;
  }[] = testdata("errors.json");
  for (const { code, operation, args, response, expected } of fixtures) {
    test(`${code} becomes a typed error with every field`, async () => {
      const client = new CalmLensServerClient({
        apiKey: "key",
        projectId: "project-1",
        maxRetries: 0,
        fetch: (async () =>
          new Response(JSON.stringify(response.body), {
            status: response.status,
            headers: response.headers,
          })) as unknown as typeof fetch,
      });
      const error = await invoke(client, operation, args).then(fail(operation), (e: unknown) => e);
      expect(errorFields(error)).toEqual(expected);
    });
  }
});

// ---- client-cases.json ----------------------------------------------------------------------

interface ScriptedResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: Json;
  bodyText?: string;
  bodyBase64?: string;
  transportError?: true;
  hang?: true;
}
interface ExpectedRequest {
  method: string;
  origin: string;
  path: string;
  rawQuery: string;
  query: [string, string][];
  headers: Record<string, Json>;
  body?: Json;
  bodyLength?: number;
  bodySha256?: string;
  bodyBase64?: string;
}
interface ClientCase {
  name: string;
  area: string;
  requires?: string;
  client?: Record<string, Json>;
  cancelAfterRequests?: number;
  responses: ScriptedResponse[];
  steps: {
    operation: string;
    args?: Json;
    expect?: {
      result?: Json;
      error?: Record<string, Json>;
      partialResult?: Json[];
      cdn?: { status: number; headers: Record<string, string | null>; bodyBase64: string };
    };
  }[];
  requests: ExpectedRequest[];
  sleepsMs?: Array<number | [number, number]>;
}
const clientCases: {
  client: Record<string, Json>;
  everyRequest: { headers: Record<string, Json> };
  cases: ClientCase[];
} = testdata("client-cases.json");
const surface: {
  capabilities: { id: string; notApplicable?: Record<string, string> }[];
  defaults: { id: string; value: Json; observedBy: string[] }[];
} = testdata("surface.json");

const isMarker = (value: unknown, key: string): value is Record<string, Json> =>
  !!value && typeof value === "object" && !Array.isArray(value) && key in value;

const decodeArgs = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(decodeArgs);
  if (isMarker(value, "$bytes")) return new Uint8Array(Buffer.from(String(value.$bytes), "base64"));
  if (isMarker(value, "$stream")) {
    const data = new Uint8Array(Buffer.from(String(value.$stream), "base64"));
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
  }
  if (isMarker(value, "$fill")) {
    const { byte, length } = value.$fill as { byte: number; length: number };
    return new Uint8Array(length).fill(byte);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeArgs(item)]));
  }
  return value;
};

const toResponse = (scripted: ScriptedResponse) => {
  const status = scripted.status ?? 200;
  const body =
    scripted.body !== undefined
      ? JSON.stringify(scripted.body)
      : scripted.bodyBase64 !== undefined
        ? Buffer.from(scripted.bodyBase64, "base64")
        : (scripted.bodyText ?? null);
  return new Response(status === 204 ? null : body, { status, headers: scripted.headers });
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Checks one header against its expectation; `$uuid` labels must map one-to-one to values. */
const checkHeader = (
  label: string,
  name: string,
  actual: string | null,
  expected: Json,
  uuids: Map<string, string>,
) => {
  if (isMarker(expected, "$absent")) {
    expect(actual, `${label}: ${name} is absent`).toBeNull();
  } else if (isMarker(expected, "$regex")) {
    expect(actual ?? "", `${label}: ${name}`).toMatch(new RegExp(String(expected.$regex)));
  } else if (isMarker(expected, "$uuid")) {
    expect(actual ?? "", `${label}: ${name} is a UUID`).toMatch(UUID_V4);
    const known = uuids.get(String(expected.$uuid));
    if (known === undefined) {
      expect([...uuids.values()], `${label}: ${name} is a new value`).not.toContain(actual);
      uuids.set(String(expected.$uuid), actual!);
    } else {
      expect(actual, `${label}: ${name} reuses ${expected.$uuid}`).toBe(known);
    }
  } else {
    expect(actual, `${label}: ${name}`).toBe(expected as string);
  }
};

const sortPairs = (pairs: [string, string][]) =>
  [...pairs].sort((a, b) => (`${a[0]}\0${a[1]}` < `${b[0]}\0${b[1]}` ? -1 : 1));

describe("scripted client cases", () => {
  const notApplicable = new Map(
    surface.capabilities.map(({ id, notApplicable }) => [id, notApplicable?.javascript]),
  );
  for (const clientCase of clientCases.cases) {
    const reason = clientCase.requires ? notApplicable.get(clientCase.requires) : undefined;
    if (clientCase.requires && !notApplicable.has(clientCase.requires)) {
      test(clientCase.name, () => {
        throw new Error(`requires unknown capability ${clientCase.requires}`);
      });
      continue;
    }
    if (reason) {
      test.skip(`${clientCase.name} (not applicable: ${reason})`, () => {});
      continue;
    }
    test(`${clientCase.area}: ${clientCase.name}`, async () => {
      const received: { url: URL; headers: Headers; body: Uint8Array; method: string }[] = [];
      const abort = new AbortController();
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        received.push({
          url: new URL(String(input)),
          method: init?.method ?? "GET",
          headers: new Headers(init?.headers),
          body:
            init?.body == null
              ? new Uint8Array(0)
              : new Uint8Array(await new Response(init.body).arrayBuffer()),
        });
        const scripted = clientCase.responses[received.length - 1];
        if (!scripted) throw new Error(`request ${received.length} has no scripted response`);
        if (clientCase.cancelAfterRequests === received.length) abort.abort();
        if (scripted.hang) {
          return await new Promise<Response>((_, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) reject(signal.reason);
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }
        if (scripted.transportError) throw new TypeError("fetch failed");
        return toResponse(scripted);
      }) as typeof fetch;

      const started = performance.now();
      let client: CalmLensServerClient | undefined;
      let constructionError: unknown;
      try {
        client = new CalmLensServerClient({
          ...(clientCases.client as object),
          ...(clientCase.client as object),
          fetch: fetchImpl,
          cdnFetch: fetchImpl,
          ...(clientCase.cancelAfterRequests ? { signal: abort.signal } : {}),
        } as never);
      } catch (error) {
        constructionError = error;
      }
      for (const [index, step] of clientCase.steps.entries()) {
        const label = `step ${index + 1} (${step.operation})`;
        const expected = step.expect;
        let result: unknown;
        let error: unknown = constructionError;
        if (!error) {
          try {
            result = await invoke(client!, step.operation, decodeArgs(step.args ?? {}));
          } catch (caught) {
            error = caught;
          }
        }
        if (expected?.error) {
          const partial = (error as { partial?: unknown[] })?.partial;
          const cause = partial ? (error as { error: unknown }).error : error;
          const { retryAfter, ...fields } = expected.error;
          const actual = errorFields(cause);
          if (isMarker(retryAfter, "$gte")) {
            expect(actual.retryAfter, `${label}: retryAfter`).toBeGreaterThanOrEqual(
              Number(retryAfter.$gte),
            );
            expect({ ...actual, retryAfter: undefined }, label).toEqual({
              ...fields,
              retryAfter: undefined,
            } as never);
          } else {
            expect(actual, label).toEqual({ ...fields, retryAfter } as never);
          }
          if (expected.partialResult) {
            expect(JSON.parse(JSON.stringify(partial ?? null)), `${label}: yielded`).toEqual(
              expected.partialResult,
            );
          }
          break;
        }
        if (error) throw error;
        if (expected?.cdn) {
          const response = result as Response;
          expect(
            {
              status: response.status,
              headers: Object.fromEntries(
                Object.keys(expected.cdn.headers).map((name) => [name, response.headers.get(name)]),
              ),
              bodyBase64: Buffer.from(await response.arrayBuffer()).toString("base64"),
            },
            label,
          ).toEqual(expected.cdn);
        } else {
          expect(JSON.parse(JSON.stringify(result ?? null)), label).toEqual(
            expected?.result ?? null,
          );
        }
      }
      const elapsed = performance.now() - started;

      expect(received.length, "requests sent").toBe(clientCase.requests.length);
      const uuids = new Map<string, string>();
      for (const [index, want] of clientCase.requests.entries()) {
        const got = received[index]!;
        const label = `request ${index + 1}`;
        expect(
          { method: got.method, origin: got.url.origin, path: got.url.pathname },
          label,
        ).toEqual({ method: want.method, origin: want.origin, path: want.path });
        // Queries compare decoded, as the API's parser reads them; pair order is free.
        expect(sortPairs([...got.url.searchParams]), `${label}: query`).toEqual(
          sortPairs(want.query),
        );
        expect(sortPairs([...new URLSearchParams(want.rawQuery)]), `${label}: rawQuery`).toEqual(
          sortPairs(want.query),
        );
        for (const [name, value] of Object.entries({
          ...clientCases.everyRequest.headers,
          ...want.headers,
        })) {
          checkHeader(label, name, got.headers.get(name), value, uuids);
        }
        if ("body" in want) {
          if (want.body === null) expect(got.body.byteLength, `${label}: no body`).toBe(0);
          else {
            expect(JSON.parse(new TextDecoder().decode(got.body)), `${label}: body`).toEqual(
              want.body,
            );
          }
        } else {
          expect(
            {
              bodyLength: got.body.byteLength,
              bodySha256: new Bun.CryptoHasher("sha256").update(got.body).digest("hex"),
              ...(want.bodyBase64 === undefined
                ? {}
                : { bodyBase64: Buffer.from(got.body).toString("base64") }),
            },
            `${label}: raw body`,
          ).toEqual({
            bodyLength: want.bodyLength,
            bodySha256: want.bodySha256,
            ...(want.bodyBase64 === undefined ? {} : { bodyBase64: want.bodyBase64 }),
          } as never);
        }
      }
      if (clientCase.sleepsMs) {
        const sum = (pick: 0 | 1) =>
          clientCase.sleepsMs!.reduce<number>(
            (total, sleep) => total + (Array.isArray(sleep) ? sleep[pick] : sleep),
            0,
          );
        // Timers may fire a millisecond early; requests and scheduling add the rest.
        expect(elapsed, "time spent waiting").toBeGreaterThanOrEqual(
          sum(0) - 5 * clientCase.sleepsMs.length,
        );
        expect(elapsed, "time spent waiting").toBeLessThanOrEqual(sum(1) + 1500);
      }
    });
  }
});

// ---- surface.json defaults ------------------------------------------------------------------

describe("client defaults", () => {
  const client = new CalmLensServerClient({ apiKey: "key", projectId: "project-1" });
  const values: Record<string, unknown> = {
    baseUrl: client.toJSON().baseUrl,
    cdnBaseUrl: client.toJSON().cdnBaseUrl,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    retryBaseDelayMs: RETRY_BASE_DELAY_MS,
    retryMaxDelayMs: RETRY_MAX_DELAY_MS,
    retryAfterMaxMs: RETRY_AFTER_MAX_MS,
    maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    signedUrlExpiresInSeconds: DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS,
    uploadTokenExpiresInSeconds: UPLOAD_TOKEN_DEFAULT_TTL_SECONDS,
    waitForDecisionTimeoutMs: DEFAULT_DECISION_TIMEOUT_MS,
    waitForDecisionFirstIntervalMs: DECISION_POLL_FIRST_DELAY_MS,
    waitForDecisionIntervalFactor: DECISION_POLL_DELAY_FACTOR,
    waitForDecisionMaxIntervalMs: DECISION_POLL_MAX_DELAY_MS,
    ensureLensesBatchSize: ENSURE_LENSES_MAX_PER_REQUEST,
  };
  // Binary uploads have no deadline unless one is set: there is no value to read back.
  const withoutValue = new Set(["uploadTimeoutMs"]);
  const caseNames = new Set(clientCases.cases.map(({ name }) => name));
  for (const { id, value, observedBy } of surface.defaults) {
    test(`${id} defaults to ${JSON.stringify(value)}`, () => {
      expect(id in values || withoutValue.has(id), `${id} is known`).toBe(true);
      if (id in values) expect(values[id]).toEqual(value);
      for (const name of observedBy) expect(caseNames.has(name), name).toBe(true);
    });
  }
});
