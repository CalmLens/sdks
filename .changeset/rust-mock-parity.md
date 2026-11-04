---
"@calmlens/sdk-rust": minor
---

`MockServerClient::in_memory` now uses project `project-1` by default, the same as `MockServerClient::new()`. `fail_next_request` returns `sdk/invalid-argument`, and queues nothing, for `details` or `retry_after` with a transport error or timeout, which they don't apply to. `MockFailureOptions::details` is now an `Option`, so options that set no details can be told apart from empty details.
