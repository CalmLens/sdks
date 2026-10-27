#!/usr/bin/env bun
// Generates CalmLens test-trigger images: harmless PNGs that CalmLens classifies as a
// specific category (score 0.95). Use them to test your "post removed" UX without
// uploading real harmful content. Also prints the matching text test codes.
//
//   bun run test-images                                  # demo mode's key
//   CALMLENS_TEST_INPUT_KEY=<key> bun run test-images    # your project's key
//
// Each image carries the authenticated test input in a compact square grid.
// Images carrying another key are moderated normally. Committed images use demo mode's key.

import fs from "node:fs";
import path from "node:path";
import { encodePng } from "../src/png.ts";
import {
  DEMO_TEST_INPUT_KEY,
  paintTestImage,
  getImageTestCategories,
  TEST_INPUT_KEY_PATTERN,
  TEST_TEXT_CATEGORIES,
  testTextCode,
} from "../src/testInputs.ts";

const testInputKey = process.env.CALMLENS_TEST_INPUT_KEY?.trim() || DEMO_TEST_INPUT_KEY;
if (!TEST_INPUT_KEY_PATTERN.test(testInputKey)) {
  process.stderr.write(
    "CALMLENS_TEST_INPUT_KEY must be your project's test input key: 32 lowercase hexadecimal characters.\n",
  );
  process.exit(1);
}

const outDir = path.join(process.cwd(), "public", "test-images");
fs.mkdirSync(outDir, { recursive: true });
for (const signal of getImageTestCategories()) {
  const file = path.join(outDir, `calmlens-test-${signal.replace(".", "-")}.png`);
  const { width, height, rgba } = await paintTestImage(signal, testInputKey);
  fs.writeFileSync(file, encodePng(width, height, rgba));
  process.stdout.write(`wrote ${path.relative(process.cwd(), file)}\n`);
}

process.stdout.write(
  `\nText test codes for key ${testInputKey} (paste into a comment, caption or bio):\n`,
);
for (const category of TEST_TEXT_CATEGORIES) {
  process.stdout.write(`  ${await testTextCode(category, testInputKey)}\n`);
}
