---
"@calmlens/sdk-rust": minor
---

Adds the `limited` moderation status and reviewer decision (`AssetModerationStatus::Limited`, `AssetModerationDecision::Limited`), the `limit` policy action (`FlaggedContentAction::Limit`) and the `asset.limited` event (`EventType::AssetLimited`). A limited asset is delivered like an allowed one, from the same URL, but marked so your app can reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it lower or collapsing it. The in-memory mock accepts `MockOutcome::Limited`, serves limited assets like allowed ones, and `decide` with `limited` adds an `asset.limited` event with `low` severity.
