---
"@calmlens/sdk-ruby": minor
---

Assets can now have the moderation status `limited`, set by the new `limit` policy action, and reviewers can decide `limited`. A `limited` asset is delivered exactly like an `allowed` one, from the same URL; it is marked so your app can reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it lower or collapsing it. The new `asset.limited` event reports the decision. `CalmLens::MockServerClient` accepts `limited` as a `queued_outcome:`, `analyzed_outcome:` and `decide` decision, and its CDN serves limited assets like allowed ones.
