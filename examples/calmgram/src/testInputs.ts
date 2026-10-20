import { detectTestTrigger } from "@calmlens/sdk/test-inputs";

export {
  detectTestImage,
  generateTestTextCode as testTextCode,
  paintTestImage,
  TEST_IMAGE_PALETTES,
  TEST_INPUT_KEY_PATTERN,
} from "@calmlens/sdk/test-inputs";

/** The key demo mode's simulator recognises. Real projects each have their own. */
export const DEMO_TEST_INPUT_KEY = "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d";
export const TEST_TEXT_CATEGORIES = [
  "sexual",
  "violence",
  "self-harm",
  "harassment",
  "hate",
  "criminal-activity",
] as const;

export const detectTestText = async (text: string, testInputKey: string) =>
  (await detectTestTrigger(text, testInputKey)).signals.find((signal) =>
    TEST_TEXT_CATEGORIES.some((category) => category === signal),
  );
