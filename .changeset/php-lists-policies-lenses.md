---
"@calmlens/sdk-php": minor
---

Every list pages and sorts the same way, policies are an organisation resource, and lenses can be managed one by one.

- List methods take `sort`, a comma-separated list of fields descending when prefixed with `-` (such as `'-createdAt,id'`), in place of `ordering`, and every page is `['items' => ..., 'nextCursor' => ..., 'hasMore' => ...]` (folders also return `ancestors`). `$client->assets->list` filters by folder through `filter` (`folderId==fldr_…`) and no longer takes `folderId`; `$client->assets->search` takes `pageSize` in place of `limit`.
- Every list has an iterator: `$client->folders->each`, `$client->hashLists->each`, `$client->hashLists->eachEntry`, `$client->policies->each`, `$client->lenses->each` and `$client->assets->eachTimelineSegment`, beside `$client->assets->each` and `$client->assets->eachChild`.
- Policies are read and changed by ID for the API key's organisation: `$client->policies->list` returns a page, `$client->policies->retrieveAssigned()` returns the project's policy, and `$client->policies->reset` and `$client->policies->upgrade` replace `$client->policies->applyPreset`. A policy's `preset['mode']` (`live`, `pinned` or `copy`) replaces `preset['own']` and `automaticUpdates`. Policy settings define every category with its `action`, `allowances` and `restrictions`, and rules no longer have `match`.
- `$client->lenses->list`, `each`, `create`, `retrieve`, `update` and `delete` manage a project's lenses. Lenses have no `version`: `$client->ensureLens` and `$client->ensureLenses` change a lens to the definition sent, and the CDN serves the new definition.
- Uploads send `wait` in place of `queue`; `$client->assets->uploadPart` takes `wait` to override the choice saved when the upload started. `$client->uploadTokens->sign` takes `expiresIn` in place of `expiresInSeconds`, and `UploadTokens::DEFAULT_EXPIRES_IN` and `UploadTokens::MAX_EXPIRES_IN` replace `DEFAULT_EXPIRES_IN_SECONDS` and `MAX_EXPIRES_IN_SECONDS`.
- Assets list `tags` and `metadata` as empty lists and `visibility` always; moderation fields are `null` until moderation decides, `raw['hashMatches']` is always a list, OCR's text regions are `classification['ocr']`, and feature results no longer include `stage`.
- `Webhooks::eventFact($event, $key)` and `Webhooks::eventFacts($event)` read an event's facts.
- `ErrorCodes::LENS_NOT_FOUND` (`lens/not-found`, HTTP 404) and `ErrorCodes::LENS_IDENTIFIER_TAKEN` (`lens/identifier-taken`, HTTP 409) are added, and `lens/version-conflict` is removed.
- `MockServerClient` follows all of these.
