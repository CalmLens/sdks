---
"@calmlens/sdk": minor
---

Test codes and test images now use a signed format that carries an expiry. `generateTestTextCode` and `paintTestImage` take `{ expiresAt }` (Unix seconds; one day from now by default, `TEST_INPUT_DEFAULT_LIFETIME_SECONDS`) and reject one that isn't a whole number from 0 to 4294967295. `detectTestTrigger` and `detectTestImage` take an optional `now` (epoch milliseconds), accept only a current code that is the whole text or a test image that is the whole image, and ignore one that still has more than `TEST_INPUT_MAX_LIFETIME_SECONDS` (seven days) to run. Codes and images made by earlier versions are no longer recognised. `calmlens trigger` sends codes in the new format.
