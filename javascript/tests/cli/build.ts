import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../../scripts/build-cli.ts");

/**
 * Builds the CLI with the package's own build script into a new temporary directory: the npm
 * entry (run with Node.js) or the standalone executable. Returns the command and a cleanup.
 */
export const buildCli = async (kind: "node" | "binary") => {
  const directory = await mkdtemp(join(tmpdir(), "calmlens-cli-build-"));
  const built = Bun.spawnSync(
    [process.execPath, script, ...(kind === "binary" ? ["--binary"] : []), "--out-dir", directory],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (built.exitCode !== 0) throw new Error(`CLI build failed:\n${built.stderr.toString()}`);
  const command =
    kind === "node"
      ? ["node", join(directory, "calmlens.js")]
      : [join(directory, process.platform === "win32" ? "calmlens.exe" : "calmlens")];
  return { command, cleanup: () => rm(directory, { recursive: true, force: true }) };
};
