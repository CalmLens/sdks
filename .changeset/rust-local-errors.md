---
"@calmlens/sdk-rust": minor
---

Errors raised by the SDK itself, with no HTTP response, report `error.is_local()` as `true`. That covers invalid arguments and options, content checked before it is sent (such as `ErrorCode::UnsupportedUploadType` for an unsupported type), timeouts and connection failures. They carry the code the API would use, with `status()` and `request_id()` returning `None`, so branch on `code()`.
