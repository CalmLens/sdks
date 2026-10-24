---
"@calmlens/sdk": minor
---

`MockCalmLensServerClient` follows the API more closely:

- `setApiKeyGrants(grants)` changes the mock API key's grants mid-test, and `failNextRequest` also takes an API error code, such as `"upload/limit-exceeded"`, to fail the next request with that error and its HTTP status.
- Classified images get a placeholder: `cdn.serve` with `resource: "placeholder"` returns a PNG for public assets whatever their moderation status (private ones need `assets:download`), and `403` `asset/not-available` once the asset is purged, its content is removed, or it has no placeholder yet. Originals carry `Cache-Tag`, `X-Content-Type-Options` and `Content-Security-Policy`; images also carry `ETag` and `Expires`. Plain text uploads are served too.
- Unset asset fields such as `description`, `externalId`, `tags` and `metadata` are `null`, as the API returns them. A completed multipart upload has `upload.partsReceived: null`, and `content.sizeInBytes` adds up its parts.
- Multipart images must total 10 MiB to 20 MiB (`upload/multipart-image-too-small`, `upload/multipart-image-too-large`), parts must add up to a declared `totalSizeInBytes` (`upload/size-mismatch`), and `upload/invalid-part-number` details include `receivedPartNumber`.
- Out-of-range `pageSize`, `limit` and search queries fail with the API's `validation/too-small` and `validation/too-big` (HTTP 400). Asset list cursors only continue the query they came from, and other cursors fail with `validation/invalid-cursor`. `events/invalid-cursor` details include `after`.
- `assets.delete`, `assets.deleteContent` and `assets.retry` add `asset.deleted`, `asset.content-removed` and `asset.retried` events. A reviewer's `purged` decision removes the content with reason `requested` and adds `asset.content-removed` before `asset.purged`.
- Uploads into an unknown folder fail with `folder/not-found`, `assets.update` keeps `externalId` unique, `assets.listChildren` fails with `asset/not-found` for an unknown asset, idempotency keys may contain inner spaces and are used without surrounding whitespace, as HTTP sends them, and folders sort by name with uppercase before lowercase.
