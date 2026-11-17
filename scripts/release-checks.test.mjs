import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkedCommit, checkState } from "./release-checks.mjs";

test("a release waits for running checks, fails once they have failed and accepts a passed rerun", () => {
  const run = (name, status, conclusion = "") => ({ name, status, conclusion });
  const tests = run("SDK Tests", "completed", "success");
  const examples = run("SDK examples", "completed", "success");
  assert.equal(checkState([tests, examples]), "passed");
  assert.equal(checkState([tests]), "SDK examples");
  assert.equal(checkState([tests, run("SDK examples", "in_progress")]), "SDK examples");
  assert.equal(checkState([run("SDK Tests", "completed", "failure"), examples]), "failed");
  assert.equal(checkState([run("SDK Tests", "completed", "failure"), tests, examples]), "passed");
  assert.equal(
    checkState([run("SDK Tests", "completed", "failure"), run("SDK Tests", "queued"), examples]),
    "SDK Tests",
  );
});

test("a release's checks are its own push's, or those of a merge that holds exactly its code", () => {
  const cwd = mkdtempSync(join(tmpdir(), "sdk-release-checks-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = (file, message) => {
    writeFileSync(join(cwd, file), message);
    git("add", ".");
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    const pushed = commit("plan.json", "Pushed release");
    assert.equal(checkedCommit(pushed, cwd, "main"), pushed);

    git("checkout", "-b", "alone");
    const alone = commit("plan.json", "Release merged alone");
    git("checkout", "main");
    git("merge", "--no-ff", "alone", "-m", "Merge the release alone");
    const merge = git("rev-parse", "HEAD");
    assert.equal(checkedCommit(alone, cwd, "main"), merge);
    // As a publish sees it: a checkout of the release's tag, with main's history fetched.
    git("checkout", "-q", alone);
    assert.equal(checkedCommit(alone, cwd, "main"), merge);
    git("checkout", "-q", "main");

    git("checkout", "-b", "beside");
    const beside = commit("plan.json", "Release merged beside other work");
    git("checkout", "main");
    commit("other.txt", "Other work");
    git("merge", "--no-ff", "beside", "-m", "Merge the release beside other work");
    assert.equal(checkedCommit(beside, cwd, "main"), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
