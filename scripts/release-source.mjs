import { execFileSync } from "node:child_process";

// Follow both parents: a release merged from origin retains its original checked commit.
// The merge itself must never become the target of an immutable version tag.
export function releaseSource(cwd = process.cwd()) {
  return execFileSync(
    "git",
    ["log", "-1", "--no-merges", "--format=%H", "HEAD", "--", ".changeset/release.json"],
    { cwd, encoding: "utf8" },
  ).trim();
}
