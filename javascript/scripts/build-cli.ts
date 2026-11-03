import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

// Builds the `calmlens` CLI from src/cli. By default it writes bin/calmlens.js, the bundled
// Node.js entry this package's `bin` runs. `--binary` writes a standalone executable to dist/,
// which embeds Bun and needs no Node.js; set CALMLENS_BUILD_TARGET (such as `bun-linux-x64`) to
// cross-compile it. `--out-dir` writes either build somewhere else, as the tests do.
const { values } = parseArgs({
  options: { binary: { type: "boolean" }, "out-dir": { type: "string" } },
});
const binary = Boolean(values.binary);
const target = process.env.CALMLENS_BUILD_TARGET;
const root = resolve(import.meta.dir, "..");
const directory = resolve(root, values["out-dir"] ?? (binary ? "dist" : "bin"));
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const windows = target?.includes("windows") ?? process.platform === "win32";
const outfile = resolve(directory, binary ? `calmlens${windows ? ".exe" : ""}` : "calmlens.js");
const result = Bun.spawnSync(
  [
    process.execPath,
    "build",
    "src/cli/index.ts",
    "--outfile",
    outfile,
    ...(binary ? ["--compile", ...(target ? ["--target", target] : [])] : ["--target", "node"]),
  ],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
if (result.exitCode !== 0) process.exit(result.exitCode);
if (!binary) {
  const source = await Bun.file(outfile).text();
  await Bun.write(outfile, `#!/usr/bin/env node\n${source}`);
  // The bundle is an ES module, and the package's own package.json declares no module type.
  await Bun.write(resolve(directory, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
}
await chmod(outfile, 0o755);
