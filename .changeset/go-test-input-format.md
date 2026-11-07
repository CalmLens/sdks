---
"@calmlens/sdk-go": minor
---

Text codes and test images from `GenerateTestTextCode` and `PaintTestImage` now use the current signed format, which CalmLens requires. CalmLens recognises a text code only as the whole submitted text, and a test image only as the whole upload, in projects with "Recognise test inputs" turned on. Codes and images made by earlier versions are no longer recognised.
