---
"@calmlens/sdk-go": minor
---

Adds `Assets.Decide(ctx, DecideAssetOptions{AssetID, Decision, Note, ConfirmPurge})`, which records a reviewer's decision with a note and returns the asset. Every list now pages with cursors: `ListFoldersOptions` takes `Cursor`, `PageSize` and `Ordering` (by `name` or `createdAt`) instead of `PageIndex`, `Sort` and `Direction`, and `FolderPage` returns `Items`, `Ancestors`, `NextCursor`, `HasMore`, `PageSize` and `Ordering`. `HashLists.List` takes `ListHashListsOptions{Cursor, PageSize}` and returns a `HashListPage`. `ListEventsOptions` takes `Cursor` and `PageSize` instead of `After` and `Limit`, and `EventsPage` returns `Items` and `NextCursor` instead of `Events` and `Cursor`. `CodeInvalidEventCursor` is removed: an unreadable events cursor is `CodeInvalidCursor`. The `calmlenstest` mock implements `Assets.Decide` with the API's validation and the new list shapes.
