// Bundles the repo's JavaScript SDK build (javascript/esm) into browser modules in sdk/: the app
// client (`app.js`), the upload widget (`elements.js`), the mocks the demo mode uploads to
// (`testing.js`) and the widget's stylesheet. Run `npm run build` in javascript first. Once a
// published @calmlens/sdk release includes CalmLensAppClient, load that instead (see README).
const esm = `${import.meta.dir}/../../javascript/esm`;
const result = await Bun.build({
  entrypoints: ["app.js", "elements.js", "testing.js"].map((entry) => `${esm}/${entry}`),
  outdir: `${import.meta.dir}/sdk`,
  // Shared code goes into chunks, so every module uses the same CalmLensError class.
  splitting: true,
  naming: { entry: "[name].js", chunk: "chunks/[hash].js" },
  target: "browser",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
await Bun.write(`${import.meta.dir}/sdk/styles.css`, Bun.file(`${esm}/styles.css`));
// biome-ignore lint/suspicious/noConsole: CLI output.
console.log("Bundled the SDK into sdk/");
