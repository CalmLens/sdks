/**
 * Portable test inputs: presets and custom instances share one authenticated format. CalmLens
 * recognises a code only as the whole text and a test image only as the whole
 * upload, in projects with test inputs turned on.
 */
export {
  type ClassificationTestSignal,
  detectTestImage,
  detectTestTrigger,
  generateTestTextCode,
  getImageTestCategories,
  paintTestImage,
  TEST_DETECTION_BOX_MAX,
  TEST_DETECTIONS_MAX,
  TEST_FACE_AGE_MAX,
  TEST_FACE_AGE_PRESETS,
  TEST_INPUT_KEY_PATTERN,
  TEST_INPUT_PRESETS,
  type TestDetections,
  type TestInput,
  testInputForSignal,
} from "./contract/TestTriggers.js";
