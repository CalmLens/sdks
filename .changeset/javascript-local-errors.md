---
"@calmlens/sdk": minor
---

Errors raised by the SDK itself, with no HTTP response, report `error.isLocal()` as `true`. That covers invalid arguments and options, content checked before it is sent (such as `upload/unsupported-type` for an unsupported type), timeouts, cancellations and connection failures. They carry the code the API would use, with no `status` or `requestId`, so branch on `code`.

`MockCalmLensServerClient`'s `assets.waitForDecision` accepts `signal`, as the real client does, and stops with `sdk/cancelled` when it aborts. `withRequestOptions` on a mock client keeps answering from the in-memory API.

`json-schema-to-ts` is no longer installed with the package; it was only used to build it.
