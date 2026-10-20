// Bundles the repo's JavaScript SDK app client build (javascript/esm/app.js) into one
// browser module at sdk/calmlens.js. Run `npm run build` in javascript first. Once a
// published @calmlens/sdk release includes CalmLensAppClient, load that instead (see README).
const result = await Bun.build({
  entrypoints: [`${import.meta.dir}/../../javascript/esm/app.js`],
  outdir: `${import.meta.dir}/sdk`,
  naming: "calmlens.js",
  target: "browser",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("Bundled the SDK into sdk/calmlens.js");
