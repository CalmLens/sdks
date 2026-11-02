---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

Read `automatedAction`, `source`, `rule`, `flaggedCategories`, `regions` and policy-adjusted `categories` directly from `classification.moderation`. Detection findings move into `moderation.raw`, and `explanationComplete` replaces `policy.evidence`. Allowed automated actions are explicitly `allow`. The `policy` and `decision` wrappers and aggregate moderation scores are removed. Offline mock responses use the same structure. Go preserves the moderation response's complete JSON in `Extra`, reserving `Raw` for detection findings.
