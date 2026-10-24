---
"@calmlens/sdk-rust": minor
---

The client now matches the other CalmLens SDKs request for request:

- API calls have a 120-second timeout by default, and binary uploads have none unless you set `upload_timeout`; text uploads keep the API timeout, and `cdn().serve`'s timeout ends when the response headers arrive. `max_response_bytes` (32 MiB by default) limits API response bodies, checking a declared `Content-Length` before reading. The defaults are exported as constants.
- Retries wait half the backoff plus a random part of it, honour `Retry-After` given as an HTTP date, and retry a `Retry-After: 0` at once. Redirects fail with `sdk/http-error`, `cdn().serve` included, and `cdn().serve` returns the last response once its retries run out.
- `assets().iterate`, `assets().iterate_children` and `events().pages` fail with `sdk/invalid-response`, naming the `cursor`, instead of repeating pages when a page hands back a cursor they already sent.
- Concurrent `ensure_lenses` calls for the same definitions send them once.
- `Content::unsized_stream` uploads a stream of unknown length. Later multipart parts are sent without a `Content-Type`.
- `construct_webhook_event` reads repeated signature headers joined, and parsing requires a string `projectId`, a numeric `createdAt` and the API's types for known fields. `WebhookEventPayload::json()` returns the body as received, `WebhookEventPayload::is_test()` tells test sends apart, `verify_webhook_headers` verifies from an `http::HeaderMap`, and `EventAsset` keeps every snapshot field behind accessors such as `moderation_status()`.
- Transport errors no longer carry a `network` detail, API calls send `Accept: application/json`, and the `User-Agent` is `calmlens-rust/<version> (rustc/<compiler version>)`.
- The mock follows the API more closely: validation errors with the field's `path`, scoped list cursors, `asset.retried`, `asset.content-removed` and `asset.deleted` events, ThumbHash placeholders and the CDN's headers (byte ranges are gone, as the CDN has none), multipart and idempotency-key rules (a key is read without surrounding whitespace, as HTTP sends it), folder and lens error details, and lenses saved in order. Captured requests show the API key sent. `fail_next_request`, `set_api_key_grants`, `queued_outcome_for`/`analyzed_outcome_for`, `enqueue_hang`, `sleeps()` and `testing::sign_upload_token` for exact test tokens are new.
