---
"@calmlens/sdk-go": minor
---

Adds the `limited` moderation status (`ModerationStatusLimited`, `ModerationDecisionLimited`), the `limit` policy action (`ModerationActionLimit`) and the `asset.limited` event (`EventAssetLimited`, with the same `AssetDecisionFacts` as the other decision events). A limited asset is delivered exactly like an allowed one, from the same URL, but is marked so your app can reduce its reach: keep it out of recommendations, trending and notifications, rank it lower or collapse it behind a "show" control. The mock accepts `calmlenstest.OutcomeLimited` for `QueuedOutcome`, `AnalyzedOutcome` and `Decide`, and its CDN serves limited assets like allowed ones.
