---
"@calmlens/sdk-rust": minor
---

Test scenarios can declare person and face detection results: `TestInput::detections` holds a `TestDetections` with `people` and `faces`, each a `TestDetectionList::Detected` list or `TestDetectionList::Unavailable` to report the feature as not evaluated. Each `TestPerson` and `TestFace` has a `bounding_box` (`[left, top, width, height]` in basis points of the image, 0 to 10000) and an optional confidence (0 to 100), and each face an optional age (`TestFaceAge::Adult`, `TestFaceAge::Minor` or `TestFaceAge::Range(TestAgeRange { low, high })`). A list holds at most 32 entries. `TestInputPreset` adds `OneFace`, `NoFace`, `AdultFace`, `MinorFace` and `Group`. `AssetClassification::test_input` and `EventAsset::test_input()` say whether an asset's results came from a test input, and `MockServerClient::in_memory` reports the person and face detection an image upload turned on, finding nobody, and never marks an asset as a test input.
