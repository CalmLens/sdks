import { expect, test } from "bun:test";
import type { Env } from "../src/data";
import worker from "../src/index";
import { decodePng } from "../src/png";
import {
  DEMO_TEST_INPUT_KEY,
  detectTestImage,
  detectTestText,
  paintTestImage,
  testCodeCategories,
  testInputForSignal,
  testTextCode,
} from "../src/testInputs";

const OTHER_KEY = "0badc0de0badc0de0badc0de0badc0de";

test("text codes count only as the whole text, with the project's key", async () => {
  const code = await testTextCode("hate", DEMO_TEST_INPUT_KEY);
  expect(await detectTestText(` ${code}\n`, DEMO_TEST_INPUT_KEY)).toBe("hate");
  expect(await detectTestText(`nice ${code}`, DEMO_TEST_INPUT_KEY)).toBeUndefined();
  expect(
    await detectTestText(await testTextCode("hate", OTHER_KEY), DEMO_TEST_INPUT_KEY),
  ).toBeUndefined();
});

test("a test image counts only with the project's key", async () => {
  const image = await paintTestImage("violence", DEMO_TEST_INPUT_KEY);
  expect(await detectTestImage(image, DEMO_TEST_INPUT_KEY)).toEqual(
    testInputForSignal("violence", "image"),
  );
  expect(await detectTestImage(image, OTHER_KEY)).toBeUndefined();
});

test("a code's label names its categories, and ordinary text has none", async () => {
  expect(testCodeCategories(await testTextCode("harassment", OTHER_KEY))).toEqual(["harassment"]);
  expect(testCodeCategories(`hi ${await testTextCode("harassment", OTHER_KEY)}`)).toBeUndefined();
});

test("serves test images only in demo mode, signed with the simulator's public key", async () => {
  const request = (env: Partial<Env>) =>
    worker.fetch(
      new Request("http://localhost/test-inputs/calmlens-test-violence.png"),
      env as Env,
      {} as ExecutionContext,
    );
  expect((await request({ CALMLENS_API_KEY: "key", CALMLENS_PROJECT_ID: "p" })).status).toBe(404);
  const response = await request({ CALMLENS_DEMO: "1" });
  expect(response.status).toBe(200);
  const image = decodePng(new Uint8Array(await response.arrayBuffer()));
  if (!image) throw new Error("not a PNG");
  expect(await detectTestImage(image, DEMO_TEST_INPUT_KEY)).toEqual(
    testInputForSignal("violence", "image"),
  );
});
