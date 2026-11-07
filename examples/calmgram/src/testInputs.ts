import { detectTestTrigger } from "calmlens/test-inputs";

export {
  detectTestImage,
  generateTestTextCode as testTextCode,
  getImageTestCategories,
  paintTestImage,
  TEST_INPUT_KEY_PATTERN,
  testInputForSignal,
} from "calmlens/test-inputs";

/**
 * The public key demo mode's simulator recognises. Calmgram shows test inputs only in demo mode:
 * a real project's codes and test images are made in your own tests with its secret key, never
 * published to visitors.
 */
export const DEMO_TEST_INPUT_KEY = "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d";
export const TEST_TEXT_CATEGORIES = [
  "sexual",
  "violence",
  "self-harm",
  "harassment",
  "hate",
  "criminal-activity",
] as const;

/**
 * The category a text declares when the whole text is one test code signed with
 * `testInputKey`, as CalmLens recognises it; anything else is ordinary text.
 */
export const detectTestText = async (text: string, testInputKey: string) =>
  (await detectTestTrigger(text, testInputKey))?.instances.find((instance) =>
    TEST_TEXT_CATEGORIES.some((category) => category === instance.category),
  )?.category;

const TEST_CODE = /^<!calmlens-test [0-9a-f]{32} ([A-Za-z0-9_-]+)>$/;

/**
 * The categories a text that is one test code names, for a readable label only: it doesn't check
 * the code's tag, so it never decides moderation. The signed payload is the scenario's JSON.
 */
export const testCodeCategories = (text: string): string[] | undefined => {
  const payload = TEST_CODE.exec(text.trim())?.[1];
  if (!payload) return;
  try {
    const bytes = Uint8Array.from(atob(payload.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
      char.charCodeAt(0),
    );
    const scenario: { instances?: { category?: unknown }[] } = JSON.parse(
      new TextDecoder().decode(bytes),
    );
    return [
      ...new Set(
        (scenario.instances ?? []).flatMap(({ category }) =>
          typeof category === "string" ? [category] : [],
        ),
      ),
    ];
  } catch {
    return;
  }
};
