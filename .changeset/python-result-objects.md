---
"@calmlens/sdk-python": minor
---

Results are now typed objects read through snake_case attributes, such as
`asset.classification.moderation.decision` and `page.next_cursor`, instead of dicts with the API's
camelCase keys. `asset["externalId"]` still reads a field by its API name, `"externalId" in asset`
tells whether the API sent it, fields added in newer API versions stay readable, and `to_dict()`
returns the API's JSON. Every result has `last_response` with the response's `status`, `headers`,
`request_id` and the request's `idempotency_key`.

Methods take keyword arguments only: pass `client.assets.retrieve(asset_id=...)` rather than an
options dict, and use snake_case keys in dict options too, such as
`processing_options={"retain_content": True}`. Options the API requires are required arguments.
Pass the idempotency key and other per-call settings as `options`, such as
`options={"idempotency_key": "...", "timeout": 10, "max_retries": 0}`, which also takes `headers`,
`extra_query` and `extra_body`.

Lists return a page you can iterate and `len()`, with `auto_paging_iter()` for its items and every
page after it. `client.request(...)` sends a request this SDK version has no method for, with your API
key, retries and errors.

`AsyncCalmLensServerClient` has the same methods, awaitable, with `async for` iterators and
`async with` CDN downloads. It needs no extra packages. Cancelling the task awaiting a call raises
`CalmLensCancelledError`, which is also an `asyncio.CancelledError`, and the call isn't retried.

Errors have a class for each kind of failure: `CalmLensBadRequestError`,
`CalmLensAuthenticationError`, `CalmLensPermissionDeniedError`, `CalmLensNotFoundError`,
`CalmLensConflictError`, `CalmLensPayloadTooLargeError`, `CalmLensUnprocessableEntityError`,
`CalmLensRateLimitError` and `CalmLensServerError` under `CalmLensAPIError`, and
`CalmLensConnectionError`, `CalmLensTimeoutError`, `CalmLensCancelledError`,
`CalmLensInvalidArgumentError` (with `CalmLensConfigurationError`),
`CalmLensInvalidResponseError` and `CalmLensWebhookVerificationError`. They replace
`CalmLensTransportError`, `CalmLensValidationError` and `WebhookVerificationError`. API errors keep
the response body as `body`, so a proxy's error page isn't lost.

The client reads `CALMLENS_BASE_URL`, and takes `app_info`, `default_headers`, `ssl_context`, `proxy`,
`logger` and an `on_attempt` hook. `CALMLENS_LOG=info` or `debug` logs requests, never with your API
key or bodies. A custom `transport` now receives a `TransportRequest` (`method`, `url`, `headers`,
`body`) instead of a `urllib.request.Request`.
