---
"@calmlens/sdk-ruby": minor
---

`MockServerClient` now answers like production in more cases. `fetch_cdn` of a private asset without a grant returns `404` with `asset/not-found` whatever its state, except for its placeholder and info. Each `classification.moderation.categories` result carries `source` and `settings`. API-key uploads naming `upload_preset_id` take the stored preset's folder, visibility and processing options and keep to its limits, with `upload-preset/not-found`, `upload-preset/disabled`, `upload-preset/field-not-allowed`, `upload/unsupported-type` and `upload/too-large`. `fail_next_request` accepts `assets.decide`.

`MockDecision#pending_review(reason, uncertain_categories = [])` leaves a decision waiting for human review: `mock.decide` clears it and `assets.decide` leaves it.

A lens's `active` is optional and defaults to `true`. `lenses.update` without it leaves it unchanged, and `ensure_lens` treats an absent `active` as `true` when deciding whether a definition was already saved.

The `germany` test input preset is now `{'instances' => [], 'regionalActions' => [{'region' => 'DE', 'action' => 'block'}]}`, and the `hate.regional-symbol` signal keeps its hate instance. `ServerClient.new` raises `sdk/invalid-config` for an API key that can't be sent as a header and for an empty project ID, and leaves any other format for the API. A `Transport::Request` no longer shows its headers from `to_s` or `pp`.
