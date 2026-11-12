// The playground's server, run inside Vite's dev server. It signs upload tokens and asset URLs,
// and tells the page which project to use. Without CalmLens credentials it also answers the upload API and CDN
// with the SDK's mock clients, keeping files in memory, so every component can be tried offline.
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { CalmLensError, CalmLensServerClient, type UploadedAsset } from "calmlens/server";
import {
  createMockApiKey,
  MockCalmLensAppClient,
  MockCalmLensServerClient,
} from "calmlens/testing";
import type { Plugin } from "vite";

const env = {
  apiKey: process.env.CALMLENS_API_KEY,
  projectId: process.env.CALMLENS_PROJECT_ID,
  uploadPresetId: process.env.CALMLENS_UPLOAD_PRESET_ID,
  /** A local CalmLens instance's API and CDN; the hosted ones by default. */
  apiUrl: process.env.CALMLENS_API_URL || undefined,
  cdnUrl: process.env.CALMLENS_CDN_URL || undefined,
};
const live = Boolean(env.apiKey && env.projectId && env.uploadPresetId);

const MOCK_PROJECT_ID = "proj_00000000000000000001";
const MOCK_PRESET_ID = "preset_00000000000000000002";
/** How long a mock upload stays pending, so the "Checking" step is visible. */
const MOCK_CHECK_MS = 2500;

/** Sample files for the page's sample buttons, from the SDK's test files. */
const testFile = (name: string) =>
  fileURLToPath(new URL(`../../../javascript/test-files/${name}`, import.meta.url));
const SAMPLES: Record<string, { path: string; type: string }> = {
  "cat.jpg": { path: testFile("test_cat_1.jpg"), type: "image/jpeg" },
  "sensitive-photo.png": { path: testFile("racy.png"), type: "image/png" },
  "blocked-photo.jpg": { path: testFile("test_cat_1.jpg"), type: "image/jpeg" },
  "large-photo.jpg": { path: testFile("large.jpg"), type: "image/jpeg" },
  "animation.gif": { path: testFile("test_gif.gif"), type: "image/gif" },
};

// The mock project: uploads are stored by the SDK's mock clients and served by its mock CDN.
// The mock decides from the file name: `blocked` blocks it and `sensitive` age-restricts it.
const mockServer = new MockCalmLensServerClient({
  apiKey: createMockApiKey([
    {
      actions: ["assets:create", "assets:read", "assets:update", "assets:download"],
      folderId: null,
      includeSubfolders: true,
    },
  ]),
  projectId: MOCK_PROJECT_ID,
  mockOptions: {
    moderate: ({ asset: { name } }) =>
      /blocked/i.test(name) ? "blocked" : /sensitive/i.test(name) ? "age-restricted" : "allowed",
  },
});
const MOCK_PRESET = {
  requireToken: true,
  allowedContentTypes: ["image/*", "video/*", "audio/*"],
  maxFileSizeInBytes: 25 * 1024 * 1024,
};
/** One mock app client per upload token, so each token can check only its own upload. */
const mockAppClients = new Map<string, MockCalmLensAppClient>();
const appClientFor = (request: IncomingMessage) => {
  const token = request.headers.authorization?.replace(/^Bearer /, "") || undefined;
  const existing = token && mockAppClients.get(token);
  if (existing) return existing;
  const client = new MockCalmLensAppClient({
    uploadPresetId: MOCK_PRESET_ID,
    token,
    mockOptions: { server: mockServer, preset: MOCK_PRESET },
  });
  if (token) mockAppClients.set(token, client);
  return client;
};
/** When each upload arrived: the mock reports it pending for a moment, as moderation would be. */
const uploadedAt = new Map<string, number>();

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

/** How fast uploads are read: slow enough that the progress bar moves even on localhost. */
const UPLOAD_BYTES_PER_SECOND = 8_000_000;

/**
 * Reads the body at a steady byte rate, so an upload takes the same time however the connection
 * chunks it.
 */
const readSlowly = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  const started = Date.now();
  let received = 0;
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
    received += (chunk as Buffer).length;
    const due = started + (received / UPLOAD_BYTES_PER_SECOND) * 1000;
    if (due > Date.now()) await new Promise((resolve) => setTimeout(resolve, due - Date.now()));
  }
  return Buffer.concat(chunks);
};

const answer = (response: ServerResponse, status: number, upload: UploadedAsset) =>
  json(
    response,
    status,
    Date.now() - (uploadedAt.get(upload.id) ?? 0) < MOCK_CHECK_MS
      ? {
          ...upload,
          classification: {
            ...upload.classification,
            status: "processing",
            moderation: { decision: null },
          },
        }
      : upload,
  );

const mockApi = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
  const route = url.pathname.match(
    /^\/mock-api\/v1\/upload-presets\/([^/]+)\/assets(?:\/([^/]+)(\/part)?)?$/,
  );
  if (!route || route[1] !== MOCK_PRESET_ID)
    return json(response, 404, { code: "upload-preset/not-found" });
  try {
    const client = appClientFor(request);
    const query = url.searchParams;
    const idempotencyKey = request.headers["idempotency-key"]?.toString();
    // The upload widget sends files larger than a part (8 MiB) in parts: the first creates the
    // upload, the rest go to its `/part` endpoint, and the final one completes it.
    const part = () => ({
      partNumber: Number(query.get("partNumber")),
      isFinal: query.get("isFinal") === "true",
    });
    if (request.method === "POST" && !route[2]) {
      // A create request is a form: the asset's fields as the "options" part, then the file.
      const { options, file } = readUploadForm(
        await readSlowly(request),
        request.headers["content-type"] ?? "",
      );
      const data = new Blob([new Uint8Array(file)]);
      const type = query.get("contentType") ?? "application/octet-stream";
      const name = options.name ?? "upload";
      const inParts = request.headers["x-calmlens-upload"] === "part";
      const upload = await client.assets.create(
        inParts
          ? {
              name,
              part: { data, type, ...part() },
              totalSizeInBytes: Number(query.get("totalSizeInBytes")) || undefined,
              idempotencyKey,
            }
          : { name, content: { data, type }, idempotencyKey },
      );
      if (!inParts || part().isFinal) uploadedAt.set(upload.id, Date.now());
      return answer(response, 201, upload);
    }
    if (request.method === "POST" && route[2] && route[3]) {
      const data = new Blob([await readSlowly(request)]);
      const upload = await client.assets.uploadPart({
        assetId: route[2],
        part: { data, ...part() },
        idempotencyKey,
      });
      if (part().isFinal) uploadedAt.set(upload.id, Date.now());
      return answer(response, 200, upload);
    }
    if (request.method === "GET" && route[2] && !route[3]) {
      return answer(response, 200, await client.assets.retrieve({ assetId: route[2] }));
    }
    return json(response, 405, { code: "method-not-allowed" });
  } catch (error) {
    if (!CalmLensError.isCalmLensError(error)) throw error;
    return json(response, error.status ?? 400, {
      code: error.code,
      message: error.message,
      ...(error.details && { details: error.details }),
    });
  }
};

/**
 * Splits an upload form into its JSON "options" part and its "file" part. The file part carries no
 * filename, so a form parser would hand it back as text and corrupt the bytes.
 */
const readUploadForm = (body: Buffer, contentType: string) => {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const delimiter = Buffer.from(`--${boundary?.[1] ?? boundary?.[2] ?? ""}`);
  const parts = new Map<string, Buffer>();
  let at = body.indexOf(delimiter);
  while (at !== -1) {
    const headEnd = body.indexOf("\r\n\r\n", at);
    const next = body.indexOf(delimiter, at + delimiter.length);
    if (headEnd === -1 || next === -1) break;
    const name = /name="([^"]*)"/.exec(body.subarray(at, headEnd).toString("latin1"))?.[1];
    if (name) parts.set(name, body.subarray(headEnd + 4, next - 2));
    at = next;
  }
  const options = JSON.parse(parts.get("options")?.toString("utf8") ?? "{}") as { name?: string };
  return { options, file: parts.get("file") ?? Buffer.alloc(0) };
};

/** Where the mock's CDN lives: the asset URLs it signs start here. */
const MOCK_CDN_BASE_URL = mockServer.toJSON().cdnBaseUrl;
/** Where the page reaches the mock CDN: `/mock-cdn/v1` on this dev server. */
const PAGE_CDN_PATH = "/mock-cdn/v1";

const mockCdn = async (response: ServerResponse, url: URL) => {
  // The mock CDN serves every resource beneath an asset URL, as a browser fetches it, with the
  // same moderation gate as the real one; it ignores lenses and transforms.
  const served = await mockServer.fetchCdn(
    `${MOCK_CDN_BASE_URL}${url.pathname.slice(PAGE_CDN_PATH.length)}${url.search}`,
  );
  response.writeHead(served.status, {
    "Content-Type": served.headers.get("content-type") ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  response.end(Buffer.from(await served.arrayBuffer()));
};

const liveClient = () =>
  new CalmLensServerClient({
    apiKey: env.apiKey ?? "",
    projectId: env.projectId ?? "",
    baseUrl: env.apiUrl,
    cdnBaseUrl: env.cdnUrl,
  });

/**
 * Signs an asset URL for the gallery with `cdn.signAssetUrl`, which works for public and private
 * assets alike. `CalmLensAsset` asks for a new one once it expires. A real app checks that the
 * viewer may see the asset first.
 */
const signAssetUrl = async (
  request: IncomingMessage,
  response: ServerResponse,
  assetId: string,
) => {
  if (!live) {
    const { url, expiresAt } = await mockServer.cdn.signAssetUrl({ assetId });
    // The page reaches the mock CDN through this dev server.
    const page = `http://${request.headers.host}${PAGE_CDN_PATH}`;
    return json(response, 200, { url: page + url.slice(MOCK_CDN_BASE_URL.length), expiresAt });
  }
  json(response, 200, await liveClient().cdn.signAssetUrl({ assetId }));
};

const signToken = async (response: ServerResponse) => {
  if (!live) {
    const { token } = await mockServer.uploadTokens.sign({ uploadPresetId: MOCK_PRESET_ID });
    return json(response, 200, { token });
  }
  const client = liveClient();
  // A real app checks the signed-in user here and passes the ID of the record being created as
  // `externalId`; see the upload component guide.
  const { token } = await client.uploadTokens.sign({ uploadPresetId: env.uploadPresetId ?? "" });
  json(response, 200, { token });
};

export const playgroundServer = (): Plugin => ({
  name: "calmlens-playground-server",
  configureServer(server) {
    server.config.logger.info(
      live
        ? `  CalmLens: live mode, project ${env.projectId}, preset ${env.uploadPresetId}${env.apiUrl ? ` on ${env.apiUrl}` : ""}`
        : "  CalmLens: mock mode (set CALMLENS_API_KEY, CALMLENS_PROJECT_ID and CALMLENS_UPLOAD_PRESET_ID for live mode)",
    );
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      try {
        if (url.pathname === "/api/config") {
          return json(response, 200, {
            mode: live ? "live" : "mock",
            projectId: live ? env.projectId : MOCK_PROJECT_ID,
            uploadPresetId: live ? env.uploadPresetId : MOCK_PRESET_ID,
            ...(live && { baseUrl: env.apiUrl }),
          });
        }
        if (url.pathname === "/api/upload-token" && request.method === "POST") {
          return await signToken(response);
        }
        const assetUrl = url.pathname.match(/^\/api\/assets\/([^/]+)\/url$/);
        if (assetUrl && request.method === "POST") {
          return await signAssetUrl(request, response, decodeURIComponent(assetUrl[1] ?? ""));
        }
        if (url.pathname.startsWith("/samples/")) {
          const sample = SAMPLES[url.pathname.slice("/samples/".length)];
          if (!sample) return json(response, 404, { code: "not-found" });
          response.writeHead(200, { "Content-Type": sample.type });
          return response.end(await readFile(sample.path));
        }
        if (!live && url.pathname.startsWith("/mock-api/"))
          return await mockApi(request, response, url);
        if (!live && url.pathname.startsWith("/mock-cdn/")) return await mockCdn(response, url);
      } catch (error) {
        server.config.logger.error(String(error));
        return json(response, 500, { code: "playground/error", message: String(error) });
      }
      next();
    });
  },
});
