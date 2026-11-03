// Whether a release commit's required checks passed. A release is published only after the SDK
// Tests and SDK examples workflows, run for the push of that commit to main, have succeeded.
//
//   node scripts/release-checks.mjs <commit>
//
// Prints `passed`, `failed` or the name of the check still to finish, and exits 0 only for
// `passed`. Reads the runs of the repository in GITHUB_REPOSITORY (default CalmLens/sdks).

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

/** The checks of the push that put `commit` on main. */
export function releaseCheckState(commit) {
  const checks = JSON.parse(
    execFileSync(
      "gh",
      [
        "run",
        "list",
        "-R",
        process.env.GITHUB_REPOSITORY || "CalmLens/sdks",
        "--commit",
        commit,
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
