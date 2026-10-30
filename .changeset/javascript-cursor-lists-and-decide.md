---
"@calmlens/sdk": minor
---

Add `assets.decide` to record a reviewer's decision (`allowed`, `limited`, `age-restricted`, `blocked` or `purged`) with a required note. Breaking: every list now uses cursor pages. `folders.list` takes `cursor`, `pageSize` and `ordering` instead of `pageIndex`, `sort` and `direction`, and returns `items` and `nextCursor` instead of `folders`. `hashLists.list` takes `cursor` and `pageSize` and returns a `HashListPage` (replacing `HashListList`). `events.list` and `events.pages` take `cursor` and `pageSize` instead of `after` and `limit`, and return `items` and `nextCursor` instead of `events` and `cursor`; an unreadable cursor fails with `validation/invalid-cursor`. `MockCalmLensServerClient` implements `assets.decide` and the new list shapes.
