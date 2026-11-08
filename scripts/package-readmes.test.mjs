// Each registry shows the README its package names: every published SDK names its own language's
// README, which opens with that SDK's heading and installs it, never the repository's overview.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");

// The README each registry reads, from the manifest it publishes, and the install command it shows.
const packages = {
  "Packagist (composer.json)": [
    JSON.parse(read("composer.json")).readme,
    "composer require calmlens/sdk",
  ],
  "PyPI (python/pyproject.toml)": [
    `python/${read("python/pyproject.toml").match(/^readme\s*=\s*"([^"]+)"/m)?.[1]}`,
    "pip install calmlens",
  ],
  "crates.io (rust/Cargo.toml)": [
    `rust/${read("rust/Cargo.toml").match(/^readme\s*=\s*"([^"]+)"/m)?.[1]}`,
    "cargo add calmlens",
  ],
  "RubyGems (ruby/calmlens.gemspec)": [
    read("ruby/calmlens.gemspec").includes("'README.md'") ? "ruby/README.md" : undefined,
    "gem install calmlens",
  ],
  "npm (javascript/package.json)": [
    JSON.parse(read("javascript/package.json")).files.includes("README.md")
      ? "javascript/README.md"
      : undefined,
    "npm install calmlens",
  ],
};

for (const [registry, [readme, install]] of Object.entries(packages)) {
  test(`${registry} publishes its own language's README`, () => {
    const language = registry.match(/\((\w+)\//)?.[1] ?? "php";
    assert.equal(readme, `${language}/README.md`);
    const text = read(readme);
    assert.match(text, /^# CalmLens \S+ SDK\n/);
    assert.ok(text.includes(install), `${readme} shows ${install}`);
  });
}
