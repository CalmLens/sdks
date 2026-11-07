---
"@calmlens/sdk-php": minor
---

`ErrorCodes::ASSET_CHILD_NOT_DELETABLE` (`asset/child-not-deletable`, HTTP 409) is thrown when `assets->delete()` or an `assets->batch()` deletion names an asset extracted from another (one with a `parentId`): delete the asset it was extracted from instead, which deletes it too.

`assets->explain()` with `'rerun' => true` now returns the asset unchanged and records an `asset.rerun-requested` event, whose `moderation-status` fact is the asset's current status. The asset keeps its decision until the re-run's `asset.classified` and `asset.<status>` events report the new one, and a failed re-run keeps it. `MockServerClient` does the same: a `pending` re-run decision keeps the asset's decision until `completeProcessing` decides it.
