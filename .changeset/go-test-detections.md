---
"@calmlens/sdk-go": minor
---

Test scenarios can declare person and face detection results: `TestInput.Detections` holds `People` (a `TestPersonList`) and `Faces` (a `TestFaceList`), or `TestUnavailable{}` to report the feature as not evaluated. Each entry has a `TestBox` (`[left, top, width, height]` in basis points of the image, 0 to 10000) and an optional confidence (0 to 100), and each face an optional age (`TestAgeAdult`, `TestAgeMinor` or a `TestAgeRange{Low, High}`). A list holds at most 32 entries. `TestInputPresets()` adds `OneFace`, `NoFace`, `AdultFace`, `MinorFace` and `Group`. `AssetClassification.TestInput` and `EventAssetClassification.TestInput` say whether an asset's results came from a test input, and the mock client reports the person and face detection an image upload turned on, finding nobody, and never marks an asset as a test input.
