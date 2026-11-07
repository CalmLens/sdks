---
"@calmlens/sdk-rust": minor
---

`ErrorCode::AssetChildNotDeletable` (`asset/child-not-deletable`, HTTP 409) is returned when `assets().delete` or an `assets().batch` deletion names an asset extracted from another (one with a `parent_id`): delete the asset it was extracted from instead, which deletes it too.

`assets().explain` with `rerun` now returns the asset unchanged and records an `asset.rerun-requested` event (`EventType::AssetRerunRequested`), whose `moderation-status` fact is the asset's current status. The asset keeps its decision until the re-run's `asset.classified` and `asset.<status>` events report the new one, and a failed re-run keeps it. The in-memory mock does the same: a pending re-run decision keeps the asset's decision until `complete_processing` decides it.
