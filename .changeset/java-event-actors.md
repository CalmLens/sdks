---
"@calmlens/sdk-java": minor
---

Events say who caused them, the events feed can be filtered, and batch operations can be followed.

- Every `Event` and `WebhookEventPayload` has `actor()`, an `EventActor` with a `type` (`user` for a person in the portal or an assistant acting for one, `api-key`, `automated` moderation or CalmLens itself as `system`) and the user's or API key's `id`, null when it was not recorded. It replaces the `decided-by` fact and the per-type ID facts (`reviewer-user-id`, `invited-by-user-id`, `removed-by-user-id`, `changed-by-user-id`, `transferred-by-user-id`, `created-by-user-id`, `revoked-by-user-id`). The constructors that build an event or payload in code take the actor after `projectId`.
- `ListEvents` takes `types(List<String>)` and `assetId(String)`, for `events.list` and `events.pages`. A cursor belongs to the filters it was issued with, so pass the same ones with each cursor.
- `assets.batch` returns `BatchAssetsResponse(batchId, status, assetCount)` in place of `queued`, and the `asset.deleted` and `asset.content-removed` events it causes carry a `batch-id` fact naming `batchId`.
- `assets.deleteContent` is now `assets.removeContent`.
- Renamed and split event types: `asset.progress-updated`, `usage.free-uploads-exhausted`, `usage.uploads-paused` (with `resumes-at` in milliseconds), `connector.disabled`, `project.member-left` (no more `left` fact on `project.member-removed`) and `api-key.deleted` (no more `action` fact on `api-key.revoked`). `project.transferred` has `method` (`handover` or `move`) in place of `handover`.
- `HashMatch` has `hashListId()` and `hashListEntryId()` in place of `listId()` and `entryId()`, and `HashListEntry` names its source asset `assetId()` in place of `sourceAssetId()`. The failure reasons `free-upload-limit` and `spend-limit` are `free-uploads-exhausted` and `uploads-paused`.
- `MockCalmLensServerClient` records each event's actor (its API key, with no ID, for API calls; `automated` for the pipeline; a `user` for `decide`), filters its feed by `types` and `assetId`, answers batches with a `batch_` ID, and names hash list entries' source asset `assetId`. `enqueueEvent` takes an optional `EventActor`.
