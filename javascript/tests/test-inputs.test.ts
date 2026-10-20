import { expect, test } from "bun:test";
import { detectTestImage, paintTestImage } from "../src/test-inputs";

test("test images reject invalid dimensions before allocating pixels", () => {
  for (const size of [0, 23, 24.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => paintTestImage("violence", "1a2b3c4d", size)).toThrow(RangeError);
    expect(() => paintTestImage("violence", "1a2b3c4d", 64, size)).toThrow(RangeError);
  }
});

test("incomplete pixel data and invalid keys cannot activate a test signal", () => {
  const rgba = paintTestImage("violence", "1a2b3c4d", 64);
  expect(
    detectTestImage({ width: 64, height: 64, rgba: rgba.slice(0, -4) }, "1a2b3c4d"),
  ).toBeUndefined();
  expect(detectTestImage({ width: 64, height: 64, rgba }, "")).toBeUndefined();
});
