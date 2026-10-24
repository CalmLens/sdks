---
"@calmlens/sdk-java": minor
---

Add the `limited` moderation status and the `limit` policy action. A `limited` asset is delivered like an allowed one, from the same public URL, but is marked so your app can reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it lower or collapsing it. `AssetModerationStatus.LIMITED` and `AssetModerationDecision.LIMITED` represent it, decisions to limit an asset arrive as `asset.limited` events, and `assets.waitForDecision` returns once an asset is limited. `MockCalmLensServerClient.Outcome.LIMITED` sets the outcome in the mock, which serves limited assets like allowed ones, and `mock.decide(assetId, Outcome.LIMITED)` adds an `asset.limited` event with `low` severity.
