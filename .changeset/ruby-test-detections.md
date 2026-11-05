---
"@calmlens/sdk-ruby": minor
---

Test scenarios can declare person and face detection results: `'detections' => { 'people' => [...], 'faces' => [...] }` lists boxes (`'box' => [left, top, width, height]` as Integers in basis points of the image, 0 to 10000) with an optional Integer `'confidence'` (0 to 100), each face optionally with an `'age'` (`'adult'`, `'minor'` or `{ 'low' => 30, 'high' => 40 }`), or `'unavailable'` to report the feature as not evaluated. A list holds at most 32 entries, and a detection key given twice (for example as a String and a Symbol) raises `sdk/invalid-argument`. `CalmLens::TestInputs::PRESETS` adds `:one_face`, `:no_face`, `:adult_face`, `:minor_face` and `:group`. Assets and event snapshots carry `classification.testInput`, and `CalmLens::MockServerClient` reports the person and face detection an image upload turned on, finding nobody, and never marks an asset as a test input.
