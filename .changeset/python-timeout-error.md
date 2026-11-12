---
"@calmlens/sdk-python": minor
---

`wait_for_decision` now raises `CalmLensTimeoutError` when its deadline passes, the same class as a
request timeout, so one `except CalmLensTimeoutError` handles both. `CalmLensTimeoutError` now
subclasses `CalmLensError` directly instead of `CalmLensTransportError`.
