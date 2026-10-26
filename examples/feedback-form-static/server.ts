// Serves the static files for local development. Nothing here talks to CalmLens: the browser
// uploads straight to the API.
//
// With CALMLENS_UPLOAD_PRESET_ID set (and CALMLENS_API_URL for a local CalmLens instance), it
// serves config.js from those instead of the file, so you can try a preset without editing it.
const files: Record<string, string> = {
  "/": "index.html",
  "/app.js": "app.js",
  "/feedback.js": "feedback.js",
  "/config.js": "config.js",
};

const presetId = process.env.CALMLENS_UPLOAD_PRESET_ID;
const configFromEnv = presetId
  ? [
      `export const UPLOAD_PRESET_ID = ${JSON.stringify(presetId)};`,
      `export const API_BASE_URL = ${JSON.stringify(process.env.CALMLENS_API_URL) ?? "undefined"};`,
    ].join("\n")
  : undefined;

const server = Bun.serve({
  hostname: "localhost",
  port: 6406,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/config.js" && configFromEnv) {
      return new Response(configFromEnv, { headers: { "Content-Type": "text/javascript" } });
    }
    // The bundled SDK: its entry modules, shared chunks and stylesheet.
    if (/^\/sdk\/(chunks\/)?[\w-]+\.(js|css)$/.test(pathname)) {
      const file = Bun.file(`${import.meta.dir}${pathname}`);
      if (await file.exists()) return new Response(file);
    }
    const path = files[pathname];
    return path
      ? new Response(Bun.file(`${import.meta.dir}/${path}`))
      : new Response("Not found", { status: 404 });
  },
});

// biome-ignore lint/suspicious/noConsole: CLI output.
console.log(`Calmform running at ${server.url}`);
