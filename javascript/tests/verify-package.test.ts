import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error -- plain .mjs build script without type declarations
import { findPackageProblems, getInternalPackageNames } from "../scripts/verify-package.mjs";

const temporaryDirectories: string[] = [];

const createPackage = (files: Record<string, string>, manifest: Record<string, unknown> = {}) => {
  const directory = mkdtempSync(join(tmpdir(), "calmlens-verify-package-"));
  temporaryDirectories.push(directory);
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ name: "@calmlens/sdk", files: ["esm/", "cjs/"], ...manifest }),
  );
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
  return directory;
};

const check = (directory: string) =>
  findPackageProblems(directory, { internalPackageNames: new Set(["shared", "shared-backend"]) });

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("verify-package", () => {
  test("accepts relative, builtin, declared and self imports", () => {
    const directory = createPackage(
      {
        "esm/index.js": [
          'import { Api } from "api-def";',
          'import { helper } from "./helper";',
          'import { createHash } from "node:crypto";',
          'import path from "path";',
          'export * from "@calmlens/sdk/testing";',
        ].join("\n"),
        "esm/helper.js": "export const helper = 1;",
        "esm/index.d.ts": 'export type { Api } from "api-def";',
      },
      { dependencies: { "api-def": "0.17.0" } },
    );
    expect(check(directory)).toEqual([]);
  });

  test("rejects internal workspace packages in ESM, CJS and type declarations", () => {
    const directory = createPackage({
      "esm/a.js": 'import { x } from "shared/AssetPayload";',
      "cjs/a.js": 'const x = require("shared/AssetPayload");',
      "esm/a.d.ts": 'import type { Y } from "shared-backend/Thing";',
    });
    const problems = check(directory);
    expect(problems).toHaveLength(3);
    for (const problem of problems) {
      expect(problem).toContain("internal workspace package");
    }
  });

  test("rejects undeclared dependencies, including type-only ones", () => {
    const directory = createPackage({
      "esm/a.js": 'import { ErrorCode } from "sendable-error";',
      "esm/a.d.ts": 'import * as zod from "zod";',
    });
    expect(check(directory)).toEqual([
      'esm/a.d.ts: imports "zod" but "zod" is not in dependencies or peerDependencies',
      'esm/a.js: imports "sendable-error" but "sendable-error" is not in dependencies or peerDependencies',
    ]);
  });

  test("rejects relative imports of files that were not packed", () => {
    const directory = createPackage({ "cjs/a.js": 'require("./missing");' });
    expect(check(directory)).toEqual(['cjs/a.js: "./missing" does not exist in the package']);
  });

  test("rejects exports the build did not produce", () => {
    const directory = createPackage(
      { "esm/server.js": "export const a = 1;" },
      {
        exports: {
          "./server": { import: "./esm/server.js", require: "./cjs/server.js" },
          "./package.json": "./package.json",
        },
      },
    );
    expect(check(directory)).toEqual([
      'package.json exports "./cjs/server.js", which the build did not produce',
    ]);
  });

  test("ignores files outside the published `files` list and prose in strings", () => {
    const directory = createPackage({
      "src/a.ts": 'import { x } from "shared/AssetPayload";',
      "esm/a.js": 'const d = { description: "fetch the asset from", placeholder: "x" };',
    });
    expect(check(directory)).toEqual([]);
  });

  test("treats every private workspace package as internal", () => {
    const root = mkdtempSync(join(tmpdir(), "calmlens-workspace-"));
    temporaryDirectories.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    for (const [name, isPrivate] of [
      ["shared", true],
      ["shared-backend", true],
      ["@calmlens/sdk", false],
      ["uzeful", false],
    ] as const) {
      const directory = join(root, "packages", name.replaceAll("/", "-"));
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "package.json"), JSON.stringify({ name, private: isPrivate }));
    }
    const sdk = join(root, "packages", "@calmlens-sdk");
    const internal = getInternalPackageNames(sdk);
    expect(internal.has("shared")).toBe(true);
    expect(internal.has("shared-backend")).toBe(true);
    expect(internal.has("@calmlens/sdk")).toBe(false);
    expect(internal.has("uzeful")).toBe(false);
  });
});
