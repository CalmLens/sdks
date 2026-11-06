---
"@calmlens/sdk-ruby": minor
---

Every list pages and sorts the same way, policies are an organisation resource, and lenses can be managed one by one.

- List methods take `sort:`, a comma-separated list of fields descending when prefixed with `-` (such as `'-createdAt,id'`), in place of `ordering:`, and every page is `{'items', 'nextCursor', 'hasMore'}` (folders also return `ancestors`). `assets.list` filters by folder through `filter:` (`folderId==fldr_…`) and no longer takes `folder_id:`; `assets.search` takes `page_size:` in place of `limit:`.
- Every list has an iterator: `folders.each`, `hash_lists.each`, `hash_lists.each_entry`, `policies.each`, `lenses.each` and `assets.each_timeline_segment`, beside `assets.each` and `assets.each_child`. Without a block each returns an Enumerator.
- Policies are read and changed by ID for the API key's organisation: `policies.list` returns a page, `policies.retrieve_assigned` returns the project's policy, and `policies.reset` and `policies.upgrade` replace `policies.apply_preset`. A policy's `preset['mode']` (`live`, `pinned` or `copy`) replaces `preset['own']` and `automaticUpdates`. Policy settings define every category with its `action`, `allowances` and `restrictions`, and rules no longer have `match`.
- `client.lenses` manages a project's lenses: `list`, `each`, `create`, `retrieve`, `update` and `delete`. Lenses have no `version`: `ensure_lens` and `ensure_lenses` change a lens to the definition sent, and the CDN serves the new definition.
- Uploads send `wait` in place of `queue`; `assets.upload_part` takes `wait:` to override the choice saved when the upload started. `upload_tokens.sign` takes `expires_in:` in place of `expires_in_seconds:`.
- Assets list `tags` and `metadata` as empty lists and `visibility` always; moderation fields are `nil` until moderation decides, `raw['hashMatches']` is always a list, OCR's text regions are `classification['ocr']`, and feature results no longer include `stage`.
- `CalmLens.get_event_fact(event, key)` and `CalmLens.get_event_facts(event)` read an event's facts.
- The RBS signatures and `MockServerClient` follow all of these.
