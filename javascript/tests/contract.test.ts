// Replays the shared SDK contract fixtures that packages/sdk-contract/generate.ts writes to
// sdks/go/testdata (format in packages/sdk-contract/README.md): webhook parsing,
// transform options, mock behaviour scenarios, the server SDK surface and rejections.
// Each fixture case is its own test.
import { describe, expect, it, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serializeTransform } from "../src/client/CalmLensUtils";
import * as server from "../src/server";
import { CalmLensError, parseWebhookEvent } from "../src/server";
import * as testing from "../src/testing";
import { createMockApiKey, MockCalmLensServerClient } from "../src/testing";

const testdata = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "../../go/testdata", name), "utf8"));

describe("webhook parsing", () => {
  const { parsing } = testdata("webhooks.json") as {
    parsing: {
      body: string;
      secret: string;
      timestamp: string;
      signature: string;
      now: number;
      expectedType: string;
      expectedFactKey: string;
    }[];
  };
  for (const fixture of parsing) {
    it(`parses a ${fixture.expectedType} event with its ${fixture.expectedFactKey} fact`, async () => {
      const parsed = await parseWebhookEvent({
        ...fixture,
        payload: fixture.body,
        now: fixture.now * 1000,
      });
      expect(parsed).toEqual(JSON.parse(fixture.body));
      expect(parsed.type).toBe(fixture.expectedType);
      expect(parsed.data.facts?.[0]?.key).toBe(fixture.expectedFactKey);
    });
  }
});

describe("transform options", () => {
  const { cases }: { cases: { options: Record<string, unknown>; selector: string }[] } =
    testdata("transform-options.json");
  for (const { options, selector } of cases) {
    test(`serializes ${JSON.stringify(options)} to ${selector}`, () => {
      expect(serializeTransform({ type: "imageTransform", options })).toBe(selector);
    });
  }
});

// Shared mock behaviour scenarios (packages/sdk-contract/mockScenarios.ts), replayed by every
// SDK's offline mock. The format is described in packages/sdk-contract/README.md.
type Scenario = {
  name: string;
  mock: { queuedOutcome?: string; analyzedOutcome?: string; apiKeyGrants?: unknown[] };
  steps: Array<{
    operation: string;
    args?: Record<string, unknown>;
    save?: string;
    expect?: {
      result?: Record<string, unknown>;
      sameAs?: string;
      error?: { code: string; status: number | null };
      cdn?: {
        status: number;
        code?: string;
        body?: string;
        headers?: Record<string, string>;
      };
    };
  }>;
};
const { scenarios }: { scenarios: Scenario[] } = testdata("mock-scenarios.json");

/** Follows a dotted path: numeric segments index arrays, `length` is an array's length. */
const at = (value: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((current, segment) => {
    if (Array.isArray(current))
      return segment === "length" ? current.length : current[Number(segment)];
    return current && typeof current === "object"
      ? (current as Record<string, unknown>)[segment]
      : undefined;
  }, value);

const isMarker = (value: unknown, key: string): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && key in value;

const resolveRefs = (value: unknown, saved: Record<string, unknown>): unknown => {
  if (isMarker(value, "$ref")) {
    const [name, ...path] = String(value.$ref).split(".");
    return at(saved[name!], path.join("."));
  }
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, saved));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveRefs(item, saved)]),
    );
  }
  return value;
};

const run = async (
  client: MockCalmLensServerClient,
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  switch (operation) {
    case "mock.decide":
      return client.decide(args.assetId as string, args.outcome as never);
    case "mock.enqueueEvent":
      return client.enqueueEvent(args as never);
    case "cdn.serve": {
      const response = await client.cdn.serve(args as never);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const text = new TextDecoder().decode(bytes);
      const code = response.headers.get("content-type")?.startsWith("application/json")
        ? (JSON.parse(text) as { code?: string }).code
        : undefined;
      return { status: response.status, code, body: text, headers: response.headers };
    }
  }
  const [resource, method] = operation.split(".") as [string, string];
  const target = (
    client as unknown as Record<string, Record<string, (options: unknown) => unknown>>
  )[resource]!;
  return JSON.parse(JSON.stringify((await target[method]!(args)) ?? null));
};

describe("shared mock scenarios", () => {
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const client = new MockCalmLensServerClient({
        apiKey: createMockApiKey((scenario.mock.apiKeyGrants ?? []) as never),
        projectId: "project-1",
        mockOptions: {
          queuedOutcome: scenario.mock.queuedOutcome as never,
          analyzedOutcome: scenario.mock.analyzedOutcome as never,
        },
      });
      const saved: Record<string, unknown> = {};
      for (const [index, step] of scenario.steps.entries()) {
        const label = `step ${index + 1} (${step.operation})`;
        const args = resolveRefs(step.args ?? {}, saved) as Record<string, unknown>;
        let result: unknown;
        let error: unknown;
        try {
          result = await run(client, step.operation, args);
        } catch (caught) {
          error = caught;
        }
        if (step.expect?.error) {
          expect(error, label).toBeInstanceOf(CalmLensError);
          const { code, status } = error as CalmLensError;
          expect({ code, status: status ?? null }, label).toEqual(step.expect.error);
          continue;
        }
        if (error) throw error;
        if (step.expect?.cdn) {
          const { status, code, body, headers } = result as {
            status: number;
            code?: string;
            body: string;
            headers: Headers;
          };
          const expected = step.expect.cdn;
          expect(
            {
              status,
              ...(expected.code !== undefined ? { code } : {}),
              ...(expected.body !== undefined ? { body } : {}),
              // Header names are case-insensitive: Headers.get matches any case.
              ...(expected.headers !== undefined
                ? {
                    headers: Object.fromEntries(
                      Object.keys(expected.headers).map((name) => [name, headers.get(name)]),
                    ),
                  }
                : {}),
            },
            label,
          ).toEqual(expected);
        }
        if (step.expect?.sameAs !== undefined) {
          expect(step.expect.sameAs in saved, `${label}: saved ${step.expect.sameAs}`).toBe(true);
          expect(result, `${label}: same as ${step.expect.sameAs}`).toEqual(
            saved[step.expect.sameAs],
          );
        }
        for (const [path, raw] of Object.entries(step.expect?.result ?? {})) {
          const actual = at(result, path);
          if (isMarker(raw, "$contains")) {
            expect(actual, `${label}: ${path}`).toContainEqual(resolveRefs(raw.$contains, saved));
          } else {
            expect(actual, `${label}: ${path}`).toEqual(resolveRefs(raw, saved));
          }
        }
        if (step.save) saved[step.save] = result;
      }
    });
  }
});

interface Capability {
  id: string;
  kind: string;
  value?: string;
  names: { javascript: string };
}
const surface: {
  capabilities: Capability[];
  errorResponse: {
    operation: string;
    options: object;
    status: number;
    headers: Record<string, string>;
    body: unknown;
    expected: { code: string; status: number; requestId: string; retryAfterSeconds: number };
  };
} = testdata("surface.json");

// Server entry exports, and `testing.*` for `@calmlens/sdk/testing`.
const modules = { ...server, testing };

const resolve = (root: unknown, path: string): unknown =>
  path.split(".").reduce<any>((value, key) => (value == null ? undefined : value[key]), root);

const refuse = async (): Promise<Response> => {
  throw new Error("sent a request");
};
const client = new server.CalmLensServerClient({
  apiKey: "key",
  projectId: "project-1",
  fetch: refuse,
  cdnFetch: refuse,
  maxRetries: 0,
});

const raisedError = async () => {
  const { operation, options, status, headers, body } = surface.errorResponse;
  const failing = new server.CalmLensServerClient({
    apiKey: "key",
    projectId: "project-1",
    fetch: async () => Response.json(body, { status, headers }),
    maxRetries: 0,
  });
  const [resource, method] = operation.split(".") as [string, string];
  return await (failing as any)[resource][method](options).then(
    () => {
      throw new Error(`${operation} did not fail`);
    },
    (error: server.CalmLensError) => error,
  );
};

const mockOutcome = async (option: string) => {
  const mock = new testing.MockCalmLensServerClient({
    apiKey: testing.createMockApiKey(),
    projectId: "project-1",
    mockOptions: { [option]: "blocked" },
  });
  const content = {
    name: "note.txt",
    content: { plainText: "hello", type: "text/plain" },
  } as const;
  const asset =
    option === "queuedOutcome"
      ? await mock.assets.create(content)
      : await mock.assets.classify(content);
  return asset.classification.moderation.status;
};

const present = async (capability: Capability): Promise<boolean> => {
  const name = capability.names.javascript;
  switch (capability.kind) {
    case "method":
      return typeof resolve(client, name) === "function";
    case "function":
    case "mock-client":
    case "mock-function":
      return typeof resolve(modules, name) === "function";
    case "constant":
      return resolve(modules, name) === capability.value;
    case "error-field": {
      const error = await raisedError();
      const { expected } = surface.errorResponse;
      const want = {
        "errors.code": expected.code,
        "errors.status": expected.status,
        "errors.requestId": expected.requestId,
        "errors.retryAfter": expected.retryAfterSeconds,
      }[capability.id];
      return error instanceof server.CalmLensError && resolve(error, name) === want;
    }
    case "cdn-resource":
      return client.cdn
        .getAssetUrl({ assetIdentifier: "asset-1", resource: name as never })
        .endsWith(`/asset-1/${capability.value}`);
    case "cdn-option":
      return client.cdn
        .getAssetUrl({ assetIdentifier: "asset-1", [name]: true })
        .endsWith("?allowAgeRestricted=true");
    case "mock-method": {
      const mock = new testing.MockCalmLensServerClient({
        apiKey: testing.createMockApiKey(),
        projectId: "project-1",
      });
      return typeof resolve(mock, name) === "function";
    }
    case "mock-option":
      return (await mockOutcome(name.replace(/^mockOptions\./, ""))) === "blocked";
    default:
      throw new Error(`Unknown capability kind ${capability.kind}`);
  }
};

describe("SDK surface", () => {
  for (const capability of surface.capabilities) {
    test(`offers ${capability.id} as ${capability.names.javascript}`, async () => {
      expect(await present(capability)).toBe(true);
    });
  }
});

describe("rejections", () => {
  const rejections: { name: string; operation: string; options: object; error: string }[] =
    testdata("rejections.json");
  for (const { name, operation, options, error } of rejections) {
    test(name, async () => {
      let sent = 0;
      const counting = async () => {
        sent++;
        return Response.json({});
      };
      const capturing = new server.CalmLensServerClient({
        apiKey: "key",
        projectId: "project-1",
        fetch: counting,
        cdnFetch: counting,
        maxRetries: 0,
      });
      const [resource, method] = operation.split(".") as [string, string];
      const code = await (capturing as any)[resource][method](options).then(
        () => "accepted",
        (failure: server.CalmLensError) => failure.code,
      );
      expect({ code, sent }).toEqual({ code: error, sent: 0 });
    });
  }
});
