---
"@calmlens/sdk-php": minor
---

Assets have a new moderation status, `limited`, decided by the new `limit` policy action, which ranks between `allow` and `age-restrict`. A limited asset is delivered exactly like an allowed one, from the same public URL without a signed URL or `allowAgeRestricted`; it is marked so your app can reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it lower or collapsing it. Webhooks and events add `asset.limited`, with the same facts as `asset.allowed`. `waitForDecision` treats `limited` as a decision, and `MockServerClient` accepts `limited` as an outcome and in `decide`, which adds an `asset.limited` event with severity `low`.
