---
"@calmlens/sdk-php": minor
---

Exceptions raised by the SDK itself, with no HTTP response, report `isLocal()` as `true`. That covers invalid arguments and options, content checked before it is sent (such as `upload/unsupported-type` for an unsupported type), timeouts and connection failures. They carry the code the API would use, with `status` and `requestId` null, so branch on `errorCode`.

The Packagist page shows the PHP SDK's own README.
