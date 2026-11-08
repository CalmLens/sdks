---
"@calmlens/sdk-go": minor
---

Errors raised by the SDK itself, with no HTTP response, report `Local()` as true, and `calmlens.IsLocal(err)` checks any error. That covers invalid arguments and options, content checked before it is sent (such as `CodeUnsupportedUploadType` for an unsupported type), timeouts, cancellations and connection failures. They carry the code the API would use, with `Status` 0 and an empty `RequestID`, so branch on `Code`.
