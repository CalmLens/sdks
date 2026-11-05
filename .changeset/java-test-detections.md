---
"@calmlens/sdk-java": minor
---

Test scenarios can declare person and face detection results: `TestInput.withDetections` takes a `TestInput.Detections` of people and faces, each a `TestInput.DetectionList` of entries (`DetectionList.of(...)`, at most 32) or `DetectionList.unavailable()` to report the feature as not evaluated. Each `Person` and `Face` has a `Box` (`left`, `top`, `width` and `height` in basis points of the image, 0 to 10000) and an optional confidence (0 to 100), and a face can have an age (`FaceAge.ADULT`, `FaceAge.MINOR` or a `FaceAge.Range` of years). `TestInputs` adds the `ONE_FACE`, `NO_FACE`, `ADULT_FACE`, `MINOR_FACE` and `GROUP` presets. `AssetClassification.testInput()` and `EventAssetClassification.testInput()` tell whether results came from a test input, and `MockCalmLensServerClient` reports the person and face detection an image upload turned on, finding nobody, and never marks an asset as a test input.
