---
"@calmlens/sdk": minor
---

Events say who caused them, the events feed can be filtered, and batch operations can be followed.

- Every event has `actor: { type, id }`: a `user` (a person in the portal, or an assistant acting for one), an `api-key`, `automated` moderation or CalmLens itself (`system`). It replaces the `decided-by` fact and the per-type ID facts (`reviewer-user-id`, `invited-by-user-id`, `removed-by-user-id`, `changed-by-user-id`, `transferred-by-user-id`, `created-by-user-id`, `revoked-by-user-id`).
- `events.list` and `events.pages` take `types` and `assetId`. A cursor belongs to the filters it was issued with.
- `assets.batch` resolves with `{ batchId, status: "queued", assetCount }`, and the `asset.deleted` and `asset.content-removed` events it causes carry a `batch-id` fact.
- `assets.deleteContent` is now `assets.removeContent`, and its options type `RemoveAssetContentOptions`.
- Renamed and split event types: `asset.progress-updated`, `usage.free-uploads-exhausted`, `usage.uploads-paused` (with `resumes-at` in milliseconds), `connector.disabled`, `project.member-left` (no more `left` fact on `project.member-removed`) and `api-key.deleted` (no more `action` fact on `api-key.revoked`). `project.transferred` has `method` (`handover` or `move`) in place of `handover`.
- Hash matches name `hashListId` and `hashListEntryId`, and hash list entries name their source asset `assetId`. The failure reasons `free-upload-limit` and `spend-limit` are `free-uploads-exhausted` and `uploads-paused`.
- The testing mock records `actor`, filters its feed, and answers batches with a batch ID.
