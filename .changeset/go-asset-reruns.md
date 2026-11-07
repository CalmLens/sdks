---
"@calmlens/sdk-go": minor
---

`CodeAssetChildNotDeletable` (`asset/child-not-deletable`, HTTP 409) is returned when `Assets.Delete` or an `Assets.Batch` deletion names an asset extracted from another (one with a `ParentID`): delete the asset it was extracted from instead, which deletes it too.

`Assets.Explain` with `Rerun` now returns the asset unchanged and records an `EventAssetRerunRequested` (`asset.rerun-requested`) event, whose `AssetRerunRequestedFacts` carry the asset's current `ModerationStatus`. The asset keeps its decision until the re-run's `asset.classified` and `asset.<status>` events report the new one, and a failed re-run keeps it. `calmlenstest` does the same: a pending re-run decision keeps the asset's decision until `CompleteProcessing` decides it.
