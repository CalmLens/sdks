---
"@calmlens/sdk-ruby": minor
---

The Ruby client now behaves like the other CalmLens SDKs:

- Retries wait 0.5 seconds and twice as long each time (up to 8 seconds), half of each wait random. A `Retry-After` in seconds or as an HTTP date replaces the wait, `0` retries at once and one over 60 seconds is returned instead of waited out. `cdn.serve` now retries like a read and returns the last response.
- A redirect fails with `sdk/http-error` and its 3xx status and is never followed or retried.
- New `upload_timeout:` and `max_response_bytes:` client and per-call options. A response whose `Content-Length` is over the limit fails with `sdk/response-too-large` before it is read.
- An empty or non-JSON successful response fails with `sdk/invalid-response`, as does an upload answered without an asset. Deletes return `nil` for an empty response.
- `Error#details` is the API's details with its `traceId`, or `nil` when there are none; it no longer carries `network`. `retry_after` is whole seconds.
- `assets.each`, `assets.each_child` and `events.each_page` raise `sdk/invalid-response` (with `details['cursor']`) when a page with more to follow repeats a cursor, instead of looping.
- Streams of unknown length, such as pipes, are uploaded with chunked transfer encoding; `size_in_bytes:` is no longer required.
- Identifiers in paths are encoded like `encodeURIComponent`, and the User-Agent is `calmlens-ruby/<version> (ruby/<version>)`.
- Idempotency keys are checked by the API, which accepts spaces inside a key.
- Concurrent `ensure_lens` calls for the same definition send it once, whatever the order of its keys.
- Webhooks: `CalmLens.verify_webhook_request` and `parse_webhook_event(headers:)` read the headers from a Hash (any case, repeated values joined), `Net::HTTPHeader` or a Rack env. Parsing checks the types of the known fields and keeps unknown top-level fields in `WebhookEvent#fields`; `WebhookEvent#to_payload` returns the whole body. `CalmLens.test_webhook_event?` recognises test sends.
- `MockServerClient` follows the API more closely: validation errors with `details['path']`, scoped list cursors, multipart and idempotency rules in the API's order (a key is read without surrounding whitespace, as HTTP sends it), lifecycle events, reviewer purges with reason `requested`, lens conflict details, folder-scoped grants, CDN cache and protection headers and a ThumbHash placeholder. New `fail_next_request`, `api_key_grants=` and `MockServerClient.sign_upload_token`.
