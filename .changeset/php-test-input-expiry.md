---
"@calmlens/sdk-php": minor
---

Text codes and test images from `TestInputs::generateTestTextCode` and `paintTestImage` now carry an expiry and use the current signed format, which CalmLens requires. They expire one day after they are made by default; pass `expiresAt` (Unix seconds from 0 to 4294967295) to choose another time, and note that CalmLens ignores a code more than seven days from expiring. `TestInputs::DEFAULT_LIFETIME_SECONDS` and `TestInputs::MAX_LIFETIME_SECONDS` hold those lifetimes. CalmLens recognises a text code only as the whole submitted text, and a test image only as the whole upload, in projects with "Recognise test inputs" turned on.
