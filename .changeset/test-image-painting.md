---
"@calmlens/sdk-go": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

Paint signed test images in every SDK: a scenario, preset or signal becomes a test image that survives JPEG, WebP and resizing, returned as PNG bytes ready to upload together with its RGBA pixels. Python `calmlens.testing.paint_test_image`; Go `calmlenstest.PaintTestImage`; Rust `calmlens::testing::paint_test_image`; Ruby `CalmLens::TestInputs.paint_image`; Java `TestInputs.paintTestImage`; PHP `CalmLens\Testing\TestInputs::paintTestImage`. Each SDK paints the same pixels as the JavaScript SDK's `paintTestImage` and rejects a scenario too large for a test image with `sdk/invalid-argument`.
