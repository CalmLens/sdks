---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

Assets have `content.fileMetadata`, the descriptive metadata embedded in an uploaded image: `capturedAt` (ISO 8601, with a UTC offset only when the file records one), `cameraMake`, `cameraModel`, `lensModel`, `software`, `creator`, `copyright`, `digitalSourceType` (the IPTC code the file declares, such as `digitalCapture`), `containsLocation`, which says whether the uploaded file embedded GPS coordinates, and `location` (`latitude` and `longitude`). It is read-only, separate from your own `metadata`, and `null` when the image declares none, for other asset types, once the content is removed and while the asset is held.

Uploads take `processingOptions.storeSensitiveMetadata`, which overrides the project's `storeSensitiveMetadata` setting. It is off by default: embedded image metadata (EXIF, XMP and IPTC) is removed before the image is stored, `checksums` and `sizeInBytes` describe the stored file, and `fileMetadata` leaves out `creator` and `location`. When it is on, the image is stored as uploaded and `fileMetadata` includes them.

The in-memory mocks give assets `fileMetadata: null`. The SDKs export `FileMetadata` and `FileMetadataLocation` types (Go, Java, Rust and Python; JavaScript exports `FileMetadata`), and the typed processing options gain `storeSensitiveMetadata`.
