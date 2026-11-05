---
"@calmlens/sdk-python": minor
---

Each API failure has one error code, named resource first, and `CalmLensError.details` tells its cases apart.

- Invalid requests fail with `validation/invalid-request`; `details["issues"]` lists each problem's `path`, `message` and issue `code`, such as `validation/too-big`. `details["path"]` is gone.
- `upload/too-large` (HTTP 413) replaces `upload/file-too-large`, `upload/multipart-image-too-large` and `upload-preset/too-large`, with `details["limitBytes"]` and `details["source"]` (`plan` or `preset`). The SDK's own size checks raise it too.
- `upload/unsupported-type` (HTTP 415) replaces `upload/invalid-mime-type`, `upload-preset/content-type-not-allowed` and `image/unsupported-format`, with `details["source"]` (`calmlens` or `preset`). The SDK's own upload type check raises it with `source` `calmlens`.
- `asset/held` (HTTP 423, `details["hold"]` `safety` or `copyright`) replaces `asset/safety-held`, `appeal/safety-held` and `copyright/content-held`; `image/too-large` (`details["limit"]`) replaces `image/input-limit` and `upload/image-exceeded-max-dimensions`; `auth/permission-denied` (`details["permission"]`) replaces `asset/api-key-missing-permission`.
- Renamed codes: `api-key/invalid`, `api-key/missing`, `api-key/project-mismatch`, `api-key/not-accepted`, `session-token/expired`, `session-token/invalid`, `cursor/invalid`, `filter/invalid`, `ordering/unsupported-field`, `request/unsupported-content-type`, `request/route-not-found`, `server/internal-error`, `viewer-claims/invalid`, `viewer-region/invalid`, `transform/invalid`, `transform-options/invalid`, `upload-payload/invalid`, `upload-part/invalid-number`, `image/invalid`, `hash-list-entry/not-found`, `hash-list-entry/limit-reached`, `support-ticket/not-found`, `upload/website-rate-limit-reached`, `remote-url/not-allowed`, `remote-url/invalid`, `remote-url/unavailable` and `remote-url/too-many-redirects`. Usage limits fail with `usage/free-uploads-exhausted` and `usage/uploads-paused`.
- `calmlens.error_codes` constants follow: `UPLOAD_TOO_LARGE`, `UNSUPPORTED_UPLOAD_TYPE`, `ASSET_HELD`, `IMAGE_TOO_LARGE`, `INVALID_IMAGE`, `INVALID_REQUEST`, `MISSING_API_KEY`, `FREE_UPLOADS_EXHAUSTED`, `UPLOADS_PAUSED`, `UNSUPPORTED_ORDERING_FIELD`, `WEBSITE_RATE_LIMIT_REACHED` and `REMOTE_URL_TOO_MANY_REDIRECTS`; the constants for removed codes are gone.
- `MockCalmLensServerClient` answers with the same codes and details.
