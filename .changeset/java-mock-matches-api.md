---
"@calmlens/sdk-java": minor
---

`MockCalmLensServerClient` now answers as production does on more points, and the client and models follow the API's latest defaults:

- `mock.fetchCdn` of a private asset without a grant answers 404 `asset/not-found` whatever the asset's state, for every resource but its placeholder and `/info`. `cdn.serve` with the API key is unchanged.
- Each `classification.moderation.categories` result from a mock decision reports its `source` and `settings`.
- An API-key upload naming an `uploadPresetId` takes the upload preset stored by `uploadPresets.ensure`: its folder, visibility and, unless the upload sets its own, processing options. It fails with `upload-preset/not-found`, `upload-preset/disabled`, `upload-preset/field-not-allowed`, or `upload/unsupported-type` and `upload/too-large` with `source: "preset"`, so tests must ensure a preset before naming it.
- `MockDecision.pendingReview(reason)` and `pendingReview(reason, uncertainCategories)` leave a decision waiting for human review. `mock.decide` clears it and `assets.decide` leaves it.
- A lens's `active` is optional and defaults to true: `new LensDefinition(identifier, name, lensType)` sends none, and `lenses.update` without it leaves the lens as it is.
- `TestInputs.GERMANY` is now no findings with a `DE` block in `regionalActions`. The `hate.regional-symbol` signal keeps its hate instance.
- The client builder throws `sdk/invalid-config` for an API key that can't be sent in a header: one with spaces, line breaks or anything else outside printable ASCII. Other formats are left to the API.
