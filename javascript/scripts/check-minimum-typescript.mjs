#!/usr/bin/env node
// Compiles a consumer of the built package's declarations with the oldest TypeScript the SDK
// supports (the `typescript-minimum` dev dependency), under both module resolutions consumers use,
// so a declaration that needs a newer compiler fails the build. Run after the build.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

const directory = mkdtempSync(join(tmpdir(), "calmlens-minimum-typescript-"));
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
    try {
      execFileSync(process.execPath, [tsc, "--project", join(directory, "tsconfig.json")], {
        stdio: "pipe",
        cwd: directory,
      });
    } catch (error) {
      process.stderr.write(String(error.stdout ?? error));
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
