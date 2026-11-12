import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AssetContentOptions,
  CreateMultipartUploadPartOptions,
  MultipartUploadPartOptions,
} from "../src/client/CalmLensTypes";
import type { AssetBinaryPayloadInput } from "../src/contract/AssetPayload.js";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  MIN_MULTIPART_UPLOAD_PART_BYTES,
} from "../src/contract/SharedConstants.js";
import { CalmLensServerClient } from "../src/server";
import { readUploadForm } from "./upload-form";

const projectId = "proj_8fK2mQx7Lp4NvB3tRz9Y";

describe("multipart binary field names", () => {
  test("preserves disk-backed BunFile bytes in direct uploads, first parts and retries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "calmlens-bunfile-"));
    const path = join(directory, "input.bin");
    const bytes = Uint8Array.from([0, 255, 1, 128, 13, 10, 42]);
    await Bun.write(path, bytes);
    try {
      for (const multipart of [false, true]) {
        const received: Uint8Array[] = [];
        const client = new CalmLensServerClient({
          apiKey: "test-api-key",
          projectId,
          maxRetries: 1,
          fetch: async (input, init) => {
            const request = new Request(input, init);
            const form = readUploadForm(await request.bytes(), request.headers.get("content-type"));
            received.push(form.file.bytes);
            return Response.json(
              { code: "test/captured" },
              { status: received.length === 1 ? 503 : 400, headers: { "Retry-After": "0" } },
            );
          },
        });
        const content = { data: Bun.file(path), type: "application/pdf" };
        await expect(
          client.assets.create({
            name: "disk-backed",
            idempotencyKey: `bunfile-${multipart}`,
            ...(multipart ? { part: { ...content, isFinal: true } } : { content }),
          }),
        ).rejects.toMatchObject({ code: "test/captured", status: 400 });
        expect(received).toEqual([bytes, bytes]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects incorrect declared sizes before sending first or later parts", async () => {
    const requests: unknown[] = [];
    const client = new CalmLensServerClient({
      apiKey: "test-api-key",
      projectId,
      fetch: async (...args) => {
        requests.push(args);
        return Response.json({});
      },
    });
    for (const payload of [
      { base64: "aGVsbG8=" },
      { uint8Array: [104, 101, 108, 108, 111] },
      { data: new Blob(["hello"]) },
      { data: Uint8Array.from([104, 101, 108, 108, 111]).buffer },
    ]) {
      await expect(
        client.assets.create({
          name: "note",
          part: { ...payload, type: "text/plain", partNumber: 1, isFinal: true, sizeInBytes: 6 },
        }),
      ).rejects.toMatchObject({ code: "upload-payload/invalid" });
      await expect(
        client.assets.uploadPart({
          assetId: "asset-1",
          part: { ...payload, partNumber: 2, isFinal: true, sizeInBytes: 6 },
        }),
      ).rejects.toMatchObject({ code: "upload-payload/invalid" });
    }
    expect(requests).toEqual([]);
  });

  test("passes direct and multipart ReadableStream bodies through without buffering", async () => {
    const bodies: Array<BodyInit | null | undefined> = [];
    const uploadFetch: typeof fetch = async (_input, init) => {
      bodies.push(init?.body);
      return Response.json(
        { code: "test/error", message: "stop after capturing the request" },
        { status: 400 },
      );
    };
    const client = new CalmLensServerClient({
      apiKey: "test-api-key",
      projectId,
      uploadFetch,
    });
    const directStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
        controller.close();
      },
    });
    const multipartStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([4, 5, 6]));
        controller.close();
      },
    });

    await expect(
      client.assets.create({
        name: "direct-stream.png",
        content: { data: directStream, type: "image/png" },
      }),
    ).rejects.toThrow("stop after capturing the request");
    await expect(
      client.assets.create({
        name: "multipart-stream.pdf",
        part: { data: multipartStream, type: "application/pdf", isFinal: false, sizeInBytes: 3 },
      }),
    ).rejects.toThrow("stop after capturing the request");

    // Each body is a stream that sends the file as it is read, inside its upload form.
    expect(bodies.map((body) => body instanceof ReadableStream)).toEqual([true, true]);
  });

  test("sends externalId, metadata, tags and processingOptions in the options part, and wait=false in the query", async () => {
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push(input instanceof Request ? input : new Request(input, init));
      return Response.json(
        { code: "test/error", message: "stop after capturing the request" },
        { status: 400 },
      );
    };
    const client = new CalmLensServerClient({
      apiKey: "test-api-key",
      projectId,
      fetch: fetchImpl,
    });

    await expect(
      client.assets.create({
        name: "response-content.png",
        externalId: "external-image",
        content: {
          data: new Response(new Uint8Array([1, 2, 3])),
          type: "image/png",
        },
        metadata: [{ id: "source", value: "sdk-test" }],
        tags: ["catalogue", "backpacks"],
        processingOptions: { retainContent: true },
      }),
    ).rejects.toThrow("stop after capturing the request");

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    const url = new URL(request.url);
    expect(url.pathname).toBe(`/v1/projects/${projectId}/assets`);
    expect(request.headers.get("X-CalmLens-Upload")).toBe("content");
    // The query holds transport values only; the asset's fields are in the options part.
    expect([...url.searchParams]).toEqual([
      ["wait", "false"],
      ["contentType", "image/png"],
    ]);
    const form = readUploadForm(await request.bytes(), request.headers.get("content-type"));
    expect(form.options).toEqual({
      name: "response-content.png",
      externalId: "external-image",
      metadata: [{ id: "source", value: "sdk-test" }],
      tags: ["catalogue", "backpacks"],
      processingOptions: { retainContent: true },
    });
    expect(form.file).toEqual({ type: "image/png", bytes: new Uint8Array([1, 2, 3]) });
  });

  test("sends every supported payload input for every upload path: text as JSON, files in a form, later parts raw", async () => {
    const binaryBytes = Uint8Array.from([1, 2, 3]);
    const textBytes = new TextEncoder().encode("plain text");
    const createReadableStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    const payloadCases: Array<{
      name: string;
      contentType: string;
      expectedBytes: Uint8Array;
      createPayload: () => AssetBinaryPayloadInput;
    }> = [
      {
        name: "plain-text",
        contentType: "text/plain",
        expectedBytes: textBytes,
        createPayload: () => ({ plainText: "plain text" }),
      },
      {
        name: "base64",
        contentType: "application/pdf",
        expectedBytes: binaryBytes,
        createPayload: () => ({ base64: "AQID" }),
      },
      {
        name: "number-array",
        contentType: "application/pdf",
        expectedBytes: binaryBytes,
        createPayload: () => ({ uint8Array: [1, 2, 3] }),
      },
      {
        name: "uint8-array",
        contentType: "application/pdf",
        expectedBytes: binaryBytes,
        createPayload: () => ({ uint8Array: Uint8Array.from(binaryBytes) }),
      },
      {
        name: "array-buffer",
        contentType: "application/pdf",
        expectedBytes: binaryBytes,
        createPayload: () => ({ buffer: Uint8Array.from(binaryBytes).buffer }),
      },
      {
        name: "node-buffer",
        contentType: "application/pdf",
        expectedBytes: binaryBytes,
        createPayload: () => ({ buffer: Buffer.from(binaryBytes) }),
      },
      {
        name: "blob",
        contentType: "application/pdf",
        expectedBytes: binaryBytes,
        createPayload: () => ({ data: new Blob([binaryBytes]) }),
      },
      {
        name: "response",
        contentType: "application/pdf",
        expectedBytes: binaryBytes,
        createPayload: () => ({ data: new Response(binaryBytes) }),
      },
      {
        name: "readable-stream",
        contentType: "application/pdf",
        expectedBytes: binaryBytes,
        createPayload: () => ({ data: createReadableStream(binaryBytes) }),
      },
    ];
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push(input instanceof Request ? input : new Request(input, init));
      return Response.json(
        { code: "test/error", message: "stop after capturing the request" },
        { status: 400 },
      );
    };
    const client = new CalmLensServerClient({
      apiKey: "test-api-key",
      projectId,
      fetch: fetchImpl,
    });

    for (const payloadCase of payloadCases) {
      const content: AssetContentOptions = {
        ...payloadCase.createPayload(),
        type: payloadCase.contentType,
        sizeInBytes: payloadCase.expectedBytes.byteLength,
      };
      await expect(
        client.assets.create({ name: `content-${payloadCase.name}.bin`, content }),
      ).rejects.toThrow("stop after capturing the request");
    }

    for (const payloadCase of payloadCases) {
      const part: CreateMultipartUploadPartOptions = {
        ...payloadCase.createPayload(),
        type: payloadCase.contentType,
        isFinal: true,
        sizeInBytes: payloadCase.expectedBytes.byteLength,
      };
      await expect(
        client.assets.create({ name: `part-${payloadCase.name}.bin`, part }),
      ).rejects.toThrow("stop after capturing the request");
    }

    const assetId = "asset_987fcdeb51a243d7b890";
    for (const [index, payloadCase] of payloadCases.entries()) {
      const part: MultipartUploadPartOptions = {
        ...payloadCase.createPayload(),
        partNumber: index + 1,
        isFinal: true,
        sizeInBytes: payloadCase.expectedBytes.byteLength,
      };
      await expect(client.assets.uploadPart({ assetId, part })).rejects.toThrow(
        "stop after capturing the request",
      );
    }

    expect(requests).toHaveLength(payloadCases.length * 3);
    const isText = (payloadCase: (typeof payloadCases)[number]) =>
      payloadCase.name === "plain-text";
    for (const [index, payloadCase] of payloadCases.entries()) {
      for (const [mode, request] of [
        ["content", requests[index]!],
        ["part", requests[index + payloadCases.length]!],
      ] as const) {
        const url = new URL(request.url);
        const name = `${mode}-${payloadCase.name}.bin`;
        expect(url.pathname).toBe(`/v1/projects/${projectId}/assets`);
        if (isText(payloadCase)) {
          expect([...url.searchParams]).toEqual([["wait", "false"]]);
          expect(request.headers.get("X-CalmLens-Upload")).toBeNull();
          const text = { plainText: "plain text", type: "text/plain" };
          expect(await request.json()).toEqual(
            mode === "content"
              ? { name, content: text }
              : { name, part: { ...text, isFinal: true } },
          );
          continue;
        }
        expect(request.headers.get("X-CalmLens-Upload")).toBe(mode);
        expect(Object.fromEntries(url.searchParams)).toEqual({
          wait: "false",
          contentType: payloadCase.contentType,
          sizeInBytes: String(payloadCase.expectedBytes.byteLength),
          ...(mode === "part" ? { partNumber: "1", isFinal: "true" } : {}),
        });
        const form = readUploadForm(await request.bytes(), request.headers.get("content-type"));
        expect(form.options).toEqual({ name });
        expect(form.file).toEqual({
          type: payloadCase.contentType,
          bytes: payloadCase.expectedBytes,
        });
      }
    }
    for (const [index, payloadCase] of payloadCases.entries()) {
      const request = requests[index + payloadCases.length * 2]!;
      const url = new URL(request.url);
      expect(url.pathname).toBe(`/v1/assets/${assetId}/part`);
      expect(url.searchParams.get("partNumber")).toBe(String(index + 1));
      expect(url.searchParams.get("isFinal")).toBe("true");
      // Whether to wait, chosen at the start of the upload, is saved by the API.
      expect(url.searchParams.has("wait")).toBe(false);
      expect(url.searchParams.get("sizeInBytes")).toBe(
        String(payloadCase.expectedBytes.byteLength),
      );
      expect(await request.bytes()).toEqual(payloadCase.expectedBytes);
    }
  });

  test("checks a single image part locally and leaves accumulated sizes to the API", async () => {
    const assetId = "asset_987fcdeb51a243d7b890";
    const urls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(new URL(String(input)));
      return Response.json({
        id: assetId,
        upload: { status: "uploading" },
        classification: { status: "queued", moderation: { decision: null } },
      });
    };
    const client = new CalmLensServerClient({
      apiKey: "test-api-key",
      projectId,
      fetch: fetchImpl,
    });

    await client.assets.create({
      name: "direct-limit.png",
      content: { uint8Array: new Uint8Array(1), type: "image/png" },
    });
    await expect(
      client.assets.create({
        name: "multipart-limit.png",
        part: {
          uint8Array: new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1),
          type: "image/png",
          isFinal: true,
        },
      }),
    ).rejects.toMatchObject({ code: "upload/too-large" });
    expect(urls).toHaveLength(1);

    const oneByteStream = () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      });
    await client.assets.create({
      name: "multipart-accumulated.png",
      totalSizeInBytes: 2 * MIN_MULTIPART_UPLOAD_PART_BYTES - 1,
      part: {
        data: oneByteStream(),
        type: "image/png",
        isFinal: false,
        sizeInBytes: 2 * MIN_MULTIPART_UPLOAD_PART_BYTES - 2,
      },
    });
    expect(urls[1]!.searchParams.get("totalSizeInBytes")).toBe(
      String(2 * MIN_MULTIPART_UPLOAD_PART_BYTES - 1),
    );
    expect(urls[1]!.searchParams.get("wait")).toBe("false");

    // The API knows the declared and accumulated size, so a small final part is sent to it.
    await client.assets.uploadPart({
      assetId,
      wait: true,
      part: { data: oneByteStream(), partNumber: 2, isFinal: true, sizeInBytes: 1 },
    });
    expect(urls[2]!.pathname).toBe(`/v1/assets/${assetId}/part`);
    expect(urls[2]!.searchParams.get("wait")).toBe("true");
  });
});
