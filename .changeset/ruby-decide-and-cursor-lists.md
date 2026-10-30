---
"@calmlens/sdk-ruby": minor
---

Adds `assets.decide(asset_id: ..., decision: ..., note: ...)`, with `confirm_purge: true` for purges, which records a reviewer's decision with a note and returns the asset. Every list now pages with cursors: `folders.list` takes `cursor`, `page_size` and `ordering` (by `name` or `createdAt`) instead of `page_index`, `sort` and `direction`, and returns `items`, `ancestors`, `nextCursor`, `hasMore`, `pageSize` and `ordering`. `hash_lists.list` takes `cursor` and `page_size` and returns one page. `events.list` and `each_page` take `cursor` and `page_size` instead of `after` and `limit`, and pages return `items` and `nextCursor` instead of `events` and `cursor`. An unreadable events cursor is `validation/invalid-cursor`. The testing client implements `assets.decide` with the API's validation and the new list shapes.
