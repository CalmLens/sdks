import { describe, expect, test } from "bun:test";
import type {
  AssetContentOptions,
  CreateMultipartUploadPartOptions,
  MultipartUploadPartOptions,
} from "../src/client/CalmLensTypes";
import type { AssetBinaryPayloadInput } from "../src/contract/AssetPayload.js";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  MIN_MULTIPART_IMAGE_UPLOAD_BYTES,
} from "../src/contract/SharedConstants.js";
import { CalmLensServerClient } from "../src/server";

const projectId = "123e4567-e89b-12d3-a456-426614174000";

describe("multipart binary field names", () => {
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

    expect(bodies).toEqual([directStream, multipartStream]);
  });

  test("serializes externalId, metadata, processingOptions and queue=true on direct uploads", async () => {
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
        processingOptions: { keepContentAfterProcessing: true },
      }),
    ).rejects.toThrow("stop after capturing the request");

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe(`/v1/projects/${projectId}/assets`);
    expect(requests[0]!.headers.get("X-CalmLens-Upload")).toBe("content");
    expect(url.searchParams.get("externalId")).toBe("external-image");
    expect(url.searchParams.get("queue")).toBe("true");
    expect(JSON.parse(url.searchParams.get("metadata")!)).toEqual([
      { id: "source", value: "sdk-test" },
    ]);
    expect(JSON.parse(url.searchParams.get("processingOptions")!)).toEqual({
      keepContentAfterProcessing: true,
    });
  });

  test("sends every supported payload input as raw bytes for every upload path", async () => {
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

    const assetId = "987fcdeb-51a2-43d7-b890-123456789abc";
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
    for (const [index, payloadCase] of payloadCases.entries()) {
      const request = requests[index]!;
      const url = new URL(request.url);
      expect(url.pathname).toBe(`/v1/projects/${projectId}/assets`);
      expect(request.headers.get("X-CalmLens-Upload")).toBe("content");
      expect(url.searchParams.get("name")).toBe(`content-${payloadCase.name}.bin`);
      expect(url.searchParams.get("contentType")).toBe(payloadCase.contentType);
      expect(url.searchParams.get("sizeInBytes")).toBe(
        String(payloadCase.expectedBytes.byteLength),
      );
      expect(await request.bytes()).toEqual(payloadCase.expectedBytes);
    }
    for (const [index, payloadCase] of payloadCases.entries()) {
      const request = requests[index + payloadCases.length]!;
      const url = new URL(request.url);
      expect(url.pathname).toBe(`/v1/projects/${projectId}/assets`);
      expect(request.headers.get("X-CalmLens-Upload")).toBe("part");
      expect(url.searchParams.get("name")).toBe(`part-${payloadCase.name}.bin`);
      expect(url.searchParams.get("contentType")).toBe(payloadCase.contentType);
      expect(url.searchParams.get("partNumber")).toBe("1");
      expect(url.searchParams.get("isFinal")).toBe("true");
      expect(url.searchParams.get("sizeInBytes")).toBe(
        String(payloadCase.expectedBytes.byteLength),
      );
      expect(await request.bytes()).toEqual(payloadCase.expectedBytes);
    }
    for (const [index, payloadCase] of payloadCases.entries()) {
      const request = requests[index + payloadCases.length * 2]!;
      const url = new URL(request.url);
      expect(url.pathname).toBe(`/v1/assets/${assetId}/part`);
      expect(url.searchParams.get("partNumber")).toBe(String(index + 1));
      expect(url.searchParams.get("isFinal")).toBe("true");
      // The queue mode chosen at the start of the upload is saved by the API.
      expect(url.searchParams.has("queue")).toBe(false);
      expect(url.searchParams.get("sizeInBytes")).toBe(
        String(payloadCase.expectedBytes.byteLength),
      );
      expect(await request.bytes()).toEqual(payloadCase.expectedBytes);
    }
  });

  test("checks a single image part locally and leaves accumulated sizes to the API", async () => {
    const assetId = "987fcdeb-51a2-43d7-b890-123456789abc";
    const urls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(new URL(String(input)));
      return Response.json({
        id: assetId,
        processing: { status: "uploading" },
        moderation: { status: "pending" },
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
    ).rejects.toMatchObject({ code: "upload/multipart-image-too-large" });
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
      totalSizeInBytes: MIN_MULTIPART_IMAGE_UPLOAD_BYTES - 1,
      part: {
        data: oneByteStream(),
        type: "image/png",
        isFinal: false,
        sizeInBytes: MIN_MULTIPART_IMAGE_UPLOAD_BYTES - 2,
      },
    });
    expect(urls[1]!.searchParams.get("totalSizeInBytes")).toBe(
      String(MIN_MULTIPART_IMAGE_UPLOAD_BYTES - 1),
    );
    expect(urls[1]!.searchParams.get("queue")).toBe("true");

    // The API knows the declared and accumulated size, so a small final part is sent to it.
    await client.assets.uploadPart({
      assetId,
      queue: false,
      part: { data: oneByteStream(), partNumber: 2, isFinal: true, sizeInBytes: 1 },
    });
    expect(urls[2]!.pathname).toBe(`/v1/assets/${assetId}/part`);
    expect(urls[2]!.searchParams.get("queue")).toBe("false");
  });
});
