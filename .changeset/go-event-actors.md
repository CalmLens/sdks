---
"@calmlens/sdk-go": minor
---

Events say who caused them, the events feed can be filtered, and batch operations can be followed.

- Every `Event` has `Actor` (an `Actor` with `Type` and `ID`): `ActorUser` (a person in the portal, or an assistant acting for one), `ActorAPIKey`, `ActorAutomated` moderation or CalmLens itself (`ActorSystem`). `ID` is nil when it was not recorded. It replaces the `decided-by` fact (`FactDecidedBy` and the `DecidedBy*` values) and the per-type ID facts (`FactReviewerUserID`, `FactInvitedByUserID`, `FactRemovedByUserID`, `FactChangedByUserID`, `FactCreatedByUserID`, `FactRevokedByUserID`), and the matching fields of the facts types are gone.
- `ListEventsOptions` (for `Events.List` and `Events.ListAll`) takes `Types`, a list of event types sent as one comma-separated value, and `AssetID`. A cursor belongs to the filters it was issued with.
- `Assets.Batch` returns `BatchAssetsResponse` with `BatchID`, `Status` (`BatchStatusQueued`) and `AssetCount` in place of `Queued`, and the `asset.deleted` and `asset.content-removed` events it causes carry a `FactBatchID` fact (`AssetRemovedFacts.BatchID`).
- `Assets.DeleteContent` is now `Assets.RemoveContent`.
- Renamed and split event types: `EventAssetProgressUpdated` (`asset.progress-updated`, with `AssetProgressUpdatedFacts`) replaces `EventAssetProcessingProgress`; `EventUsageFreeUploadsExhausted` (`UsageFreeUploadsExhaustedFacts`) replaces `EventUsageLimitReached`; `EventUsageUploadsPaused` (`UsageUploadsPausedFacts`, whose `ResumesAt` (`FactResumesAt`) is in unix milliseconds, in place of `ResumesOn`) replaces `EventUsageSpendLimitReached`; `EventConnectorDisabled` (`ConnectorDisabledFacts`, with the `ConnectorType*` values) replaces `EventConnectorFailing`. New: `EventProjectMemberLeft` (no more `Left` on `ProjectMemberRemovedFacts`), `EventAPIKeyDeleted` (no more `Action` on `APIKeyRevokedFacts`) and `EventProjectTransferred` with `ProjectTransferredFacts`, whose `Method` is `TransferMethodHandover` or `TransferMethodMove`.
- `HashMatch` names `HashListID` and `HashListEntryID`, and `HashListEntry` names its source asset `AssetID`. The failure reasons `AssetFailureReasonFreeUploadLimit` and `AssetFailureReasonSpendLimit` are `AssetFailureReasonFreeUploadsExhausted` (`free-uploads-exhausted`) and `AssetFailureReasonUploadsPaused` (`uploads-paused`).
- `ToWebhookEventPayload` keeps the event's `actor`.
- The `calmlenstest` mock records `Actor` (its API key for API calls, automated moderation for the pipeline and a user for `Decide`), fills in its API key for an `EnqueueEvent` event without one, filters its feed with cursors bound to their filters, and answers batches with a batch ID.
