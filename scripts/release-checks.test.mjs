import assert from "node:assert/strict";
import { test } from "node:test";
import { checkState } from "./release-checks.mjs";

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
