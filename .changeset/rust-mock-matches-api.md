---
"@calmlens/sdk-rust": minor
---

`LensDefinition::active` is now `Option<bool>`, left out of the request when `None`: the API defaults it to `true`, and `ensure_lens` treats `None` and `Some(true)` as the same definition. This is a breaking change for code that sets `active: true`, which becomes `active: Some(true)`.

Building a client now fails with `sdk/invalid-config` for an API key that can't be sent as a header (spaces, line breaks or anything outside printable ASCII). Any other key format is left for the API to check.

`MockServerClient::in_memory` now matches production on these points:

- `fetch_cdn` of a private asset without a grant answers 404 `asset/not-found` whatever the asset's state, for every resource but its public placeholder. `cdn().serve` with the API key is unchanged.
- Each `classification.moderation.categories` result reports `source` and `settings`.
- An upload with an API key that names `upload_preset_id` takes the preset's folder, visibility and processing options, and is refused by its limits with `upload-preset/not-found`, `upload-preset/disabled`, `upload-preset/field-not-allowed`, `upload/unsupported-type` or `upload/too-large`. An upload that names a preset must now use one stored with `upload_presets().ensure`.
- A lens defined without `active` is stored as active.

`MockDecision::pending_review(reason, uncertain_categories)` leaves a decided asset waiting for human review. `mock.decide` clears it and `assets().decide` leaves it.

`TestInputPreset::Germany` now has no instances and blocks delivery in `DE`. The `hate.regional-symbol` signal still carries the hate instance. `MockServerClient`'s captured `Request` now leaves the API key out of its `Debug` output.
