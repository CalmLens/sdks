---
"@calmlens/sdk": minor
---

Text codes and test images from `generateTestTextCode` and `paintTestImage` now use the current signed format, which CalmLens requires. `detectTestTrigger` and `detectTestImage` accept only a code that is the whole text or a test image that is the whole image, as CalmLens does. `calmlens trigger` sends codes in the new format. CalmLens recognises them only in projects with "Recognise test inputs" turned on. Codes and images made by earlier versions are no longer recognised.
