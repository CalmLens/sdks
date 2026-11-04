---
"@calmlens/sdk-ruby": minor
---

`CalmLens::MockServerClient#fail_next_request` raises `sdk/invalid-argument` when `details:` or `retry_after:` is given with `transport-error`, `timeout` or an exception, which they don't apply to. The mock's `project_id:` is documented as defaulting to `project-1`.
