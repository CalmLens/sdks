---
"@calmlens/sdk-java": minor
---

The client now matches the other CalmLens SDKs request for request:

- API requests have a 120-second deadline by default, and binary uploads have none unless you set `uploadTimeout`; text uploads keep the API deadline.
- `RequestOptions` takes `timeout`, `uploadTimeout` and `maxRetries` for one call, and `client.withRequestOptions(options)` returns a client whose every call uses them, sharing the connection and lens cache.
- Retries wait half the backoff plus a random part of it, honour `Retry-After` given as a date, and retry a `Retry-After: 0` at once. Redirects fail with `sdk/http-error`, `cdn.serve` included, and `cdn.serve` returns the last response once its retries run out.
- `assets.iterate`, `assets.iterateChildren` and `events.pages` fail with `sdk/invalid-response`, naming the `cursor`, instead of looping when a page hands back a cursor they already sent.
- Concurrent `ensureLenses` calls for the same new definitions share one request.
- `Content.stream(inputStream, mimeType)` uploads a stream of unknown size. Idempotency keys are checked by CalmLens, which answers with its own error codes.
- `verifyWebhookRequest` and `parseWebhookRequest` take the request's headers, in any letter case and with repeated headers joined. Parsing requires a numeric `createdAt` and the API's types for known fields, and `WebhookEventPayload.json()` and `Event.json()` keep fields this SDK version doesn't model. `isTestWebhookEvent` tells test sends apart.
- Transport errors no longer carry a `network` detail, and requests send `Accept: application/json` and `User-Agent: calmlens-java/<version> (java/<runtime version>)`.
- The mock follows the API more closely: validation errors with the field's `path`, scoped list cursors, `asset.retried`, `asset.content-removed` and `asset.deleted` events, ThumbHash placeholders and the CDN's headers, multipart and idempotency rules (a key is read without surrounding whitespace, as HTTP sends it), folder and lens error details, and lenses saved in order. `failNextRequest`, `setApiKeyGrants`, per-asset outcome functions and `MockCalmLensServerClient.signUploadToken` for exact test tokens are new.
