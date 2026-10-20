import { CalmLensServerClient } from "@calmlens/sdk/server";

const apiKey = process.env.CALMLENS_API_KEY;
const projectId = process.env.CALMLENS_PROJECT_ID;
const uploadPresetId = process.env.CALMLENS_UPLOAD_PRESET_ID;
if (!apiKey || !projectId || !uploadPresetId) {
  throw new Error(
    "Set CALMLENS_API_KEY, CALMLENS_PROJECT_ID and CALMLENS_UPLOAD_PRESET_ID (see the README)",
  );
}

// Signing is local: the API key never leaves this server and no request goes to CalmLens.
const client = new CalmLensServerClient({ apiKey, projectId });

const server = Bun.serve({
  // The iOS Simulator reaches the Mac at 127.0.0.1. Use 0.0.0.0 to reach it from a phone.
  hostname: process.env.HOST ?? "127.0.0.1",
  port: 6411,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/upload-token") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    // A real app checks who is signed in here and only signs tokens for them, for example
    // with an externalId that ties the upload to the user or post it belongs to.
    const { token, expiresAt } = await client.uploadTokens.sign({
      uploadPresetId,
      externalId: `mobile-${crypto.randomUUID()}`,
      expiresInSeconds: 300,
    });
    return Response.json({ token, expiresAt });
  },
});

// biome-ignore lint/suspicious/noConsole: CLI startup output.
console.log(`Token server: http://${server.hostname}:${server.port}/upload-token`);
