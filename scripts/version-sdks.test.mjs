import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { manifests, replaceVersion, syncVersions } from "./version-sdks.mjs";

test("version synchronization updates every native SDK without changing dependency versions", () => {
  const root = mkdtempSync(join(tmpdir(), "calmlens-version-test-"));
  const source = fileURLToPath(new URL("../", import.meta.url));
  try {
    for (const [language, [file]] of Object.entries(manifests)) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      cpSync(join(source, file), join(root, file));
      writeFileSync(join(root, language, "package.json"), JSON.stringify({ version: "1.2.3" }));
    }
    cpSync(join(source, "rust/Cargo.lock"), join(root, "rust/Cargo.lock"));
    mkdirSync(join(root, "examples/marketplace-listing-java"), { recursive: true });
    cpSync(
      join(source, "examples/marketplace-listing-java/pom.xml"),
      join(root, "examples/marketplace-listing-java/pom.xml"),
    );
    assert.throws(() => syncVersions(root, true), /disagrees/);
    mkdirSync(join(root, "examples/media-library-rust"), { recursive: true });
    cpSync(
      join(source, "examples/media-library-rust/Cargo.lock"),
      join(root, "examples/media-library-rust/Cargo.lock"),
    );
    syncVersions(root);
    for (const [, [file, pattern]] of Object.entries(manifests)) {
      const result = readFileSync(join(root, file), "utf8");
      assert.equal(result.match(pattern)?.[0].includes("1.2.3"), true, file);
    }
    assert.match(
      readFileSync(join(root, "rust/Cargo.lock"), "utf8"),
      /name = "calmlens"\nversion = "1.2.3"/,
    );
    const example = readFileSync(join(root, "examples/marketplace-listing-java/pom.xml"), "utf8");
    assert.match(example, /<artifactId>calmlens-sdk<\/artifactId><version>1.2.3<\/version>/);
    assert.match(
      readFileSync(join(root, "java/pom.xml"), "utf8"),
      /<artifactId>gson<\/artifactId><version>2.11.0<\/version>/,
    );
    syncVersions(root, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("refuses missing manifest fields and non-stable release versions", () => {
  assert.throws(() => replaceVersion("", manifests.go[1], "1.0.0"), /Missing/);
  assert.throws(
    () => replaceVersion('const Version = "1.0.0"', manifests.go[1], "1.0.1-beta"),
    /Invalid/,
  );
});
