---
"@calmlens/sdk": patch
---

Aborting a request's own `signal` now also cancels the wait before a retry, so the call fails with
`sdk/cancelled` at once instead of after the retry delay.
