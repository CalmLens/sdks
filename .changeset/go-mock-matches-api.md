---
"@calmlens/sdk-go": minor
---

`calmlenstest` now answers as CalmLens does on these points. `FetchCDN` of a private asset without a grant returns `404` `asset/not-found` whatever its state, except its public placeholder; `CDN.Serve` with the API key and public assets are unchanged. Each category in a decision report has `Source` and `Settings`. Uploads naming `UploadPresetID` apply the preset from `UploadPresets.Ensure`: its folder, visibility and processing options, and its `upload-preset/*`, `upload/unsupported-type` and `upload/too-large` refusals, so a test must ensure a preset before uploading through it. `Decision.PendingReview(reason, uncertainCategories...)` leaves a decision waiting for human review, which `mock.Decide` settles and `Assets.Decide` leaves waiting. `TestInputPresets().Germany` now only blocks in Germany, with no findings; `TestInputForSignal("hate.regional-symbol", ...)` keeps the hate finding.

`Active` on `EnsureLensOptions` and `CreateLensOptions` is now a `*bool`, and a lens without it is active. `Lens` no longer embeds `EnsureLensOptions`; it has the same fields, with `Active` a `bool`.

`NewServerClient` returns `sdk/invalid-config` for an API key that can't be sent as a header: anything but printable ASCII without spaces. `fmt` no longer prints a dereferenced `ServerClient`'s fields.
