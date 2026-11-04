import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const languages = ["javascript", "python", "ruby", "rust", "java", "go", "php"];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const manifests = {
  php: ["php/src/Version.php", /^(\s*public const VERSION = ')[^']+(';)/m],
  python: ["python/pyproject.toml", /^(version\s*=\s*")[^"]+("\s*)$/m],
  ruby: ["ruby/lib/calmlens/version.rb", /^(\s*VERSION\s*=\s*['"])[^'"]+(['"])/m],
  rust: ["rust/Cargo.toml", /^(version\s*=\s*")[^"]+("\s*)$/m],
  java: ["java/pom.xml", /(<artifactId>calmlens-sdk<\/artifactId><version>)[^<]+(<\/version>)/],
  go: ["go/version.go", /^(const Version = ")[^"]+(")/m],
};
const cargoLock = /(\[\[package\]\]\nname = "calmlens"\nversion = ")[^"]+(")/;
/**
 * Other files that name each SDK's release. Each one with a message must already agree with the
 * SDK version before versioning, and `--check` reports the message when it does not.
 */
export const companions = {
  rust: [
    ["rust/Cargo.lock", cargoLock, "Rust lockfile version disagrees with manifest"],
    [
      "examples/media-library-rust/Cargo.lock",
      cargoLock,
      "Rust lockfile version disagrees with manifest",
    ],
  ],
  ruby: [
    [
      "examples/comment-thread-ruby/Gemfile.lock",
      /^(\s+calmlens \()[^)]+(\))$/gm,
      "Ruby lockfile version disagrees with gem",
    ],
  ],
  java: [
    [
      "java/README.md",
      /(<artifactId>calmlens-sdk<\/artifactId>\n\s*<version>)[^<]+(<\/version>)/,
      "The Java README's install snippet disagrees with the SDK version",
    ],
    ["examples/marketplace-listing-java/pom.xml", manifests.java[1]],
  ],
};
/** Every file the version synchronization reads or rewrites, besides each SDK's package.json. */
export const versionedFiles = [
  ...Object.values(manifests).map(([file]) => file),
  ...Object.values(companions)
    .flat()
    .map(([file]) => file),
];
export function replaceVersion(source, pattern, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid stable version: ${version}`);
  if (!pattern.test(source)) throw new Error("Missing SDK version field");
  return source.replace(pattern, (_, before, after) => `${before}${version}${after}`);
}
export function syncVersions(directory, check = false) {
  for (const [language, [file, pattern]] of Object.entries(manifests)) {
    const { version } = JSON.parse(readFileSync(resolve(directory, language, "package.json")));
    const path = resolve(directory, file);
    const source = readFileSync(path, "utf8");
    const updated = replaceVersion(source, pattern, version);
    if (check && updated !== source)
      throw new Error(`${file} disagrees with Changesets version ${version}`);
    if (!check) writeFileSync(path, updated);
    for (const [companion, companionPattern, disagreement] of companions[language] ?? []) {
      if (check && !disagreement) continue;
      const companionPath = resolve(directory, companion);
      const contents = readFileSync(companionPath, "utf8");
      const next = replaceVersion(contents, companionPattern, version);
      if (check && contents !== next) throw new Error(disagreement);
      if (!check) writeFileSync(companionPath, next);
    }
  }
}
const versions = () =>
  Object.fromEntries(
    languages.map((language) => [
      language,
      JSON.parse(readFileSync(resolve(root, language, "package.json"))).version,
    ]),
  );
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  if (check) syncVersions(root, true);
  else {
    syncVersions(root, true);
    const before = versions();
    execFileSync("bun", ["x", "--no-install", "changeset", "version"], {
      cwd: root,
      stdio: "inherit",
    });
    syncVersions(root);
    // Changesets writes its changelogs in a layout the repository's formatter rejects.
    const changelogs = languages
      .map((language) => resolve(root, language, "CHANGELOG.md"))
      .filter((changelog) => existsSync(changelog));
    if (changelogs.length)
      execFileSync("bun", ["x", "--no-install", "biome", "format", "--write", ...changelogs], {
        cwd: root,
        stdio: "inherit",
      });
    const releases = Object.entries(versions())
      .filter(([language, version]) => before[language] !== version)
      .map(([sdk, version]) => ({ sdk, version }));
    if (releases.length)
      writeFileSync(
        resolve(root, ".changeset/release.json"),
        `${JSON.stringify({ releases }, null, 2)}\n`,
      );
    execFileSync("bun", ["install", "--lockfile-only", "--ignore-scripts"], {
      cwd: root,
      stdio: "inherit",
    });
  }
}
