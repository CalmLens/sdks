import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { CalmLensError } from "../src/server";
import { createMockApiKey, MockCalmLensServerClient } from "../src/testing";

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
      error?: { code: string; status: number | null };
      cdn?: { status: number; code?: string; body?: string };
    };
  }>;
};
const { scenarios } = JSON.parse(
  readFileSync(new URL("../../go/testdata/mock-scenarios.json", import.meta.url), "utf8"),
) as { scenarios: Scenario[] };

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
      return { status: response.status, code, body: text };
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
          const { status, code, body } = result as { status: number; code?: string; body: string };
          const expected = step.expect.cdn;
          expect(
            {
              status,
              ...(expected.code !== undefined ? { code } : {}),
              ...(expected.body !== undefined ? { body } : {}),
            },
            label,
          ).toEqual(expected);
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
