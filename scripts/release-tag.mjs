// Tags an SDK's release in this public repository and dispatches the workflow that publishes it.
// It reads the merged release plan (.changeset/release.json), tags the commit that recorded it and
// starts the workflow on that tag, since tags pushed by GITHUB_TOKEN start no workflows themselves.
//
//   node scripts/release-tag.mjs go go/v release-go-sdk.yml
//   node scripts/release-tag.mjs javascript cli-v release-cli.yml

import { execFileSync } from "node:child_process";

const [sdk, prefix, workflow] = process.argv.slice(2);
if (!sdk || !prefix || !workflow) throw new Error("Pass the SDK, tag prefix and workflow file.");
const run = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const git = (...args) => run("git", args);
const source = git(
  "log",
  "-1",
  "--first-parent",
  "--format=%H",
  "HEAD",
  "--",
  ".changeset/release.json",
);
const { releases } = JSON.parse(git("show", `${source}:.changeset/release.json`));
const release = releases.find((entry) => entry.sdk === sdk);
if (release) {
  if (!/^\d+\.\d+\.\d+$/.test(release.version)) throw new Error(`Invalid ${sdk} version`);
  const tag = `${prefix}${release.version}`;
  if (git("tag", "--list", tag)) {
    if (git("rev-parse", `${tag}^{commit}`) !== source)
      throw new Error(`${tag} already points at different code`);
  } else {
    git("tag", tag, source);
    git("push", "origin", `refs/tags/${tag}`);
  }
  const runs = JSON.parse(
    run("gh", [
      "run",
      "list",
      "--workflow",
      workflow,
      "--branch",
      tag,
      "--event",
      "workflow_dispatch",
      "--limit",
      "1",
      "--json",
      "status,conclusion,url",
    ]),
  );
  if (!runs.length) run("gh", ["workflow", "run", workflow, "--ref", tag]);
  else if (runs[0].status === "completed" && runs[0].conclusion !== "success")
    throw new Error(`Review failed ${tag} release: ${runs[0].url}`);
}
