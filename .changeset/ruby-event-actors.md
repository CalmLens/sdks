---
"@calmlens/sdk-ruby": minor
---

Events say who caused them, the events feed can be filtered, and batch operations can be followed.

- Every event has `'actor' => { 'type', 'id' }`: a `user` (a person in the portal, or an assistant acting for one), an `api-key`, `automated` moderation or CalmLens itself (`system`), with `id` nil when it was not recorded. It replaces the `decided-by` fact and the per-type ID facts (`reviewer-user-id`, `invited-by-user-id`, `removed-by-user-id`, `changed-by-user-id`, `transferred-by-user-id`, `created-by-user-id`, `revoked-by-user-id`). `CalmLens::WebhookEvent#actor` returns it for a delivery, and the RBS signatures add the `actor` and `actor_type` types.
- `events.list`, `events.each_page` and `events.each` take `types:` (an Array of event types, sent as one comma-separated value) and `asset_id:`. A cursor belongs to the filters it was issued with, so pass the same ones with each `cursor:`.
- `assets.batch` returns `{ 'batchId', 'status' => 'queued', 'assetCount' }`, and the `asset.deleted` and `asset.content-removed` events it causes carry a `batch-id` fact.
- `assets.delete_content` is now `assets.remove_content`.
- Renamed and split event types: `asset.progress-updated`, `usage.free-uploads-exhausted`, `usage.uploads-paused` (with `resumes-at` in milliseconds), `connector.disabled`, `project.member-left` (no more `left` fact on `project.member-removed`) and `api-key.deleted` (no more `action` fact on `api-key.revoked`). `project.transferred` has `method` (`handover` or `move`) in place of `handover`.
- Hash matches name `hashListId` and `hashListEntryId`, and hash list entries name their source asset `assetId`. The failure reasons `free-upload-limit` and `spend-limit` are `free-uploads-exhausted` and `uploads-paused`.
- `CalmLens::MockServerClient` records `actor` (the mock API key for API calls, `automated` for processing, a `user` for `decide`), `enqueue_event` takes an `actor:` (the mock API key when omitted), the events feed filters by `types:` and `asset_id:`, and batches return a batch ID.
