---
"@calmlens/sdk-java": minor
---

Text codes and test images from `TestInputs.generateTestTextCode` and `TestInputs.paintTestImage` now carry an expiry and use the current signed format, which CalmLens requires. They expire one day after they are made by default; the new overloads with a `long expiresAt` (Unix seconds, from 0 to 4294967295) choose another time, and CalmLens ignores a code more than seven days from expiring. `TestInputs.DEFAULT_LIFETIME_SECONDS` and `TestInputs.MAX_LIFETIME_SECONDS` hold the two lifetimes. CalmLens recognises a text code only as the whole submitted text, and a test image only as the whole upload, in projects with "Recognise test inputs" turned on.
