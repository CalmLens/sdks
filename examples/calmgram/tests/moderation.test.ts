import { expect, test } from "bun:test";
import { createCalmLensProvider, toOutcome } from "../src/moderation/calmlens";
import { createDemoProvider } from "../src/moderation/demo";
import { DEMO_TEST_INPUT_KEY, testTextCode } from "../src/testInputs";

test("preserves pending and failed decisions without inventing safe scores", () => {
  const cases = [
    { processing: "pending", moderation: "pending", expected: "pending" },
    { processing: "processing", moderation: "pending", expected: "pending" },
    { processing: "failed", moderation: "pending", expected: "error" },
    { processing: "completed", moderation: "allowed", expected: "allowed" },
    { processing: "completed", moderation: "age-restricted", expected: "age-restricted" },
    { processing: "completed", moderation: "blocked", expected: "blocked" },
    { processing: "completed", moderation: "purged", expected: "purged" },
    { processing: "completed", moderation: "quarantined", expected: "pending" },
  ];
  for (const { processing, moderation, expected } of cases) {
    const outcome = toOutcome({
      id: "asset",
      externalId: "post-1",
      uploadPresetId: "preset-1",
      upload: { status: "completed" },
      classification: {
        status: processing,
        moderation: {
          status: moderation,
          categories: {
            violence: { status: "not-evaluated" },
            harassment: { status: "evaluated", score: 0.8 },
            sexual: { status: "partial", score: 0.4 },
          },
        },
      },
    } as any);
    expect(outcome.status).toBe(expected);
    expect(outcome.externalId).toBe("post-1");
    expect(outcome.uploadPresetId).toBe("preset-1");
    expect(outcome.findings).toEqual([
      { category: "harassment", score: 0.8 },
      { category: "sexual", score: 0.4 },
    ]);
  }
});

test("waits for CalmLens's decision, and reports a post still pending when none arrives", async () => {
  const statuses = new Map([
    ["asset-decided", ["pending", "blocked"]],
    ["asset-slow", ["pending"]],
  ]);
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const assetId = new URL(request.url).pathname.split("/").at(-1)!;
      const remaining = statuses.get(assetId)!;
      const status = remaining.length > 1 ? remaining.shift()! : remaining[0]!;
      const decided = status !== "pending";
      return Response.json({
        id: assetId,
        upload: { status: "completed" },
        classification: {
          status: decided ? "completed" : "processing",
          moderation: {
            status,
            categories: decided ? { violence: { status: "evaluated", score: 0.9 } } : {},
          },
        },
      });
    },
  });
  try {
    const provider = createCalmLensProvider({
      apiKey: "sk_test_key",
      projectId: "project-1",
      apiUrl: `http://127.0.0.1:${server.port}/v1`,
    });
    expect(await provider.waitForDecision("asset-decided", { timeoutMs: 10_000 })).toMatchObject({
      assetId: "asset-decided",
      status: "blocked",
      findings: [{ category: "violence", score: 0.9 }],
    });
    expect(await provider.waitForDecision("asset-slow", { timeoutMs: 0 })).toMatchObject({
      assetId: "asset-slow",
      status: "pending",
    });
  } finally {
    server.stop(true);
  }
});

test("demo mode age-restricts sexual test text, blocks other matches and allows the rest", async () => {
  // Text moderation never touches storage.
  const demo = createDemoProvider({} as KVNamespace);
  const moderate = async (text: string) =>
    (await demo.moderateText({ text, kind: "caption", externalId: "post-1", username: "u" }))
      .status;
  expect(await moderate(await testTextCode("sexual", DEMO_TEST_INPUT_KEY))).toBe("age-restricted");
  expect(await moderate(await testTextCode("harassment", DEMO_TEST_INPUT_KEY))).toBe("blocked");
  expect(await moderate("I'll hurt you")).toBe("blocked");
  expect(await moderate("The tomatoes are ripening.")).toBe("allowed");
});
