#!/usr/bin/env node
// Compiles a consumer of the built package's declarations with the oldest TypeScript the SDK
// supports (the `typescript-minimum` dev dependency), under both module resolutions consumers use,
// so a declaration that needs a newer compiler fails the build. Run after the build.
//
// The SDK's own declarations are checked strictly (no skipLibCheck). Errors inside other packages'
// declarations, such as a UI library's, are reported but don't fail the check: which version of
// them resolves depends on the consumer's install (a workspace root can hoist a different one), and
// they aren't the SDK's to fix.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(packageDirectory, "package.json"));
const tsc = join(dirname(require.resolve("typescript-minimum/package.json")), "bin", "tsc");
const { version } = require("typescript-minimum/package.json");

// Every entry a server or browser consumer imports. The UI entries need their UI library's types,
// which the SDK's dev dependencies provide.
const consumer = `
import { CalmLensServerClient, CalmLensNotFoundError, type ListPage, type CalmLensResponse } from "@calmlens/sdk/server";
import { CalmLensAppClient } from "@calmlens/sdk/app";
import { MockCalmLensServerClient, createMockApiKey } from "@calmlens/sdk/testing";
import { CalmLensAsset } from "@calmlens/sdk/react";
import { CalmLensUploader } from "@calmlens/sdk/vue";
import "@calmlens/sdk/elements";
import type { Asset } from "@calmlens/sdk";

export async function check(client: CalmLensServerClient): Promise<string[]> {
  const page = await client.assets.list({ pageSize: 10 }, { timeoutMs: 1000 });
  const ids = page.items.map((asset: Asset) => asset.id);
  for await (const asset of client.assets.list()) ids.push(asset.id);
  const response: CalmLensResponse<Asset> = await client.assets.retrieve({ assetId: ids[0]! });
  ids.push(response.lastResponse.requestId ?? "");
  try {
    await client.request("GET", "/assets/a");
  } catch (error) {
    if (error instanceof CalmLensNotFoundError) ids.push(error.kind);
  }
  return ids;
}
export const unused: unknown[] = [
  CalmLensAppClient,
  MockCalmLensServerClient,
  createMockApiKey,
  CalmLensAsset,
  CalmLensUploader,
];
export type Page = ListPage<{ items: Asset[]; nextCursor: string | null; hasMore: boolean }>;
`;

// tsc --pretty false prints each diagnostic as `file(line,col): error TSnnnn: message`, with
// continuation lines indented, and a diagnostic with no file as `error TSnnnn: message`.
const diagnostic = /^(?:(.+?)\(\d+,\d+\): )?error TS\d+:/;

function isOwnFile(file, directory) {
  const path = isAbsolute(file) ? file : resolve(directory, file);
  const ownDeclarations = relative(packageDirectory, path);
  const isInPackage =
    !ownDeclarations.startsWith("..") &&
    !isAbsolute(ownDeclarations) &&
    !ownDeclarations.split(sep).includes("node_modules");
  const isConsumer = !relative(directory, path).split(sep).includes("node_modules");
  const isLinkedPackage = relative(join(directory, "node_modules", "@calmlens", "sdk"), path)
    .split(sep)
    .every((segment) => segment !== ".." && segment !== "node_modules");
  return isInPackage || isConsumer || isLinkedPackage;
}

// The real path, since tsc reports files relative to it (macOS links /var to /private/var).
const directory = realpathSync(mkdtempSync(join(tmpdir(), "calmlens-minimum-typescript-")));
try {
  // The consumer resolves @calmlens/sdk to this package, and its dependencies from beside it.
  mkdirSync(join(directory, "node_modules", "@calmlens"), { recursive: true });
  symlinkSync(packageDirectory, join(directory, "node_modules", "@calmlens", "sdk"), "dir");
  writeFileSync(join(directory, "consumer.ts"), consumer);
  for (const [moduleResolution, module] of [
    ["bundler", "esnext"],
    ["node16", "node16"],
  ]) {
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "es2022",
          lib: ["es2022", "dom", "dom.iterable"],
          module,
          moduleResolution,
          jsx: "react-jsx",
          // The SDK's own declarations are checked, not only the consumer's use of them.
          skipLibCheck: false,
          types: [],
          typeRoots: [join(packageDirectory, "node_modules", "@types")],
        },
        files: ["consumer.ts"],
      }),
    );
    let output = "";
    try {
      execFileSync(
        process.execPath,
        [tsc, "--project", join(directory, "tsconfig.json"), "--pretty", "false"],
        { stdio: "pipe", cwd: directory },
      );
    } catch (error) {
      if (error.stdout === undefined) throw error;
      output = String(error.stdout);
    }
    const own = [];
    const thirdParty = [];
    let current = null;
    for (const line of output.split("\n")) {
      const match = diagnostic.exec(line);
      if (match) {
        current = match[1] === undefined || isOwnFile(match[1], directory) ? own : thirdParty;
        current.push(line);
      } else if (line.trim() !== "") {
        // A continuation line, or output tsc doesn't format as a diagnostic: never ignore the latter.
        (current ?? own).push(line);
      }
    }
    if (thirdParty.length > 0) {
      process.stdout.write(
        `Ignored errors in other packages' declarations (moduleResolution ${moduleResolution}):\n${thirdParty.join("\n")}\n`,
      );
    }
    if (own.length > 0) {
      process.stderr.write(`${own.join("\n")}\n`);
      throw new Error(
        `The built declarations don't compile with TypeScript ${version} (moduleResolution ${moduleResolution})`,
      );
    }
  }
  process.stdout.write(
    `Declarations compile with TypeScript ${version} (bundler and node16 resolution).\n`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
