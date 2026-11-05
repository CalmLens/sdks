---
"@calmlens/sdk-rust": minor
---

Events say who caused them, the events feed can be filtered, and batch operations can be followed.

- Every `Event` has `actor`, an `Actor` with `actor_type` (`ActorType::User` for a person in the portal or an assistant acting for one, `ApiKey`, `Automated` moderation or `System` for CalmLens itself) and `id` (`None` when not recorded). `WebhookEventPayload::actor` carries it in deliveries. It replaces the `decided-by` fact and the per-type ID facts (`reviewer-user-id`, `invited-by-user-id`, `removed-by-user-id`, `changed-by-user-id`, `transferred-by-user-id`, `created-by-user-id`, `revoked-by-user-id`).
- `ListEvents` takes `types` (`Option<Vec<EventType>>`, sent as one comma-separated value) and `asset_id`, for `events().list` and `events().pages`. A cursor belongs to the filters it was issued with.
- `assets().batch` returns `BatchAssetsResponse { batch_id, status: AssetBatchStatus::Queued, asset_count }` in place of `queued`, and the `asset.deleted` and `asset.content-removed` events it causes carry a `batch-id` fact.
- `assets().delete_content` is now `assets().remove_content` (also on the blocking client).
- Renamed and split event types: `EventType::AssetProgressUpdated`, `UsageFreeUploadsExhausted`, `UsageUploadsPaused` (with `resumes-at` in milliseconds), `ConnectorDisabled`, `ProjectMemberLeft` (no more `left` fact on `project.member-removed`) and `ApiKeyDeleted` (no more `action` fact on `api-key.revoked`), and the new `AssetRegionRestricted`, `AssetHashMatched`, `AssetLinkFlagged` and `ProjectTransferred`, whose `method` fact (`handover` or `move`) replaces `handover`.
- `HashMatch::hash_list_id` and `hash_list_entry_id` replace `list_id` and `entry_id`, and `HashListEntry::asset_id` replaces `source_asset_id`. `AssetFailureReason::FreeUploadsExhausted` and `UploadsPaused` replace `FreeUploadLimit` and `SpendLimit`.
- `MockServerClient` records each event's actor (the mock API key, with no ID, for its requests; `automated` for the pipeline; a `user` for `decide`), and `enqueue_event` keeps the actor it is given, or names the mock API key. It filters its feed with cursors bound to their filters, answers batches with a `batch_`-prefixed ID and puts the `batch-id` fact on their events, and names hash list entries' source asset `assetId`.
