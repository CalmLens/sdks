---
"@calmlens/sdk-php": minor
---

Adds `assets->decide(['assetId' => ..., 'decision' => ..., 'note' => ...])`, with `'confirmPurge' => true` for purges, which records a reviewer's decision with a note and returns the asset. Every list now pages with cursors: `folders->list` takes `cursor`, `pageSize` and `ordering` (by `name` or `createdAt`) instead of `pageIndex`, `sort` and `direction`, and returns `items`, `ancestors`, `nextCursor`, `hasMore`, `pageSize` and `ordering`. `hashLists->list` takes `cursor` and `pageSize` and returns one page. `events->list` and `eachPage` take `cursor` and `pageSize` instead of `after` and `limit`, and pages return `items` and `nextCursor`. `ErrorCodes::INVALID_EVENT_CURSOR` is removed: an unreadable events cursor is `INVALID_CURSOR`. `MockServerClient` implements `assets->decide` with the API's validation and the new list shapes.
