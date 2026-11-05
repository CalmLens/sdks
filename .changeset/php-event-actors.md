---
"@calmlens/sdk-php": minor
---

Events say who caused them, the events feed can be filtered, and batch operations can be followed.

- Every event has `actor` (`['type' => ..., 'id' => ...]`): a `user` (a person in the portal, or an assistant acting for one), an `api-key`, `automated` moderation or CalmLens itself (`system`). It replaces the `decided-by` fact and the per-type ID facts (`reviewer-user-id`, `invited-by-user-id`, `removed-by-user-id`, `changed-by-user-id`, `transferred-by-user-id`, `created-by-user-id`, `revoked-by-user-id`). `Webhooks::toPayload` includes it.
- `$client->events->list`, `eachPage` and `each` take `types` (a list of event types) and `assetId`. A cursor belongs to the filters it was issued with.
- `$client->assets->batch` returns `['batchId' => ..., 'status' => 'queued', 'assetCount' => ...]`, and the `asset.deleted` and `asset.content-removed` events it causes carry a `batch-id` fact.
- `$client->assets->deleteContent` is now `$client->assets->removeContent`.
- Renamed and split event types: `asset.progress-updated`, `usage.free-uploads-exhausted`, `usage.uploads-paused` (with `resumes-at` in milliseconds), `connector.disabled`, `project.member-left` (no more `left` fact on `project.member-removed`) and `api-key.deleted` (no more `action` fact on `api-key.revoked`). `project.transferred` has `method` (`handover` or `move`) in place of `handover`.
- Hash matches name `hashListId` and `hashListEntryId`, and hash list entries name their source asset `assetId`. The failure reasons `free-upload-limit` and `spend-limit` are `free-uploads-exhausted` and `uploads-paused`.
- `MockServerClient` records an `actor` on every event (the mock API key, `['type' => 'api-key', 'id' => null]`, for client calls; `automated` for moderation; a `user` for `decide`), and `enqueueEvent` takes one in the event's `actor`. Its feed filters by `types` and `assetId`, refusing a cursor used with other filters with `cursor/invalid`; batches return a `batch_` ID; and hash list entries name their source asset `assetId`.
