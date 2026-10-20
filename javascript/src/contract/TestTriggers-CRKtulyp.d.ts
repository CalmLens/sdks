import { n as ClassificationCategory } from "./Classification-BNhgwGEm.js";
//#region packages/shared/src/TestTriggers.d.ts
type ClassificationTestSignal = ClassificationCategory | "sexual.involving-minors" | "violence.graphic";
declare const TEST_IMAGE_PALETTES: Partial<Record<ClassificationTestSignal, [[number, number, number, number], [number, number, number, number], [number, number, number, number], [number, number, number, number]]>>;
/** A project's test input key: eight hexadecimal characters only its members can see. */
declare const TEST_INPUT_KEY_PATTERN: RegExp;
/**
 * The text code that CalmLens classifies as `category` for the project with this test input key.
 * @returns The code, or an empty string for a category without a text code
 */
declare const generateTestTextCode: (category: ClassificationTestSignal, testInputKey: string) => string;
/**
 * The test signals in `text` whose codes carry the project's test input key. Codes with another
 * key are ignored, so a code can only be used by the project it belongs to.
 */
declare const detectTestTrigger: (text: string, testInputKey: string) => {
  isTestTrigger: boolean;
  signals: ClassificationTestSignal[];
};
/** One cell in the full-image 4×4 colour grid carrying the project key. */
interface TestImageKeyCell {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Sixteen cells encode two bits each using the category's four existing colours. */
declare const getTestImageKeyCells: (width: number, height: number) => TestImageKeyCell[];
declare const getTestImageKeyColors: (signal: ClassificationTestSignal, testInputKey: string) => [number, number, number, number][];
/**
 * Gets all test trigger categories that support images
 */
declare const getImageTestCategories: () => ClassificationTestSignal[];
/** Paint a full-image 4×4 grid as RGBA pixels; callers choose their image encoder. */
declare const paintTestImage: (signal: ClassificationTestSignal, testInputKey: string, width?: number, height?: number) => Uint8Array<ArrayBuffer>;
/** Decode the project key from pixels, tolerating resizing and lossy compression. */
declare const detectTestImage: (image: {
  width: number;
  height: number;
  rgba: Uint8Array;
}, testInputKey: string) => ClassificationTestSignal | undefined;
//#endregion
export { detectTestImage as a, getImageTestCategories as c, paintTestImage as d, TestImageKeyCell as i, getTestImageKeyCells as l, TEST_IMAGE_PALETTES as n, detectTestTrigger as o, TEST_INPUT_KEY_PATTERN as r, generateTestTextCode as s, ClassificationTestSignal as t, getTestImageKeyColors as u };