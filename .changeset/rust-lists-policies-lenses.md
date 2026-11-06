---
"@calmlens/sdk-rust": minor
---

Every list pages and sorts the same way, policies are an organisation resource, and lenses can be managed one by one.

- List options take `sort`, a comma-separated list of fields descending when prefixed with `-` (such as `"-createdAt,id"`), in place of `ordering`, and every page has `items`, `next_cursor` and `has_more` (folder pages also have `ancestors`). `Order` and `SortDirection` are removed. `ListAssets` filters by folder through `filter` (`folderId==fldr_…`) and no longer has `folder_id`; `SearchAssets` takes `page_size` in place of `limit`.
- Every list has an iterator: `folders().iterate`, `hash_lists().iterate`, `hash_lists().iterate_entries`, `policies().iterate`, `lenses().iterate` and `assets().iterate_timeline`, beside `assets().iterate` and `assets().iterate_children`, in the async and blocking clients.
- Policies are read and changed by ID for the API key's organisation: `policies().list(ListPolicies)` returns a `PolicyPage` in place of `PolicyList`, `policies().retrieve_assigned()` returns the project's policy, and `policies().reset(ResetPolicy)` and `policies().upgrade(UpgradePolicy)` replace `apply_preset`. A policy's `preset.mode` (`PolicyPresetMode::Live`, `Pinned` or `Copy`) replaces `preset.own` and `automatic_updates`. `CategoryPolicySettings` has a required `action` and `allowances` and `restrictions` lists, settings define every category, and rules no longer have `match`. A decision's per-category settings snapshot names its default action `action`.
- `lenses().list`, `lenses().iterate`, `lenses().create`, `lenses().retrieve`, `lenses().update` and `lenses().delete` manage a project's lenses. `Lens` and `LensDefinition` have no `version`: `ensure_lens` and `ensure_lenses` change a lens to the definition sent, and the CDN serves the new definition. `ErrorCode::LensVersionConflict` is removed; `LensNotFound` and `LensIdentifierTaken` are added.
- Uploads send `wait` in place of `queue`; `UploadPart` takes `wait` to override the choice saved when the upload started. `SignUploadToken` takes `expires_in` in place of `expires_in_seconds`.
- `Asset::tags` and `Asset::metadata` are lists, empty when there are none, and `Asset::visibility` is always set; moderation fields are `None` until moderation decides, `raw.hash_matches` is always a list, OCR's text regions are in `classification.ocr` (`OcrResult`) in place of `classification.text_regions`, and feature results no longer have `stage` (`FeatureStage` is removed).
- `get_event_fact(&event, key)` and `get_event_facts(&event)` read the facts of an `Event` or `WebhookEventPayload`.
- `MockServerClient` follows all of these.
