---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
---

Breaking: an asset's picture is one field, `content.image`, with `width`, `height`, `thumbhash`, `averageColor` and `perceptualHash`. It replaces `content.image` (size and perceptual hash) and `content.previewImage`. For images, the width and height are the original upload's. For documents and websites, they are the page image's. The JavaScript SDK exports the `AssetImage` type, which replaces `ImageData` and `PreviewImage`. `CalmLensMedia` sizes itself and shows its placeholder colour from `content.image`.
