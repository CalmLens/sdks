import { afterEach, describe, expect, it, mock } from "bun:test";
import { getFileIcon, renderFileIconSvg } from "../src/file-icons";
import { MockCalmLensAppClient } from "../src/testing";
import {
  AssetSession,
  type AssetView,
  type CalmLensUpload,
  createUploadController,
  getAssetView,
  getPlayedPercent,
  isFileAccepted,
  pickAssetSource,
  resolveTheme,
  type UploadFile,
  type UploadItem,
  type ViewerAsset,
} from "../src/ui";

const PROJECT_ID = "proj_8fK2mQx7Lp4NvB3tRz9Y";
const PRESET_ID = "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P";
const CDN = "https://cdn.calmlens.com/v1";
const SRC = `${CDN}/assets/${PROJECT_ID}/sig_grant`;

const info = (
  type: string,
  content: NonNullable<ViewerAsset["content"]>,
  extra: Partial<ViewerAsset> = {},
): ViewerAsset => ({
  id: "asset-1",
  projectId: PROJECT_ID,
  type,
  externalUrl: null,
  availability: "available",
  content: { format: null, hls: null, preview: null, rendered: null, ...content },
  ...extra,
});
const IMAGE = info("image", {
  format: "image/png",
  rendered: { kind: "image", width: 800, height: 600 },
  preview: { width: 800, height: 600, thumbhash: null, averageColor: "#123456" },
});
const view = (options: Parameters<typeof getAssetView>[0], asset: ViewerAsset, src = SRC) =>
  getAssetView(options, { src, info: asset, unavailable: false });

describe("getAssetView", () => {
  it("waits for a src and the info, and is unavailable when the session says so", () => {
    expect(getAssetView({}, { unavailable: false })).toEqual({ kind: "pending" });
    expect(getAssetView({}, { src: SRC, unavailable: false })).toEqual({ kind: "pending" });
    expect(getAssetView({}, { src: SRC, info: IMAGE, unavailable: true })).toEqual({
      kind: "unavailable",
    });
  });

  it("shows the info's availability: the notice, or the age gate over the placeholder", () => {
    expect(view({}, { ...IMAGE, availability: "unavailable" })).toEqual({ kind: "unavailable" });
    expect(view({}, { ...IMAGE, availability: "age-restricted" })).toEqual({
      kind: "age-restricted",
      placeholderUrl: `${SRC}/placeholder`,
    });
  });

  it("builds every resource beneath the asset URL, with the lens, transform and widths", () => {
    const shown = view({ image: { lens: "card", widths: [640, 320] } }, IMAGE);
    expect(shown).toMatchObject({
      kind: "image",
      src: `${SRC}/rendered/@card,width=640`,
      srcSet: `${SRC}/rendered/@card,width=320 320w, ${SRC}/rendered/@card,width=640 640w`,
      width: 800,
      height: 600,
    });
  });

  it("adds the viewer claims beyond the defaults to every URL, and only the region to the placeholder", () => {
    const claims = (url: string | undefined) => new URL(url!).searchParams.get("viewerClaims");
    const shown = view({ viewerClaims: { region: "GB", ageConfirmed: true } }, IMAGE);
    if (shown.kind !== "image") throw new Error("Expected an image");
    expect(claims(shown.src)).toBe(JSON.stringify({ region: "GB", ageConfirmed: true }));
    expect(claims(shown.placeholderUrl)).toBe(JSON.stringify({ region: "GB" }));
    const unconfirmed = view({ viewerClaims: { ageConfirmed: false } }, IMAGE);
    if (unconfirmed.kind !== "image") throw new Error("Expected an image");
    expect(new URL(unconfirmed.src).search).toBe("");
  });

  it("keeps the viewer claims an asset URL carries, unless the options give their own", () => {
    const carried = `${SRC}?viewerClaims=${encodeURIComponent('{"region":"DE"}')}`;
    const shown = view({}, IMAGE, carried);
    if (shown.kind !== "image") throw new Error("Expected an image");
    expect(shown.src).toBe(`${SRC}/rendered?viewerClaims=${encodeURIComponent('{"region":"DE"}')}`);
  });

  it("draws the placeholder from the stored ThumbHash instead of requesting it", () => {
    const shown = view(
      {},
      info("image", {
        rendered: { kind: "image", width: 4, height: 3 },
        preview: {
          width: 4,
          height: 3,
          thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
          averageColor: null,
        },
      }),
    );
    if (shown.kind !== "image") throw new Error("Expected an image");
    expect(shown.placeholderUrl).toStartWith("data:image/png;base64,");
  });

  it("plays video and audio from the rendered file, with the stream, poster or waveform", () => {
    const hls = { status: "ready", renditions: [] };
    const preview = { width: 640, height: 360, thumbhash: null, averageColor: null };
    expect(
      view(
        {},
        info("video", { rendered: { kind: "video", width: 640, height: 360 }, hls, preview }),
      ),
    ).toMatchObject({
      kind: "video",
      src: `${SRC}/rendered`,
      stream: `${SRC}/hls/index.m3u8`,
      poster: `${SRC}/preview`,
    });
    expect(
      view({ video: { stream: false } }, info("video", { rendered: { kind: "video" }, hls })),
    ).toMatchObject({ kind: "video", stream: undefined });
    // A stream still preparing, or not prepared, plays the rendered file.
    expect(
      view(
        {},
        info("video", {
          rendered: { kind: "video" },
          hls: { status: "preparing", reason: null, renditions: [] },
        }),
      ),
    ).toMatchObject({ kind: "video", src: `${SRC}/rendered`, stream: undefined });
    expect(
      view({}, info("audio", { rendered: { kind: "audio", peaks: [0.5, 1] }, preview })),
    ).toEqual({
      kind: "audio",
      src: `${SRC}/rendered`,
      stream: undefined,
      waveformUrl: `${SRC}/preview`,
      peaks: [0.5, 1],
    });
  });

  it("dispatches documents, text, spreadsheets and websites to their viewers", () => {
    const preview = { width: 600, height: 800, thumbhash: null, averageColor: null };
    expect(view({}, info("multimedia-document", { rendered: { kind: "pdf" }, preview }))).toEqual({
      kind: "document",
      src: `${SRC}/rendered`,
      still: `${SRC}/preview`,
    });
    expect(view({}, info("plaintext-document", {}))).toEqual({ kind: "text" });
    expect(
      view(
        {},
        info("multimedia-document", {
          format: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      ),
    ).toEqual({ kind: "spreadsheet" });
    expect(
      view(
        {},
        info(
          "website",
          { rendered: { kind: "image", width: 1280, height: 4000 } },
          { externalUrl: "https://example.com/page" },
        ),
      ),
    ).toMatchObject({ kind: "website", src: `${SRC}/rendered`, link: "https://example.com/page" });
    expect(
      view(
        {},
        info("website", { rendered: { kind: "image" } }, { externalUrl: "javascript:alert(1)" }),
      ),
    ).toMatchObject({ kind: "website", link: undefined });
  });

  it("shows the preview still for display=preview, whatever the asset type", () => {
    const preview = { width: 640, height: 360, thumbhash: null, averageColor: null };
    expect(
      view(
        { display: "preview", image: { transform: { width: 200 } } },
        info("video", { rendered: { kind: "video" }, preview }),
      ),
    ).toMatchObject({ kind: "image", src: `${SRC}/preview/width=200` });
    expect(view({ display: "preview" }, info("plaintext-document", {}))).toEqual({
      kind: "file",
      icon: "documents",
    });
  });
});

describe("pickAssetSource", () => {
  const shown = view({ image: { widths: [400, 800, 1200] } }, IMAGE) as Extract<
    AssetView,
    { kind: "image" }
  >;
  const base = `${SRC}/rendered`;

  it("loads the smallest width that covers the measured box", () => {
    expect(pickAssetSource(shown, 401)).toBe(`${base}/width=800`);
    expect(pickAssetSource(shown, 400)).toBe(`${base}/width=400`);
  });

  it("loads the largest width for a box wider than every width, or before it is measured", () => {
    expect(pickAssetSource(shown, 3000)).toBe(`${base}/width=1200`);
    expect(pickAssetSource(shown, undefined)).toBe(`${base}/width=1200`);
  });
});

describe("AssetSession", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  const serving = (respond: (url: string) => Response) => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return respond(String(input));
    }) as typeof fetch;
    return urls;
  };
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("requests nothing before src, and reads the info once it has one", async () => {
    const urls = serving(() => Response.json(IMAGE));
    const changes: number[] = [];
    const session = new AssetSession(() => changes.push(1));
    session.update({});
    session.load();
    await settled();
    expect(urls).toEqual([]);
    session.update({ src: SRC });
    session.load();
    session.load();
    await settled();
    expect(urls).toEqual([`${SRC}/info`]);
    expect(session.state.info).toEqual(IMAGE);
  });

  it("reads no info when it is given", async () => {
    const urls = serving(() => Response.json(IMAGE));
    const session = new AssetSession(() => {});
    session.update({ src: SRC, info: IMAGE });
    session.load();
    await settled();
    expect(urls).toEqual([]);
  });

  it("refreshes an expired signed URL through onExpired, and loads beneath the fresh one", async () => {
    const fresh = `${CDN}/assets/${PROJECT_ID}/sig_fresh`;
    serving((url) =>
      url.startsWith(SRC)
        ? Response.json({ code: "signed-url/expired" }, { status: 403 })
        : Response.json(IMAGE),
    );
    const onExpired = mock(async () => fresh);
    const session = new AssetSession(() => {});
    session.update({ src: SRC, onExpired });
    session.load();
    await settled();
    await settled();
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(session.state.src).toBe(fresh);
    session.load();
    await settled();
    expect(session.state.info).toEqual(IMAGE);
  });

  it("is unavailable when an expired URL can't be refreshed", async () => {
    serving(() => Response.json({ code: "signed-url/expired" }, { status: 403 }));
    const session = new AssetSession(() => {});
    session.update({ src: SRC });
    session.load();
    await settled();
    expect(session.state.unavailable).toBe(true);
  });

  it("follows the CDN when a resource fails: age-restricted or unavailable, whatever the info said", async () => {
    let availability = "age-restricted";
    serving(() => Response.json({ ...IMAGE, availability }));
    const session = new AssetSession(() => {});
    session.update({ src: SRC, info: IMAGE });
    session.failed();
    await settled();
    expect(session.state.info?.availability).toBe("age-restricted");

    availability = "available";
    const other = new AssetSession(() => {});
    other.update({ src: SRC, info: IMAGE });
    other.failed();
    await settled();
    expect(other.state.unavailable).toBe(true);
  });

  it("retries a failed resource beneath a fresh URL once, then asks the CDN", async () => {
    const urls = serving(() => Response.json({ ...IMAGE, availability: "unavailable" }));
    let count = 0;
    const session = new AssetSession(() => {});
    session.update({ src: SRC, info: IMAGE, onExpired: async () => `${SRC}${++count}` });
    session.failed();
    await settled();
    expect(session.state.src).toBe(`${SRC}1`);
    expect(urls).toEqual([]);
    session.failed();
    await settled();
    expect(urls).toEqual([`${SRC}1/info`]);
    expect(session.state.info?.availability).toBe("unavailable");
  });

  it("shows the unavailable notice when told the CDN refused the asset", () => {
    const session = new AssetSession(() => {});
    session.update({ src: SRC, info: IMAGE });
    session.unavailable();
    expect(getAssetView({}, session.state)).toEqual({ kind: "unavailable" });
  });
});

describe("audio progress", () => {
  it("measures the played part of a media element", () => {
    expect(getPlayedPercent({ currentTime: 10, duration: 40 })).toBe(25);
    expect(getPlayedPercent({ currentTime: 50, duration: 40 })).toBe(100);
    expect(getPlayedPercent({ currentTime: 3, duration: Number.NaN })).toBe(0);
  });
});

describe("resolveTheme", () => {
  it("mixes the secondary colours from the text colour", () => {
    expect(resolveTheme({ text: "#fff" })).toMatchObject({
      text: "#fff",
      muted: "rgba(255, 255, 255, 0.72)",
      border: "rgba(255, 255, 255, 0.18)",
      surface: "rgba(255, 255, 255, 0.04)",
    });
  });

  it("keeps a secondary colour you set over the mixed one", () => {
    expect(resolveTheme({ text: "#000000", border: "red" })).toMatchObject({
      muted: "rgba(0, 0, 0, 0.72)",
      border: "red",
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

  /**
   * An upload as the preset's routes return it: `pending` is still processing, `failed` failed
   * processing, and any other status is a decision.
   */
  const uploadedAsset = (status: string) => ({
    id: "asset-1",
    name: "photo.png",
    uploadPresetId: PRESET_ID,
    createdAt: 1,
    upload: { status: "completed", partsReceived: null },
    classification:
      status === "failed"
        ? { status: "failed", failureReason: "processing-error", moderation: { decision: null } }
        : {
            status: status === "pending" ? "processing" : "completed",
            failureReason: null,
            moderation: { decision: status === "pending" ? null : status },
          },
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
      return Response.json(uploadedAsset(status ?? "allowed"));
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

  it("shows an upload whose processing failed as failed, and uploads it again on retry", async () => {
    const requests = serve(["pending", "failed", "allowed"]);
    const uploaded: CalmLensUpload[] = [];
    const failed: UploadItem[] = [];
    const controller = createUploadController({
      uploadPresetId: PRESET_ID,
      onUploaded: (upload) => uploaded.push(upload),
      onFailed: (item) => failed.push(item),
    });
    controller.addFiles([photo()]);
    await settle(controller);

    expect(requests.map((request) => request.method)).toEqual(["POST", "GET"]);
    expect(controller.getSnapshot().items[0]).toMatchObject({
      stage: "failed",
      assetId: "asset-1",
    });
    expect(failed.map((item) => item.assetId)).toEqual(["asset-1"]);
    expect(uploaded).toEqual([]);

    controller.retry(controller.getSnapshot().items[0]?.key ?? "");
    await settle(controller);
    // Checking it again would find it failed, so the file is uploaded again.
    expect(requests.map((request) => request.method)).toEqual(["POST", "GET", "POST"]);
    expect(controller.getSnapshot().items[0]).toMatchObject({
      stage: "complete",
      status: "allowed",
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
      return Response.json(uploadedAsset("allowed"));
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

  it("cancels a queued file but keeps it, so it can be retried", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    serve(["allowed", "allowed"]);
    const served = globalThis.fetch;
    let first = true;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (first) {
        first = false;
        await gate;
      }
      return served(input, init);
    }) as typeof fetch;
    const controller = createUploadController({
      uploadPresetId: PRESET_ID,
      multiple: true,
      concurrency: 1,
    });
    controller.addFiles([photo(), photo()]);
    const [, queued] = controller.getSnapshot().items;
    controller.cancel(queued?.key ?? "");
    release();
    await settle(controller);
    expect(controller.getSnapshot().items.map((item) => [item.stage, item.errorCode])).toEqual([
      ["complete", undefined],
      ["failed", "sdk/cancelled"],
    ]);

    controller.retry(queued?.key ?? "");
    await settle(controller);
    expect(controller.getSnapshot().items[1]).toMatchObject({
      stage: "complete",
      status: "allowed",
    });
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
          mockOptions: { moderate: () => "allowed", preset: { maxFileSizeInBytes: 3 } },
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
      { stage: "failed", status: undefined, errorCode: "upload/too-large" },
    ]);
    expect(failed.map((item) => item.file.name)).toEqual(["big.png"]);
    expect(created).toHaveLength(2);
  });

  it("uploads a phone file's bytes and previews it from its own URI", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    // A file as `expo-file-system` returns it: not a Blob, with a local URI.
    const phoneFile: UploadFile = {
      name: "camera.jpg",
      type: "image/jpeg",
      size: bytes.length,
      uri: "file:///cache/camera.jpg",
      arrayBuffer: async () => bytes.slice().buffer,
    };
    const created: MockCalmLensAppClient[] = [];
    const uploaded: CalmLensUpload[] = [];
    const controller = createUploadController({
      uploadPresetId: PRESET_ID,
      createClient: (options) => {
        const client = new MockCalmLensAppClient({
          ...options,
          mockOptions: { moderate: () => "allowed" },
        });
        created.push(client);
        return client;
      },
      onUploaded: (upload) => uploaded.push(upload),
    });
    controller.addFiles([phoneFile]);
    expect(controller.getSnapshot().items[0]?.previewUrl).toBe("file:///cache/camera.jpg");
    await settle(controller);

    expect(uploaded.map(({ status, file }) => [status, file])).toEqual([["allowed", phoneFile]]);
    const served = await created[0]?.server.cdn.serve({
      assetId: uploaded[0]?.assetId ?? "",
    });
    expect(new Uint8Array((await served?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(bytes);
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

  it("checks an upload again when its status check failed, without uploading it again", async () => {
    let uploads = 0;
    let checks = 0;
    const controller = createUploadController({
      upload: async () => {
        uploads++;
        return { assetId: "own-3", status: "pending" };
      },
      checkStatus: async () => {
        if (++checks === 1) throw new Error("Network down");
        return "allowed";
      },
    });
    controller.addFiles([photo()]);
    await settle(controller);
    expect(controller.getSnapshot().items[0]).toMatchObject({ stage: "failed", assetId: "own-3" });

    controller.retry(controller.getSnapshot().items[0]?.key ?? "");
    await settle(controller);
    expect(controller.getSnapshot().items[0]).toMatchObject({
      stage: "complete",
      status: "allowed",
    });
    expect(uploads).toBe(1);
  });

  it("checks a finished upload that is still pending again", async () => {
    let decided = false;
    const uploaded: CalmLensUpload[] = [];
    const controller = createUploadController({
      upload: async () => ({ assetId: "own-4", status: "pending" }),
      checkStatus: async () => (decided ? "allowed" : "pending"),
      decisionTimeoutMs: 1,
      onUploaded: (upload) => uploaded.push(upload),
    });
    controller.addFiles([photo()]);
    await settle(controller);
    expect(controller.getSnapshot().items[0]).toMatchObject({
      stage: "complete",
      status: "pending",
    });

    decided = true;
    controller.retry(controller.getSnapshot().items[0]?.key ?? "");
    await settle(controller);
    expect(controller.getSnapshot().items[0]).toMatchObject({
      stage: "complete",
      status: "allowed",
    });
    expect(uploaded.map(({ status }) => status)).toEqual(["pending", "allowed"]);
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

describe("getFileIcon", () => {
  it("finds the family from the extension, then the MIME type", () => {
    expect(getFileIcon({ name: "Report.PDF", type: "" })).toEqual({
      family: "documents",
      extension: "pdf",
    });
    expect(getFileIcon({ name: "clip", type: "video/quicktime" })).toEqual({
      family: "video",
      extension: "",
    });
    expect(getFileIcon({ name: "notes.unknownext", type: "application/x-thing" })).toEqual({
      family: "unknown",
      extension: "",
    });
  });

  it("keeps file names out of the icon markup", () => {
    const icon = getFileIcon({ name: 'x.<svg onload="alert(1)">', type: "image/svg+xml" });
    expect(icon.extension).toBe("");
    expect(renderFileIconSvg(icon, 40)).not.toContain("onload");
  });
});
