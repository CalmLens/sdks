---
"@calmlens/sdk-rust": minor
---

Text codes and test images from `generate_test_text_code` and `paint_test_image` now carry an expiry and use the current signed format, which CalmLens requires. Both take a third `TestInputCodeOptions` argument: `TestInputCodeOptions::default()` makes a code that expires one day after it is made, and `expires_at: Some(unix_seconds)` (from 0 to 4294967295) chooses another time; CalmLens ignores a code more than seven days from expiring. `calmlens::testing` exports `TEST_INPUT_DEFAULT_LIFETIME_SECONDS` and `TEST_INPUT_MAX_LIFETIME_SECONDS`. CalmLens recognises a text code only as the whole submitted text, and a test image only as the whole upload, in projects with "Recognise test inputs" turned on.
