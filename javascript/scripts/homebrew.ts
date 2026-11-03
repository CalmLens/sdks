import { resolve } from "node:path";
import { version } from "../package.json";

// Generates Formula/calmlens.rb, the Homebrew formula for this version's CLI, from the checksums
// attached to its `cli-v<version>` GitHub release (.github/workflows/release-cli.yml).
const directory = process.argv[2];
if (!directory) throw new Error("Pass the release artifact directory.");
const checksums = await Bun.file(resolve(directory, "SHA256SUMS")).text();
const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const entries = platforms.map((platform) => {
  const archive = `calmlens-${version}-${platform}.tar.gz`;
  const checksum = checksums
    .split("\n")
    .find((line) => line.trim().endsWith(` ${archive}`))
    ?.split(/\s+/)[0];
  if (!checksum || !/^[a-f0-9]{64}$/.test(checksum))
    throw new Error(`Missing checksum for ${archive}`);
  return { platform, archive, checksum };
});
const stanza = (platform: string) => {
  const entry = entries.find((entry) => entry.platform === platform)!;
  return `      url "https://github.com/CalmLens/sdks/releases/download/cli-v${version}/${entry.archive}"\n      sha256 "${entry.checksum}"`;
};
await Bun.write(
  resolve(directory, "calmlens.rb"),
  `class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "${version}"

  on_macos do
    on_arm do
${stanza("darwin-arm64")}
    end
    on_intel do
${stanza("darwin-x64")}
    end
  end
  on_linux do
    on_arm do
${stanza("linux-arm64")}
    end
    on_intel do
${stanza("linux-x64")}
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
`,
);
