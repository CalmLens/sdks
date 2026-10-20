import { describe, expect, test } from "bun:test";
import { PUBLIC_ERROR_CODES } from "../src/contract/PublicErrorCodes.js";
import { CalmLensError, CalmLensServerClient } from "../src/server";
import { createMockApiKey, MockCalmLensServerClient } from "../src/testing";

const projectId = "123e4567-e89b-12d3-a456-426614174000";

describe("assets.moderate", () => {
  test("text convenience uses the same synchronous asset path", async () => {
    let query: URLSearchParams | undefined;
    const client = new CalmLensServerClient({
      apiKey: "key",
      projectId,
      uploadFetch: async (url) => {
        query = new URL(String(url)).searchParams;
        return Response.json({
          id: "asset",
          processing: { status: "done" },
          moderation: { status: "approved" },
        });
      },
    });
    const asset = await client.text.moderate({ text: "hello" });
    expect(asset.moderation.status).toBe("approved");
    expect(query?.get("queue")).toBe("false");
    expect(query?.get("name")).toBe("text");
    expect(query?.get("contentType")).toBe("text/plain");
  });

  test("uploads the text synchronously as a plain-text asset", async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const uploadFetch: typeof fetch = async (input, init) => {
      requests.push({ url: new URL(String(input)), init });
      return Response.json({
        id: "asset-id",
        processing: { status: "done" },
        moderation: { status: "approved" },
      });
    };
    const client = new CalmLensServerClient({ apiKey: "test-api-key", projectId, uploadFetch });

    const asset = await client.assets.moderate({
      name: "text",
      externalId: "comment-42",
      metadata: [{ id: "kind", value: "comment" }],
      content: { plainText: "Lovely photo!", type: "text/plain" },
    });

    expect(asset.moderation.status).toBe("approved");
    expect(requests).toHaveLength(1);
    const [{ url, init }] = requests;
    expect(url.pathname).toBe(`/v1/projects/${projectId}/assets`);
    expect(new Headers(init?.headers).get("X-CalmLens-Upload")).toBe("content");
    expect(url.searchParams.get("queue")).toBe("false");
    expect(url.searchParams.get("name")).toBe("text");
    expect(url.searchParams.get("contentType")).toBe("text/plain");
    expect(url.searchParams.get("externalId")).toBe("comment-42");
    expect(new Headers(init?.headers).get("X-Api-Key")).toBe("test-api-key");
    expect(await new Response(init?.body).text()).toBe("Lovely photo!");
  });

  test("uses a custom asset name when provided", async () => {
    let name: string | null = null;
    const client = new CalmLensServerClient({
      apiKey: "test-api-key",
      projectId,
      uploadFetch: async (input) => {
        name = new URL(String(input)).searchParams.get("name");
        return Response.json({
          id: "asset-id",
          processing: { status: "done" },
          moderation: { status: "approved" },
        });
      },
    });

    await client.assets.moderate({
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
      .moderate({ name: "text", content: { plainText: "   ", type: "text/plain" } })
      .catch((e) => e);

    expect(error).toBeInstanceOf(CalmLensError);
    expect(error.code).toBe(PUBLIC_ERROR_CODES.INVALID_UPLOAD_PAYLOAD.getId());
  });

  test("is available on the mock client", async () => {
    const client = new MockCalmLensServerClient({
      apiKey: createMockApiKey(),
      projectId,
      mockOptions: { analyzedOutcome: "rejected" },
    });

    const asset = await client.assets.moderate({
      name: "text",
      externalId: "c-1",
      content: { plainText: "unsafe content", type: "text/plain" },
    });

    expect(asset.type).toBe("plaintext-document");
    expect(asset.moderation.status).toBe("rejected");
    expect(asset.externalId).toBe("c-1");
  });
});
