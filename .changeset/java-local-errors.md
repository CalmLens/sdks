---
"@calmlens/sdk-java": minor
---

Exceptions raised by the SDK itself, with no HTTP response, report `isLocal()` as `true`. That covers invalid arguments and options, content checked before it is sent (such as `ErrorCodes.UNSUPPORTED_UPLOAD_TYPE` for an unsupported type), timeouts, interruptions and connection failures. They carry the code the API would use, with `getStatus()` 0 and `getRequestId()` null, so branch on `getCode()`.
