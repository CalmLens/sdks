---
"@calmlens/sdk-python": minor
---

Events say who caused them, the events feed can be filtered, and batch operations can be followed.

- Every event has `actor` (`{"type", "id"}`, typed as `Actor`): a `user` (a person in the portal, or an assistant acting for one), an `api-key`, `automated` moderation or CalmLens itself (`system`), with `id` `None` when no ID was recorded. Webhook payloads carry it too. It replaces the `decided-by` fact and the per-type ID facts (`reviewer-user-id`, `invited-by-user-id`, `removed-by-user-id`, `changed-by-user-id`, `transferred-by-user-id`, `created-by-user-id`, `revoked-by-user-id`).
- `events.list`, `events.iter_pages` and `events.iter` take `types` (a list of event types, sent as one comma-separated value) and `asset_id`. A cursor belongs to the filters it was issued with.
- `assets.batch` returns `{"batchId", "status": "queued", "assetCount"}`, and the `asset.deleted` and `asset.content-removed` events it causes carry a `batch-id` fact.
- `assets.delete_content` is now `assets.remove_content`.
- Renamed and split event types: `asset.progress-updated`, `usage.free-uploads-exhausted`, `usage.uploads-paused` (with `resumes-at` in epoch milliseconds), `connector.disabled`, `project.member-left` (no more `left` fact on `project.member-removed`) and `api-key.deleted` (no more `action` fact on `api-key.revoked`). `project.transferred` has `method` (`handover` or `move`) in place of `handover`.
- Hash matches name `hashListId` and `hashListEntryId`, and hash list entries name their source asset `assetId`. The failure reasons `free-upload-limit` and `spend-limit` are `free-uploads-exhausted` and `uploads-paused`.
- `MockCalmLensServerClient` records an actor on every event (its API key, which has no ID, for API calls; `automated` for the pipeline; a `user` for `decide`), and `enqueue_event` takes an `actor`. It filters its feed by `types` and `asset_id`, refusing a cursor reused with other filters with `cursor/invalid`, and answers batches with a `batch_` ID.
