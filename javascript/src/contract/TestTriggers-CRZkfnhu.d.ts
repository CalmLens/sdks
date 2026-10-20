import { n as ClassificationCategory } from "./Classification-D9ZNv0MB.js";
//#region packages/shared/src/TestTriggers.d.ts
type ClassificationTestSignal = ClassificationCategory | "sexual.involving-minors" | "violence.graphic";
declare const TEST_IMAGE_PALETTES: Partial<Record<ClassificationTestSignal, [[number, number, number, number], [number, number, number, number], [number, number, number, number], [number, number, number, number]]>>;
/** A project's test input key: 32 hexadecimal characters only its members can see. */
declare const TEST_INPUT_KEY_PATTERN: RegExp;
/** A category-specific text code authenticated with the project's secret key. */
declare const generateTestTextCode: (category: ClassificationTestSignal, testInputKey: string) => Promise<string>;
/** Accept only category tags authenticated by this project's key. */
declare const detectTestTrigger: (text: string, testInputKey: string) => Promise<{
  isTestTrigger: boolean;
  signals: ClassificationTestSignal[];
}>;
/** One cell in the full-image 8×8 colour grid carrying an authenticated tag. */
interface TestImageKeyCell {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Sixty-four cells encode a 128-bit tag using the category's four colours. */
declare const getTestImageKeyCells: (width: number, height: number) => TestImageKeyCell[];
declare const getTestImageKeyColors: (signal: ClassificationTestSignal, testInputKey: string) => Promise<[number, number, number, number][]>;
/**
 * Gets all test trigger categories that support images
 */
declare const getImageTestCategories: () => ClassificationTestSignal[];
/** Paint a full-image 8×8 grid as RGBA pixels; callers choose their image encoder. */
declare const paintTestImage: (signal: ClassificationTestSignal, testInputKey: string, width?: number, height?: number) => Promise<Uint8Array<ArrayBuffer>>;
/** Decode the public image tag, then authenticate it without comparing secret cells. */
declare const detectTestImage: (image: {
  width: number;
  height: number;
  rgba: Uint8Array;
}, testInputKey: string) => Promise<ClassificationTestSignal | undefined>;
//#endregion
export { detectTestImage as a, getImageTestCategories as c, paintTestImage as d, TestImageKeyCell as i, getTestImageKeyCells as l, TEST_IMAGE_PALETTES as n, detectTestTrigger as o, TEST_INPUT_KEY_PATTERN as r, generateTestTextCode as s, ClassificationTestSignal as t, getTestImageKeyColors as u };