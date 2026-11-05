// Refuses an SDK release whose version bump is too small for its public surface changes. Each
// SDK's surface is the list of methods, functions, constants and mock helpers in the shared
// contract fixture (`<language>/testdata/surface.json`, one copy per native SDK that tests it,
// naming every language) and, for JavaScript, the exports of the `src/contract` type modules.
// It is compared with the surface of the SDK's previous release:
//
// - a removed item, or one whose name or kind changed, is breaking: a major release, or a minor
//   release while the version is 0.x;
// - an added item is a new feature: a minor release, or a patch release while the version is 0.x;
// - anything else may be a patch release.
//
// The previous release is the SDK's release tag (`javascript/v<version>`, `cli-v<version>`,
// `go/v<version>`, PHP's `v<version>`) or, for the SDKs tagged by the private application, the
// commit whose `.changeset/release.json` recorded that version. It reads git and the fixtures
// only, so it runs offline, but it needs the full history and tags (not a shallow clone).
//
//   node scripts/check-surface.mjs
//
// With pending changesets the bump is the largest one they ask for (the SDKs are one fixed
// group in .changeset/config.json, so they all move together). Without any, an SDK whose
// version has not been released at an earlier commit (the Version SDKs PR, or its merge) is
// compared from its previous release to that version.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SDKS = ["javascript", "python", "ruby", "rust", "java", "go", "php"];
/** The release tags this repository creates for each SDK. */
export const TAG_PREFIXES = { javascript: ["javascript/v", "cli-v"], go: ["go/v"], php: ["v"] };
/** The copies of the shared surface fixture, for SDKs that keep none of their own. */
const SURFACE_COPIES = ["go", "java", "ruby", "rust"];
const CONTRACT = "javascript/src/contract";
const LEVELS = ["patch", "minor", "major"];
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;

const parse = (version) => {
  const match = STABLE.exec(version);
  if (!match) throw new Error(`Invalid stable version: ${version}`);
  return match.slice(1).map(Number);
};
const compareVersions = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** The level of the bump from one version to a later one. */
export function bumpLevel(from, to) {
  const [a, b] = [parse(from), parse(to)];
  if (b[0] !== a[0]) return "major";
  if (b[1] !== a[1]) return "minor";
  return "patch";
}

/** The version a changeset bump level gives. */
export function bumpVersion(version, level) {
  const [major, minor, patch] = parse(version);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** The smallest bump from `from` that covers the changes, as semantic versioning asks. */
export function requiredLevel(from, { breaking, added }) {
  const initial = parse(from)[0] === 0;
  if (breaking.length) return initial ? "minor" : "major";
  if (added.length) return initial ? "patch" : "minor";
  return "patch";
}

/** The items of one SDK's public surface, keyed by a stable ID, with the name it has there. */
export function surfaceItems(sdk, { surface, contract } = {}) {
  const items = new Map();
  for (const capability of surface?.capabilities ?? []) {
    const name = capability.names?.[sdk];
    if (!name || capability.notApplicable?.[sdk]) continue;
    items.set(capability.id, { kind: capability.kind, name });
  }
  for (const [module, names] of Object.entries(contract ?? {})) {
    for (const name of names)
      items.set(`contract:${module}:${name}`, { kind: "export", name: `${name} from ${module}` });
  }
  return items;
}

/** What changed between two surfaces of one SDK: breaking changes and additions. */
export function compareSurfaces(sdk, before, after) {
  const [previous, next] = [surfaceItems(sdk, before), surfaceItems(sdk, after)];
  const breaking = [];
  const added = [];
  for (const [id, item] of previous) {
    const current = next.get(id);
    if (!current) breaking.push(`removed ${item.kind} ${item.name} (${id})`);
    else if (current.kind !== item.kind || current.name !== item.name)
      breaking.push(
        `changed ${id} from ${item.kind} ${item.name} to ${current.kind} ${current.name}`,
      );
  }
  for (const [id, item] of next)
    if (!previous.has(id)) added.push(`added ${item.kind} ${item.name} (${id})`);
  return { breaking, added };
}

/** The names a TypeScript declaration module exports. */
export function declarationExports(source) {
  const names = new Set();
  const declared =
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|class|enum|interface|type|namespace)\s+([A-Za-z_$][\w$]*)/gm;
  for (const [, name] of source.matchAll(declared)) names.add(name);
  for (const [, list] of source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const entry of list.split(",")) {
      const name = entry
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop();
      if (name) names.add(name);
    }
  }
  if (/^export\s+default\b/m.test(source)) names.add("default");
  return [...names].sort();
}

const gitRunner = (cwd) => (args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** Reads a file at a commit, or from the working tree when `ref` is undefined. */
function reader(cwd, ref) {
  const git = gitRunner(cwd);
  if (ref === undefined)
    return {
      read: (path) =>
        existsSync(join(cwd, path)) ? readFileSync(join(cwd, path), "utf8") : undefined,
      list: (directory) =>
        existsSync(join(cwd, directory)) ? readdirSync(join(cwd, directory)) : [],
    };
  return {
    read: (path) => {
      try {
        return git(["show", `${ref}:${path}`]);
      } catch {
        return undefined;
      }
    },
    list: (directory) =>
      git(["ls-tree", "--name-only", ref, `${directory}/`])
        .split("\n")
        .filter(Boolean)
        .map((path) => path.slice(directory.length + 1)),
  };
}

/** One SDK's surface at a commit, or in the working tree when `ref` is undefined. */
export function readSurface(cwd, sdk, ref) {
  const { read, list } = reader(cwd, ref);
  const source = [sdk, ...SURFACE_COPIES]
    .map((language) => read(`${language}/testdata/surface.json`))
    .find((contents) => contents !== undefined);
  const result = { surface: source === undefined ? undefined : JSON.parse(source) };
  if (sdk === "javascript") {
    // The entry modules; the hashed chunks (`Asset-CQt2Rst2.d.ts`) are only what they import.
    const modules = list(CONTRACT).filter((file) => /^[^-]+\.d\.ts$/.test(file));
    if (modules.length)
      result.contract = Object.fromEntries(
        modules.map((file) => [
          file.replace(/\.d\.ts$/, ""),
          declarationExports(read(`${CONTRACT}/${file}`)),
        ]),
      );
  }
  return result;
}

/** Every earlier release of each SDK: its version, the commit that recorded it and a ref to read. */
export function releaseHistory(cwd) {
  const git = gitRunner(cwd);
  const history = Object.fromEntries(SDKS.map((sdk) => [sdk, new Map()]));
  try {
    git(["rev-parse", "--verify", "--quiet", "HEAD"]);
  } catch {
    return history;
  }
  if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true")
    throw new Error(
      "The surface check needs the full git history and tags; fetch without a depth limit.",
    );
  for (const commit of git([
    "log",
    "--first-parent",
    "--format=%H",
    "HEAD",
    "--",
    ".changeset/release.json",
  ])
    .split("\n")
    .filter(Boolean)) {
    let plan;
    try {
      plan = JSON.parse(git(["show", `${commit}:.changeset/release.json`]));
    } catch {
      continue;
    }
    for (const { sdk, version } of plan.releases ?? []) {
      // The log is newest first, so the earliest commit recording a version wins.
      if (history[sdk] && STABLE.test(version))
        history[sdk].set(version, { version, recordedAt: commit, ref: commit });
    }
  }
  for (const [sdk, prefixes] of Object.entries(TAG_PREFIXES)) {
    for (const prefix of prefixes) {
      for (const tag of git(["tag", "--list", `${prefix}*`])
        .split("\n")
        .filter(Boolean)) {
        const version = tag.slice(prefix.length);
        if (!STABLE.test(version)) continue;
        const commit = git(["rev-list", "-n", "1", tag]).trim();
        const known = history[sdk].get(version);
        // The tag is the published code; keep the commit that recorded it when there is one.
        if (!known?.tagged)
          history[sdk].set(version, {
            version,
            recordedAt: known?.recordedAt ?? commit,
            ref: commit,
            tagged: true,
          });
      }
    }
  }
  return history;
}

/** The largest bump pending changesets ask for, if any. */
export function pendingLevel(cwd) {
  const directory = join(cwd, ".changeset");
  if (!existsSync(directory)) return undefined;
  let level;
  for (const file of readdirSync(directory)) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    const frontmatter =
      /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(directory, file), "utf8"))?.[1] ?? "";
    for (const [, bump] of frontmatter.matchAll(
      /^\s*["']?[^"':]+["']?\s*:\s*(patch|minor|major)\s*$/gm,
    ))
      if (!level || LEVELS.indexOf(bump) > LEVELS.indexOf(level)) level = bump;
  }
  return level;
}

/** The release each SDK is about to make, and the earlier release it is compared with. */
export function plannedReleases(cwd, sdks = SDKS) {
  const history = releaseHistory(cwd);
  const head = (() => {
    try {
      return gitRunner(cwd)(["rev-parse", "HEAD"]).trim();
    } catch {
      return undefined;
    }
  })();
  const pending = pendingLevel(cwd);
  const plans = [];
  for (const sdk of sdks) {
    const { version } = JSON.parse(readFileSync(join(cwd, sdk, "package.json"), "utf8"));
    const releases = history[sdk];
    const current = releases.get(version);
    if (pending) {
      if (current) plans.push({ sdk, from: current, to: bumpVersion(version, pending) });
      continue;
    }
    // Released at an earlier commit, with nothing pending: there is no release to check.
    if (current && current.recordedAt !== head) continue;
    const previous = [...releases.values()]
      .filter((release) => compareVersions(release.version, version) < 0)
      .sort((a, b) => compareVersions(b.version, a.version))[0];
    if (previous) plans.push({ sdk, from: previous, to: version });
  }
  return plans;
}

/** One message per SDK whose planned bump is smaller than its surface changes need. */
export function checkSurfaces(cwd, sdks = SDKS) {
  const failures = [];
  for (const { sdk, from, to } of plannedReleases(cwd, sdks)) {
    const changes = compareSurfaces(sdk, readSurface(cwd, sdk, from.ref), readSurface(cwd, sdk));
    const needed = requiredLevel(from.version, changes);
    const level = bumpLevel(from.version, to);
    if (LEVELS.indexOf(level) >= LEVELS.indexOf(needed)) continue;
    // The level is decided by the breaking changes when there are any, else by the additions.
    const items = changes.breaking.length ? changes.breaking : changes.added;
    failures.push(
      `${sdk} ${from.version} -> ${to} is a ${level} release, but its public surface since ${from.version} needs a ${needed} release:\n${items.map((item) => `  ${item}`).join("\n")}`,
    );
  }
  return failures;
}

/** Throws with every SDK whose planned bump is too small. */
export function assertSurfaces(cwd, sdks = SDKS) {
  const failures = checkSurfaces(cwd, sdks);
  if (failures.length)
    throw new Error(
      `Release bump too small for the public surface changes.\n${failures.join("\n")}`,
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertSurfaces(resolve(fileURLToPath(import.meta.url), "../.."));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
