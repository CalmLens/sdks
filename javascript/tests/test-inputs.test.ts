import { expect, test } from "bun:test";
import {
  type ClassificationTestSignal,
  detectTestImage,
  detectTestTrigger,
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

test("generates the contract's text codes and reads them back", async () => {
  for (const testCase of fixture.text) {
    const code = await generateTestTextCode(scenarioOf(testCase), testCase.key);
    expect({ name: testCase.name, code }).toEqual({ name: testCase.name, code: testCase.code });
    expect(await detectTestTrigger(code, testCase.key)).toEqual(
      testCase.signal ? testInputForSignal(testCase.signal) : testCase.input,
    );
  }
});

test("recognises a code only as the whole text", async () => {
  const code = await generateTestTextCode("harassment", key);
  expect(await detectTestTrigger(`  ${code}\n`, key)).toEqual(testInputForSignal("harassment"));
  expect(await detectTestTrigger(`Nice post ${code}`, key)).toBeUndefined();
  expect(await detectTestTrigger(`${code} ${code}`, key)).toBeUndefined();
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

// One test per image: painting and reading a whole image is slow enough that the contract's set
// doesn't fit one test's time limit on a CI runner.
for (const testCase of fixture.images)
  test(`paints the contract's ${testCase.name} test image byte for byte`, async () => {
    const image = await paintTestImage(scenarioOf(testCase), testCase.key);
    expect({ width: image.width, height: image.height }).toEqual({
      width: testCase.width,
      height: testCase.height,
    });
    expect(new Bun.CryptoHasher("sha256").update(image.rgba).digest("hex")).toBe(
      testCase.rgbaSha256,
    );
    expect(await detectTestImage(image, testCase.key)).toEqual(
      testCase.signal ? testInputForSignal(testCase.signal, "image") : testCase.input,
    );
  });

test("refuses to paint the contract's test images that are too large", async () => {
  for (const rejection of fixture.imageRejections)
    expect(
      await paintTestImage(scenarioOf(rejection), rejection.key).then(
        () => rejection.name,
        () => undefined,
      ),
    ).toBeUndefined();
});
