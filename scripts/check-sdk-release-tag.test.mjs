import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkReleaseTag, readManifestVersion, SDK_MANIFESTS } from "./check-sdk-release-tag.mjs";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const script = join(root, "scripts/check-sdk-release-tag.mjs");

test("every published SDK manifest declares a version the release check can read", () => {
  for (const [sdk, { path }] of Object.entries(SDK_MANIFESTS)) {
    const version = readManifestVersion(sdk, readFileSync(join(root, path), "utf8"));
    assert.match(version, /^\d+\.\d+\.\d+/, sdk);
  }
});

test("the manifest version is the package's own, not a dependency's", () => {
  const cargo = `[package]\nname = "calmlens"\nversion = "1.2.3"\n\n[dependencies]\nserde = { version = "9.9.9" }\n`;
  assert.equal(readManifestVersion("rust", cargo), "1.2.3");
  const pyproject = `[build-system]\nrequires = ["setuptools>=77"]\n\n[project]\nname = "calmlens"\nversion = "1.2.3"\n`;
  assert.equal(readManifestVersion("python", pyproject), "1.2.3");
  const pom = `<project><dependencies><dependency><artifactId>gson</artifactId><version>9.9.9</version></dependency></dependencies><groupId>com.calmlens</groupId><artifactId>calmlens-sdk</artifactId><version>1.2.3</version></project>`;
  assert.equal(readManifestVersion("java", pom), "1.2.3");
});

test("a tag publishes only the version the manifest declares", () => {
  const gemspec = "module CalmLens\n  VERSION = '1.2.3'\nend\n";
  assert.equal(checkReleaseTag("ruby", "ruby-sdk/v1.2.3", gemspec), "1.2.3");
  assert.throws(() => checkReleaseTag("ruby", "ruby-sdk/v1.2.4", gemspec), /declares 1\.2\.3/);
  // Another SDK's tag, or a tag without the SDK prefix, never releases this one.
  assert.throws(() => checkReleaseTag("ruby", "rust-sdk/v1.2.3", gemspec), /ruby-sdk\/v/);
  assert.throws(() => checkReleaseTag("ruby", "v1.2.3", gemspec), /ruby-sdk\/v/);
});

test("Go releases use the module subdirectory tag and the reported SDK version", () => {
  const source = 'package calmlens\nconst Version = "0.1.0"\n';
  assert.equal(checkReleaseTag("go", "go/v0.1.0", source), "0.1.0");
  assert.throws(() => checkReleaseTag("go", "go-sdk/v0.1.0", source), /go\/v/);
  assert.throws(() => checkReleaseTag("go", "go/v0.2.0", source), /declares 0\.1\.0/);
});

test("the command fails a mismatched tag and prints the version of a matching one", () => {
  const version = readManifestVersion(
    "python",
    readFileSync(join(root, SDK_MANIFESTS.python.path), "utf8"),
  );
  const matching = spawnSync(process.execPath, [script, "python", `python-sdk/v${version}`], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: "" },
  });
  assert.equal(matching.status, 0, matching.stderr);
  assert.equal(matching.stdout.trim(), version);
  const mismatched = spawnSync(process.execPath, [script, "python", "python-sdk/v999.0.0"], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: "" },
  });
  assert.equal(mismatched.status, 1);
});
