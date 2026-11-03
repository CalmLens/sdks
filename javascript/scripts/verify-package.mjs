#!/usr/bin/env node
// Fails the SDK build when the packed output depends on something an npm user won't have:
// a workspace-internal package (e.g. `shared/...`) or a package missing from `dependencies`.
// The build's other self-checks run inside the monorepo, where both resolve from the workspace
// `node_modules`, so they can't catch this.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Specifiers never contain whitespace or commas, which keeps prose such as
// `description: "fetch the asset from", placeholder: "..."` from matching.
const SPECIFIER = `["']([^"'\\s,]+)["']`;
const SPECIFIER_PATTERNS = [
  new RegExp(`\\bfrom\\s*${SPECIFIER}`, "g"),
  new RegExp(`\\bimport\\s*${SPECIFIER}`, "g"),
  new RegExp(`\\bimport\\s*\\(\\s*${SPECIFIER}\\s*\\)`, "g"),
  new RegExp(`\\brequire\\s*\\(\\s*${SPECIFIER}\\s*\\)`, "g"),
];
const CHECKED_FILES = /\.(?:c|m)?js$|\.d\.(?:c|m)?ts$/;
const BUILTINS = new Set(builtinModules);

const packageNameOf = (specifier) => {
  const [first, second] = specifier.split("/");
  return first.startsWith("@") ? `${first}/${second}` : first;
};

const findWorkspaceRoot = (start) => {
  let directory = start;
  while (dirname(directory) !== directory) {
    directory = dirname(directory);
    const manifest = join(directory, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).workspaces) {
      return directory;
    }
  }
  return null;
};

/** Names of `"private": true` workspace packages, which can never be installed from npm. */
export const getInternalPackageNames = (packageDirectory) => {
  const root = findWorkspaceRoot(packageDirectory);
  if (!root || !existsSync(join(root, "packages"))) return new Set();
  const packagesDirectory = join(root, "packages");
  const names = new Set();
  for (const entry of readdirSync(packagesDirectory)) {
    const manifest = join(packagesDirectory, entry, "package.json");
    if (!existsSync(manifest)) continue;
    const { name, private: isPrivate } = JSON.parse(readFileSync(manifest, "utf8"));
    if (name && isPrivate) names.add(name);
  }
  return names;
};

const listPublishedFiles = (packageDirectory, files) => {
  const result = [];
  const visit = (path) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      // Sorted so problems are reported in the same order on every filesystem.
      for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    } else if (CHECKED_FILES.test(path)) {
      result.push(path);
    }
  };
  for (const entry of files ?? ["."]) visit(join(packageDirectory, entry));
  return result;
};

const resolvesRelative = (fromFile, specifier) => {
  const target = resolve(dirname(fromFile), specifier);
  const candidates = [
    target,
    ...[".js", ".cjs", ".mjs", ".d.ts", "/index.js", "/index.d.ts"].map((ext) => target + ext),
  ];
  if (target.endsWith(".js")) candidates.push(target.replace(/\.js$/, ".d.ts"));
  return candidates.some((candidate) => existsSync(candidate) && statSync(candidate).isFile());
};

/** Every file path an `exports` condition points to, such as `./esm/server.js`. */
const exportTargets = (exportsField) => {
  if (typeof exportsField === "string") return [exportsField];
  if (!exportsField || typeof exportsField !== "object") return [];
  return Object.values(exportsField).flatMap(exportTargets);
};

/**
 * Entry points that load no other package at runtime, so a page can use them through an import
 * map that points at a hosted copy of the module: the main, `/server` and `/app` entry points.
 */
export const SELF_CONTAINED_ENTRIES = [
  "esm/index.js",
  "esm/server.js",
  "esm/app.js",
  "cjs/index.js",
  "cjs/server.js",
  "cjs/app.js",
];

const specifiersOf = (file) => {
  const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
  return new Set(
    SPECIFIER_PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((m) => m[1])),
  );
};

const resolveRelativeScript = (fromFile, specifier) => {
  const target = resolve(dirname(fromFile), specifier);
  return [target, `${target}.js`, `${target}.cjs`, `${target}/index.js`].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
};

/** Problems for packages an entry point's modules import at runtime, other than Node built-ins. */
const findRuntimeImports = (packageDirectory, entry) => {
  const problems = [];
  const pending = [join(packageDirectory, entry)];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith(".")) {
        const target = resolveRelativeScript(file, specifier);
        if (target) pending.push(target);
      } else if (!specifier.startsWith("node:") && !BUILTINS.has(specifier)) {
        problems.push(
          `${entry} loads "${specifier}" at runtime (from ${relative(packageDirectory, file)}); ` +
            "it must load no other package",
        );
      }
    }
  }
  return problems;
};

/** Returns a list of problems; empty means the package is safe to publish. */
export const findPackageProblems = (packageDirectory, options = {}) => {
  const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  const internal = options.internalPackageNames ?? getInternalPackageNames(packageDirectory);
  const declared = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);

  const problems = [];
  for (const target of new Set(exportTargets(manifest.exports))) {
    if (!existsSync(join(packageDirectory, target))) {
      problems.push(`package.json exports "${target}", which the build did not produce`);
    }
  }
  for (const file of listPublishedFiles(packageDirectory, manifest.files)) {
    const specifiers = specifiersOf(file);
    const where = relative(packageDirectory, file);
    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) {
        if (!resolvesRelative(file, specifier)) {
          problems.push(`${where}: "${specifier}" does not exist in the package`);
        }
        continue;
      }
      if (specifier.startsWith("node:") || BUILTINS.has(specifier)) continue;
      const name = packageNameOf(specifier);
      if (internal.has(name)) {
        problems.push(
          `${where}: imports "${specifier}" from the internal workspace package "${name}". ` +
            "Internal packages are never published; compile the source into the SDK and rewrite the import.",
        );
      } else if (!declared.has(name)) {
        problems.push(
          `${where}: imports "${specifier}" but "${name}" is not in dependencies or peerDependencies`,
        );
      }
    }
  }
  for (const entry of options.selfContainedEntries ?? SELF_CONTAINED_ENTRIES) {
    if (existsSync(join(packageDirectory, entry))) {
      problems.push(...findRuntimeImports(packageDirectory, entry));
    }
  }
  return problems;
};

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const packageDirectory = resolve(
    process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const problems = findPackageProblems(packageDirectory);
  if (problems.length > 0) {
    throw new Error(
      `The packed SDK would not work outside this monorepo (${problems.length} problems):\n` +
        problems.map((problem) => `  - ${problem}`).join("\n"),
    );
  }
  process.stdout.write(
    "SDK package verified: no internal or undeclared imports, and no runtime packages in the main, /server and /app entry points.\n",
  );
}
