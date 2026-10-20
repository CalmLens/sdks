import { expect, test } from "bun:test";
import { detectTestImage, paintTestImage } from "../src/test-inputs";

const key = "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d";
test("test images reject invalid dimensions before allocating pixels", async () => {
  for (const size of [0, 23, 24.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await expect(paintTestImage("violence", key, size)).rejects.toThrow(RangeError);
    await expect(paintTestImage("violence", key, 64, size)).rejects.toThrow(RangeError);
  }
});
test("incomplete pixel data and invalid keys cannot activate a test signal", async () => {
  const rgba = await paintTestImage("violence", key, 64);
  expect(
    await detectTestImage({ width: 64, height: 64, rgba: rgba.slice(0, -4) }, key),
  ).toBeUndefined();
  expect(await detectTestImage({ width: 64, height: 64, rgba }, "")).toBeUndefined();
});
