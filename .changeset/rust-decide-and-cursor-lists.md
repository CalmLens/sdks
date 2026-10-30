---
"@calmlens/sdk-rust": minor
---

Adds `assets().decide(DecideAsset::new(asset_id, decision, note))`, which records a reviewer's decision with a note and returns the asset (set `confirm_purge` to purge). Every list now pages with cursors: `ListFolders` takes `cursor`, `page_size` and `ordering` (by `name` or `createdAt`) instead of `page_index`, `sort` and `direction`, and `FolderPage` returns `items`, `ancestors`, `next_cursor`, `has_more`, `page_size` and `ordering`. `hash_lists().list(ListHashLists)` returns a `HashListPage`. `ListEvents` takes `cursor` and `page_size` instead of `after` and `limit`, and `EventsPage` returns `items` and `next_cursor` instead of `events` and `cursor`. `ErrorCode::InvalidEventCursor` is removed: an unreadable events cursor is `ErrorCode::InvalidCursor`. The in-memory mock implements `assets().decide` with the API's validation and the new list shapes.
