---
"@calmlens/sdk-rust": minor
---

Each API failure has one error code, named resource first, and `Error::details` tells its cases apart.

- Invalid requests fail with `ErrorCode::InvalidRequest` (`validation/invalid-request`); `details["issues"]` lists each problem's `path`, `message` and issue `code`, such as `validation/too-big` (`ErrorCode::TooBig`). `details["path"]` is gone.
- `ErrorCode::UploadTooLarge` (`upload/too-large`, HTTP 413) replaces `FileTooLarge`, `MultipartImageTooLarge` and `UploadPresetTooLarge`, with `details["limitBytes"]` and `details["source"]` (`plan` or `preset`). The SDK's own size checks fail with it too.
- `ErrorCode::UnsupportedUploadType` (`upload/unsupported-type`, HTTP 415) replaces `InvalidUploadMimeType`, `UploadPresetContentTypeNotAllowed` and `ImageUnsupportedFormat`, with `details["source"]` (`calmlens` or `preset`). The SDK's own MIME type check fails with it too, with `source` `calmlens`.
- `ErrorCode::AssetHeld` (`asset/held`, HTTP 423, `details["hold"]` `safety` or `copyright`) replaces `AssetSafetyHeld`, `AppealSafetyHeld` and `CopyrightContentHeld`; `ErrorCode::ImageTooLarge` (`image/too-large`, `details["limit"]`) replaces `ImageInputLimit` and `ImageExceededMaxDimensions`; `ErrorCode::PermissionDenied` (`auth/permission-denied`, `details["permission"]`) replaces `DownloadPermissionRequired`.
- Renamed codes: `api-key/invalid`, `api-key/missing`, `api-key/project-mismatch`, `api-key/not-accepted`, `session-token/expired`, `session-token/invalid`, `cursor/invalid`, `filter/invalid`, `ordering/unsupported-field`, `request/unsupported-content-type`, `request/route-not-found`, `server/internal-error`, `viewer-claims/invalid`, `viewer-region/invalid`, `transform/invalid`, `transform-options/invalid`, `upload-payload/invalid`, `upload-part/invalid-number`, `image/invalid`, `hash-list-entry/not-found`, `hash-list-entry/limit-reached`, `support-ticket/not-found`, `upload/website-rate-limit-reached`, `remote-url/not-allowed`, `remote-url/invalid`, `remote-url/unavailable` and `remote-url/too-many-redirects`. Usage limits fail with `usage/free-uploads-exhausted` and `usage/uploads-paused`.
- `ErrorCode` variants follow: `InvalidRequest`, `UploadTooLarge`, `UnsupportedUploadType`, `AssetHeld`, `ImageTooLarge`, `InvalidImage`, `MissingApiKey`, `FreeUploadsExhausted`, `UploadsPaused`, `UnsupportedOrderingField`, `WebsiteRateLimitReached` and `RemoteUrlTooManyRedirects` are new names, and the replaced variants are removed.
- `MockServerClient` answers with the same codes and details.
