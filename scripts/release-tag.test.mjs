import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./release-tag.mjs", import.meta.url));

test("--output tags the release commit and hands the tag to the run instead of dispatching", () => {
  const root = mkdtempSync(join(tmpdir(), "sdk-release-tag-"));
  const cwd = join(root, "repo");
  const output = join(root, "output");
  const dispatches = join(root, "gh.log");
  const env = { ...process.env, GITHUB_OUTPUT: output, GH_LOG: dispatches };
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    mkdirSync(cwd);
    git("init", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    mkdirSync(join(cwd, ".changeset"));
    writeFileSync(
      join(cwd, ".changeset/release.json"),
      JSON.stringify({ releases: [{ sdk: "python", version: "0.4.1" }] }),
    );
    git("add", ".");
    git("commit", "-m", "Version SDKs");
    const source = git("rev-parse", "HEAD");
    writeFileSync(join(cwd, "later.txt"), "Unreleased work");
    git("add", ".");
    git("commit", "-m", "Later work");
    git("init", "--bare", join(root, "origin.git"));
    git("remote", "add", "origin", join(root, "origin.git"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$@" >> "$GH_LOG"\necho '[]'\n`);
    chmodSync(join(bin, "gh"), 0o755);
    env.PATH = `${bin}${delimiter}${process.env.PATH}`;
    const tagRelease = () =>
      execFileSync(
        process.execPath,
        [script, "python", "python-sdk/v", "release-python-sdk.yml", "--output"],
        { cwd, env, encoding: "utf8" },
      );

    tagRelease();
    assert.equal(git("rev-parse", "python-sdk/v0.4.1^{commit}"), source);
    assert.equal(git("ls-remote", "origin", "refs/tags/python-sdk/v0.4.1").split("\t")[0], source);
    assert.equal(readFileSync(output, "utf8"), "tag=python-sdk/v0.4.1\n");
    assert.throws(() => readFileSync(dispatches, "utf8"), { code: "ENOENT" });

    // A later run finds the tag in place and hands it on again, for a retried publish.
    tagRelease();
    assert.equal(readFileSync(output, "utf8"), "tag=python-sdk/v0.4.1\ntag=python-sdk/v0.4.1\n");
    assert.throws(() => readFileSync(dispatches, "utf8"), { code: "ENOENT" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
