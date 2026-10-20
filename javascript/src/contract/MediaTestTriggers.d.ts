import { t as ClassificationTestSignal } from "./TestTriggers-BHKQtSn4.js";
//#region packages/shared/src/MediaTestTriggers.d.ts
export declare const MEDIA_TEST_SIGNALS: readonly ["sexual", "violence", "self-harm", "harassment", "hate", "criminal-activity", "violence.graphic"];
/** Read this aloud, or render it as large, high-contrast text in a video frame. */
export declare function generateMediaTestCode(signal: ClassificationTestSignal, testInputKey: string): Promise<string>;
//#endregion