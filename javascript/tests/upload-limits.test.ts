import { describe, expect, test } from "bun:test";
import { PUBLIC_ERROR_CODES } from "../src/contract/PublicErrorCodes.js";
import { CalmLensServerClient } from "../src/server";

const MIB = 1024 * 1024;
const projectId = "proj_8fK2mQx7Lp4NvB3tRz9Y";
const asset = {
  id: "asset",
  upload: { status: "completed" },
  classification: { status: "processing", moderation: { status: "pending" } },
};

const client = (sent: string[]) =>
  new CalmLensServerClient({
    apiKey: "key",
    projectId,
    uploadFetch: async (url) => {
      sent.push(String(url));
      return Response.json(asset);
    },
  });

describe("one-request upload size limits", () => {
  test("refuse content over its type's limit before sending any of it", async () => {
    const sent: string[] = [];
    const uploads = [
      { type: "image/png", uint8Array: new Uint8Array(10 * MIB + 1) },
      { type: "video/mp4", data: new ReadableStream(), sizeInBytes: 50 * MIB + 1 },
      { type: "application/pdf", data: new ReadableStream(), sizeInBytes: 5000 * MIB + 1 },
    ];
    for (const content of uploads) {
      const error = await client(sent)
        .assets.create({ name: "big", content } as never)
        .catch((error: unknown) => error);
      expect(error, content.type).toMatchObject({
        code: PUBLIC_ERROR_CODES.FILE_TOO_LARGE.getId(),
      });
    }
    expect(sent).toEqual([]);
  });

  test("send content at the limit", async () => {
    const sent: string[] = [];
    await client(sent).assets.create({
      name: "x.png",
      content: { type: "image/png", uint8Array: new Uint8Array(10 * MIB) },
    });
    expect(sent).toHaveLength(1);
  });
});
