import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { releaseSource } from "./release-source.mjs";

test("a merged release resolves to its original commit without moving its tag", () => {
  const cwd = mkdtempSync(join(tmpdir(), "sdk-release-source-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("init", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    mkdirSync(join(cwd, ".changeset"));
    const plan = join(cwd, ".changeset/release.json");
    writeFileSync(plan, JSON.stringify({ releases: [] }));
    git("add", ".");
    git("commit", "-m", "Initial plan");
    git("checkout", "-b", "release");
    writeFileSync(plan, JSON.stringify({ releases: [{ sdk: "javascript", version: "0.25.0" }] }));
    git("commit", "-am", "Version SDKs");
    const source = git("rev-parse", "HEAD");
    git("tag", "javascript/v0.25.0");
    git("checkout", "main");
    writeFileSync(join(cwd, "other.txt"), "Independent work");
    git("add", ".");
    git("commit", "-m", "Independent work");
    git("merge", "--no-ff", "release", "-m", "Merge release");
    assert.notEqual(git("rev-parse", "HEAD"), source);
    assert.equal(releaseSource(cwd), source);
    assert.equal(git("rev-parse", "javascript/v0.25.0"), source);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
