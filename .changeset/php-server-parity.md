---
"@calmlens/sdk-php": minor
---

Errors now use typed classes in `CalmLens\Exception` (`NotFoundException`, `RateLimitException`, `ConnectionException`, `TimeoutException`, `InvalidArgumentException`, `ConfigurationException`, `WebhookVerificationException` and others), all extending `CalmLensException`. Exceptions carry `requestId`, the underlying exception in `getPrevious()`, and `retryAfter()`, `isNotFound()` and `header()` helpers. `CalmLens\ErrorCodes` lists the API's error codes with their HTTP statuses, and `CalmLens\SdkErrorCodes` the SDK's own. A response larger than 32 MiB now fails with `sdk/response-too-large`.

Webhooks gain `Webhooks::createHeaders` and `Webhooks::toPayload` for testing receivers, `SIGNATURE_TOLERANCE_SECONDS`, and a `headers` argument to `verify` and `parseEvent` that reads the signature and timestamp from request headers or `$_SERVER`.

`MockServerClient` now emulates folders, search, child listings, multipart uploads, idempotency keys and RSQL filters with `,`, wildcards and value lists. `failNextRequest` simulates connection failures, timeouts and API errors, `createApiKey` builds keys whose grants decide CDN downloads, `maxRetries` enables retries, and waits advance a virtual clock instead of sleeping.
