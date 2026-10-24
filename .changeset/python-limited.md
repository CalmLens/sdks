---
"@calmlens/sdk-python": minor
---

Add the `limited` moderation status and reviewer decision, the `limit` policy action and the `asset.limited` event to `AssetModerationStatus`, `AssetModerationDecision`, `ModerationAction` and `EventType`. A limited asset is delivered exactly like an allowed one, from the same URLs, but is marked so your app can reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it lower or collapsing it. `MockCalmLensServerClient` accepts `limited` as a `queued_outcome`, `analyzed_outcome` and `decide` decision, serves limited assets from the CDN like allowed ones, and `decide(asset_id, "limited")` adds a low-severity `asset.limited` event.
