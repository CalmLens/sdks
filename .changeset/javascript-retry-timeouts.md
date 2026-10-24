---
"@calmlens/sdk": patch
---

Timeouts are retried like network failures: reads, and creates and uploads with an `Idempotency-Key`, are sent again after `sdk/timeout`, up to `maxRetries`. `error.isRetryable()` is now true for `sdk/timeout`, including `waitForDecision`'s deadline, and stays false for `sdk/cancelled`.

`MockCalmLensServerClient` now behaves more like the API: `assets.search` runs the API's keyword search, with every word matched against the name, ID, external ID, description, tags, type, content format or extension and moderation status, and returns the API's scores and `matchedFields`; `assets.list` filters accept parentheses; and assets created in a row get increasing `createdAt` values.
