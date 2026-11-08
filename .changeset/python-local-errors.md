---
"@calmlens/sdk-python": minor
---

Errors raised by the SDK itself, with no HTTP response, report `error.is_local` as `True`. That covers invalid arguments and options, content checked before it is sent (such as `upload/unsupported-type` for an unsupported type), timeouts and connection failures. They carry the code the API would use, with `status` and `request_id` set to `None`, so branch on `code`.
