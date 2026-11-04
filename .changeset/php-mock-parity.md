---
"@calmlens/sdk-php": minor
---

The `moderate` callable's `MockModerationInput` holds the stored content in `content`, a `CalmLens\Testing\MockModerationContent` with `bytes` and `text`, in place of its own `bytes` and `text` properties. `MockTransport::client()` uses `project-1` by default, as `MockServerClient` does. `failNextRequest` throws `sdk/invalid-argument` for `details` or `retryAfter` with a transport error, a timeout or an exception, which they don't apply to, and for an `operation` the client doesn't have.
