---
"@calmlens/sdk-java": minor
---

Adds `assets.decide(new DecideAsset(assetId, decision, note))`, with `confirmPurge(true)` for purges, which records a reviewer's decision with a note and returns the asset. Every list now pages with cursors: `ListFolders` takes `cursor`, `pageSize` and `ordering` (by `name` or `createdAt`) instead of `pageIndex`, `sort` and `direction`, and `FolderPage` returns `items`, `ancestors`, `nextCursor`, `pageSize`, `hasMore` and `ordering`. `hashLists.list(ListHashLists)` returns a `HashListPage`, replacing `HashListList`. `ListEvents` takes `cursor` and `pageSize` instead of `after` and `limit`, and `EventsPage` returns `items` and `nextCursor`. `ErrorCodes.INVALID_EVENT_CURSOR` is removed: an unreadable events cursor is `INVALID_CURSOR`. The mock client implements `assets.decide` with the API's validation and the new list shapes.
