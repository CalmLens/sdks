import { expect, test } from "bun:test";
import { createCalmLensProvider, toOutcome } from "../src/moderation/calmlens";

test("preserves pending and failed decisions without inventing safe scores", () => {
  const cases = [
    { processing: "pending", moderation: "pending", expected: "pending" },
    { processing: "processing", moderation: "pending", expected: "pending" },
    { processing: "failed", moderation: "pending", expected: "error" },
    { processing: "completed", moderation: "rejected", expected: "rejected" },
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
          decision: moderation,
          action: "hide",
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
    upload: { status: "completed" },
    classification: {
      status: "completed",
      moderation: { decision: "approved", action: null, categories: {} },
    },
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
        upload: { status: "completed" },
        classification: {
          status: status === "rejected" ? "completed" : "processing",
          labels: (status === "rejected"
            ? { categories: { violence: { status: "evaluated", score: 0.9 } } }
            : null
          )?.labels,
          personDetection: (status === "rejected"
            ? { categories: { violence: { status: "evaluated", score: 0.9 } } }
            : null
          )?.features?.personDetection,
          faceDetection: (status === "rejected"
            ? { categories: { violence: { status: "evaluated", score: 0.9 } } }
            : null
          )?.features?.faceDetection,
          moderation: {
            decision: status,
            action: status === "rejected" ? "hide" : null,
            categories: (status === "rejected"
              ? { categories: { violence: { status: "evaluated", score: 0.9 } } }
              : null
            )?.categories,
            score: (status === "rejected"
              ? { categories: { violence: { status: "evaluated", score: 0.9 } } }
              : null
            )?.score,
            policy: (status === "rejected"
              ? { categories: { violence: { status: "evaluated", score: 0.9 } } }
              : null
            )?.policy,
            timeline: (status === "rejected"
              ? { categories: { violence: { status: "evaluated", score: 0.9 } } }
              : null
            )?.media,
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
