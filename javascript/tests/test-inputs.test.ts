import { expect, test } from "bun:test";
import { detectTestImage, paintTestImage } from "../src/test-inputs";

const key = "01234567012345670123456701234567";
test("rejects truncated image data and missing keys", async () => {
  const image = await paintTestImage("violence", key);
  expect(await detectTestImage({ ...image, rgba: image.rgba.slice(0, -4) }, key)).toBeUndefined();
  expect(await detectTestImage(image, "")).toBeUndefined();
  expect(await detectTestImage(image, key)).toEqual({
    instances: [{ category: "violence", qualifiers: [] }],
  });
});
