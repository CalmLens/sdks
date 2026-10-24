// Replays testdata/surface.json and testdata/rejections.json (packages/sdk-contract/surface.ts):
// every capability a server SDK must offer exists here under its JavaScript name, and every
// request the API would reject is refused before anything is sent.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as server from "../src/server";
import * as testing from "../src/testing";

const testdata = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "../../go/testdata", name), "utf8"));

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
  test("offers every capability in surface.json", async () => {
    const missing: string[] = [];
    for (const capability of surface.capabilities) {
      if (!(await present(capability))) {
        missing.push(`${capability.id} (${capability.names.javascript})`);
      }
    }
    expect(missing).toEqual([]);
  });
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
