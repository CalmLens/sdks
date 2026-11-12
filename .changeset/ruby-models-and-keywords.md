---
"@calmlens/sdk-ruby": minor
---

Results are now read-only objects with snake_case readers, such as
`asset.classification.moderation.decision`, instead of Hashes with camelCase keys. Read a field
by name with `asset[:external_id]` or `asset['externalId']`, a path with `dig`, the API's JSON
with `to_h`, and match results with `case asset in {classification: {moderation: {decision:}}}`.
Fields CalmLens adds later are kept and returned by `[]` and `to_h`. Every result has
`last_response` with the response's `status`, `headers` and `request_id`. Webhook deliveries
parse to `CalmLens::Event`, the same class as `events.list` items, in place of
`CalmLens::WebhookEvent`; read the whole body with `to_h`.

Methods take the ID they act on as their first argument and their other options as snake_case
keywords: `client.assets.retrieve(asset_id)`, `client.assets.update(asset_id, name: 'Beach')`.
camelCase and String option names at the top level are refused like misspelt ones.

Lists return a page you can enumerate, with `next_page?`, `next_page`, `each_page` and
`auto_paging_each`, which fetches the following pages with the same options. They replace
`assets.each`, `assets.each_child`, `assets.each_timeline_segment`, `folders.each`,
`hash_lists.each`, `hash_lists.each_entry`, `policies.each`, `lenses.each`, `upload_presets.each`,
`events.each` and `events.each_page`.

Errors: HTTP 413 raises `CalmLens::PayloadTooLargeError` and 422 raises
`CalmLens::UnprocessableEntityError`. API errors keep the response `body` as received, and their
`http_method` and `url`. `CalmLens::TimeoutError` is now a direct subclass of `CalmLens::Error`
rather than of `ConnectionError`, and `CalmLens::CancelledError` (`sdk/cancelled`) is added.
Error messages no longer start with `[calmlens]`.

The client reads `CALMLENS_API_KEY`, `CALMLENS_PROJECT_ID` and `CALMLENS_BASE_URL` when you
don't pass them, adds `app_info: {name:, version:, url:}` to its user agent, and takes
`max_retry_delay:` for the longest wait between retries. `request_options:` also takes
`headers`, `extra_query` and `extra_body`, and `client.request(method, path, ...)` calls an
endpoint this version has no method for. Set `CALMLENS_LOG=info` or pass `logger:` to log each
request, and `on_request:` to receive each attempt for metrics.

The signatures match what the API sends and accepts: category names, regions, policy preset IDs,
adaptive stream status and reason, opt-out jurisdictions, event fact keys and qualifier names are
literal unions, and `classification_category` includes `personal-information` and `profanity`.

Ruby 3.3 or later is now required.
