---
"@calmlens/sdk-go": minor
---

The Go SDK now behaves like the other CalmLens SDKs in every shared contract case.

- Requests send `Accept: application/json` (API calls) and `User-Agent: calmlens-go/<version> (go/<Go version>)`.
- Retries wait between half and all of the exponential backoff, honour `Retry-After` in seconds or as an HTTP date (`0` retries at once), and `CDN.Serve` retries like an API read, returning the last response when retries run out. Redirects fail with `sdk/http-error` and the redirect's status, also from `CDN.Serve`.
- `Error.RetryAfter` is a `*time.Duration`, nil without a `Retry-After` header. Transport failures have no `Details`, and API errors no longer add `network: true`.
- `Options.UploadTimeout` bounds binary uploads (none by default); `Options.Timeout` now covers text uploads and URL submissions, and `CDN.Serve` until its headers arrive. A declared `Content-Length` over `MaxResponseBytes` fails before the body is read, and an upload answered with something other than an asset fails with `sdk/invalid-response`.
- `client.WithRequestOptions(calmlens.RequestOptions{...})` returns a client with other deadlines or retries that shares the credentials and lens cache.
- `WaitForDecisionOptions.Timeout` is a `*time.Duration`: nil waits the default 60 seconds and zero checks once. `ListFoldersOptions.SearchAll` and `ResolveOnly` are `*bool`, so an explicit `false` is sent.
- Iterators fail with `sdk/invalid-response` (`Details["cursor"]`) when a page that says more follow repeats a cursor, and event pages with more to follow continue past empty pages. `EventIterator.NextPage` and `Page` read the feed a page at a time.
- Webhooks: `VerifyWebhookHeaders` verifies against an `http.Header`; header names match in any case and repeated signature headers are joined; `WithTolerance(0)` accepts only the signing second; parsing checks the API's event shape and keeps the whole body in `WebhookEventPayload.Raw`, which `ToWebhookEventPayload` also fills. Upload tokens encode claims exactly as the server does.
- `calmlenstest` adds `FailNextRequest`, `SetAPIKeyGrants` and `SignUploadToken`, and `EnqueueEvent` returns the stored events. The mock answers schema errors with `validation/<issue>` and `details.path`, scopes cursors to their query, records `asset.retried`, `asset.content-removed` and `asset.deleted` events, serves a ThumbHash placeholder PNG and the CDN's cache and protection headers, checks multipart image totals, multipart part sizes, idempotency key rules, lens versions and folder rules like the API. It reads an idempotency key without surrounding whitespace, as HTTP sends it.
