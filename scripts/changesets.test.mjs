import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("Changesets versions all seven SDKs and generates native changelogs and a release plan", () => {
  const original = fileURLToPath(new URL("../", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "calmlens-changesets-roundtrip-"));
  try {
    cpSync(join(original, "package.json"), join(root, "package.json"));
    cpSync(join(original, "bun.lock"), join(root, "bun.lock"));
    // Only the configuration: pending changesets would change the versions this test expects.
    mkdirSync(join(root, ".changeset"));
    for (const file of ["config.json", "release.json"]) {
      cpSync(join(original, ".changeset", file), join(root, ".changeset", file));
    }
    cpSync(join(original, "scripts"), join(root, "scripts"), { recursive: true });
    symlinkSync(join(original, "node_modules"), join(root, "node_modules"));
    for (const lang of ["javascript", "python", "ruby", "rust", "java", "go", "php"]) {
      mkdirSync(join(root, lang), { recursive: true });
      cpSync(join(original, lang, "package.json"), join(root, lang, "package.json"));
    }
    for (const file of [
      "php/src/Version.php",
      "python/pyproject.toml",
      "ruby/lib/calmlens/version.rb",
      "rust/Cargo.toml",
      "rust/Cargo.lock",
      "java/pom.xml",
      "go/version.go",
      "examples/marketplace-listing-java/pom.xml",
      "examples/media-library-rust/Cargo.lock",
      "examples/comment-thread-ruby/Gemfile.lock",
    ]) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      cpSync(join(original, file), join(root, file));
    }
    writeFileSync(
      join(root, ".changeset/roundtrip.md"),
      '---\n"@calmlens/sdk": patch\n"@calmlens/sdk-python": patch\n"@calmlens/sdk-ruby": patch\n"@calmlens/sdk-rust": patch\n"@calmlens/sdk-java": patch\n"@calmlens/sdk-go": patch\n"@calmlens/sdk-php": patch\n---\n\nExercise native release adapters.\n',
    );
    execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
    execFileSync("bun", ["run", "release:version"], { cwd: root, stdio: "inherit" });
    execFileSync("bun", ["run", "release:check"], { cwd: root, stdio: "inherit" });
    const { releases } = JSON.parse(readFileSync(join(root, ".changeset/release.json")));
    assert.equal(releases.length, 7);
    for (const { sdk, version } of releases) {
      const before = JSON.parse(readFileSync(join(original, sdk, "package.json")))
        .version.split(".")
        .map(Number);
      assert.equal(version, `${before[0]}.${before[1]}.${before[2] + 1}`);
      assert.match(
        readFileSync(join(root, sdk, "CHANGELOG.md"), "utf8"),
        /Exercise native release adapters/,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
