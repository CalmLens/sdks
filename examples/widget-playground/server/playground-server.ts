// The playground's server, run inside Vite's dev server. It signs upload tokens and tells the
// page which project to use. Without CalmLens credentials it also answers the upload API and CDN
// with the SDK's mock clients, keeping files in memory, so every component can be tried offline.
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { CalmLensError, CalmLensServerClient, type UploadedAsset } from "@calmlens/sdk/server";
import {
  createMockApiKey,
  MockCalmLensAppClient,
  MockCalmLensServerClient,
} from "@calmlens/sdk/testing";
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
      actions: ["assets:create", "assets:read", "assets:update"],
      folderId: null,
      includeSubfolders: true,
    },
  ]),
  projectId: MOCK_PROJECT_ID,
  mockOptions: {
    queuedOutcome: ({ name }) =>
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

/** Reads the body slowly, so the upload's progress bar moves even on localhost. */
const readSlowly = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
  return Buffer.concat(chunks);
};

const answer = (response: ServerResponse, status: number, upload: UploadedAsset) =>
  json(response, status, {
    ...upload,
    status:
      Date.now() - (uploadedAt.get(upload.id) ?? 0) < MOCK_CHECK_MS ? "pending" : upload.status,
  });

const mockApi = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
  const route = url.pathname.match(
    /^\/mock-api\/v1\/upload-presets\/([^/]+)\/assets(?:\/([^/]+))?$/,
  );
  if (!route || route[1] !== MOCK_PRESET_ID)
    return json(response, 404, { code: "upload-preset/not-found" });
  try {
    const client = appClientFor(request);
    if (request.method === "POST" && !route[2]) {
      const bytes = await readSlowly(request);
      const upload = await client.assets.create({
        name: url.searchParams.get("name") ?? "upload",
        content: {
          data: new Blob([bytes]),
          type: url.searchParams.get("contentType") ?? "application/octet-stream",
        },
      });
      uploadedAt.set(upload.id, Date.now());
      return answer(response, 201, upload);
    }
    if (request.method === "GET" && route[2]) {
      return answer(response, 200, await client.assets.retrieve({ assetId: route[2] }));
    }
    return json(response, 405, { code: "method-not-allowed" });
  } catch (error) {
    if (!CalmLensError.isCalmLensError(error)) throw error;
    return json(response, error.status ?? 400, { code: error.code, message: error.message });
  }
};

const mockCdn = async (response: ServerResponse, url: URL) => {
  const route = url.pathname.match(
    /^\/mock-cdn\/v1\/assets\/([^/]+)\/([^/]+)\/(original|rendered|placeholder)/,
  );
  if (!route || route[1] !== MOCK_PROJECT_ID)
    return json(response, 404, { code: "asset/not-found" });
  // The mock CDN applies the moderation gate; it ignores lenses and transforms.
  const served = await mockServer.cdn.serve({
    assetIdentifier: route[2] ?? "",
    resource: route[3] as "original" | "rendered" | "placeholder",
    ageConfirmed: url.searchParams.get("ageConfirmed") === "true" || undefined,
  });
  response.writeHead(served.status, {
    "Content-Type": served.headers.get("content-type") ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  response.end(Buffer.from(await served.arrayBuffer()));
};

const signToken = async (response: ServerResponse) => {
  if (!live) {
    const { token } = await mockServer.uploadTokens.sign({ uploadPresetId: MOCK_PRESET_ID });
    return json(response, 200, { token });
  }
  const client = new CalmLensServerClient({
    apiKey: env.apiKey ?? "",
    projectId: env.projectId ?? "",
    baseUrl: env.apiUrl,
  });
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
            ...(live && { baseUrl: env.apiUrl, cdnBaseUrl: env.cdnUrl }),
          });
        }
        if (url.pathname === "/api/upload-token" && request.method === "POST") {
          return await signToken(response);
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
