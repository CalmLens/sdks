---
"@calmlens/sdk-go": minor
---

Text codes and test images from `GenerateTestTextCode` and `PaintTestImage` now carry an expiry and use the current signed format, which CalmLens requires. Both take a third `options *TestInputCodeOptions` argument: `nil` makes a code that expires one day after it is made, and `&TestInputCodeOptions{ExpiresAt: unixSeconds}` (from 0 to 4294967295) chooses another time; CalmLens ignores a code more than seven days from expiring. `calmlenstest` exports `TestInputDefaultLifetimeSeconds` and `TestInputMaxLifetimeSeconds`. CalmLens recognises a text code only as the whole submitted text, and a test image only as the whole upload, in projects with "Recognise test inputs" turned on.
