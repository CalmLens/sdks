---
"@calmlens/sdk-php": minor
---

`MockServerClient` answers more like production. Fetching a private asset with neither the API key nor a signed URL (`fetchCdn`) gives 404 `asset/not-found` whatever the asset's state, except its placeholder and `info`. Each result in `classification.moderation.categories` has its `source` and `settings`. An API-key upload naming `uploadPresetId` applies the preset from `uploadPresets->ensure`: its folder, visibility and processing options (unless the upload sets its own), with `upload-preset/not-found`, `upload-preset/disabled`, `upload-preset/field-not-allowed`, `upload/unsupported-type` and `upload/too-large` when it can't. Name a preset the mock knows, by ensuring it first.

`MockDecision` adds `pendingReview($reason, $uncertainCategories)`, which leaves a decision waiting for human review in `classification.moderation.pendingReview`. `$mock->decide()` clears it and `assets->decide()` leaves it.

A lens's `active` is optional: `ensureLens`, `ensureLenses` and `lenses->create` default it to `true`, `lenses->update` leaves it unchanged when left out, and the client's lens cache treats a definition without it and one with `true` as the same.

`TestInputs::PRESETS['germany']` is now `['regionalActions' => [['region' => 'DE', 'action' => 'block']], 'instances' => []]`. The `hate.regional-symbol` signal still stands for the hate instance with qualifiers `hate-symbol` and `hate-nazi-symbols-public-display`.

Test input keys no longer appear in stack traces: `TestInputs::generateTestTextCode`, `paintTestImage` and `generateMediaTestCode` mark them with `#[\SensitiveParameter]`.
