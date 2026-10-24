---
"@calmlens/sdk": minor
---

Assets can now have the moderation status `limited`, decided by the new `limit` policy action. A limited asset is delivered exactly like an allowed one, from the same public URL, but is marked so your app can reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it lower or collapsing it. The new `asset.limited` event reports it. `<CalmLensMedia>` shows limited media like allowed media, and `MockCalmLensServerClient` accepts `limited` for `queuedOutcome`, `analyzedOutcome` and `decide`, serving it from the mock CDN like an allowed asset.
