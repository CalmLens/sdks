// Serves the static files for local development. Nothing here talks to CalmLens: the browser
// uploads straight to the API.
const files: Record<string, string> = {
  "/": "index.html",
  "/app.js": "app.js",
  "/sdk/calmlens.js": "sdk/calmlens.js",
};

const server = Bun.serve({
  hostname: "localhost",
  port: 6406,
  fetch(request) {
    const path = files[new URL(request.url).pathname];
    return path
      ? new Response(Bun.file(`${import.meta.dir}/${path}`))
      : new Response("Not found", { status: 404 });
  },
});

console.log(`Calmform running at ${server.url}`);
