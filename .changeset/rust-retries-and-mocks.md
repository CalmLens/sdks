---
"@calmlens/sdk-rust": minor
---

Requests that fail with HTTP 500 (`misc/internal-error`) are retried like other transient errors, with the same backoff and idempotency keys; a 501 still isn't. The `asset/no-rendered-version` error code is available for a CDN request for a rendered version an asset doesn't have. The mock client signs viewer claims into signed URLs as the API does, gives an `asset.<status>` event the status it announces, and records an API key's decision with `decided-by` set to `api-key`. `Event`'s `event_type`, `created_at` and `project_id` are no longer optional, matching `WebhookEventPayload`, since the API always sends them. `ErrorCode` values compare by their code, so `ErrorCode::Other("misc/internal-error")` equals `ErrorCode::InternalError` and maps to HTTP 500.
