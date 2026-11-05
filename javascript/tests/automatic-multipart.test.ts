import { describe, expect, test } from "bun:test";
import { CalmLensAppClient } from "../src/app";
import { CalmLensServerClient } from "../src/server";
import { MockCalmLensServerClient } from "../src/testing";

const MiB = 1024 * 1024;
const projectId = "project-1";

interface Sent {
  path: string;
  query: URLSearchParams;
  key: string | null;
  authorization: string | null;
  body: Uint8Array;
}

/** Distinct bytes, so a part sent at the wrong offset shows. */
const fileOf = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 7) % 251);

const asset = (id: string, status: "uploading" | "completed", partsReceived: number | null) => ({
  id,
  classification: { status: "queued", moderation: { status: "pending" } },
  upload: { status, updatedAt: 1, partsReceived },
});

const apiError = (code: string, status: number, details: Record<string, unknown> = {}) =>
  Response.json({ code, message: code, requestId: "req", details }, { status });

/** A fetch that records each request and answers with `respond(request, index)`. */
const scripted = (respond: (sent: Sent, index: number) => Response | Promise<Response>) => {
  const sent: Sent[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const request: Sent = {
      path: url.pathname,
      query: url.searchParams,
      key: headers.get("idempotency-key"),
      authorization: headers.get("authorization"),
      body: new Uint8Array(await new Response(init?.body).arrayBuffer()),
    };
    sent.push(request);
    return respond(request, sent.length - 1);
  }) as typeof fetch;
  return { sent, fetch };
};

/** Answers part n of an upload like the API: uploading until the final part. */
const uploadResponse = (request: Sent) =>
  Response.json(
    request.query.get("isFinal") === "true"
      ? asset("asset-1", "completed", null)
      : asset("asset-1", "uploading", Number(request.query.get("partNumber"))),
  );

const joined = (sent: Sent[]) => Buffer.concat(sent.map((request) => request.body));

describe("automatic multipart uploads", () => {
  test("content larger than partSizeBytes is sent in parts with derived keys", async () => {
    const { sent, fetch } = scripted(uploadResponse);
    const client = new CalmLensServerClient({
      apiKey: "key",
      projectId,
      fetch,
      partSizeBytes: 5 * MiB,
    });
    const file = fileOf(11 * MiB);
    const result = await client.assets.classify({
      name: "clip.mp4",
      content: { uint8Array: file, type: "video/mp4" },
      idempotencyKey: "upload-1",
    });

    expect(result.upload.status).toBe("completed");
    expect(sent.map(({ path }) => path)).toEqual([
      `/v1/projects/${projectId}/assets`,
      "/v1/assets/asset-1/part",
      "/v1/assets/asset-1/part",
    ]);
    expect(sent.map(({ key }) => key)).toEqual(["upload-1", "upload-1:part-2", "upload-1:part-3"]);
    expect(sent.map(({ query }) => query.get("partNumber"))).toEqual(["1", "2", "3"]);
    expect(sent.map(({ query }) => query.get("isFinal"))).toEqual(["false", "false", "true"]);
    expect(sent.map(({ query }) => query.get("sizeInBytes"))).toEqual([
      String(5 * MiB),
      String(5 * MiB),
      String(MiB),
    ]);
    expect(sent[0]!.query.get("totalSizeInBytes")).toBe(String(11 * MiB));
    // The queue choice goes with the first part, which saves it for the upload.
    expect(sent.map(({ query }) => query.get("queue"))).toEqual(["false", null, null]);
    expect(joined(sent).equals(Buffer.from(file))).toBe(true);
  });

  test("content of one part or less, and streams, go in one request", async () => {
    const { sent, fetch } = scripted(() => Response.json(asset("asset-1", "completed", null)));
    const client = new CalmLensServerClient({ apiKey: "key", projectId, fetch });
    await client.assets.create({
      name: "exact.bin",
      content: { uint8Array: fileOf(8 * MiB), type: "application/pdf" },
    });
    const bytes = fileOf(9 * MiB);
    await client.assets.create({
      name: "stream.bin",
      content: {
        data: new Response(bytes).body!,
        type: "application/pdf",
        sizeInBytes: bytes.byteLength,
      },
    });
    expect(sent.map(({ query }) => query.get("partNumber"))).toEqual([null, null]);
    expect(sent.map(({ body }) => body.byteLength)).toEqual([8 * MiB, 9 * MiB]);
  });

  test("a dropped part is retried with its own key, and a part the API has is skipped", async () => {
    const { sent, fetch } = scripted((request, index) => {
      if (index === 1) throw new TypeError("fetch failed: connection reset");
      // Part 3's response was lost before: the API asks for part 4.
      if (request.query.get("partNumber") === "3") {
        return apiError("upload-part/invalid-number", 409, {
          expectedPartNumber: 4,
          receivedPartNumber: 3,
        });
      }
      return uploadResponse(request);
    });
    const client = new CalmLensServerClient({
      apiKey: "key",
      projectId,
      fetch,
      partSizeBytes: 5 * MiB,
      maxRetries: 1,
    });
    const result = await client.assets.create({
      name: "report.pdf",
      content: { data: new Blob([fileOf(16 * MiB)]), type: "application/pdf" },
      idempotencyKey: "upload-2",
    });
    expect(result.upload.status).toBe("completed");
    expect(sent.map(({ key }) => key)).toEqual([
      "upload-2",
      "upload-2:part-2",
      "upload-2:part-2",
      "upload-2:part-3",
      "upload-2:part-4",
    ]);
    expect(sent[2]!.body).toEqual(sent[1]!.body);
    expect(sent[4]!.query.get("isFinal")).toBe("true");
  });

  test("a final part that finds the upload completed reads the asset back", async () => {
    const { sent, fetch } = scripted((request) =>
      request.path.endsWith("/part")
        ? apiError("upload/not-open", 409)
        : request.query.get("partNumber") === "1"
          ? uploadResponse(request)
          : Response.json(asset("asset-1", "completed", null)),
    );
    const client = new CalmLensServerClient({ apiKey: "key", projectId, fetch });
    const result = await client.assets.create({
      name: "clip.mp4",
      content: { uint8Array: fileOf(9 * MiB), type: "video/mp4" },
    });
    expect(result.upload.status).toBe("completed");
    expect(sent.map(({ path }) => path)).toEqual([
      `/v1/projects/${projectId}/assets`,
      "/v1/assets/asset-1/part",
      "/v1/assets/asset-1",
    ]);
    // Without a caller's key, the parts share a generated one.
    expect(sent[1]!.key).toBe(`${sent[0]!.key}:part-2`);
  });

  test("an app client sends every part with the token that started the upload", async () => {
    const { sent, fetch } = scripted(uploadResponse);
    let tokens = 0;
    const client = new CalmLensAppClient({
      uploadPresetId: "preset-1",
      token: async () => `token-${++tokens}`,
      fetch,
    });
    await client.assets.create({
      name: "voice.wav",
      content: { uint8Array: fileOf(17 * MiB), type: "audio/wav" },
    });
    expect(sent.map(({ path }) => path)).toEqual([
      "/v1/upload-presets/preset-1/assets",
      "/v1/upload-presets/preset-1/assets/asset-1/part",
      "/v1/upload-presets/preset-1/assets/asset-1/part",
    ]);
    expect(sent.map(({ authorization }) => authorization)).toEqual([
      "Bearer token-1",
      "Bearer token-1",
      "Bearer token-1",
    ]);
  });

  test("refuses a partSizeBytes outside 5 to 64 MiB and an over-long key for a split upload", async () => {
    for (const partSizeBytes of [5 * MiB - 1, 64 * MiB + 1, 5 * MiB + 0.5])
      expect(() => new CalmLensServerClient({ apiKey: "key", projectId, partSizeBytes })).toThrow(
        expect.objectContaining({ code: "sdk/invalid-config" }),
      );
    const { sent, fetch } = scripted(uploadResponse);
    const client = new CalmLensServerClient({ apiKey: "key", projectId, fetch });
    await expect(
      client.assets.create({
        name: "clip.mp4",
        content: { uint8Array: fileOf(9 * MiB), type: "video/mp4" },
        idempotencyKey: "k".repeat(241),
      }),
    ).rejects.toMatchObject({ code: "sdk/invalid-argument" });
    // An image over 20 MiB can't be sent at all.
    await expect(
      client.assets.create({
        name: "huge.png",
        content: { uint8Array: fileOf(21 * MiB), type: "image/png" },
      }),
    ).rejects.toMatchObject({ code: "upload/too-large" });
    expect(sent).toEqual([]);
  });

  test("the mock resumes an upload with the same key after its second part fails", async () => {
    const moderated: number[] = [];
    const client = new MockCalmLensServerClient({
      apiKey: "key",
      projectId,
      partSizeBytes: 5 * MiB,
      mockOptions: {
        moderate: (input) => {
          moderated.push(input.content?.bytes?.byteLength ?? 0);
          return "allowed";
        },
      },
    });
    const options = {
      name: "report.pdf",
      content: { uint8Array: fileOf(12 * MiB), type: "application/pdf" },
      idempotencyKey: "upload-3",
    };
    client.failNextRequest("transport-error", { operation: "assets.uploadPart" });
    await expect(client.assets.classify(options)).rejects.toMatchObject({
      code: "sdk/transport-error",
    });
    const finished = await client.assets.classify(options);
    expect(finished.upload.status).toBe("completed");
    expect(finished.content.sizeInBytes).toBe(12 * MiB);
    expect((await client.assets.list()).items.map(({ id }) => id)).toEqual([finished.id]);
    expect(moderated).toEqual([12 * MiB]);
  });
});
