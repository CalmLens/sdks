---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

Assets have `classification.failureReason`, which says why processing failed while `classification.status` is `failed` (such as `duration-limit` or `unsupported-format`), and is `null` otherwise. The `asset.failed` event carries the same value in its `failure-reason` fact. The in-memory mocks give a failed asset `processing-error`. The JavaScript SDK exports the `AssetClassificationFailureReason` type.
