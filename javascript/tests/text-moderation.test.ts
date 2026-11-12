import { describe, expect, test } from "bun:test";
import { PUBLIC_ERROR_CODES } from "../src/contract/PublicErrorCodes.js";
import { CalmLensError, CalmLensServerClient } from "../src/server";
import { createMockApiKey, MockCalmLensServerClient } from "../src/testing";

const projectId = "proj_8fK2mQx7Lp4NvB3tRz9Y";

describe("assets.classify", () => {
  test("text convenience uses the same synchronous asset path", async () => {
    let request: { url: URL; body: unknown } | undefined;
    const client = new CalmLensServerClient({
      apiKey: "key",
      projectId,
      uploadFetch: async (url, init) => {
        request = { url: new URL(String(url)), body: JSON.parse(String(init?.body)) };
        return Response.json({
          id: "asset",
          upload: { status: "completed" },
          classification: { status: "completed", moderation: { decision: "allowed" } },
        });
      },
    });
    const asset = await client.text.classify({ text: "hello" });
    expect(asset.classification.moderation.decision).toBe("allowed");
    expect([...request!.url.searchParams]).toEqual([["wait", "true"]]);
    expect(request!.body).toEqual({
      name: "text",
      content: { plainText: "hello", type: "text/plain" },
    });
  });

  test("uploads the text synchronously as a JSON body, its fields never in the URL", async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const uploadFetch: typeof fetch = async (input, init) => {
      requests.push({ url: new URL(String(input)), init });
      return Response.json({
        id: "asset-id",
        upload: { status: "completed" },
        classification: { status: "completed", moderation: { decision: "allowed" } },
      });
    };
    const client = new CalmLensServerClient({ apiKey: "test-api-key", projectId, uploadFetch });
    const context = { items: [{ text: "Another pupil's post", authorId: "pupil-3" }] };

    const asset = await client.assets.classify({
      name: "text",
      description: "A reply",
      externalId: "comment-42",
      authorId: "pupil-7",
      context,
      metadata: [{ id: "kind", value: "comment" }],
      content: { plainText: "Lovely photo!", type: "text/plain" },
    });

    expect(asset.classification.moderation.decision).toBe("allowed");
    expect(requests).toHaveLength(1);
    const [{ url, init }] = requests;
    const headers = new Headers(init?.headers);
    expect(url.pathname).toBe(`/v1/projects/${projectId}/assets`);
    expect([...url.searchParams]).toEqual([["wait", "true"]]);
    expect(headers.get("X-CalmLens-Upload")).toBeNull();
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Api-Key")).toBe("test-api-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "text",
      description: "A reply",
      externalId: "comment-42",
      authorId: "pupil-7",
      context,
      metadata: [{ id: "kind", value: "comment" }],
      content: { plainText: "Lovely photo!", type: "text/plain" },
    });
  });

  test("uses a custom asset name when provided", async () => {
    let name: unknown = null;
    const client = new CalmLensServerClient({
      apiKey: "test-api-key",
      projectId,
      uploadFetch: async (_input, init) => {
        name = JSON.parse(String(init?.body)).name;
        return Response.json({
          id: "asset-id",
          upload: { status: "completed" },
          classification: { status: "completed", moderation: { decision: "allowed" } },
        });
      },
    });

    await client.assets.classify({
      name: "comment-42",
      content: { plainText: "hi", type: "text/plain" },
    });

    expect(name).toBe("comment-42");
  });

  test("rejects empty text before sending a request", async () => {
    const client = new CalmLensServerClient({
      apiKey: "test-api-key",
      projectId,
      uploadFetch: async () => {
        throw new Error("should not be called");
      },
    });

    const error = await client.assets
      .classify({ name: "text", content: { plainText: "   ", type: "text/plain" } })
      .catch((e) => e);

    expect(error).toBeInstanceOf(CalmLensError);
    expect(error.code).toBe(PUBLIC_ERROR_CODES.INVALID_UPLOAD_PAYLOAD.getId());
  });

  test("is available on the mock client", async () => {
    const client = new MockCalmLensServerClient({
      apiKey: createMockApiKey(),
      projectId,
      mockOptions: { moderate: () => "blocked" },
    });

    const asset = await client.assets.classify({
      name: "text",
      externalId: "c-1",
      content: { plainText: "unsafe content", type: "text/plain" },
    });

    expect(asset.type).toBe("plaintext-document");
    expect(asset.classification.moderation.decision).toBe("blocked");
    expect(asset.externalId).toBe("c-1");
  });
});
