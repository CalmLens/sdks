---
"@calmlens/sdk-python": minor
---

The Python SDK now behaves like the other CalmLens SDKs in every shared contract case.

- API requests send `Accept: application/json`, and every request `User-Agent: calmlens-python/<version> (<implementation>/<Python version>)`. The default `timeout` is 120 seconds.
- `upload_timeout` sets the timeout of binary uploads and `max_response_bytes` the largest response body read (default 32 MiB); `with_options` accepts both. A declared `Content-Length` over the limit fails before the body is read, and an upload answered with something other than an asset raises `sdk/invalid-response`.
- Retries wait between half and all of the exponential backoff and honour `Retry-After` in whole seconds or as an HTTP date (`0` retries at once). `cdn.serve` retries network failures, timeouts and 429, 502, 503 and 504, returning the last response once retries run out. A redirect raises `sdk/http-error` with its status and is never followed or retried, from `cdn.serve` too.
- API errors no longer add `network: True` to `details`. An empty successful response to anything but a delete raises `sdk/invalid-response`.
- A non-seekable stream without `sizeInBytes` is uploaded with chunked encoding instead of being refused.
- `assets.iter`, `assets.iter_children` and `events.iter_pages` raise `sdk/invalid-response` (`details["cursor"]`) when a page that says more follow repeats a cursor, and event pages with more to follow continue past empty pages.
- Webhooks: header names match in any case and repeated signature headers are joined, including from `email.message.Message`, `http.client.HTTPMessage` and Werkzeug headers. `parse_webhook_event` checks the API's event shape and keeps unknown fields. `is_test_webhook_event` tells test sends from real events. Upload tokens encode claims exactly as the server does.
- `calmlens.testing` adds `sign_upload_token`, `MockCalmLensServerClient.fail_next_request` and `set_api_key_grants`, and outcomes that are functions of the asset. The mock answers schema errors with `validation/<issue>` and `details["path"]`, scopes list cursors to their query, uses positional event cursors, records `asset.retried`, `asset.content-removed` and `asset.deleted` events, purges with reason `requested` for reviewers, serves a ThumbHash placeholder PNG and the CDN's cache and protection headers, and checks multipart image totals, idempotency key rules, lens versions and folder rules like the API. It reads an idempotency key without surrounding whitespace, as HTTP sends it.
