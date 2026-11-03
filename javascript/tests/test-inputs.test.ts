import { expect, test } from "bun:test";
import {
  type ClassificationTestSignal,
  detectTestImage,
  generateTestTextCode,
  paintTestImage,
  TEST_INPUT_PRESETS,
  type TestInput,
  testInputForSignal,
} from "../src/test-inputs";
import { generateMediaTestCode } from "../src/testing";
import { testdata } from "./testdata";

const key = "01234567012345670123456701234567";
test("rejects truncated image data and missing keys", async () => {
  const image = await paintTestImage("violence", key);
  expect(await detectTestImage({ ...image, rgba: image.rgba.slice(0, -4) }, key)).toBeUndefined();
  expect(await detectTestImage(image, "")).toBeUndefined();
  expect(await detectTestImage(image, key)).toEqual({
    instances: [{ category: "violence", qualifiers: [] }],
  });
});

// The shared contract every SDK replays (packages/sdk-contract/testInputs.ts).
const fixture = testdata("test-inputs.json");
const scenarioOf = (source: { input?: TestInput; signal?: ClassificationTestSignal }) =>
  source.signal ?? (source.input as TestInput);

test("generates the contract's text codes", async () => {
  for (const testCase of fixture.text)
    expect(await generateTestTextCode(scenarioOf(testCase), testCase.key)).toBe(testCase.code);
});

test("generates the contract's media phrases", async () => {
  for (const testCase of fixture.media)
    expect(await generateMediaTestCode(testCase.signal, testCase.key)).toBe(testCase.code);
});

test("matches the contract's presets and signal shortcuts", () => {
  expect(TEST_INPUT_PRESETS).toEqual(fixture.presets);
  for (const { signal, kind, input } of fixture.signalInputs)
    expect(testInputForSignal(signal, kind)).toEqual(input);
});

test("rejects the contract's invalid inputs", async () => {
  for (const rejection of fixture.rejections) {
    const run =
      rejection.kind === "media"
        ? generateMediaTestCode(rejection.signal, rejection.key)
        : generateTestTextCode(scenarioOf(rejection), rejection.key);
    expect(
      await run.then(
        () => rejection.name,
        () => undefined,
      ),
    ).toBeUndefined();
  }
});
