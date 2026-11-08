---
"@calmlens/sdk": minor
---

The mock matches CalmLens in more places. A private asset fetched with `fetchCdn`, without a grant or the API key, returns `404 asset/not-found` whatever its state. Each result in `classification.moderation.categories` includes `settings` and `source`. API-key uploads naming `uploadPresetId` take the preset's visibility, folder and processing options, keep to its type and size limits, and are refused for an unknown or paused preset or a visibility or folder that differs from the preset's. `mockDecision(status).pendingReview(reason, uncertainCategories?)` leaves a decision waiting for human review; `decide` clears it and `assets.decide` leaves it.

`active` is optional in `ensureLens`, `ensureLenses` and `lenses.create`, and defaults to true. The `germany` test input preset has no category instances and an explicit block in Germany, as the testing guide describes; the `hate.regional-symbol` signal still sends a hate-symbol instance. An API key that can't be sent in a header, one with spaces or line breaks, now fails with `sdk/invalid-config` when the client is created.
