import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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
    if (language === "rust") {
      for (const lockfile of ["rust/Cargo.lock", "examples/media-library-rust/Cargo.lock"]) {
        const lock = resolve(directory, lockfile);
        const contents = readFileSync(lock, "utf8");
        const next = replaceVersion(
          contents,
          /(\[\[package\]\]\nname = "calmlens"\nversion = ")[^"]+(")/,
          version,
        );
        if (check && contents !== next)
          throw new Error("Rust lockfile version disagrees with manifest");
        if (!check) writeFileSync(lock, next);
      }
    }
    if (language === "ruby") {
      const lock = resolve(directory, "examples/comment-thread-ruby/Gemfile.lock");
      const contents = readFileSync(lock, "utf8");
      const next = replaceVersion(contents, /^(\s+calmlens \()[^)]+(\))$/gm, version);
      if (check && contents !== next) throw new Error("Ruby lockfile version disagrees with gem");
      if (!check) writeFileSync(lock, next);
    }
    if (language === "java" && !check) {
      const example = resolve(directory, "examples/marketplace-listing-java/pom.xml");
      writeFileSync(example, replaceVersion(readFileSync(example, "utf8"), pattern, version));
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
