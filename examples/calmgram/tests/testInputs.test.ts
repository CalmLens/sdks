import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { decodePng } from "../src/png";
import {
  DEMO_TEST_INPUT_KEY,
  detectTestImage,
  detectTestText,
  TEST_IMAGE_PALETTES,
  testTextCode,
} from "../src/testInputs";

const OTHER_KEY = "0badc0de0badc0de0badc0de0badc0de";

test("the committed test images authenticate demo mode and are ordinary images for any other", async () => {
  for (const signal of Object.keys(TEST_IMAGE_PALETTES)) {
    const file = path.join(
      import.meta.dir,
      "../public/test-images",
      `calmlens-test-${signal.replace(".", "-")}.png`,
    );
    const image = decodePng(readFileSync(file));
    if (!image) throw new Error(`${file} is not a PNG`);
    expect(await detectTestImage(image, DEMO_TEST_INPUT_KEY)).toBe(signal);
    expect(await detectTestImage(image, OTHER_KEY)).toBeUndefined();
  }
});

test("text codes count only with the project's key", async () => {
  expect(
    await detectTestText(
      `nice ${await testTextCode("hate", DEMO_TEST_INPUT_KEY)}`,
      DEMO_TEST_INPUT_KEY,
    ),
  ).toBe("hate");
  expect(
    await detectTestText(`nice ${await testTextCode("hate", OTHER_KEY)}`, DEMO_TEST_INPUT_KEY),
  ).toBeUndefined();
});
