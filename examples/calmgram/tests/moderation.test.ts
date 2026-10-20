import { expect, test } from "bun:test";
import { createCalmLensProvider, toOutcome } from "../src/moderation/calmlens";

test("preserves pending and failed decisions without inventing safe scores", () => {
  const cases = [
    { processing: "uploading", moderation: "pending", expected: "pending" },
    { processing: "processing", moderation: "pending", expected: "pending" },
    { processing: "failed", moderation: "pending", expected: "error" },
    { processing: "done", moderation: "rejected", expected: "rejected" },
    { processing: "done", moderation: "quarantined", expected: "pending" },
  ];
  for (const { processing, moderation, expected } of cases) {
    const outcome = toOutcome({
      id: "asset",
      externalId: "post-1",
      uploadPresetId: "preset-1",
      processing: { status: processing },
      moderation: {
        status: moderation,
        action: "hide",
        report: {
          categories: {
            violence: { status: "not-evaluated" },
            harassment: { status: "evaluated", score: 0.8 },
            sexual: { status: "partial", score: 0.4 },
          },
        },
      },
    } as any);
    expect(outcome.status).toBe(expected);
    expect(outcome.flagged).toBe(true);
    expect(outcome.externalId).toBe("post-1");
    expect(outcome.uploadPresetId).toBe("preset-1");
    expect(outcome.findings).toEqual([
      { category: "harassment", score: 0.8 },
      { category: "sexual", score: 0.4 },
    ]);
  }
});

test("an asset the policy took no action on is not flagged", () => {
  const outcome = toOutcome({
    id: "asset",
    processing: { status: "done" },
    moderation: { status: "approved", action: null, report: { categories: {} } },
  } as any);
  expect(outcome).toMatchObject({ status: "approved", flagged: false });
});

test("waits for CalmLens's decision, and reports a post still pending when none arrives", async () => {
  const statuses = new Map([
    ["asset-decided", ["pending", "rejected"]],
    ["asset-slow", ["pending"]],
  ]);
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const assetId = new URL(request.url).pathname.split("/").at(-1)!;
      const remaining = statuses.get(assetId)!;
      const status = remaining.length > 1 ? remaining.shift()! : remaining[0]!;
      return Response.json({
        id: assetId,
        processing: { status: status === "rejected" ? "done" : "processing" },
        moderation: {
          status,
          action: status === "rejected" ? "hide" : null,
          report:
            status === "rejected"
              ? { categories: { violence: { status: "evaluated", score: 0.9 } } }
              : null,
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
      status: "rejected",
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
