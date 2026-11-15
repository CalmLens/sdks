---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-php": minor
---

`assets.explain` is removed, with its `rerun` option, as the API no longer explains or re-runs a
decided asset's moderation: an asset keeps the one decision it is given. The
`asset.rerun-requested` event type and the `asset/not-decided`, `asset/policy-changed` and
`asset/reviewed` error codes are removed too. The mock clients no longer offer the `rerun`
moderation trigger, and `completeProcessing` finishes only an asset that is processing.
`classification.moderation.explanationComplete` is unchanged.
