---
"@calmlens/sdk": minor
---

`MockCalmLensServerClient`'s `projectId` is optional and defaults to `project-1`, and a `MockCalmLensAppClient` that creates its own server uses `project-1` too. `failNextRequest` throws `sdk/invalid-argument` for an `operation` the client doesn't have, and for `details` or `retryAfter` with a transport error or timeout, which they don't apply to.
