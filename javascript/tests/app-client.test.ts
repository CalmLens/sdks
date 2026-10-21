import { describe, expect, it } from "bun:test";
import { CalmLensAppClient, type CalmLensError } from "../src/app";

const PRESET_ID = "8f0f6a8e-2c1e-4c7a-9d55-0b6f4c1a2e10";
const API_KEY = "clsk_use_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHabcdef";

interface Sent {
  method: string;
  path: string;
  apiKey: string | null;
  authorization: string | null;
  upload: string | null;
}

const createPresetClient = (token?: string | (() => string | Promise<string>)) => {
  const sent: Sent[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    sent.push({
      method: request.method,
      path: `${url.pathname}`,
      apiKey: request.headers.get("x-api-key"),
      authorization: request.headers.get("authorization"),
      upload: request.headers.get("x-calmlens-upload"),
    });
    const assetId = url.pathname.match(/assets\/([^/]+)/)?.[1];
    return Response.json({
      id: assetId ?? "asset-1",
      name: "photo.png",
      uploadPresetId: PRESET_ID,
      createdAt: 1,
    });
  };
  const client = new CalmLensAppClient({
    uploadPresetId: PRESET_ID,
    token,
    fetch: fetchImpl,
    uploadFetch: fetchImpl,
  });
  return { client, sent };
};

const errorCode = async (run: () => unknown) => {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as CalmLensError).code;
  }
};

// Every multipart part but the last must be at least 5 MiB.
const FIRST_PART_BYTES = 5 * 1024 * 1024;
const image = { data: new Blob([new Uint8Array([1, 2, 3])]), type: "image/png" };

describe("CalmLensAppClient", () => {
  it("upload through the preset with a fresh token per upload and no API key", async () => {
    let issued = 0;
    const { client, sent } = createPresetClient(() => `clut_token-${++issued}`);
    await client.assets.create({ name: "a.png", content: image });
    await client.assets.classify({ name: "b.png", content: image });

    expect(sent.map(({ method, path, upload }) => `${method} ${path} ${upload}`)).toEqual([
      `POST /v1/upload-presets/${PRESET_ID}/assets content`,
      `POST /v1/upload-presets/${PRESET_ID}/assets content`,
    ]);
    expect(sent.map(({ authorization }) => authorization)).toEqual([
      "Bearer clut_token-1",
      "Bearer clut_token-2",
    ]);
    expect(sent.every(({ apiKey }) => apiKey === null)).toBe(true);
  });

  it("continue and check an upload with the token that started it", async () => {
    let issued = 0;
    const { client, sent } = createPresetClient(async () => `clut_token-${++issued}`);
    const started = await client.assets.create({
      name: "video.mp4",
      part: {
        data: new Blob([new Uint8Array(FIRST_PART_BYTES)]),
        type: "video/mp4",
        partNumber: 1,
      },
      totalSizeInBytes: FIRST_PART_BYTES + 8,
    });
    await client.assets.uploadPart({
      assetId: started.id,
      part: {
        data: new Blob([new Uint8Array(8)]),
        type: "video/mp4",
        partNumber: 2,
        isFinal: true,
      },
    });
    await client.assets.retrieve({ assetId: started.id });

    expect(sent.map(({ method, path, upload }) => `${method} ${path} ${upload}`)).toEqual([
      `POST /v1/upload-presets/${PRESET_ID}/assets part`,
      `POST /v1/upload-presets/${PRESET_ID}/assets/${started.id}/part part`,
      `GET /v1/upload-presets/${PRESET_ID}/assets/${started.id} null`,
    ]);
    expect(new Set(sent.map(({ authorization }) => authorization))).toEqual(
      new Set(["Bearer clut_token-1"]),
    );
    expect(issued).toBe(1);
  });

  it("has only upload methods and no way to sign tokens", () => {
    const { client } = createPresetClient();
    expect(Object.keys(client.assets).sort()).toEqual([
      "classify",
      "create",
      "retrieve",
      "uploadPart",
    ]);
    expect("uploadTokens" in client).toBe(false);
  });

  it("keeps tokens out of logs and JSON", async () => {
    const { client } = createPresetClient("clut_secret-token");
    const { inspect } = await import("node:util");
    expect(inspect(client)).not.toContain("clut_secret-token");
    expect(JSON.stringify(client)).not.toContain("clut_secret-token");
    expect(client.toJSON()).toEqual({
      uploadPresetId: PRESET_ID,
      baseUrl: "https://api.calmlens.com/v1",
    });
  });

  it("refuses an API key", () => {
    expect(
      () =>
        new CalmLensAppClient({
          apiKey: API_KEY,
          uploadPresetId: PRESET_ID,
        } as never),
    ).toThrow(expect.objectContaining({ code: "sdk/invalid-config" }));
  });

  it("requires an upload preset", () => {
    expect(() => new CalmLensAppClient({} as never)).toThrow(
      expect.objectContaining({ code: "sdk/invalid-config" }),
    );
  });
});
