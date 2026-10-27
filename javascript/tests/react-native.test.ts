import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CalmLensAppClient } from "../src/app";
import { type CalmLensError, CalmLensServerClient, SDK_VERSION } from "../src/server";

const PRESET_ID = "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The parts of React Native's runtime (Hermes with Expo) that differ from browsers and servers:
 * `navigator.product`, no `crypto` global, no `AbortSignal.prototype.throwIfAborted`, and a
 * Blob that can't be built from bytes.
 */
const originals = {
  crypto: Object.getOwnPropertyDescriptor(globalThis, "crypto")!,
  blob: globalThis.Blob,
  throwIfAborted: Object.getOwnPropertyDescriptor(AbortSignal.prototype, "throwIfAborted")!,
};

class ReactNativeBlob extends originals.blob {
  constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
    if (parts?.some((part) => part instanceof ArrayBuffer || ArrayBuffer.isView(part))) {
      throw new Error("Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported");
    }
    super(parts, options);
  }
}

beforeEach(() => {
  Object.defineProperty(navigator, "product", { value: "ReactNative", configurable: true });
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  globalThis.Blob = ReactNativeBlob;
  delete (AbortSignal.prototype as { throwIfAborted?: unknown }).throwIfAborted;
});

afterEach(() => {
  delete (navigator as { product?: string }).product;
  Object.defineProperty(globalThis, "crypto", originals.crypto);
  globalThis.Blob = originals.blob;
  Object.defineProperty(AbortSignal.prototype, "throwIfAborted", originals.throwIfAborted);
});

const recordingFetch = () => {
  const requests: { request: Request; bytes: Uint8Array }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ request, bytes: new Uint8Array(await request.clone().arrayBuffer()) });
    const assetId = new URL(request.url).pathname.match(/assets\/([^/]+)$/)?.[1];
    return Response.json({
      id: assetId && assetId !== "upload" ? assetId : "asset-1",
      name: "photo.png",
      uploadPresetId: PRESET_ID,
      createdAt: 1,
      status: "pending",
    });
  }) as typeof fetch;
  return { fetchImpl, requests };
};

describe("React Native", () => {
  it("uploads bytes through an upload preset and checks the upload", async () => {
    const { fetchImpl, requests } = recordingFetch();
    const client = new CalmLensAppClient({
      uploadPresetId: PRESET_ID,
      token: async () => "clut_token",
      fetch: fetchImpl,
    });
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

    const uploaded = await client.assets.classify({
      name: "photo.png",
      content: { uint8Array: bytes, type: "image/png" },
    });
    await client.assets.classify({
      name: "photo.png",
      content: { base64: "AQID", type: "image/png" },
    });
    const checked = await client.assets.retrieve({ assetId: uploaded.id });

    expect(checked.id).toBe("asset-1");
    expect(requests.map(({ request }) => request.method)).toEqual(["POST", "POST", "GET"]);
    expect(requests[0]!.bytes).toEqual(bytes);
    expect(requests[1]!.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(requests[2]!.request.headers.get("authorization")).toBe("Bearer clut_token");
    const keys = requests.slice(0, 2).map(({ request }) => request.headers.get("idempotency-key"));
    expect(keys[0]).toMatch(UUID_V4);
    expect(keys[1]).toMatch(UUID_V4);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("refuses an API key in the app unless explicitly allowed", async () => {
    let code: string | undefined;
    try {
      new CalmLensServerClient({ apiKey: "clsk_secret", projectId: "project-1" });
    } catch (error) {
      code = (error as CalmLensError).code;
    }
    expect(code).toBe("sdk/invalid-config");

    const { fetchImpl, requests } = recordingFetch();
    const client = new CalmLensServerClient({
      apiKey: "clsk_secret",
      projectId: "project-1",
      fetch: fetchImpl,
      dangerouslyAllowBrowser: true,
    });
    await client.assets.retrieve({ assetId: "asset-1" });
    expect(requests[0]!.request.headers.get("user-agent")).toBe(
      `calmlens-js/${SDK_VERSION} (react-native)`,
    );
  });
});
