// Whether a release commit's required checks passed. A release is published only after the SDK
// Tests and SDK examples workflows, run for the push that put that commit's code on main, have
// succeeded: the commit's own push, or the push of a merge that holds exactly its code.
//
//   node scripts/release-checks.mjs <commit>
//
// Prints `passed`, `failed`, `unchecked` or the name of the check still to finish, and exits 0
// only for `passed`. Reads the runs of the repository in GITHUB_REPOSITORY (default CalmLens/sdks).

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_CHECKS = ["SDK Tests", "SDK examples"];

/** `passed`, `failed` for good, or the name of a check still to finish. */
export function checkState(checks) {
  for (const name of REQUIRED_CHECKS) {
    const runs = checks.filter((check) => check.name === name);
    // A rerun that passed counts, even beside a failed attempt.
    if (runs.some((check) => check.status === "completed" && check.conclusion === "success"))
      continue;
    if (runs.length && runs.every((check) => check.status === "completed")) return "failed";
    return name;
  }
  return "passed";
}

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * The commit whose push to main ran `commit`'s checks: the commit itself when it was pushed
 * directly, or else the merge that brought it in, provided that merge holds exactly its code.
 * Null when it reached main only alongside other changes, so no push checked it on its own.
 */
export function checkedCommit(commit, cwd = process.cwd(), main = "origin/main") {
  // Main's history, not HEAD's: a publish runs on a checkout of the release tag itself.
  const mainline = git(cwd, "rev-list", "--first-parent", main).split("\n");
  if (mainline.includes(commit)) return commit;
  const merge = mainline.findLast((candidate) => {
    try {
      git(cwd, "merge-base", "--is-ancestor", commit, candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!merge) return null;
  return git(cwd, "rev-parse", `${merge}^{tree}`) === git(cwd, "rev-parse", `${commit}^{tree}`)
    ? merge
    : null;
}

/** The checks of the push that put `commit` on main, or `unchecked` when no push checked it alone. */
export function releaseCheckState(commit) {
  const pushed = checkedCommit(commit);
  if (!pushed) return "unchecked";
  const checks = JSON.parse(
    execFileSync(
      "gh",
      [
        "run",
        "list",
        "-R",
        process.env.GITHUB_REPOSITORY || "CalmLens/sdks",
        "--commit",
        pushed,
        "--event",
        "push",
        "--limit",
        "30",
        "--json",
        "name,status,conclusion",
      ],
      { encoding: "utf8" },
    ),
  );
  return checkState(checks);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [commit] = process.argv.slice(2);
  if (!commit) throw new Error("Pass the release commit.");
  const state = releaseCheckState(commit);
  process.stdout.write(`${state}\n`);
  process.exit(state === "passed" ? 0 : 1);
}
