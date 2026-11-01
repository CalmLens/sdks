---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

Assets have `content.fileMetadata`, the descriptive metadata embedded in an uploaded image: `capturedAt` (ISO 8601, with a UTC offset only when the file records one), `cameraMake`, `cameraModel`, `lensModel`, `software`, `creator`, `copyright`, `digitalSourceType` (the IPTC code the file declares, such as `digitalCapture`) and `containsLocation`, which says whether the file embeds GPS coordinates. The coordinates themselves are never returned. It is read-only, separate from your own `metadata`, and `null` when the image declares none, for other asset types, once the content is removed and while the asset is held. The in-memory mocks give assets `fileMetadata: null`. The SDKs export a `FileMetadata` type (Go, Java, Rust, Python and JavaScript).
