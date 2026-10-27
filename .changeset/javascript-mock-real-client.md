---
"@calmlens/sdk": minor
---

`MockCalmLensServerClient` and `MockCalmLensAppClient` now run the real `CalmLensServerClient` and `CalmLensAppClient` against an in-memory CalmLens API and CDN, so your tests exercise the client code your app runs. The mock server client is a `CalmLensServerClient` (`instanceof` holds), and every request gets the API's HTTP status, body, error body and `X-Request-Id`.

- `calls` and `callsTo(operation)` list the requests the client sent: each is `{ operation, method, url, path, query, headers, body, status }` instead of `{ operation, options }`. A request several methods send matches each of them in `callsTo`, so `callsTo("text.classify")` also lists text uploads through `assets.classify`, and `calls` records them as `assets.classify`. Methods that send no request, such as `uploadTokens.sign` and an `ensureLens` answered from the lens cache, are no longer recorded. The `MockCalmLensOperationOptions` type is removed, and `MockCalmLensCall` no longer takes a type parameter.
- `failNextRequest` fails the next request rather than the next method call, so options the client refuses before sending fail without using it. An `Error` that is not a `CalmLensError` now fails the request with `sdk/transport-error`, with the error as its `cause`, as an exception from `fetch` would; a `CalmLensError` is still thrown as is.
- Options the client checks before sending, such as a missing asset name or an unsupported MIME type, now fail as the real client fails them, without an HTTP status or request ID.
- `maxRetries` is accepted and defaults to 0; with retries on, the backoff takes no real time. `uploadTokens.sign` signs at `mockOptions.now` with a random nonce.
- `MockCalmLensAppClient` uploads get the preset's `uploadPresetId`, and `mockOptions.preset.folderId` is documented.
- `MockReviewDecision` is exported from `@calmlens/sdk/testing`.
