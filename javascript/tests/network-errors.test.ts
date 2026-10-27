import { describe, expect, it } from "bun:test";
import { CalmLensError, CalmLensServerClient } from "../src/server";

const projectId = "proj_8fK2mQx7Lp4NvB3tRz9Y";
const apiKey = "test-api-key";
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("network errors", () => {
  it("turns API error bodies into CalmLensError with status, request ID and headers", async () => {
    const apiError = {
      code: "validation/invalid-type",
      message: "Invalid input: expected array, received object",
      traceId: "40d366f9-8c1f-4245-986b-59c633a0a512",
      details: {
        path: "metadata",
        issues: [
          {
            path: "metadata",
            message: "Invalid input: expected array, received object",
            code: "validation/invalid-type",
          },
        ],
      },
    };
    const fetchImpl = (async () =>
      Response.json(apiError, {
        status: 400,
        headers: { "X-Request-Id": "req-123", "Retry-After": "7" },
      })) as typeof fetch;
    const client = new CalmLensServerClient({
      apiKey,
      projectId,
      fetch: fetchImpl,
    });

    const error = await client.assets
      .create({
        name: "invalid-metadata.png",
        metadata: {} as any,
        content: {
          base64: pngBase64,
          type: "image/png",
        },
      })
      .catch((error) => error);

    expect(error).toBeInstanceOf(CalmLensError);
    expect(error.code).toBe("validation/invalid-type");
    expect(error.message).toBe("[calmlens] Invalid input: expected array, received object");
    expect(error.details).toEqual({
      path: "metadata",
      issues: [
        {
          path: "metadata",
          message: "Invalid input: expected array, received object",
          code: "validation/invalid-type",
        },
      ],
      traceId: "40d366f9-8c1f-4245-986b-59c633a0a512",
    });
    expect(error.status).toBe(400);
    expect(error.requestId).toBe("req-123");
    expect(error.retryAfter).toBe(7);
    expect(error.headers.get("x-request-id")).toBe("req-123");
  });
});
