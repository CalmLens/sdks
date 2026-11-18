// Tags an SDK's release in this public repository and dispatches the workflow that publishes it.
// It reads the merged release plan (.changeset/release.json), tags the commit that recorded it and
// starts the workflow on that tag, since tags pushed by GITHUB_TOKEN start no workflows themselves.
//
//   node scripts/release-tag.mjs go go/v release-go-sdk.yml
//   node scripts/release-tag.mjs javascript cli-v release-cli.yml
//   node scripts/release-tag.mjs javascript javascript/v release-npm.yml --after-checks
//   node scripts/release-tag.mjs python python-sdk/v release-python-sdk.yml --after-checks --output
//
// With --after-checks the release is tagged only once its commit's SDK Tests and SDK examples
// runs have passed (release-checks.mjs): while one is running it waits for a later run of this
// script, and once they have failed it skips the release.
//
// With --output nothing is dispatched: the tag is written to the step's `tag` output instead, for a
// later job of the same run to publish. PyPI, RubyGems and crates.io trust a workflow file and
// environment, so the publish job runs main's workflow and checks out the release tag's code.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { releaseCheckState } from "./release-checks.mjs";
import { releaseSource } from "./release-source.mjs";

const [sdk, prefix, workflow, ...flags] = process.argv.slice(2);
const afterChecks = flags.includes("--after-checks");
const output = flags.includes("--output");
if (!sdk || !prefix || !workflow) throw new Error("Pass the SDK, tag prefix and workflow file.");
const run = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const git = (...args) => run("git", args);
const source = releaseSource();
const { releases } = JSON.parse(git("show", `${source}:.changeset/release.json`));
const release = releases.find((entry) => entry.sdk === sdk);
const state = release && afterChecks ? releaseCheckState(source) : "passed";
if (state === "failed")
  process.stderr.write(`::warning::Not releasing ${sdk} from ${source}: its checks failed\n`);
else if (state === "unchecked")
  process.stderr.write(
    `::warning::Not releasing ${sdk} from ${source}: it reached main merged with other changes, so no push checked its code\n`,
  );
else if (state !== "passed") process.stdout.write(`Waiting for ${state} at ${source}\n`);
else if (release) {
  if (!/^\d+\.\d+\.\d+$/.test(release.version)) throw new Error(`Invalid ${sdk} version`);
  const tag = `${prefix}${release.version}`;
  if (git("tag", "--list", tag)) {
    if (git("rev-parse", `${tag}^{commit}`) !== source)
      throw new Error(`${tag} already points at different code`);
  } else {
    git("tag", tag, source);
    git("push", "origin", `refs/tags/${tag}`);
  }
  if (output) {
    if (!process.env.GITHUB_OUTPUT) throw new Error("--output needs GITHUB_OUTPUT");
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
    process.exit(0);
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
