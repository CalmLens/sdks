---
"@calmlens/sdk": minor
---

Every list pages and sorts the same way, policies are an organisation resource, and lenses can be managed one by one.

- List methods take `sort`, a comma-separated list of fields descending when prefixed with `-` (such as `"-createdAt,id"`), in place of `ordering`, and every page is `{ items, nextCursor, hasMore }` (folders also return `ancestors`). `assets.list` filters by folder through `filter` (`folderId==fldr_…`) and no longer takes `folderId`; `assets.search` takes `pageSize` in place of `limit`.
- Every list has an iterator: `folders.iterate`, `hashLists.iterate`, `hashLists.iterateEntries`, `policies.iterate`, `lenses.iterate` and `assets.iterateTimeline`, beside `assets.iterate` and `assets.iterateChildren`.
- Policies are read and changed by ID for the API key's organisation: `policies.list` returns a page, `policies.retrieveAssigned` returns the project's policy, and `policies.reset` and `policies.upgrade` replace `policies.applyPreset`. A policy's `preset.mode` (`live`, `pinned` or `copy`) replaces `preset.own` and `automaticUpdates`. Policy settings define every category with its `action`, `allowances` and `restrictions`, and rules no longer have `match`.
- `lenses.list`, `lenses.iterate`, `lenses.create`, `lenses.retrieve`, `lenses.update` and `lenses.delete` manage a project's lenses. Lenses have no `version`: `ensureLens` and `ensureLenses` change a lens to the definition sent, and the CDN serves the new definition.
- Uploads send `wait` in place of `queue`; `assets.uploadPart` takes `wait` to override the choice saved when the upload started. `uploadTokens.sign` takes `expiresIn` in place of `expiresInSeconds`.
- Assets list `tags` and `metadata` as empty lists and `visibility` always; moderation fields are `null` until moderation decides, `raw.hashMatches` is always a list, OCR's text regions are `classification.ocr`, and feature results no longer include `stage`.
- `getEventFact(event, key)` and `getEventFacts(event)` read an event's facts.
- The testing mock follows all of these.
