---
"@calmlens/sdk-python": minor
---

Adds `assets.decide(asset_id=..., decision=..., note=...)`, with `confirm_purge=True` for purges, which records a reviewer's decision with a note and returns the asset. Every list now pages with cursors: `folders.list` takes `cursor`, `page_size` and `ordering` (by `name` or `createdAt`) instead of `pageIndex`, `sort` and `direction`, and returns `items`, `ancestors`, `nextCursor`, `hasMore`, `pageSize` and `ordering`. `hash_lists.list(cursor, page_size)` returns a `HashListPage`. `events.list`, `iter_pages` and `iter` take `cursor` and `page_size` instead of `after` and `limit`, and pages return `items` and `nextCursor` instead of `events` and `cursor`. An unreadable events cursor is `validation/invalid-cursor`. `MockCalmLensServerClient` implements `assets.decide` with the API's validation and the new list shapes.
