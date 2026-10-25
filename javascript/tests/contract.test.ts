// Replays the shared SDK contract fixtures that packages/sdk-contract/generate.ts writes to
// sdks/go/testdata (format in packages/sdk-contract/README.md): webhook parsing,
// transform options, mock behaviour scenarios, the server SDK surface and rejections.
// Each fixture case is its own test.
import { describe, expect, it, test } from "bun:test";
import { Buffer } from "node:buffer";
import { serializeTransform } from "../src/client/CalmLensUtils";
import * as server from "../src/server";
import { CalmLensError, parseWebhookEvent } from "../src/server";
import * as testing from "../src/testing";
import { createMockApiKey, MockCalmLensServerClient } from "../src/testing";
import { testdata } from "./testdata";

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

// ---- Shared mock behaviour scenarios ------------------------------------------------------
// packages/sdk-contract/mockScenarios.ts writes them and every SDK's offline mock replays them.
// The format (operations, `$ref`/`$concat`/`$base64Repeat` values, `repeat`, and the `result`,
// `sameAs`, `error` and `cdn` expectations) is described in packages/sdk-contract/README.md
// under "Mock behaviour scenarios".
type ScenarioStep = {
  operation: string;
  args?: Record<string, unknown>;
  save?: string;
  repeat?: number;
  expect?: {
    result?: Record<string, unknown>;
    sameAs?: string;
    httpStatus?: number;
    error?: { code: string; status: number | null; details?: Record<string, unknown> };
    cdn?: {
      status: number;
      code?: string;
      body?: string;
      bodyPrefixBase64?: string;
      headers?: Record<string, unknown>;
      headersPresent?: string[];
    };
  };
};
type Scenario = {
  name: string;
  mock: { queuedOutcome?: string; analyzedOutcome?: string; apiKeyGrants?: unknown[] };
  steps: ScenarioStep[];
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

/** Resolves `$ref`, `$concat` and `$base64Repeat` values (see the README). */
const resolveRefs = (value: unknown, saved: Record<string, unknown>): unknown => {
  if (isMarker(value, "$ref")) {
    // `<save>` alone is the whole saved result.
    const [name, ...path] = String(value.$ref).split(".");
    return path.length ? at(saved[name!], path.join(".")) : saved[name!];
  }
  if (isMarker(value, "$concat")) {
    return (value.$concat as unknown[]).map((part) => String(resolveRefs(part, saved))).join("");
  }
  if (isMarker(value, "$base64Repeat")) {
    const { text, count } = value.$base64Repeat as { text: string; count: number };
    return Buffer.from(text.repeat(count), "utf8").toString("base64");
  }
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, saved));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveRefs(item, saved)]),
    );
  }
  return value;
};

/** What a `cdn.serve` step returns: the response's status, error code, bytes and headers. */
type ServedResponse = { status: number; code?: string; bytes: Uint8Array; headers: Headers };

const collect = async (items: AsyncIterable<unknown>) => {
  const all: unknown[] = [];
  for await (const item of items) all.push(item);
  return all;
};

const runScenarioStep = async (
  client: MockCalmLensServerClient,
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  switch (operation) {
    case "mock.decide":
      return client.decide(args.assetId as string, args.outcome as never);
    case "mock.enqueueEvent":
      return client.enqueueEvent(args as never);
    case "mock.grant":
      client.setApiKeyGrants(args.grants as never);
      return null;
    case "mock.failNext":
      client.failNextRequest(
        args.failure as never,
        args.operation === undefined ? {} : { operation: args.operation as never },
      );
      return null;
    case "cdn.serve": {
      const response = await client.cdn.serve(args as never);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const code = response.headers.get("content-type")?.startsWith("application/json")
        ? (JSON.parse(new TextDecoder().decode(bytes)) as { code?: string }).code
        : undefined;
      return { status: response.status, code, bytes, headers: response.headers };
    }
    // Iterators yield every item (or, for events, every page) in order.
    case "assets.iterate":
      return JSON.parse(JSON.stringify(await collect(client.assets.iterate(args))));
    case "assets.iterateChildren":
      return JSON.parse(
        JSON.stringify(await collect(client.assets.iterateChildren(args as never))),
      );
    case "events.pages":
      return JSON.parse(JSON.stringify(await collect(client.events.pages(args))));
  }
  // `assets.create` calls client.assets.create; `ensureLens` calls client.ensureLens.
  const path = operation.split(".");
  const owner = path
    .slice(0, -1)
    .reduce<any>((target, key) => target[key], client as unknown as Record<string, unknown>);
  const method = owner[path.at(-1)!] as (options: unknown) => unknown;
  return JSON.parse(JSON.stringify((await method.call(owner, args)) ?? null));
};

const checkCdnExpectation = (
  result: ServedResponse,
  expected: NonNullable<NonNullable<ScenarioStep["expect"]>["cdn"]>,
  saved: Record<string, unknown>,
  label: string,
) => {
  const { status, code, bytes, headers } = result;
  const want = resolveRefs(expected, saved) as typeof expected;
  expect(
    {
      status,
      ...(want.code !== undefined ? { code } : {}),
      ...(want.body !== undefined ? { body: new TextDecoder().decode(bytes) } : {}),
      // Header names are case-insensitive: Headers.get matches any case.
      ...(want.headers !== undefined
        ? {
            headers: Object.fromEntries(
              Object.keys(want.headers).map((name) => [name, headers.get(name)]),
            ),
          }
        : {}),
    },
    label,
  ).toEqual({
    status: want.status,
    ...(want.code !== undefined ? { code: want.code } : {}),
    ...(want.body !== undefined ? { body: want.body } : {}),
    ...(want.headers !== undefined ? { headers: want.headers } : {}),
  });
  for (const name of want.headersPresent ?? []) {
    expect(headers.get(name), `${label}: ${name} header`).not.toBeNull();
  }
  if (want.bodyPrefixBase64 !== undefined) {
    const prefix = Buffer.from(want.bodyPrefixBase64, "base64");
    expect(Buffer.from(bytes.subarray(0, prefix.byteLength)), `${label}: body prefix`).toEqual(
      prefix,
    );
  }
};

describe("shared mock scenarios", () => {
  // Like the other not-applicable cases, the reason is the skipped test's name.
  test.skip("expect.httpStatus (not applicable: MockCalmLensServerClient answers API methods in memory and sends no HTTP response; cdn.serve steps check expect.cdn.status)", () => {});
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
        for (let run = 0; run < (step.repeat ?? 1); run++) {
          const label = `step ${index + 1}${step.repeat ? ` run ${run + 1}` : ""} (${step.operation})`;
          const args = resolveRefs(step.args ?? {}, saved) as Record<string, unknown>;
          let result: unknown;
          let error: unknown;
          try {
            result = await runScenarioStep(client, step.operation, args);
          } catch (caught) {
            error = caught;
          }
          if (step.expect?.error) {
            expect(error, label).toBeInstanceOf(CalmLensError);
            const { code, status, details } = error as CalmLensError;
            const { details: wantDetails, ...want } = step.expect.error;
            expect({ code, status: status ?? null }, label).toEqual(want);
            // `details` lists only the keys to compare.
            for (const [key, value] of Object.entries(wantDetails ?? {})) {
              expect(details?.[key], `${label}: details.${key}`).toEqual(resolveRefs(value, saved));
            }
            continue;
          }
          if (error) throw error;
          if (step.expect?.cdn) {
            checkCdnExpectation(result as ServedResponse, step.expect.cdn, saved, label);
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
      }
    });
  }
});
// ---- End of shared mock scenarios -----------------------------------------------------------

interface Capability {
  id: string;
  kind: string;
  value?: string;
  names: { javascript: string };
  /** Languages the capability cannot apply to, with the reason. */
  notApplicable?: { javascript?: string };
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
  retryable: { code: string; status: number | null; retryable: boolean }[];
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
    const reason = capability.notApplicable?.javascript;
    if (reason) {
      test.skip(`${capability.id} (not applicable: ${reason})`, () => {});
      continue;
    }
    test(`offers ${capability.id} as ${capability.names.javascript}`, async () => {
      expect(await present(capability)).toBe(true);
    });
  }
});

describe("retryable errors", () => {
  for (const { code, status, retryable } of surface.retryable) {
    test(`${code}${status === null ? "" : ` (HTTP ${status})`} is ${retryable ? "" : "not "}retryable`, () => {
      const error = new CalmLensError(code, status === null ? {} : { status });
      expect(error.isRetryable()).toBe(retryable);
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

// ---------------------------------------------------------------------------------------------
// Upload tokens and webhook receivers: testdata/upload-tokens.json and webhooks.json, written by
// packages/sdk-contract/tokensAndWebhooks.ts (format in packages/sdk-contract/README.md).

const { decodeUploadToken, verifyUploadTokenSignature } = await import(
  "../src/contract/UploadToken.js"
);
const { sha256Hex } = await import("../src/contract/CryptoUtils.js");

interface TokenOptions {
  uploadPresetId: string;
  externalId?: string;
  expiresInSeconds?: number;
}
const uploadTokens: {
  signing: {
    name: string;
    apiKey: string;
    options: TokenOptions;
    now: number;
    nonce: string;
    expected: {
      token: string;
      expiresAt: number;
      claims: Record<string, unknown>;
      body: string;
      signingSecret: string;
      signature: string;
    };
  }[];
  rejections: { name: string; apiKey: string; options: TokenOptions; error: string }[];
  verification: { name: string; token: string; apiKey: string; decodesAndVerifies: boolean }[];
} = testdata("upload-tokens.json");

describe("upload token signing", () => {
  for (const { name, apiKey, options, now, nonce, expected } of uploadTokens.signing) {
    test(`signs exactly: ${name}`, async () => {
      expect(await testing.signUploadToken(apiKey, options, { now, nonce })).toEqual({
        token: expected.token,
        expiresAt: expected.expiresAt,
      });
    });

    test(`signs with the client's clock and a fresh nonce: ${name}`, async () => {
      const client = new server.CalmLensServerClient({ apiKey, projectId: "project-1" });
      const before = Date.now();
      const { token, expiresAt } = await client.uploadTokens.sign(options);
      const decoded = decodeUploadToken(token);
      const lifetime = expected.expiresAt - now;
      expect(decoded?.claims).toEqual({ ...expected.claims, e: expiresAt, n: decoded?.claims.n });
      expect(decoded?.claims.n).not.toBe(nonce);
      expect(expiresAt - before).toBeGreaterThanOrEqual(lifetime);
      expect(expiresAt - Date.now()).toBeLessThanOrEqual(lifetime);
      expect(
        await verifyUploadTokenSignature(decoded!.body, decoded!.signature, expected.signingSecret),
      ).toBe(true);
    });
  }

  for (const { name, apiKey, options, error } of uploadTokens.rejections) {
    test(`refuses ${name}`, async () => {
      const client = new server.CalmLensServerClient({ apiKey, projectId: "project-1" });
      const code = (promise: Promise<unknown>) =>
        promise.then(
          () => "signed",
          (failure: CalmLensError) => failure.code,
        );
      expect(await code(client.uploadTokens.sign(options))).toBe(error);
      expect(await code(testing.signUploadToken(apiKey, options, { now: 0, nonce: "n" }))).toBe(
        error,
      );
    });
  }

  for (const { name, token, apiKey, decodesAndVerifies } of uploadTokens.verification) {
    test(`${decodesAndVerifies ? "decodes and verifies" : "fails to decode or verify"}: ${name}`, async () => {
      const decoded = decodeUploadToken(token);
      const verified =
        !!decoded &&
        (await verifyUploadTokenSignature(
          decoded.body,
          decoded.signature,
          await sha256Hex(apiKey),
        ));
      expect(verified).toBe(decodesAndVerifies);
    });
  }
});

type HeaderMap = Record<string, string | string[]>;
interface SignedDelivery {
  name: string;
  body: string;
  secret: string;
  timestamp: string;
  signature: string;
  now: number;
}
const receiver: {
  signatures: { secret: string; timestamp: string; body: string; signature: string }[];
  verification: (SignedDelivery & { toleranceSeconds?: number; valid: boolean })[];
  payloads: { event: unknown; payload: unknown }[];
  headerCases: {
    name: string;
    headers: HeaderMap;
    body: string;
    secret: string;
    now: number;
    valid: boolean;
  }[];
  parseErrors: (SignedDelivery & { error: string })[];
  parsed: (SignedDelivery & { expected: unknown; isTest: boolean })[];
  testFacts: { name: string; event: server.WebhookEventPayload; isTest: boolean }[];
  roundTrips: {
    name: string;
    event: unknown;
    payload: unknown;
    body: string;
    secret: string;
    deliveryId: string;
    timestampSeconds: number;
    headers: Record<string, string>;
    isTest: boolean;
  }[];
} = testdata("webhooks.json");

/** The header containers a JavaScript receiver gets: Node's plain object and a fetch `Headers`. */
const headerContainers = (headers: HeaderMap) => {
  const fetchHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    for (const item of [value].flat()) fetchHeaders.append(name, item);
  }
  return { record: headers, Headers: fetchHeaders };
};

describe("webhook receivers", () => {
  for (const { secret, timestamp, body, signature } of receiver.signatures) {
    test(`signs ${body.slice(0, 24)} at ${timestamp}`, async () => {
      expect(await testing.createWebhookSignatureHeader(secret, timestamp, body)).toBe(signature);
    });
  }

  for (const { name, body, toleranceSeconds, now, valid, ...rest } of receiver.verification) {
    test(`${valid ? "accepts" : "refuses"} ${name}`, async () => {
      expect(
        await server.verifyWebhookSignature({
          ...rest,
          payload: body,
          toleranceSeconds,
          now: now * 1000,
        }),
      ).toBe(valid);
    });
  }

  for (const { event, payload } of receiver.payloads) {
    test(`converts ${(event as { type: string }).type} to its delivery body`, () => {
      expect(testing.toWebhookEventPayload(event as never)).toEqual(payload as never);
    });
  }

  for (const { name, headers, body, secret, now, valid } of receiver.headerCases) {
    for (const [container, value] of Object.entries(headerContainers(headers))) {
      test(`${valid ? "accepts" : "refuses"} ${name} (${container})`, async () => {
        expect(
          await server.verifyWebhookSignature({
            payload: body,
            headers: value,
            secret,
            now: now * 1000,
          }),
        ).toBe(valid);
      });
    }
  }

  for (const { name, body, now, error, ...rest } of receiver.parseErrors) {
    test(`fails to parse ${name} with ${error}`, async () => {
      const code = await parseWebhookEvent({ ...rest, payload: body, now: now * 1000 }).then(
        () => "parsed",
        (failure: CalmLensError) => failure.code,
      );
      expect(code).toBe(error);
    });
  }

  for (const { name, body, now, expected, isTest, ...rest } of receiver.parsed) {
    test(`parses ${name}`, async () => {
      const event = await parseWebhookEvent({ ...rest, payload: body, now: now * 1000 });
      expect(event).toEqual(expected as never);
      expect(server.isTestWebhookEvent(event)).toBe(isTest);
    });
  }

  for (const { name, event, isTest } of receiver.testFacts) {
    test(`${isTest ? "recognises" : "does not take"} ${name} ${isTest ? "as" : "for"} a test send`, () => {
      expect(server.isTestWebhookEvent(event)).toBe(isTest);
    });
  }

  for (const roundTrip of receiver.roundTrips) {
    test(`delivers and receives ${roundTrip.name}`, async () => {
      const { event, payload, body, secret, deliveryId, timestampSeconds, headers } = roundTrip;
      expect(testing.toWebhookEventPayload(event as never)).toEqual(payload as never);
      expect(JSON.stringify(payload)).toBe(body);
      expect(
        await testing.createWebhookHeaders({ secret, body, deliveryId, timestampSeconds }),
      ).toEqual(headers);
      const received = await parseWebhookEvent({
        payload: body,
        headers,
        secret,
        now: timestampSeconds * 1000,
      });
      expect(received).toEqual(payload as never);
      expect(server.isTestWebhookEvent(received)).toBe(roundTrip.isTest);
    });
  }
});
