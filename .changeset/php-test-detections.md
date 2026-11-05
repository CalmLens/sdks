---
"@calmlens/sdk-php": minor
---

Test scenarios can declare person and face detection results: `detections['people']` and `detections['faces']` list boxes (`[left, top, width, height]` in basis points of the image, 0 to 10000) with an optional `confidence` (0 to 100), each face optionally with an `age` (`'adult'`, `'minor'` or `['low' => …, 'high' => …]`), or `'unavailable'` to report the feature as not evaluated. A list holds at most 32 entries, and `TestInputs` throws `InvalidArgumentException` (`sdk/invalid-argument`) for anything else. `TestInputs::PRESETS` adds `oneFace`, `noFace`, `adultFace`, `minorFace` and `group`, and `Classification` adds `TEST_DETECTIONS_MAX`, `TEST_DETECTION_BOX_MAX`, `TEST_FACE_AGE_MAX` and `TEST_FACE_AGE_PRESETS`. Assets and event snapshots carry `classification.testInput`, and `MockServerClient` reports the person and face detection an image upload turned on, finding nobody, and never marks an asset as a test input.
