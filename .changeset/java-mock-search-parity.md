---
"@calmlens/sdk-java": patch
---

`MockCalmLensServerClient` `assets.search` matches every word of the query in any searchable field and returns the API's keyword scores, matched fields and ranking. Mock list filters accept parentheses, with `;` binding tighter than `,`. The default mock clock gives assets created in a row increasing `createdAt`, so lists, cursors and search order them predictably. `CalmLensException.isRetryable()` follows from the code and status whichever exception class carries them: the `sdk/timeout` that `assets.waitForDecision` throws at its deadline is now retryable, like `sdk/transport-error`, `idempotency/request-in-progress` and `429`, `502`, `503` and `504`.
