import { resolve } from "node:path";

/**
 * Reads each archive's SHA-256 checksum from a CLI release's SHA256SUMS, as written by
 * .github/workflows/release-cli.yml. Throws for an archive without a valid checksum.
 */
export const readReleaseChecksums = async (directory: string, archives: readonly string[]) => {
  const checksums = await Bun.file(resolve(directory, "SHA256SUMS")).text();
  return Object.fromEntries(
    archives.map((archive) => {
      const checksum = checksums
        .split("\n")
        .find((line) => line.trim().endsWith(` ${archive}`))
        ?.split(/\s+/)[0];
      if (!checksum || !/^[a-f0-9]{64}$/.test(checksum))
        throw new Error(`Missing checksum for ${archive}`);
      return [archive, checksum];
    }),
  );
};

export const releaseUrl = (version: string, archive: string) =>
  `https://github.com/CalmLens/sdks/releases/download/cli-v${version}/${archive}`;
