import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { version } from "../package.json";
import { readReleaseChecksums, releaseUrl } from "./release-checksums";

// Generates the Windows package manifests for this version's CLI from the checksums attached to
// its `cli-v<version>` GitHub release (.github/workflows/release-cli.yml):
//
// - calmlens.json, a Scoop manifest for a bucket in this repository (bucket/calmlens.json);
// - winget/, the three winget manifests for a pull request to microsoft/winget-pkgs
//   (manifests/c/CalmLens/CLI/<version>/).
const directory = process.argv[2];
if (!directory) throw new Error("Pass the release artifact directory.");
const archive = `calmlens-${version}-windows-x64.zip`;
const checksum = (await readReleaseChecksums(directory, [archive]))[archive]!;
const url = releaseUrl(version, archive);
const description = "CalmLens CLI for local webhook development";
const homepage = "https://calmlens.com/docs/guides/local-development";

await Bun.write(
  resolve(directory, "calmlens.json"),
  `${JSON.stringify(
    {
      version,
      description,
      homepage,
      license: "MIT",
      architecture: { "64bit": { url, hash: checksum } },
      bin: "calmlens.exe",
      checkver: { github: "https://github.com/CalmLens/sdks", regex: "cli-v([\\d.]+)" },
      autoupdate: {
        architecture: {
          "64bit": {
            url: "https://github.com/CalmLens/sdks/releases/download/cli-v$version/calmlens-$version-windows-x64.zip",
          },
        },
        hash: { url: "$baseurl/SHA256SUMS" },
      },
    },
    null,
    2,
  )}\n`,
);

const identifier = "CalmLens.CLI";
const schema = (type: string) =>
  `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.1.6.0.schema.json\n`;
const winget = resolve(directory, "winget");
await mkdir(winget, { recursive: true });
await Bun.write(
  resolve(winget, `${identifier}.yaml`),
  `${schema("version")}PackageIdentifier: ${identifier}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
`,
);
await Bun.write(
  resolve(winget, `${identifier}.installer.yaml`),
  `${schema("installer")}PackageIdentifier: ${identifier}
PackageVersion: ${version}
InstallerType: zip
NestedInstallerType: portable
NestedInstallerFiles:
  - RelativeFilePath: calmlens.exe
    PortableCommandAlias: calmlens
Installers:
  - Architecture: x64
    InstallerUrl: ${url}
    InstallerSha256: ${checksum.toUpperCase()}
ManifestType: installer
ManifestVersion: 1.6.0
`,
);
await Bun.write(
  resolve(winget, `${identifier}.locale.en-US.yaml`),
  `${schema("defaultLocale")}PackageIdentifier: ${identifier}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: CalmLens
PublisherUrl: https://calmlens.com
PackageName: CalmLens CLI
PackageUrl: ${homepage}
License: MIT
LicenseUrl: https://github.com/CalmLens/sdks/blob/main/LICENSE
ShortDescription: ${description}
Description: Forward your CalmLens project's events to a local webhook handler, signed like real deliveries, and create test events.
Moniker: calmlens
Tags:
  - cli
  - webhooks
  - moderation
ReleaseNotesUrl: https://github.com/CalmLens/sdks/releases/tag/cli-v${version}
ManifestType: defaultLocale
ManifestVersion: 1.6.0
`,
);
