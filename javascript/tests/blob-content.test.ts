import { describe, expect, test } from "bun:test";
import { CalmLensAppClient } from "../src/app";
import { API_ERROR_CODES } from "../src/client/CalmLensErrorCodes";
import { CalmLensServerClient } from "../src/server";
import { readUploadForm } from "./upload-form";

const MiB = 1024 * 1024;
const projectId = "project-1";
const PRESET_ID = "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P";

interface Sent {
  path: string;
  query: URLSearchParams;
  authorization: string | null;
  /** An upload form's file part, or a later part's raw body. */
  body: Uint8Array;
  /** An upload form's options, for the request that starts an upload. */
  options?: Record<string, unknown>;
}

/** Records each request and answers like the API: uploading until a final part, else completed. */
const recording = () => {
  const sent: Sent[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const request: Sent = {
      path: url.pathname,
      query: url.searchParams,
      authorization: headers.get("authorization"),
      body: new Uint8Array(await new Response(init?.body).arrayBuffer()),
    };
    if (headers.get("content-type")?.startsWith("multipart/form-data")) {
      const form = readUploadForm(request.body, headers.get("content-type"));
      request.body = form.file.bytes;
      request.options = form.options as Record<string, unknown>;
    }
    sent.push(request);
    const partial = url.searchParams.get("isFinal") === "false";
    return Response.json({
      id: "asset-1",
      name: "asset",
      uploadPresetId: PRESET_ID,
      createdAt: 1,
      classification: { status: "queued", moderation: { decision: null } },
      upload: {
        status: partial ? "uploading" : "completed",
        updatedAt: 1,
        partsReceived: partial ? Number(url.searchParams.get("partNumber")) : null,
      },
    });
  }) as typeof fetch;
  return { sent, fetch };
};

/** Distinct bytes, so a part sent at the wrong offset shows. */
const bytesOf = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 7) % 251);

const codeOf = async (run: () => Promise<unknown>) =>
  run().then(
    () => undefined,
    (error: { code?: string }) => error.code,
  );

describe("content given as a Blob or File", () => {
  test("a Blob uploads its bytes with its own type", async () => {
    const { sent, fetch } = recording();
    const client = new CalmLensServerClient({ apiKey: "key", projectId, fetch });
    const bytes = bytesOf(1000);
    await client.assets.create({
      name: "photo",
      content: new Blob([bytes], { type: "image/png" }),
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.query.get("contentType")).toBe("image/png");
    expect(sent[0]!.body).toEqual(bytes);
    expect(sent[0]!.options?.name).toBe("photo");
  });

  test("a File uploads with its own type, under the name given", async () => {
    const { sent, fetch } = recording();
    const client = new CalmLensServerClient({ apiKey: "key", projectId, fetch });
    const file = new File([bytesOf(10)], "holiday.jpg", { type: "image/jpeg" });
    await client.assets.create({ name: "chosen", content: file });
    // Untyped JavaScript may leave the name out: the File's is used.
    await client.assets.create({ content: file } as never);
    expect(sent.map((request) => request.options?.name)).toEqual(["chosen", "holiday.jpg"]);
    expect(sent.map((request) => request.query.get("contentType"))).toEqual([
      "image/jpeg",
      "image/jpeg",
    ]);
  });

  test("a Blob without a type is refused before anything is sent", async () => {
    const { sent, fetch } = recording();
    const client = new CalmLensServerClient({ apiKey: "key", projectId, fetch });
    const code = await codeOf(() =>
      client.assets.create({ name: "photo", content: new Blob([bytesOf(10)]) }),
    );
    expect(code).toBe(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD);
    expect(sent).toHaveLength(0);
  });

  test("a Blob larger than partSizeBytes goes up in parts", async () => {
    const { sent, fetch } = recording();
    const client = new CalmLensServerClient({
      apiKey: "key",
      projectId,
      fetch,
      partSizeBytes: 5 * MiB,
    });
    const bytes = bytesOf(11 * MiB);
    await client.assets.create({ name: "clip", content: new Blob([bytes], { type: "video/mp4" }) });
    expect(sent.map((request) => request.query.get("partNumber"))).toEqual(["1", "2", "3"]);
    expect(Buffer.concat(sent.map((request) => request.body))).toEqual(Buffer.from(bytes));
  });

  test("an upload preset takes a File, named after it", async () => {
    const { sent, fetch } = recording();
    const client = new CalmLensAppClient({
      uploadPresetId: PRESET_ID,
      token: () => "clut_token",
      fetch,
      uploadFetch: fetch,
    });
    const bytes = bytesOf(100);
    await client.assets.create({
      content: new File([bytes], "avatar.webp", { type: "image/webp" }),
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe(`/v1/upload-presets/${PRESET_ID}/assets`);
    expect(sent[0]!.authorization).toBe("Bearer clut_token");
    expect(sent[0]!.query.get("contentType")).toBe("image/webp");
    expect(sent[0]!.options?.name).toBe("avatar.webp");
    expect(sent[0]!.body).toEqual(bytes);
  });
});
