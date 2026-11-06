---
"@calmlens/sdk-java": minor
---

Every list pages and sorts the same way, policies are an organisation resource, and lenses can be managed one by one.

- List options take `sort(String)`, a comma-separated list of fields descending when prefixed with `-` (such as `"-createdAt,id"`), in place of `ordering(...)` and `Models.Order`, and every page record has `items()`, `nextCursor()` and `hasMore()` only (`FolderPage` also has `ancestors()`). `ListAssets` filters by folder through `filter("folderId==fldr_…")` and no longer has `folderId(...)`; `SearchAssets` takes `pageSize(...)` in place of `limit(...)`.
- Every list has an iterator: `folders.iterate`, `hashLists.iterate`, `hashLists.iterateEntries`, `policies.iterate`, `lenses.iterate` and `assets.iterateTimeline`, beside `assets.iterate` and `assets.iterateChildren`.
- Policies are read and changed by ID for the API key's organisation: `policies.list` returns a `PolicyPage`, `policies.retrieveAssigned()` returns the project's policy, and `policies.reset(ResetPolicy)` and `policies.upgrade(UpgradePolicy)` replace `policies.applyPreset`. A policy's `preset().mode()` (`live`, `pinned` or `copy`) replaces `preset().own()` and `automaticUpdates()`. Policy settings define every category with its `action`, `allowances` and `restrictions`, and rules no longer have `match`; a decision report's category settings name the default action `action()`.
- `lenses.list`, `lenses.iterate`, `lenses.create`, `lenses.retrieve`, `lenses.update` and `lenses.delete` manage a project's lenses. Lenses have no `version`: `LensDefinition` no longer takes one, and `ensureLens` and `ensureLenses` change a lens to the definition sent, and the CDN serves the new definition. `ErrorCodes.LENS_NOT_FOUND` and `ErrorCodes.LENS_IDENTIFIER_TAKEN` replace `ErrorCodes.LENS_VERSION_CONFLICT`.
- Uploads send `wait` in place of `queue`; `UploadPart.wait(Boolean)` overrides the choice saved when the upload started. `SignUploadToken` takes `expiresIn(...)` in place of `expiresInSeconds(...)`.
- Assets list `tags` and `metadata` as empty lists and always have a `visibility`; moderation fields are null until moderation decides, `raw().hashMatches()` is always a list, OCR's text regions are `classification().ocr()` (an `OcrResult`), and feature results no longer have `stage()`.
- `CalmLensServerClient.getEventFact(event, key)` and `CalmLensServerClient.getEventFacts(event)` read an event's facts.
- `MockCalmLensServerClient` follows all of these.
