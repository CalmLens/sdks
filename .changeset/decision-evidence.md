---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-php": minor
---

An asset's `classification.moderation` names the policy that made the automated decision (`policy`: its `id`, its `revision` then and the `preset` release it used) and says when a human review is waiting (`pendingReview`: `requestedAt`, `reason` and `uncertainCategories`, `null` when none is waiting). A category's allowance or restriction `source` carries the `conditionScore` that triggered its rules, since a rule assessed as a whole can leave its qualifiers out of `raw`. A document or website decided by its parts lists the categories that decided it in `flaggedCategories`. The mocks keep no policies or review queue, so both new fields stay `null` in them.
