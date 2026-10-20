// Checks a language SDK release tag against the SDK's manifest before anything is published.
// The release workflows (.github/workflows/release-<language>-sdk.yml) run on tags named
// `<language>-sdk/v<version>`, for example `python-sdk/v0.1.0`, and the version in the tag must be
// the version the manifest declares, so a tag can never publish a different version than it names.
//
//   node scripts/check-sdk-release-tag.mjs python python-sdk/v0.1.0
//
// Prints the version and, on GitHub Actions, writes it to the step's `version` output.

import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Each published language SDK: its manifest and how to read the version it declares. */
export const SDK_MANIFESTS = {
  go: {
    path: "go/version.go",
    version: /^const Version = "([^"]+)"/m,
    tagPrefix: "go/v",
  },
  python: {
    path: "python/pyproject.toml",
    // The `version` key of the `[project]` table.
    version: /^\[project\][^[]*?^version\s*=\s*"([^"]+)"/ms,
  },
  ruby: {
    // The gemspec reads CalmLens::VERSION from here.
    path: "ruby/lib/calmlens/version.rb",
    version: /^\s*VERSION\s*=\s*['"]([^'"]+)['"]/m,
  },
  rust: {
    path: "rust/Cargo.toml",
    // The `version` key of the `[package]` table, not a dependency's.
    version: /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms,
  },
  java: {
    path: "java/pom.xml",
    // The project's own version, which follows its artifactId (dependencies have other ids).
    version: /<artifactId>calmlens-sdk<\/artifactId>\s*<version>([^<]+)<\/version>/,
  },
};

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The version a manifest declares. Throws when it declares none. */
export function readManifestVersion(sdk, source) {
  const manifest = SDK_MANIFESTS[sdk];
  if (!manifest) throw new Error(`Unknown SDK "${sdk}"`);
  const version = manifest.version.exec(source)?.[1];
  if (!version || !SEMVER.test(version)) {
    throw new Error(`${manifest.path} does not declare a release version`);
  }
  return version;
}

/** The version a release tag names (`<sdk>-sdk/v<version>`). Throws for any other tag. */
export function readTagVersion(sdk, tag) {
  const prefix = SDK_MANIFESTS[sdk]?.tagPrefix ?? `${sdk}-sdk/v`;
  const version = tag.startsWith(prefix) ? tag.slice(prefix.length) : undefined;
  if (!version || !SEMVER.test(version)) {
    throw new Error(`"${tag}" is not a ${sdk} SDK release tag (expected ${prefix}<version>)`);
  }
  return version;
}

/** The release version, when the tag names the manifest's version. Throws otherwise. */
export function checkReleaseTag(sdk, tag, manifestSource) {
  const tagged = readTagVersion(sdk, tag);
  const declared = readManifestVersion(sdk, manifestSource);
  if (tagged !== declared) {
    throw new Error(
      `Tag ${tag} names ${tagged}, but ${SDK_MANIFESTS[sdk].path} declares ${declared}. ` +
        "Bump the manifest version first, then tag that commit.",
    );
  }
  return declared;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sdk, tag = process.env.GITHUB_REF_NAME ?? ""] = process.argv.slice(2);
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  try {
    if (!SDK_MANIFESTS[sdk]) throw new Error(`Unknown SDK "${sdk}"`);
    const version = checkReleaseTag(
      sdk,
      tag,
      readFileSync(join(root, SDK_MANIFESTS[sdk].path), "utf8"),
    );
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
    console.log(version);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
