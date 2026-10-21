# CalmLens Ruby SDK

Ruby 3.1+ server-side client for CalmLens moderation, uploads, events, webhooks and CDN delivery. It uses only the standard library (Net::HTTP, JSON, OpenSSL). Calls accept keyword arguments in snake_case (or the API's camelCase); responses are Hashes with the API's camelCase string keys.

```ruby
require 'calmlens'
client = CalmLens::ServerClient.new(api_key: ENV.fetch('CALMLENS_API_KEY'), project_id: ENV.fetch('CALMLENS_PROJECT_ID'))
result = client.assets.classify(name: 'text', content: {plain_text: 'Hello world', type: 'text/plain'})
asset = client.assets.create(name: 'note.txt', content: {data: 'Hello', type: 'text/plain'})
client.close
```

Install from RubyGems: `gem install calmlens`, or add `gem "calmlens"` to your Gemfile. The gem has no runtime dependencies and ships YARD documentation and RBS signatures in `sig/` (see [Types](#types)).

Resources cover every API operation: assets create/classify/search/list/each/retrieve/wait_for_decision/update/retry/delete_content/delete/move/list_children/each_child/upload_part/create_signed_url; folders list/create/retrieve/update/move/delete; text moderation; events list/each/each_page; CDN URL building and serving; and `ensure_lens`/`ensure_lenses`. `CalmLens::VERSION` holds the gem version.

## Options

Every option name may be snake_case or camelCase, at any depth, so options added to the API later work without an SDK update (`processing_options: {features: {face_detection: {enabled: true, age_estimation: true}}}` is sent as `processingOptions.features.faceDetection.ageEstimation`). Keys inside `metadata` are yours and are sent unchanged.

Any method also accepts `request_options:`:

| Key | Meaning |
|---|---|
| `idempotency_key` | The `Idempotency-Key` for an upload. The SDK generates one when you omit it. |
| `timeout` | Seconds allowed for each socket read or write for this call. |
| `open_timeout` | Seconds allowed to open a connection for this call. |
| `max_retries` | Retries for this call (see below). |

## Types

`sig/` holds RBS signatures for every public method, with record types for each option Hash and response (in `sig/types.rbs`): `CalmLens::asset` (with `asset_classification`, `asset_moderation` and `asset_content`), `classification_report` (categories, qualifiers, labels, media segments and `features` results), `processing_options_input`, `folder`, `lens`, `event`, `events_page`, `asset_page`, `asset_search_response`, `signed_url`, `webhook_event_data` and the rest. Steep and other RBS tools check your calls and the response keys you read:

```ruby
asset = client.text.classify(text: 'Hello', processing_options: { features: { face_detection: { enabled: true } } })
asset['classification']['moderation']['decision']                                              # CalmLens::asset_moderation_status
asset.dig('moderation', 'report', 'features', 'faceDetection', 'faces')    # Array[CalmLens::detected_face]?
```

The signatures describe snake_case Symbol option keys; camelCase and String keys still work at runtime but are not typed. Results whose fields depend on `status` (category, qualifier and feature results) are typed as one record with those fields optional: check `status`, then read `score` or `reason`. `metadata` values and API error `details` are any JSON (`CalmLens::json_value`).

## Classification results

`assets.classify` and `text.classify` return the asset, whose state is in three parts:

- `upload`: receipt of source content, with `status` (`uploading` or `completed`), `updatedAt` and `partsReceived` for multipart uploads.
- `classification`: `status` (`pending`, `processing`, `completed` or `failed`), `updatedAt`, `completedAt`, optional `personDetection`, `faceDetection` and `labels`, and `moderation`. The moderation section contains `decision` (`pending`, `approved` or `rejected`), `action`, category scores, policy assessment, an optional `timeline` and reviewer details. A reviewer decision does not change `completedAt`.
- `content`: `status` is `temporary` (held until processing finishes), `stored` (kept with `keep_content_after_processing: true`) or `removed`, with `removalReason` (`policy`, `retention`, `requested`, `parent-removed` or `disposed`). It also holds `format` (MIME type), `extension`, `sizeInBytes`, `checksums`, `image`, `previewImage`, `extractedText` and `safetyHold`.

Publish only when `asset['classification']['moderation']['decision']` is `approved` and `asset['classification']['moderation']['action']` is nil. New statuses, visibilities and fields may appear in later API versions: the SDK returns them unchanged, so treat any value you do not recognise as not ready.

### Waiting for a decision

`assets.wait_for_decision` waits for a queued asset's decision and returns the asset once `classification.moderation.decision` is `approved` or `rejected`, or `classification.status` is `failed`. It retrieves the asset every few seconds and raises `CalmLens::TimeoutError` with code `sdk/timeout` if there's no decision within `timeout:` seconds (default 60); `details` holds `'assetId'` and the last `'classificationStatus'` and `'moderationStatus'`. Use it after `assets.create`, or with an asset ID you stored earlier. Webhooks report decisions without polling.

```ruby
queued = client.assets.create(name: 'photo.jpg', content: {data: File.open('photo.jpg', 'rb'), type: 'image/jpeg'})
decided = client.assets.wait_for_decision(asset_id: queued['id'], timeout: 30)
hide_photo(decided['id']) if decided['classification']['moderation']['decision'] == 'rejected'
```

`timeout:` covers the whole wait; `request_options: {timeout:}` still limits each request. The call only sleeps and sends requests, so you can stop it early by stopping its thread.

## Uploads and delivery

Content is `{type:, plain_text:}`, `{type:, base64:}` or `{type:, data:}`, where `data` is a binary String or an IO. An IO is streamed with a `Content-Length` and never read into memory; a File, Tempfile or StringIO knows its size, and other streams (pipes, sockets) need `size_in_bytes:`. A stream that ends early or holds more bytes than declared fails with `upload/invalid-payload`.

```ruby
File.open('video.mp4', 'rb') do |file|
  client.assets.create(name: 'video.mp4', content: {data: file, type: 'video/mp4'})
end
```

Multipart uploads start with `part:` on `create`/`classify` and continue with `upload_part`. The queue mode chosen at the start is saved with the upload, so later parts can come from another process; pass `queue:` to `upload_part` only to override it. Pass `total_size_in_bytes:` at the start when you know the file size. See [Multipart uploads](https://calmlens.com/docs/guides/multipart-uploads).

`cdn.serve` fetches content with the API key. With a block it yields a `CalmLens::Response` whose body streams; without one it returns the response with the body read. Error statuses are returned, not raised.

```ruby
File.open('photo.jpg', 'wb') do |file|
  client.cdn.serve(asset_identifier: asset_id) do |response|
    raise "CDN returned #{response.status}" unless response.success?
    response.each_chunk { |chunk| file.write(chunk) }
  end
end
```

Use `create_signed_url` to deliver private content to browsers without your key.

`cdn.get_asset_url`, `cdn.serve` and `create_signed_url` accept a `lens:`, a `transform:`, or both (the lens runs first). A transform is a selector string or structured steps (one Hash or an Array), serialized with sorted option keys:

```ruby
client.cdn.get_asset_url(asset_identifier: asset_id, transform: 'imageTransform[format=png,width=1024]')
client.cdn.get_asset_url(asset_identifier: asset_id, transform: {type: 'imageTransform', options: {width: 1024, format: 'png'}})
# => ".../content/imageTransform[format=png,width=1024]" in both cases
```

## Upload presets

Pass `upload_preset_id:` to `assets.create` or `assets.classify` to apply an upload preset's folder, visibility, file types and size limit. To let a browser upload through a preset that requires tokens, sign a single-use token on your server. Signing happens locally with your API key and makes no request.

```ruby
signed = client.upload_tokens.sign(
  upload_preset_id: 'your-upload-preset-id',
  external_id: 'post-42',     # optional: the uploaded asset gets this ID
  expires_in_seconds: 600     # optional: 1 to 3600, 600 by default
)
# signed['token'], signed['expiresAt'] (milliseconds since the Unix epoch)
```

See [Upload presets](https://calmlens.com/docs/guides/upload-presets). `CalmLens::MockServerClient` signs tokens with its own key.

## Pagination

`assets.each`, `assets.each_child`, `events.each` and `events.each_page` fetch pages as you iterate and return an Enumerator without a block, so `client.assets.each(filter: 'classification.moderation.decision==approved').lazy.first(5)` stops after the pages it needs.

## Events feed

`events.list` without `after` returns **no events** and a cursor for the current time. Store it, then read on from it; persist each page's cursor once its events are handled.

```ruby
cursor = client.events.list['cursor'] # start from now
# ...later, and on every poll:
client.events.each_page(after: cursor, limit: 50) do |page|
  page['events'].each { |event| handle(event) } # event['type'], event['facts'], event['assetId']
  cursor = page['cursor'] # persist it
end
```

Each event carries `facts`, an array of `{'key', 'value', 'url'?}` entries registered for its `type`. An unknown cursor raises `events/invalid-cursor`.

## Webhooks

Verify the **raw** request body, never re-serialized JSON. `CalmLens.parse_webhook_event` verifies the signature and timestamp, then parses the delivery into a `CalmLens::WebhookEvent` (`id`, `type`, `created_at`, `project_id`, `data`, plus `asset_id`, `facts` and `test?`). It raises `CalmLens::WebhookVerificationError` with code `sdk/invalid-webhook-signature` or `sdk/invalid-webhook-payload`. Passing a parsed Hash instead of the body raises `CalmLens::InvalidArgumentError`.

Rails:

```ruby
class CalmLensWebhooksController < ActionController::API
  def create
    event = CalmLens.parse_webhook_event(
      payload: request.raw_post,
      signature: request.headers[CalmLens::WEBHOOK_SIGNATURE_HEADER],
      timestamp: request.headers[CalmLens::WEBHOOK_TIMESTAMP_HEADER],
      secret: ENV.fetch('CALMLENS_WEBHOOK_SECRET')
    )
    # Acknowledge first; do the work in a job. Skip a delivery ID you have already queued.
    CalmLensEventJob.perform_later(request.headers[CalmLens::WEBHOOK_DELIVERY_HEADER], event.to_h)
    head :no_content
  rescue CalmLens::WebhookVerificationError
    head :bad_request
  end
end
```

Sinatra (or any Rack app):

```ruby
post '/webhooks/calmlens' do
  request.body.rewind
  event = CalmLens.parse_webhook_event(
    payload: request.body.read,
    signature: request.env['HTTP_X_CALMLENS_SIGNATURE'],
    timestamp: request.env['HTTP_X_CALMLENS_TIMESTAMP'],
    secret: ENV.fetch('CALMLENS_WEBHOOK_SECRET')
  )
  enqueue(request.env['HTTP_X_CALMLENS_DELIVERY'], event)
  204
rescue CalmLens::WebhookVerificationError
  400
end
```

The header names are exported as `CalmLens::WEBHOOK_SIGNATURE_HEADER`, `WEBHOOK_TIMESTAMP_HEADER` and `WEBHOOK_DELIVERY_HEADER`. Retries of one delivery repeat its `x-calmlens-delivery` ID, so use it to skip duplicates. Deliveries signed more than `CalmLens::WEBHOOK_SIGNATURE_TOLERANCE_SECONDS` (300) from your clock fail; change it with `tolerance_seconds:`. `CalmLens.verify_webhook_signature` returns true or false instead of raising, and `CalmLens.create_webhook_signature_header(payload:, timestamp:, secret:)` signs a body, for example to test your receiver.

## Errors

Every error the SDK raises is a `CalmLens::Error` with `code`, `message`, `details`, `status` (nil without a response), `request_id` (the `X-Request-Id` header, for support), `headers`, `retry_after` (seconds from `Retry-After`) and the original exception in `cause`. Helpers: `not_found?` and `retryable?`. Compare codes with the constants in `CalmLens::ErrorCodes` (API codes, generated from the API's list, with their HTTP statuses in `ErrorCodes::STATUSES`) and `CalmLens::SdkErrorCodes`.

| Class | When |
|---|---|
| `CalmLens::APIError` and its subclasses `BadRequestError`, `AuthenticationError`, `PermissionDeniedError`, `NotFoundError`, `ConflictError`, `RateLimitError`, `ServerError` | The API answered with an error status. |
| `CalmLens::ConnectionError` (`sdk/transport-error`), `CalmLens::TimeoutError` (`sdk/timeout`) | No complete response arrived, or `assets.wait_for_decision` had no decision in time. |
| `CalmLens::InvalidResponseError` (`sdk/invalid-response`, `sdk/response-too-large`) | A successful response could not be read, or was larger than 32 MiB. |
| `CalmLens::InvalidArgumentError` (`sdk/invalid-argument`, or an `upload/*` code for payload checks the API also makes) | An argument was rejected before sending. |
| `CalmLens::ConfigurationError` (`sdk/invalid-config`) | `ServerClient.new` received an invalid setting, such as a malformed `base_url`. |
| `CalmLens::WebhookVerificationError` | A webhook delivery failed verification. |

## Retries and timeouts

Requests that are safe to repeat are retried up to `max_retries:` times (default 2): GET and HEAD, and uploads, which carry an `Idempotency-Key` reused on every retry so CalmLens runs them once and replays the saved response. Connection failures, timeouts, `429`, `502`, `503`, `504` and `idempotency/request-in-progress` are retried with jittered exponential backoff (`retry_base_delay:`, default 0.5 seconds, at most 8), waiting for `Retry-After` when the API sends one. Other writes are never retried. A streamed upload is retried only when its IO can seek back.

`timeout:` (default 120 seconds) limits each socket read or write, not a whole transfer, so large uploads and downloads are not cut off. `open_timeout:` (default 10 seconds) limits connecting. Both can be set per call with `request_options:`.

## Connections

Reuse one client: it keeps up to 8 idle keep-alive connections per host, is safe to share between threads, never follows redirects, and after `fork` (Puma, Unicorn, Resque) the child opens its own connections instead of sharing the parent's. Call `close` when finished. Requests identify themselves as `calmlens-ruby/<version> (ruby <version>)`. `inspect` never shows the API key.

## Offline testing

```ruby
require 'calmlens/testing'
mock = CalmLens::MockServerClient.new
asset = mock.assets.classify(name: 'note', content: {plain_text: 'hello', type: 'text/plain'},
                             processing_options: {keep_content_after_processing: true})
mock.assets.retrieve(asset_id: asset['id']).dig('moderation', 'status') # => "approved"
mock.assets.list(filter: 'classification.moderation.decision==approved')['items'].length        # => 1
mock.cdn.serve(asset_identifier: asset['id']).body                      # => "hello"

mock.enqueue(status: 503, body: {code: 'server/unavailable', message: 'Busy'}) # answers the next request
mock.enqueue_error(Net::ReadTimeout.new)            # the next request raises CalmLens::TimeoutError
mock.enqueue_event(type: 'asset.approved', asset_id: asset['id']) # joins the events feed

request = mock.requests.last
request.method # => "GET"
request.path   # => "/assets/project-1/<id>/content" (relative to base_url or cdn_base_url)
```

`MockServerClient` runs the real client's validation, encoding, retries and error handling, then answers from an in-memory stand-in for the API and CDN. Uploads create assets you can retrieve, list, search, move and delete, and `assets.wait_for_decision` checks the stored asset's processing and moderation status; folders, multipart uploads, idempotency keys, lenses and the events feed behave like the API's; errors carry the API's codes, HTTP statuses and body shape; and `cdn.serve` returns stored bytes with real headers. Like the API, content is removed (`removalReason` `retention`) once classification is `completed` unless the upload sets `keep_content_after_processing: true`. List filters support `==` and `!=` (with `*` wildcards) joined by `;` and `,`, on top-level and nested names such as `classification.moderation.decision`, `classification.status`, `content.status` and `content.format`; other RSQL operators raise rather than being ignored. It does not classify content: `classify` gives `analyzed_outcome:` and `create` gives `queued_outcome:`. An outcome is `pending` (still processing), `approved` or `rejected` (processing done with that decision) or `failed` (processing failed, retryable). `analyzed_outcome:` can also be fields to deep-merge into the asset, such as `{'moderation' => {'status' => 'rejected', 'action' => 'hide'}}` (the outcome follows `classification.moderation.decision`), or a callable that receives the asset and returns either. Change records through `mock.state` to arrange a test. Queued responses and errors are used first, in order.

## Development

Native tests (Ruby 3.1+, Bundler 2.6+): `bundle install && bundle exec ruby -Ilib -e 'Dir["test/*_test.rb"].each { |file| require_relative file }'`, and lint with `bundle exec rubocop`. `lib/calmlens/error_codes.rb` and the files in `testdata/` are generated by `bun packages/sdk-contract/generate.ts` from the repository root. Container/backend checks: `bun run test:sdk:e2e`. Type-check the signatures with `gem install steep && steep check` (see `Steepfile`) and `rbs -I sig validate`. Release by setting `CalmLens::VERSION` in `lib/calmlens/version.rb`.

Image moderation considers readable text directly. Optional OCR (`processingOptions.features.ocr.enabled: true` on the wire) adds a text moderation pass and stores retained text in the image’s `content.extractedText`. No separate text child is created. Read the image’s combined `classification.moderation`; removing its content also removes the extracted text.

Folder listings return a page with `folders`, visible `ancestors`, and `hasMore`. Set `parentId` to open a branch (omit it for project root), and advance `pageIndex` to load another page. `pageSize` is at most 100. `search` with `searchAll` finds names in unopened branches; `ids` with `resolveOnly` resolves selected folder paths. Use the SDK’s language-specific option names.
