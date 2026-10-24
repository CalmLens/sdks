import { afterEach, describe, expect, it } from "bun:test";
import { MockCalmLensAppClient } from "../src/testing";
import {
  type CalmLensUpload,
  createUploadController,
  getMediaState,
  isFileAccepted,
  resolveMediaProps,
  type UploadItem,
} from "../src/ui";

const PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";
const PRESET_ID = "8f0f6a8e-2c1e-4c7a-9d55-0b6f4c1a2e10";
const CDN = "https://cdn.calmlens.com/v1";

describe("getMediaState", () => {
  it("serves nothing for blocked and purged assets", () => {
    for (const status of ["blocked", "purged"] as const) {
      expect(getMediaState({ projectId: PROJECT_ID, assetId: "a1", status })).toEqual({
        kind: "unavailable",
      });
    }
  });

  it("keeps age-restricted assets behind the placeholder until the viewer may see them", () => {
    const options = { projectId: PROJECT_ID, assetId: "a1", status: "age-restricted" as const };
    expect(getMediaState(options)).toEqual({
      kind: "gated",
      placeholderUrl: `${CDN}/assets/${PROJECT_ID}/a1/placeholder`,
    });

    const shown = getMediaState({ ...options, canView: true });
    expect(shown.kind === "image" && shown.src).toBe(
      `${CDN}/assets/${PROJECT_ID}/a1/rendered?allowAgeRestricted=true`,
    );
  });

  it("offers each width from the rendered resource and falls back to the largest", () => {
    const state = getMediaState({
      projectId: PROJECT_ID,
      assetId: "a1",
      lens: "card",
      widths: [800, 400, 400],
    });
    const base = `${CDN}/assets/${PROJECT_ID}/a1/rendered/@card`;
    expect(state).toEqual({
      kind: "image",
      src: `${base}/width=800`,
      srcSet: `${base}/width=400 400w, ${base}/width=800 800w`,
      placeholderUrl: `${CDN}/assets/${PROJECT_ID}/a1/placeholder`,
    });
  });

  it("uses a signed URL as given, without a placeholder that would need the same access", () => {
    const url = "https://cdn.calmlens.com/v1/assets/p/a1/rendered?exp=1&sig=abc";
    expect(getMediaState({ projectId: PROJECT_ID, assetId: "a1", url })).toEqual({
      kind: "image",
      src: url,
      placeholderUrl: undefined,
    });
  });

  it("draws the placeholder from a stored ThumbHash instead of requesting it", () => {
    const drawn = getMediaState({
      projectId: PROJECT_ID,
      assetId: "a1",
      status: "age-restricted",
      placeholderHash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
    });
    expect(
      drawn.kind === "gated" && drawn.placeholderUrl?.startsWith("data:image/png;base64,"),
    ).toBe(true);

    const invalid = getMediaState({ projectId: PROJECT_ID, assetId: "a1", placeholderHash: "%%" });
    expect(invalid.kind === "image" && invalid.placeholderUrl).toBe(
      `${CDN}/assets/${PROJECT_ID}/a1/placeholder`,
    );
  });

  it("takes the source, status, type and preview from an API asset", () => {
    const asset = {
      id: "v1",
      projectId: PROJECT_ID,
      type: "video",
      classification: { moderation: { status: "age-restricted" as const } },
      content: {
        previewImage: { thumbhash: null, averageColor: "#112233", width: 1280, height: 720 },
      },
    };
    expect(getMediaState({ asset })).toEqual({
      kind: "gated",
      placeholderUrl: `${CDN}/assets/${PROJECT_ID}/v1/placeholder`,
    });
    expect(resolveMediaProps({ asset, canView: true })).toMatchObject({
      projectId: PROJECT_ID,
      assetId: "v1",
      status: "age-restricted",
      type: "video",
      averageColor: "#112233",
      width: 1280,
      height: 720,
    });
  });

  it("lets props win over the asset they are passed with", () => {
    const asset = {
      id: "a1",
      projectId: PROJECT_ID,
      type: "image",
      classification: { moderation: { status: "blocked" as const } },
    };
    expect(getMediaState({ asset, status: "allowed", assetId: "external-1" })).toMatchObject({
      kind: "image",
      src: `${CDN}/assets/${PROJECT_ID}/external-1/rendered`,
    });
  });

  it("plays a video's original file, with the lens only on its rendered poster", () => {
    expect(
      getMediaState({ projectId: PROJECT_ID, assetId: "v1", type: "video", lens: "card" }),
    ).toMatchObject({
      kind: "video",
      src: `${CDN}/assets/${PROJECT_ID}/v1/original`,
      poster: `${CDN}/assets/${PROJECT_ID}/v1/rendered/@card`,
    });
  });
});

describe("isFileAccepted", () => {
  const photo = { name: "Beach.JPG", type: "image/jpeg" };
  it("matches MIME wildcards, exact types and extensions", () => {
    expect(isFileAccepted(photo, "image/*")).toBe(true);
    expect(isFileAccepted(photo, "video/*, .jpg")).toBe(true);
    expect(isFileAccepted(photo, "image/png,.pdf")).toBe(false);
    expect(isFileAccepted(photo, undefined)).toBe(true);
  });
});

describe("UploadController", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** Answers the token endpoint and the preset's upload routes, recording each request. */
  const serve = (statuses: string[]) => {
    const requests: {
      method: string;
      path: string;
      authorization: string | null;
      body?: string;
    }[] = [];
    let checks = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://app.example");
      requests.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.pathname === "/api/upload-token") return Response.json({ token: "clut_signed" });
      const status = statuses[Math.min(checks++, statuses.length - 1)];
      return Response.json({ id: "asset-1", name: "photo.png", createdAt: 1, status });
    }) as typeof fetch;
    return requests;
  };

  const settle = async (controller: ReturnType<typeof createUploadController>) => {
    for (let wait = 0; controller.getSnapshot().busy && wait < 300; wait++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  const photo = () => new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" });

  it("uploads with a token from the token endpoint and reports the decision", async () => {
    const requests = serve(["allowed"]);
    const uploaded: CalmLensUpload[] = [];
    const controller = createUploadController({
      uploadPresetId: PRESET_ID,
      tokenUrl: "/api/upload-token",
      onUploaded: (upload) => uploaded.push(upload),
    });
    controller.addFiles([photo()]);
    await settle(controller);

    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/upload-token" });
    expect(JSON.parse(requests[0]?.body ?? "")).toEqual({
      name: "photo.png",
      type: "image/png",
      size: 3,
    });
    expect(requests[1]).toMatchObject({
      method: "POST",
      path: `/v1/upload-presets/${PRESET_ID}/assets`,
      authorization: "Bearer clut_signed",
    });
    expect(uploaded.map(({ assetId, status }) => ({ assetId, status }))).toEqual([
      { assetId: "asset-1", status: "allowed" },
    ]);
    expect(controller.getSnapshot().items[0]).toMatchObject({
      stage: "complete",
      status: "allowed",
    });
  });

  it("checks a pending upload again until it has a decision", async () => {
    const requests = serve(["pending", "age-restricted"]);
    const controller = createUploadController({ uploadPresetId: PRESET_ID });
    controller.addFiles([photo()]);
    await settle(controller);

    expect(requests.map((request) => request.method)).toEqual(["POST", "GET"]);
    expect(controller.getSnapshot().items[0]).toMatchObject({
      stage: "complete",
      status: "age-restricted",
    });
  });

  it("reports blocked uploads as rejected instead of uploaded", async () => {
    serve(["blocked"]);
    const uploaded: CalmLensUpload[] = [];
    const rejected: UploadItem[] = [];
    const controller = createUploadController({
      uploadPresetId: PRESET_ID,
      onUploaded: (upload) => uploaded.push(upload),
      onRejected: (item) => rejected.push(item),
    });
    controller.addFiles([photo()]);
    await settle(controller);

    expect(uploaded).toEqual([]);
    expect(rejected.map((item) => item.assetId)).toEqual(["asset-1"]);
  });

  it("refuses files over the size limit or of the wrong type without sending them", async () => {
    const requests = serve(["allowed"]);
    const controller = createUploadController({
      uploadPresetId: PRESET_ID,
      multiple: true,
      accept: "image/*",
      maxFileSize: 2,
    });
    controller.addFiles([photo(), new File(["x"], "notes.txt", { type: "text/plain" })]);
    await settle(controller);

    expect(requests).toEqual([]);
    expect(controller.getSnapshot().items.map((item) => item.errorCode)).toEqual([
      "file/too-large",
      "file/not-accepted",
    ]);
  });

  it("keeps one file unless multiple is on, replacing it with the next pick", () => {
    serve(["allowed"]);
    const removed: string[] = [];
    const controller = createUploadController({
      uploadPresetId: PRESET_ID,
      maxFileSize: 0,
      onRemoved: (item) => removed.push(item.file.name),
    });
    controller.addFiles([photo()]);
    controller.addFiles([new File(["2"], "second.png", { type: "image/png" })]);

    expect(controller.getSnapshot().items.map((item) => item.file.name)).toEqual(["second.png"]);
    expect(removed).toEqual(["photo.png"]);
  });

  it("cancels an upload that is removed before it finishes", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      await gate;
      return Response.json({ id: "asset-1", name: "photo.png", createdAt: 1, status: "allowed" });
    }) as typeof fetch;
    const uploaded: CalmLensUpload[] = [];
    const controller = createUploadController({
      uploadPresetId: PRESET_ID,
      onUploaded: (upload) => uploaded.push(upload),
    });
    controller.addFiles([photo()]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.remove(controller.getSnapshot().items[0]?.key ?? "");
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(signal?.aborted).toBe(true);
    expect(controller.getSnapshot()).toEqual({ items: [], busy: false });
    expect(uploaded).toEqual([]);
  });

  it("retries a failed upload", async () => {
    let failing = true;
    serve(["allowed"]);
    const served = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      failing
        ? Promise.resolve(Response.json({ code: "upload-preset/disabled" }, { status: 403 }))
        : served(input, init)) as typeof fetch;
    const controller = createUploadController({ uploadPresetId: PRESET_ID });
    controller.addFiles([photo()]);
    await settle(controller);
    const [failed] = controller.getSnapshot().items;
    expect(failed).toMatchObject({ stage: "failed", errorCode: "upload-preset/disabled" });

    failing = false;
    controller.retry(failed?.key ?? "");
    await settle(controller);
    expect(controller.getSnapshot().items[0]).toMatchObject({
      stage: "complete",
      status: "allowed",
    });
  });

  it("runs on a mock app client and shows the preset's refusal", async () => {
    const created: MockCalmLensAppClient[] = [];
    const failed: UploadItem[] = [];
    const controller = createUploadController({
      uploadPresetId: PRESET_ID,
      multiple: true,
      createClient: (options) => {
        const client = new MockCalmLensAppClient({
          ...options,
          mockOptions: { queuedOutcome: "allowed", preset: { maxFileSizeInBytes: 3 } },
        });
        created.push(client);
        return client;
      },
      onFailed: (item) => failed.push(item),
    });
    controller.addFiles([photo(), new File([new Uint8Array(4)], "big.png", { type: "image/png" })]);
    await settle(controller);

    expect(
      controller
        .getSnapshot()
        .items.map(({ stage, status, errorCode }) => ({ stage, status, errorCode })),
    ).toEqual([
      { stage: "complete", status: "allowed", errorCode: undefined },
      { stage: "failed", status: undefined, errorCode: "upload-preset/too-large" },
    ]);
    expect(failed.map((item) => item.file.name)).toEqual(["big.png"]);
    expect(created).toHaveLength(2);
  });

  it("uploads through a custom upload function and checks its status", async () => {
    const progress: (number | null)[] = [];
    const uploaded: CalmLensUpload[] = [];
    const controller = createUploadController({
      upload: async (file, { onProgress }) => {
        onProgress(file.size / 2, file.size);
        return { assetId: "own-1", status: "pending" };
      },
      checkStatus: async (assetId) => (assetId === "own-1" ? "allowed" : undefined),
      onUploaded: (upload) => uploaded.push(upload),
    });
    controller.subscribe(({ items }) => {
      if (items[0]?.stage === "uploading") progress.push(items[0].progress);
    });
    controller.addFiles([photo()]);
    await settle(controller);

    expect(progress).toContain(0.5);
    expect(uploaded.map(({ assetId, status }) => ({ assetId, status }))).toEqual([
      { assetId: "own-1", status: "allowed" },
    ]);
  });

  it("finishes a custom upload as pending when there is no status check", async () => {
    const controller = createUploadController({
      upload: async () => ({ assetId: "own-2", status: "pending" }),
    });
    controller.addFiles([photo()]);
    await settle(controller);
    expect(controller.getSnapshot().items[0]).toMatchObject({
      stage: "complete",
      status: "pending",
    });
  });

  it("fails an upload with neither a preset nor an upload function", async () => {
    const controller = createUploadController({});
    controller.addFiles([photo()]);
    await settle(controller);
    expect(controller.getSnapshot().items[0]?.errorCode).toBe("sdk/invalid-config");
  });
});
