---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
---

Breaking: an asset's moderation outcome is now `classification.moderation.status`: `pending`, then `allowed`, `age-restricted`, `blocked` or `purged`. It replaces `classification.moderation.decision` and `classification.moderation.action`, and filters use `classification.moderation.status`. Manual reviews record their `decision` as one of the four decided statuses and no longer have an `action`. Policy actions are `allow`, `age-restrict`, `block` and `purge`; `flag` is removed.

Webhook and event types `asset.flagged`, `asset.approved` and `asset.rejected` are replaced by `asset.classified` and one event per status: `asset.allowed`, `asset.age-restricted`, `asset.blocked` and `asset.purged`. Event asset snapshots carry `classification.moderation.status`, and the `moderation-action` and `review-action` facts are replaced by `moderation-status` and `decided-by`.

Waiting for a decision returns once the status is no longer `pending`. Mock clients take the new statuses as outcomes, and `purged` removes the content.

CDN URL builders take an `allowAgeRestricted` option that adds `allowAgeRestricted=true`, so a public age-restricted asset can be served from its public URL where your app has already decided the viewer may see it. Without it, age-restricted assets need a signed URL or an API key.
