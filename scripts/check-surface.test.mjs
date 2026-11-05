import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkSurfaces, declarationExports } from "./check-surface.mjs";

/** A throwaway SDK repository with one release of `sdk` recorded by `.changeset/release.json`. */
function repository(t, sdk, version, methods) {
  const root = mkdtempSync(join(tmpdir(), "calmlens-surface-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root, stdio: "ignore" },
    );
  const write = (path, contents) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  const repo = {
    root,
    git,
    write,
    version: (next) => write(`${sdk}/package.json`, JSON.stringify({ version: next })),
    methods: (ids) =>
      write(
        "go/testdata/surface.json",
        JSON.stringify({
          capabilities: ids.map((id) => ({ id, kind: "method", names: { [sdk]: id } })),
        }),
      ),
    changeset: (level) =>
      write(".changeset/change.md", `---\n"@calmlens/sdk-${sdk}": ${level}\n---\n\nA change.\n`),
    commit: () => {
      git("add", "-A");
      git("commit", "-q", "-m", "Change");
    },
    check: () => checkSurfaces(root, [sdk]),
  };
  git("init", "-q", "-b", "main");
  repo.version(version);
  repo.methods(methods);
  write(".changeset/release.json", JSON.stringify({ releases: [{ sdk, version }] }));
  repo.commit();
  return repo;
}

test("an added method passes with a minor bump and, once stable, fails a patch bump", (t) => {
  const repo = repository(t, "go", "1.4.0", ["assets.list"]);
  repo.methods(["assets.list", "assets.retrieve"]);
  repo.changeset("minor");
  assert.deepEqual(repo.check(), []);
  repo.changeset("patch");
  const [failure] = repo.check();
  assert.match(failure, /go 1\.4\.0 -> 1\.4\.1 is a patch release.*needs a minor release/);
  assert.match(failure, /added method assets\.retrieve/);
});

test("a removed method fails a patch bump and names the method", (t) => {
  const repo = repository(t, "go", "0.20.0", ["assets.list", "assets.delete"]);
  repo.methods(["assets.list"]);
  repo.changeset("patch");
  const failures = repo.check();
  assert.equal(failures.length, 1);
  assert.match(failures[0], /go 0\.20\.0 -> 0\.20\.1 is a patch release.*needs a minor release/);
  assert.match(failures[0], /removed method assets\.delete \(assets\.delete\)/);
  assert.doesNotMatch(failures[0], /assets\.list/);
});

test("on 0.x a removed method passes with a minor bump, and once stable it needs a major one", (t) => {
  const initial = repository(t, "go", "0.20.0", ["assets.list", "assets.delete"]);
  initial.methods(["assets.list"]);
  initial.changeset("minor");
  assert.deepEqual(initial.check(), []);

  const stable = repository(t, "go", "1.0.0", ["assets.list", "assets.delete"]);
  stable.methods(["assets.list"]);
  stable.changeset("minor");
  assert.match(stable.check()[0], /needs a major release:\n {2}removed method assets\.delete/);
  stable.changeset("major");
  assert.deepEqual(stable.check(), []);
});

test("a renamed method counts as a breaking change", (t) => {
  const repo = repository(t, "go", "0.20.0", ["assets.list"]);
  repo.write(
    "go/testdata/surface.json",
    JSON.stringify({
      capabilities: [{ id: "assets.list", kind: "method", names: { go: "Assets.All" } }],
    }),
  );
  repo.changeset("patch");
  assert.match(
    repo.check()[0],
    /changed assets\.list from method assets\.list to method Assets\.All/,
  );
});

test("the Version SDKs PR is checked from the previous release until a later commit", (t) => {
  const repo = repository(t, "go", "0.20.0", ["assets.list", "assets.delete"]);
  repo.methods(["assets.list"]);
  repo.version("0.21.0");
  repo.write(
    ".changeset/release.json",
    JSON.stringify({ releases: [{ sdk: "go", version: "0.21.0" }] }),
  );
  assert.deepEqual(repo.check(), []);
  repo.version("0.20.1");
  repo.write(
    ".changeset/release.json",
    JSON.stringify({ releases: [{ sdk: "go", version: "0.20.1" }] }),
  );
  assert.match(repo.check()[0], /go 0\.20\.0 -> 0\.20\.1 is a patch release/);
  // The commit that records the release is still checked; a later one has nothing to release.
  repo.commit();
  assert.match(repo.check()[0], /removed method assets\.delete/);
  repo.write("go/README.md", "Later work.\n");
  repo.commit();
  assert.deepEqual(repo.check(), []);
});

test("a JavaScript contract type removed since the release tag fails a patch bump", (t) => {
  const repo = repository(t, "javascript", "0.20.0", []);
  repo.write(
    "javascript/src/contract/Ids.d.ts",
    "export declare const isId: () => boolean;\nexport type { IdPrefix };\n",
  );
  repo.write("javascript/src/contract/Ids-Ab12Cd34.d.ts", "export { t as Hidden };\n");
  repo.commit();
  repo.git("tag", "javascript/v0.20.0");
  repo.write("javascript/src/contract/Ids.d.ts", "export declare const isId: () => boolean;\n");
  repo.write("javascript/src/contract/Ids-Ef56Gh78.d.ts", "export { t as Other };\n");
  repo.changeset("patch");
  const [failure] = repo.check();
  assert.match(failure, /removed export IdPrefix from Ids \(contract:Ids:IdPrefix\)/);
  assert.doesNotMatch(failure, /Hidden|Other|isId/);
});

test("declaration exports include declared names, export lists and aliases", () => {
  assert.deepEqual(
    declarationExports(
      "export declare const A: 1;\nexport declare function b(): void;\nexport interface C {}\nexport { d as D, type E };\nexport type { F };\nexport {};\n",
    ),
    ["A", "C", "D", "E", "F", "b"],
  );
});
