---
"@calmlens/sdk-python": minor
---

The mock matches CalmLens in more places. A private asset fetched with `fetch_cdn`, without a grant or the API key, returns `404 asset/not-found` whatever its state. Each result in `classification.moderation.categories` includes `settings` and `source`. API-key uploads naming `uploadPresetId` take the preset's visibility, folder and processing options, keep to its type and size limits, and are refused for an unknown or paused preset or a visibility or folder that differs from the preset's. `mock_decision(status).pending_review(reason, uncertain_categories)` leaves a decision waiting for human review; `decide` clears it and `assets.decide` leaves it.

`text.classify` takes `upload_preset_id`. `active` is optional in lens definitions and defaults to true, also in the mock. The `germany` test input preset has no category instances and an explicit block in Germany; the `hate.regional-symbol` signal still sends a hate-symbol instance. An API key that can't be sent in a header, one with spaces or line breaks, now fails with `sdk/invalid-config` when the client is created.
