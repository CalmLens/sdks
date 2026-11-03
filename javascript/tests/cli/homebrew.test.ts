import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../../package.json";

test("Homebrew formula pins release URLs and checksums, and rejects missing checksums", async () => {
  const directory = await mkdtemp(join(tmpdir(), "calmlens-formula-"));
  try {
    const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
    await Bun.write(
      join(directory, "SHA256SUMS"),
      platforms
        .map((platform, i) => `${String(i + 1).repeat(64)}  calmlens-${version}-${platform}.tar.gz`)
        .join("\n"),
    );
    const generate = () =>
      Bun.spawnSync(
        [process.execPath, join(import.meta.dir, "../../scripts/homebrew.ts"), directory],
        { stderr: "pipe" },
      );
    expect(generate().exitCode).toBe(0);
    const formula = await Bun.file(join(directory, "calmlens.rb")).text();
    for (const [i, platform] of platforms.entries()) {
      expect(formula).toContain(
        `/CalmLens/sdks/releases/download/cli-v${version}/calmlens-${version}-${platform}.tar.gz`,
      );
      expect(formula).toContain(`sha256 "${String(i + 1).repeat(64)}"`);
    }
    await Bun.write(join(directory, "SHA256SUMS"), "");
    expect(generate().exitCode).not.toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
