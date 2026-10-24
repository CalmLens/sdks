---
"@calmlens/sdk-ruby": patch
---

`MockServerClient.assets.search` matches every word of the query in any searchable field and returns the API's keyword scores, matched fields and ranking. Mock list filters accept parentheses, with `;` binding tighter than `,`. The default mock clock gives assets created in a row increasing `createdAt`, so lists, cursors and search order them predictably. `CalmLens::Error#retryable?` is true for `sdk/transport-error`, `sdk/timeout` and `idempotency/request-in-progress` whichever error class carries them, and for `429`, `502`, `503` and `504`.
