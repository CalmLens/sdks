---
"@calmlens/sdk-python": minor
---

Test scenarios can declare person and face detection results: `detections["people"]` and `detections["faces"]` list boxes (`[left, top, width, height]` in basis points of the image, 0 to 10000) with an optional confidence (0 to 100), each face optionally with an age (`"adult"`, `"minor"` or `{"low": ..., "high": ...}`), or `"unavailable"` to report the feature as not evaluated. A list holds at most 32 entries, and `calmlens.testing` types them as `SignedTestDetections`, `SignedTestDetectedPerson`, `SignedTestDetectedFace` and `SignedTestFaceAge`. `TEST_INPUT_PRESETS` adds `one_face`, `no_face`, `adult_face`, `minor_face` and `group`. Assets and event snapshots carry `classification["testInput"]`, and `MockCalmLensServerClient` reports the person and face detection an image upload turned on, finding nobody, and never marks an asset as a test input.
