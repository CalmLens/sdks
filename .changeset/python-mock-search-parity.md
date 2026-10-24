---
"@calmlens/sdk-python": patch
---

`CalmLensError.is_retryable` now depends only on the error's `code` and `status`, so every error class agrees: the `sdk/timeout` that `assets.wait_for_decision` raises is now retryable. `MockCalmLensServerClient` search works like the API's keyword search: every word of the query must appear in a searchable field, `matchedFields` and `score` follow the API, and results are ranked by score, then newest first. Mock list filters accept parentheses for grouping, with `;` binding tighter than `,`. The mock's default clock moves on by at least a millisecond per reading, so assets created in a row have increasing `createdAt` values.
