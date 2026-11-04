---
"@calmlens/sdk-python": minor
---

`MockCalmLensServerClient` uses the project ID `project-1`, available as `calmlens.testing.MOCK_PROJECT_ID`, when you don't pass `project_id`. `fail_next_request` raises `sdk/invalid-argument` for `details` or `retry_after` with `"transport-error"`, `"timeout"` or an exception, which they don't apply to.
