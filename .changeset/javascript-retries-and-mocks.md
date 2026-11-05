---
"@calmlens/sdk": minor
---

Requests that fail with HTTP 500 (`misc/internal-error`) are retried like other transient errors, with the same backoff and idempotency keys; a 501 still isn't. The `asset/no-rendered-version` error code is available for a CDN request for a rendered version an asset doesn't have. The mock client signs viewer claims into signed URLs as the API does, gives an `asset.<status>` event the status it announces, and records an API key's decision with `decided-by` set to `api-key`. The mock app client takes a browser upload's `externalId` from its upload token, as the API does. `calmlens listen --help` describes the forwarded webhook body as it is sent, and `calmlens trigger` points to Project settings for the test input key.
