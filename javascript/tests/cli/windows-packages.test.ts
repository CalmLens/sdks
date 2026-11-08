import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../../package.json";

test("Scoop and winget manifests pin the Windows release archive and its checksum", async () => {
  const directory = await mkdtemp(join(tmpdir(), "calmlens-windows-packages-"));
  try {
    const archive = `calmlens-${version}-windows-x64.zip`;
    const checksum = "ab".repeat(32);
    await Bun.write(
      join(directory, "SHA256SUMS"),
      `${"cd".repeat(32)}  calmlens-${version}-linux-x64.tar.gz\n${checksum}  ${archive}\n`,
    );
    const generate = () =>
      Bun.spawnSync(
        [process.execPath, join(import.meta.dir, "../../scripts/windows-packages.ts"), directory],
        { stderr: "pipe" },
      );
    expect(generate().exitCode).toBe(0);
    const url = `https://github.com/CalmLens/sdks/releases/download/cli-v${version}/${archive}`;

    const scoop = await Bun.file(join(directory, "calmlens.json")).json();
    expect(scoop.version).toBe(version);
    expect(scoop.architecture).toEqual({ "64bit": { url, hash: checksum } });
    expect(scoop.bin).toBe("calmlens.exe");

    const installer = await Bun.file(join(directory, "winget/CalmLens.CLI.installer.yaml")).text();
    expect(installer).toContain(`PackageVersion: ${version}\n`);
    expect(installer).toContain(`InstallerUrl: ${url}\n`);
    expect(installer).toContain(`InstallerSha256: ${checksum.toUpperCase()}\n`);
    expect(installer).toContain("PortableCommandAlias: calmlens\n");
    for (const manifest of ["CalmLens.CLI.yaml", "CalmLens.CLI.locale.en-US.yaml"])
      expect(await Bun.file(join(directory, "winget", manifest)).text()).toContain(
        `PackageVersion: ${version}\n`,
      );

    await Bun.write(join(directory, "SHA256SUMS"), `${"cd".repeat(32)}  other.zip\n`);
    expect(generate().exitCode).not.toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
