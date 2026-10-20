import { execFileSync } from "node:child_process";

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
const release = releases.find(({ sdk }) => sdk === "go");
if (release) {
  if (!/^\d+\.\d+\.\d+$/.test(release.version)) throw new Error("Invalid Go version");
  const tag = `go/v${release.version}`;
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
      "release-go-sdk.yml",
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
  if (!runs.length) run("gh", ["workflow", "run", "release-go-sdk.yml", "--ref", tag]);
  else if (runs[0].status === "completed" && runs[0].conclusion !== "success")
    throw new Error(`Review failed Go release: ${runs[0].url}`);
}
