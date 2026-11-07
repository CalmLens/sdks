import { expect, test } from "bun:test";
import {
  type ClassificationTestSignal,
  detectTestImage,
  detectTestTrigger,
  generateTestTextCode,
  paintTestImage,
  TEST_INPUT_DEFAULT_LIFETIME_SECONDS,
  TEST_INPUT_MAX_LIFETIME_SECONDS,
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
// The fixtures expire in 2030: read them an hour before, when they are current.
const beforeExpiry = (expiresAt: number) => (expiresAt - 3600) * 1000;
// The expiry a code carries: the first four bytes of its signed payload (big-endian seconds).
const expiryIn = (code: string) =>
  Buffer.from(code.slice(0, -1).split(" ")[2], "base64url").readUInt32BE(0);

test("generates the contract's text codes and reads them back while current", async () => {
  for (const testCase of fixture.text) {
    const code = await generateTestTextCode(scenarioOf(testCase), testCase.key, {
      expiresAt: testCase.expiresAt,
    });
    expect({ name: testCase.name, code }).toEqual({ name: testCase.name, code: testCase.code });
    expect(await detectTestTrigger(code, testCase.key, beforeExpiry(testCase.expiresAt))).toEqual(
      testCase.signal ? testInputForSignal(testCase.signal) : testCase.input,
    );
  }
});

test("matches the contract's lifetimes and expires codes after a day by default", async () => {
  expect({
    defaultLifetimeSeconds: TEST_INPUT_DEFAULT_LIFETIME_SECONDS,
    maxLifetimeSeconds: TEST_INPUT_MAX_LIFETIME_SECONDS,
  }).toEqual(fixture.expiry);
  const now = Math.floor(Date.now() / 1000);
  const code = await generateTestTextCode("harassment", key);
  const expiresAt = expiryIn(code);
  expect(expiresAt).toBeGreaterThanOrEqual(now + fixture.expiry.defaultLifetimeSeconds - 5);
  expect(expiresAt).toBeLessThanOrEqual(now + fixture.expiry.defaultLifetimeSeconds + 5);
  const signal = testInputForSignal("harassment");
  expect(await detectTestTrigger(code, key)).toEqual(signal);
  // Expired, or still more than the longest lifetime away from expiring: ordinary text.
  expect(await detectTestTrigger(code, key, (expiresAt + 3600) * 1000)).toBeUndefined();
  const farOff = await generateTestTextCode("harassment", key, {
    expiresAt: now + fixture.expiry.maxLifetimeSeconds + 3600,
  });
  expect(await detectTestTrigger(farOff, key)).toBeUndefined();
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
        : generateTestTextCode(scenarioOf(rejection), rejection.key, {
            expiresAt: rejection.expiresAt,
          });
    expect(
      await run.then(
        () => rejection.name,
        () => undefined,
      ),
    ).toBeUndefined();
  }
});

test("paints the contract's test images byte for byte and rejects ones too large", async () => {
  for (const testCase of fixture.images) {
    const image = await paintTestImage(scenarioOf(testCase), testCase.key, {
      expiresAt: testCase.expiresAt,
    });
    expect({ name: testCase.name, width: image.width, height: image.height }).toEqual({
      name: testCase.name,
      width: testCase.width,
      height: testCase.height,
    });
    const digest = new Bun.CryptoHasher("sha256").update(image.rgba).digest("hex");
    expect({ name: testCase.name, digest }).toEqual({
      name: testCase.name,
      digest: testCase.rgbaSha256,
    });
    expect(await detectTestImage(image, testCase.key, beforeExpiry(testCase.expiresAt))).toEqual(
      testCase.signal ? testInputForSignal(testCase.signal, "image") : testCase.input,
    );
  }
  for (const rejection of fixture.imageRejections)
    expect(
      await paintTestImage(scenarioOf(rejection), rejection.key, {
        expiresAt: rejection.expiresAt,
      }).then(
        () => rejection.name,
        () => undefined,
      ),
    ).toBeUndefined();
});
