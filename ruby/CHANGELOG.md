# @calmlens/sdk-ruby

## 0.26.0

### Minor Changes

- 251c028: Results are now read-only objects with snake_case readers, such as
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

### Patch Changes

- 747237b: Align text classification options across languages: `visibility` is available in every SDK,
  and Python declares upload and text `tags`. Python's asset-ID option types now require `assetId`,
  matching the existing runtime requirement. Ruby declares the existing `link_checking_enabled`
  project setting. Rust's `search_indexing_budget_units` now accepts `f64`, matching the API's
  numeric budget; change integer literals assigned to it to floating-point literals.

## 0.25.0

### Minor Changes

- d836147: Support the `asset.review-completed` event for both confirmed and changed review decisions. Its facts identify the review, decision, reviewer and whether the decision was applied to the asset.

## 0.24.0

### Minor Changes

- 66aa688: Configure retainContent through project settings. Offline mocks retain new uploads by default and resolve upload retention from an explicit upload value, then its preset, then project settings. Existing uploads retain their original choice.

  The processing option is now named `retainContent` in JSON and JavaScript, `retain_content` in Python and Ruby, and `RetainContent` in Go. Use the new name in upload options and configuration.

## 0.23.1

### Patch Changes

- d47bc14: Apply the decision timeout to in-flight asset lookups and their retries. A zero timeout still checks once.

  Python also reports truncated CDN downloads during streaming reads. PHP returns the original upload error when a stream of unknown size cannot be rewound for a retry.

## 0.23.0

### Minor Changes

- `content['hls']` now has `status`, `reason` and `renditions`: it says whether a requested adaptive stream is `preparing` or `ready`, or `unavailable` with a reason (`allowance-used`, `billing-required`, `spend-limit`, `processing-failed` or `content-not-kept`), and lists its renditions once ready. Check `status` rather than whether `hls` is `nil`. The offline mock prepares no stream, so it reports `null`. This replaces the separate HLS status field added in 0.22.0.
- cfb6aef: `MockServerClient` now answers like production in more cases. `fetch_cdn` of a private asset without a grant returns `404` with `asset/not-found` whatever its state, except for its placeholder and info. Each `classification.moderation.categories` result carries `source` and `settings`. API-key uploads naming `upload_preset_id` take the stored preset's folder, visibility and processing options and keep to its limits, with `upload-preset/not-found`, `upload-preset/disabled`, `upload-preset/field-not-allowed`, `upload/unsupported-type` and `upload/too-large`. `fail_next_request` accepts `assets.decide`.

  `MockDecision#pending_review(reason, uncertain_categories = [])` leaves a decision waiting for human review: `mock.decide` clears it and `assets.decide` leaves it.

  A lens's `active` is optional and defaults to `true`. `lenses.update` without it leaves it unchanged, and `ensure_lens` treats an absent `active` as `true` when deciding whether a definition was already saved.

  The `germany` test input preset is now `{'instances' => [], 'regionalActions' => [{'region' => 'DE', 'action' => 'block'}]}`, and the `hate.regional-symbol` signal keeps its hate instance. `ServerClient.new` raises `sdk/invalid-config` for an API key that can't be sent as a header and for an empty project ID, and leaves any other format for the API. A `Transport::Request` no longer shows its headers from `to_s` or `pp`.

- 928edde: Image transform options list only what the CDN accepts, and any other option fails locally with `sdk/invalid-argument`.

### Patch Changes

- c3bee2b: Adds the `sexual-artistic` qualifier, for sexual content that is art not made to arouse.

## 0.22.0

### Minor Changes

- d4f47e9: Events can report the new `configurator` role, and `auth/permission-denied` errors carry `details.role`, the least role that includes the permission in `details.permission`.
- 1c0eef1: An asset's `classification.moderation` names the policy that made the automated decision (`policy`: its `id`, its `revision` then and the `preset` release it used) and says when a human review is waiting (`pendingReview`: `requestedAt`, `reason` and `uncertainCategories`, `null` when none is waiting). A category's allowance or restriction `source` carries the `conditionScore` that triggered its rules, since a rule assessed as a whole can leave its qualifiers out of `raw`. A document or website decided by its parts lists the categories that decided it in `flaggedCategories`. The mocks keep no policies or review queue, so both new fields stay `null` in them.
- 008473f: Manage a project's configuration as data: `upload_presets` lists and iterates upload presets, creates or replaces them by key with `ensure` and removes them with `delete`; `project_settings` reads and replaces the project's settings with `get` and `update`; and `metadata_fields` lists, creates or replaces by ID, and deletes metadata fields. Send the `revision` you read to refuse a change made since. `MockServerClient` serves all of them.
- 11fd85b: `content['hlsStatus']` says whether a requested adaptive stream is `preparing` or `ready`, or `unavailable` with a reason (`allowance-used`, `billing-required`, `spend-limit`, `processing-failed` or `content-not-kept`). The offline mock prepares no stream, so it reports `null`. Adds the `media/duration-limit` error code: audio or video whose file states it is over the duration limit is refused at upload, with `details.durationSeconds` and `details.limitSeconds`.
- 52cfb90: Errors raised by the SDK itself, with no HTTP response, report `error.local?` as `true`. That covers invalid arguments and options, content checked before it is sent (such as `upload/unsupported-type` for an unsupported type), timeouts and connection failures. They carry the code the API would use, with `status` and `request_id` set to `nil`, so branch on `code`.
- 1d9a0d0: Uploads no longer put asset fields in the URL. Text is sent as a JSON body, and files and first multipart parts as a `multipart/form-data` upload form: the name, description, metadata, tags, author, conversation context, external IDs, folder, upload preset and processing options go in its `options` part and the bytes in its `file` part, so none of them appear in proxy, CDN or server logs. The query string holds only `wait`, `contentType`, sizes and part numbers. The offline mock reads uploads the same way and refuses asset fields in a query string with `upload/options-in-query`, as the API does.

### Patch Changes

- Every project recognises its test inputs: the project setting that turned them on is gone, so test codes and test images made with the current signed format are always recognised. Nothing changes in how you generate or detect them.

## 0.21.0

### Minor Changes

- b6cd3f9: `CalmLens::ErrorCodes::ASSET_CHILD_NOT_DELETABLE` (`asset/child-not-deletable`, HTTP 409) is raised when `assets.delete` or an `assets.batch` deletion names an asset extracted from another (one with a `parentId`): delete the asset it was extracted from instead, which deletes it too.

  `assets.explain` with `rerun: true` now returns the asset unchanged and records an `asset.rerun-requested` event, with the asset's current status in its `moderation-status` fact. The asset keeps its decision until the re-run's `asset.classified` and `asset.<status>` events report the new one, and a failed re-run keeps it. `CalmLens::MockServerClient` does the same: a `pending` re-run decision keeps the asset's decision until `complete_processing` decides it.

- cdcf714: One URL per asset: every CDN resource is a path beneath it, signed or not.
  - `cdn.get_asset_url` returns the asset URL itself, `{cdn_base_url}/assets/{project_id}/{asset}`, when no `resource:` is given, and a resource URL beneath it otherwise. Name the asset by exactly one of `asset_id:` and `external_id:` (the external ID it was uploaded with, written `ext:` and the URL-encoded ID); `project_id:` defaults to the client's project. `asset_identifier:` is removed, and a lens or transform without a resource raises `sdk/invalid-argument`. Viewer claims leave out their defaults: `region` only when set, which must be an ISO 3166-1 alpha-2 country (`CalmLens::CDN::VIEWER_COUNTRIES`), and `age_confirmed` only when true; any other claim key is refused.
  - `cdn.sign_asset_url(asset_id: | external_id:, project_id:, expires_in:, original:, resource:, lens:, transform:, viewer_claims:)` replaces `assets.create_signed_url`, `CalmLens::CDN::SIGNED_RESOURCES`, `CalmLens::Assets::DEFAULT_SIGNED_URL_SECONDS` and `CalmLens::Assets::MAX_SIGNED_URL_SECONDS`. It signs a private asset's URL for `expires_in` whole seconds, from 1 to `CalmLens::CDN::MAX_SIGNED_URL_EXPIRES_IN` (24 hours; `CalmLens::CDN::DEFAULT_SIGNED_URL_EXPIRES_IN`, 15 minutes, by default), and returns `{'url', 'expiresAt'}`. Every resource is served beneath the signed URL; `original` only when signed with `original: true`. `resource:`, `lens:`, `transform:` and `viewer_claims:` aren't signed: they are appended as `cdn.get_asset_url` appends them.
  - The new `info` resource and `cdn.get_asset_info(url, viewer_claims: nil)` read an asset URL's display info: the asset's `id`, `projectId`, `type`, `externalUrl`, `content` (format, size, duration, page count, rendered file, preview and stream) and `availability` (`available`, `age-restricted` or `unavailable`) for the URL's viewer claims, or those given. It sends no API key; a refusal raises the CDN's code, such as `signed-url/expired`.
  - `cdn.serve` takes the same asset options; its resource defaults to `rendered`. `CalmLens::CDN::RESOURCES` lists every resource beneath an asset URL.
  - `CalmLens::ErrorCodes::SIGNED_URL_ORIGINAL_NOT_GRANTED` (`signed-url/original-not-granted`, HTTP 403) is returned for the original beneath a signed URL that doesn't grant it.
  - `CalmLens::MockServerClient` signs asset URLs beneath its `cdn_base_url` with a readable grant, and its CDN serves them: private assets without the API key until the grant expires, the original only when granted, assets by external ID, and `info`. `MockServerClient#fetch_cdn(url)` fetches a mock CDN URL as a browser would, without the API key.
- 7f82656: Each API failure has one error code, named resource first, and `CalmLens::Error#details` tells its cases apart.
  - Invalid requests fail with `validation/invalid-request`; `details['issues']` lists each problem's `path`, `message` and issue `code`, such as `validation/too-big`. `details['path']` is gone.
  - `upload/too-large` (HTTP 413) replaces `upload/file-too-large`, `upload/multipart-image-too-large` and `upload-preset/too-large`, with `details['limitBytes']` and `details['source']` (`plan` or `preset`). The SDK's own size checks fail with it too.
  - `upload/unsupported-type` (HTTP 415) replaces `upload/invalid-mime-type`, `upload-preset/content-type-not-allowed` and `image/unsupported-format`, with `details['source']` (`calmlens` or `preset`). The SDK's own MIME type check fails with it too.
  - `asset/held` (HTTP 423, `details['hold']` `safety` or `copyright`) replaces `asset/safety-held`, `appeal/safety-held` and `copyright/content-held`; `image/too-large` (`details['limit']`) replaces `image/input-limit` and `upload/image-exceeded-max-dimensions`; `auth/permission-denied` (`details['permission']`) replaces `asset/api-key-missing-permission`.
  - Renamed codes: `api-key/invalid`, `api-key/missing`, `api-key/project-mismatch`, `api-key/not-accepted`, `session-token/expired`, `session-token/invalid`, `cursor/invalid`, `filter/invalid`, `ordering/unsupported-field`, `request/unsupported-content-type`, `request/route-not-found`, `server/internal-error`, `viewer-claims/invalid`, `viewer-region/invalid`, `transform/invalid`, `transform-options/invalid`, `upload-payload/invalid`, `upload-part/invalid-number`, `image/invalid`, `hash-list-entry/not-found`, `hash-list-entry/limit-reached`, `support-ticket/not-found`, `upload/website-rate-limit-reached`, `remote-url/not-allowed`, `remote-url/invalid`, `remote-url/unavailable` and `remote-url/too-many-redirects`. Usage limits fail with `usage/free-uploads-exhausted` and `usage/uploads-paused`.
  - `CalmLens::ErrorCodes` follows: `UPLOAD_TOO_LARGE`, `UNSUPPORTED_UPLOAD_TYPE`, `ASSET_HELD`, `IMAGE_TOO_LARGE`, `INVALID_IMAGE`, `INVALID_REQUEST`, `MISSING_API_KEY`, `FREE_UPLOADS_EXHAUSTED`, `UPLOADS_PAUSED`, `UNSUPPORTED_ORDERING_FIELD`, `WEBSITE_RATE_LIMIT_REACHED` and `REMOTE_URL_TOO_MANY_REDIRECTS` are new names; `FILE_TOO_LARGE`, `MULTIPART_IMAGE_TOO_LARGE`, `INVALID_UPLOAD_MIME_TYPE`, `ASSET_SAFETY_HELD`, `APPEAL_SAFETY_HELD`, `COPYRIGHT_CONTENT_HELD`, `DOWNLOAD_PERMISSION_REQUIRED`, `IMAGE_EXCEEDED_MAX_DIMENSIONS`, `IMAGE_INVALID_INPUT`, `IMAGE_UNSUPPORTED_FORMAT`, `IMAGE_INPUT_LIMIT`, `UPLOAD_LIMIT_EXCEEDED`, `SPEND_LIMIT_REACHED`, `MISSING_TOKEN`, `INVALID_ORDERING_FIELD`, `REMOTE_URL_REDIRECT_LIMIT`, `WEBSITE_RATE_LIMIT_EXCEEDED`, `UPLOAD_PRESET_CONTENT_TYPE_NOT_ALLOWED` and `UPLOAD_PRESET_TOO_LARGE` are gone.
  - `CalmLens::MockServerClient` answers with the same codes and details.
- 7f82656: Events say who caused them, the events feed can be filtered, and batch operations can be followed.
  - Every event has `'actor' => { 'type', 'id' }`: a `user` (a person in the portal, or an assistant acting for one), an `api-key`, `automated` moderation or CalmLens itself (`system`), with `id` nil when it was not recorded. It replaces the `decided-by` fact and the per-type ID facts (`reviewer-user-id`, `invited-by-user-id`, `removed-by-user-id`, `changed-by-user-id`, `transferred-by-user-id`, `created-by-user-id`, `revoked-by-user-id`). `CalmLens::WebhookEvent#actor` returns it for a delivery, and the RBS signatures add the `actor` and `actor_type` types.
  - `events.list`, `events.each_page` and `events.each` take `types:` (an Array of event types, sent as one comma-separated value) and `asset_id:`. A cursor belongs to the filters it was issued with, so pass the same ones with each `cursor:`.
  - `assets.batch` returns `{ 'batchId', 'status' => 'queued', 'assetCount' }`, and the `asset.deleted` and `asset.content-removed` events it causes carry a `batch-id` fact.
  - `assets.delete_content` is now `assets.remove_content`.
  - Renamed and split event types: `asset.progress-updated`, `usage.free-uploads-exhausted`, `usage.uploads-paused` (with `resumes-at` in milliseconds), `connector.disabled`, `project.member-left` (no more `left` fact on `project.member-removed`) and `api-key.deleted` (no more `action` fact on `api-key.revoked`). `project.transferred` has `method` (`handover` or `move`) in place of `handover`.
  - Hash matches name `hashListId` and `hashListEntryId`, and hash list entries name their source asset `assetId`. The failure reasons `free-upload-limit` and `spend-limit` are `free-uploads-exhausted` and `uploads-paused`.
  - `CalmLens::MockServerClient` records `actor` (the mock API key for API calls, `automated` for processing, a `user` for `decide`), `enqueue_event` takes an `actor:` (the mock API key when omitted), the events feed filters by `types:` and `asset_id:`, and batches return a batch ID.
- 8f35ca3: Every list pages and sorts the same way, policies are an organisation resource, and lenses can be managed one by one.
  - List methods take `sort:`, a comma-separated list of fields descending when prefixed with `-` (such as `'-createdAt,id'`), in place of `ordering:`, and every page is `{'items', 'nextCursor', 'hasMore'}` (folders also return `ancestors`). `assets.list` filters by folder through `filter:` (`folderId==fldr_…`) and no longer takes `folder_id:`; `assets.search` takes `page_size:` in place of `limit:`.
  - Every list has an iterator: `folders.each`, `hash_lists.each`, `hash_lists.each_entry`, `policies.each`, `lenses.each` and `assets.each_timeline_segment`, beside `assets.each` and `assets.each_child`. Without a block each returns an Enumerator.
  - Policies are read and changed by ID for the API key's organisation: `policies.list` returns a page, `policies.retrieve_assigned` returns the project's policy, and `policies.reset` and `policies.upgrade` replace `policies.apply_preset`. A policy's `preset['mode']` (`live`, `pinned` or `copy`) replaces `preset['own']` and `automaticUpdates`. Policy settings define every category with its `action`, `allowances` and `restrictions`, and rules no longer have `match`.
  - `client.lenses` manages a project's lenses: `list`, `each`, `create`, `retrieve`, `update` and `delete`. Lenses have no `version`: `ensure_lens` and `ensure_lenses` change a lens to the definition sent, and the CDN serves the new definition.
  - Uploads send `wait` in place of `queue`; `assets.upload_part` takes `wait:` to override the choice saved when the upload started. `upload_tokens.sign` takes `expires_in:` in place of `expires_in_seconds:`.
  - Assets list `tags` and `metadata` as empty lists and `visibility` always; moderation fields are `nil` until moderation decides, `raw['hashMatches']` is always a list, OCR's text regions are `classification['ocr']`, and feature results no longer include `stage`.
  - `CalmLens.get_event_fact(event, key)` and `CalmLens.get_event_facts(event)` read an event's facts.
  - The RBS signatures and `MockServerClient` follow all of these.
- b2fb53c: Long audio and video, rendered media and previews.
  - `assets.list_timeline(asset_id:, cursor:, page_size:)` pages through every segment of an audio or video asset's findings timeline in time order, from `GET /v1/projects/:projectId/assets/:assetId/timeline` in the client's project. Pass each page's `nextCursor` back unchanged; cursors are opaque.
  - `classification.moderation.timeline` is `{ 'segmentCount' }` for an audio or video asset with a findings timeline, and `nil` otherwise. `classification.moderation.raw` no longer includes the timeline.
  - `classification.progress` reports `completedSections` and `totalSections` while long media is analysed in sections, and the `asset.processing-progress` event reports the same. The failure reasons include `media-limit` and `spend-limit`.
  - `content.rendered` describes the asset's displayable file (`kind` `image`, `pdf`, `video` or `audio`, with its `format`, `width`, `height` and, for audio, waveform `peaks`), and `content.preview` describes its still image (`width`, `height`, `thumbhash` and `averageColor`). They replace `content.image`. The file's own `width`, `height`, `durationSeconds`, `pageCount`, `perceptualHash` and `perceptualHashQuality` are on `content`, and `content.fileMetadata` is now `content.metadata`.
  - The CDN's new `preview` resource serves the asset's still image: the image itself, a document's first page or slide, a website's first screen, a video's poster frame or an audio waveform. `cdn.get_asset_url`, `cdn.serve` and `cdn.sign_asset_url` accept it, and it takes lenses and transforms. `original`, `hls`, `embed`, `placeholder` and `info` refuse a lens or transform before sending; the `rendered` resource takes them only when it is an image, and the CDN answers `asset/invalid-transform` otherwise, and `asset/no-rendered-version` for a resource the asset doesn't have.
  - `MockServerClient` serves the timeline endpoint (empty, as the mock analyses no media), fills `content.rendered` and `content.preview` for each asset type, serves the `preview` and `rendered` resources as the CDN does, withholds every resource and the timeline while a safety hold is on, and gives mock assets a `nil` progress and timeline.
  - Audio and video can be up to 2 GiB when sent in parts, whether `assets.create` and `assets.classify` split a large file or you use the multipart part API; one request still takes up to 50 MiB. Before billing is set up, the API keeps every audio and video upload to 50 MiB and answers `upload/file-too-large`.
- 401e477: `CalmLens::MockServerClient` filters assets like the API: only the documented asset fields and the `==`, `!=`, `>`, `>=`, `<`, `<=`, `=in=` and `=out=` operators, with any other field or operator, such as `=like=` or `=gt=`, refused with `validation/invalid-filter` (HTTP 400). `*` wildcards ignore case, a number field needs a number, and a comparison never matches a missing value.
- 4bcaf59: `CalmLens::MockServerClient` filters `tags` like the API: only `=in=`, an asset with any of the tags, and `=out=`, an asset with none of them, including one without tags. Any other operator on `tags`, such as `tags==homepage`, is refused with `validation/invalid-filter` (HTTP 400).
- 7f82656: Moderation outcomes are reported as statuses, reviews no longer carry personal data, and uploads take tags.
  - `classification.status` is `queued`, `processing`, `completed` or `failed`. `queued` replaces `pending`: the asset is waiting for its content, such as a multipart upload still receiving parts, or for its turn. An asset is settled once it is `completed` or `failed`.
  - `assets.wait_for_decision` returns once the asset is settled, and keeps waiting while it is `queued` or `processing`, even when a reviewer has already decided it. A failed asset is returned with its `classification.failureReason`. `CalmLens::Assets::SETTLED_STATUSES` lists the settled statuses, replacing `PENDING_MODERATION_STATUS` and `FINISHED_PROCESSING_STATUSES`.
  - Each review in `classification.moderation.manualReviews` has `decidedBy` (`{ 'type', 'id' }`, with `type` `user` or `api-key` and the user's or API key's ID) and `applied`, which replaces `appliedToAsset`. Reviews no longer include `reviewerName` or `reviewerEmail`.
  - `classification.moderation.automatedStatus` (`allowed`, `limited`, `age-restricted`, `blocked` or `purged`) replaces `automatedAction`, and is absent before a decision.
  - Each regional decision in `classification.moderation.regions` has a `status` (`limited`, `age-restricted`, `blocked` or `purged`) in place of its `action`.
  - `classification.moderation.linkSafety.links` lists the checked links that take the link-safety action, each with its `url`, `finalUrl`, `redirects`, `source`, `verdict` and `evidence`, in place of their indexes.
  - A category's `source` names the deciding allowance or restriction rules as `indexes`, the decisive rule first, in place of a single `index`.
  - Assets no longer include `classification.labels`, `classification.moderation.testCategoryActions`, `classification.moderation.testRegionalActions`, `processingOptions` or the policy-condition answers in `classification.moderation.raw.categories`. `processing_options:` remains an upload option. The RBS signatures drop the `classification_label`, `processing_options` and `processing_features` types and add `review_actor`.
  - `assets.create`, `assets.classify` and `text.classify` take a `tags:` option, an Array of Strings, which the asset keeps in `tags`.
  - Event facts: `asset.region-restricted` reports `status` (`limited`, `age-restricted`, `blocked` or `purged`) in place of `action`, `asset.link-flagged` reports `link-status` (`limited`, `age-restricted` or `blocked`) in place of `link-action`, and `asset.review-requested` reports `automated-status` in place of `automated-outcome`. The asset snapshot's `classification.status` is `queued` where it was `pending`.
  - `CalmLens::MockServerClient` follows: an open multipart upload is `queued`, reviews (through `assets.decide` or `decide`) record `decidedBy` as the mock API key with `applied: true`, decided assets carry `automatedStatus`, created assets keep their `tags`, and assets no longer include `processingOptions`.
- a3c2fb3: Requests that fail with HTTP 500 (`misc/internal-error`) are retried like other transient errors, with the same backoff and idempotency keys; a 501 still isn't. The `asset/no-rendered-version` error code is available for a CDN request for a rendered version an asset doesn't have. The mock client signs viewer claims into signed URLs as the API does, gives an `asset.<status>` event the status it announces, and records an API key's decision with `decided-by` set to `api-key`.
- d840aa4: Adaptive streaming of audio and video (preview), and an embed page for every asset.
  - The CDN's new `hls` resource serves an audio or video asset's adaptive stream, its HLS master playlist at `/hls/index.m3u8` (a signed asset URL covers every playlist and segment beneath `/hls/`), and the new `embed` resource serves an HTML page at `/embed` that shows any asset, as a viewer for its type, for an iframe. `cdn.get_asset_url`, `cdn.serve` and `cdn.sign_asset_url` accept both, and `CalmLens::CDN::RESOURCES` lists every resource. Neither takes a lens or transform; the SDK refuses one with `sdk/invalid-argument`, as it does for the original.
  - `content.hls` describes the stream once one is prepared (its `renditions`, each with `kind`, `width`, `height`, `bandwidth` and `codecs`), and is `nil` for other assets, until then, once the content is removed and while the asset is held. The RBS signatures add `asset_hls` and `asset_hls_rendition`.
  - `processing_options: { features: { streaming: { enabled: } } }` turns streaming on or off for an upload; left out, the project's setting decides.
  - `MockServerClient` prepares no stream, so `content.hls` is `nil` and it answers `asset/no-rendered-version` for the `hls` resource; it serves an embed page for every asset it may deliver.
- f5c796b: Test scenarios can declare person and face detection results: `'detections' => { 'people' => [...], 'faces' => [...] }` lists boxes (`'box' => [left, top, width, height]` as Integers in basis points of the image, 0 to 10000) with an optional Integer `'confidence'` (0 to 100), each face optionally with an `'age'` (`'adult'`, `'minor'` or `{ 'low' => 30, 'high' => 40 }`), or `'unavailable'` to report the feature as not evaluated. A list holds at most 32 entries, and a detection key given twice (for example as a String and a Symbol) raises `sdk/invalid-argument`. `CalmLens::TestInputs::PRESETS` adds `:one_face`, `:no_face`, `:adult_face`, `:minor_face` and `:group`. Assets and event snapshots carry `classification.testInput`, and `CalmLens::MockServerClient` reports the person and face detection an image upload turned on, finding nobody, and never marks an asset as a test input.
- d9b5400: Text codes and test images from `CalmLens::TestInputs.generate_text_code` and `paint_image` now use the current signed format, which CalmLens requires. CalmLens recognises a text code only as the whole submitted text, and a test image only as the whole upload, in projects with "Recognise test inputs" turned on. Codes and images made by earlier versions are no longer recognised.

## 0.20.0

### Minor Changes

- e1b32c3: Structured transform options are checked against the image transform schema before a CDN or signed URL is built: an unknown option (such as the earlier `{ type: "imageTransform", options: { ... } }` shape) or an invalid value (such as `width: 0` or `format: "bmp"`) fails with `sdk/invalid-argument`, naming each option, instead of building a URL the CDN refuses. Selector strings are passed to the CDN unchanged.

  Every SDK refuses an upload whose type CalmLens can't moderate (anything other than an image, audio, video, text, document or web page, such as `application/zip`) with `upload/invalid-mime-type` before sending it, as the API does.

  An option given as `null` (`None` in Python, `nil` in Ruby) is left out of the request, as if omitted, unless the API takes `null` for it, such as `description` to clear it or `folderId` for the project root. Passing `viewer_claims=None` to `create_signed_url` now works. In Java and Rust, `UpdateAsset`'s name is a plain optional string, since a name can't be cleared.

  The mock clients answer more like the API: they refuse `metadata` that isn't a list of `{ id, value }` items and `null` for fields the API refuses it for with the same `validation/...` error, refuse the same upload types, and their CDN refuses a transform it can't read (`asset/invalid-transform`) or whose options are invalid (`asset/invalid-transform-options`).

- 244ef8e: `CalmLens::MockServerClient#fail_next_request` raises `sdk/invalid-argument` when `details:` or `retry_after:` is given with `transport-error`, `timeout` or an exception, which they don't apply to. The mock's `project_id:` is documented as defaulting to `project-1`.

## 0.19.0

### Minor Changes

- e5f6372: Images can be uploaded in parts at any size up to 20 MiB, down to one final part: `upload/multipart-image-too-small` is gone. In every SDK, `assets.create` and `assets.classify` upload content larger than the part size (`partSizeBytes` in JavaScript, Java and PHP, `part_size_bytes` in Python, Rust and Ruby, `PartSizeBytes` in Go; 8 MiB by default, from 5 MiB to 64 MiB) in parts when its size is known and it can be read again: each part has its own idempotency key (`<key>:part-<n>`) and is retried on its own, and calling again with the same `idempotencyKey` resumes the upload. Content in parts can be up to each type's limit, so images up to 20 MiB no longer need manual parts.
- d2278ac: The events list response includes `excludedTypes` in every SDK: the event types the API key lacks the permission to receive (`ExcludedTypes` in Go, `excluded_types` in Rust, `excludedTypes()` in Java). Each SDK's offline mock returns an empty list, because its key holds every permission.

  `CalmLensServerClient` and `CalmLensAppClient` in the JavaScript SDK refuse an option a method doesn't take, such as a misspelt `externalId`, with `sdk/invalid-argument` naming the key before sending anything, as the Ruby, PHP and Python SDKs do. The app client also refuses options its upload preset sets, such as `folderId`.

- df1539e: Breaking: a transform is now one set of image options, applied in one pass. Pass the options themselves, such as `{ width: 1024, format: "png" }`, where you passed `{ type: "imageTransform", options: { ... } }` or a list of steps; lenses take `transform` options in place of a `transforms` list. CDN URLs put a lens and its extra options in one path segment, such as `/rendered/@thumbnail,width=64`, and options in the URL replace the lens's own. Selector strings containing `/` or starting with `@` are refused with `sdk/invalid-argument`.
- 230efd9: The PHP SDK works with Guzzle 7 and Guzzle 8 (with Guzzle PSR-7 2 or 3 and Guzzle Promises 2 or 3), so it installs in Laravel 13 applications.

  The Ruby, PHP and Python SDKs refuse an option a method doesn't take, such as a misspelt `externalId`, with `sdk/invalid-argument` before sending anything; Python checks an options dict against the method's keyword arguments. `text.classify` without text fails with `sdk/invalid-argument` in every SDK, where it gave `upload/invalid-payload`.

  Every SDK refuses one-request content whose size it knows and that is over the upload limit with `upload/file-too-large` before sending it: images over 10 MiB, audio and video over 50 MiB and other files over 5,000 MiB. Every SDK's error codes include `image/invalid-input`, `image/unsupported-format` and `image/input-limit`.

  The JavaScript SDK's main, `/server` and `/app` entry points load no other package at runtime, so `calmlens/app` works from an import map without a bundler.

- 9abfeaa: Paint signed test images in every SDK: a scenario, preset or signal becomes a test image that survives JPEG, WebP and resizing, returned as PNG bytes ready to upload together with its RGBA pixels. Python `calmlens.testing.paint_test_image`; Go `calmlenstest.PaintTestImage`; Rust `calmlens::testing::paint_test_image`; Ruby `CalmLens::TestInputs.paint_image`; Java `TestInputs.paintTestImage`; PHP `CalmLens\Testing\TestInputs::paintTestImage`. Each SDK paints the same pixels as the JavaScript SDK's `paintTestImage` and rejects a scenario too large for a test image with `sdk/invalid-argument`.
- a70206c: Generate signed test inputs in every SDK: text codes for a scenario, preset or category, and audio and video test phrases, from a project's test input key. Python `calmlens.testing.generate_test_text_code` and `generate_media_test_code`; Go `calmlenstest.GenerateTestTextCode` and `GenerateMediaTestCode`; Rust `calmlens::testing::generate_test_text_code` and `generate_media_test_code`; Ruby `CalmLens::TestInputs.generate_text_code` and `generate_media_code`; Java `TestInputs.generateTestTextCode` and `generateMediaTestCode`; PHP `CalmLens\Testing\TestInputs::generateTestTextCode` and `generateMediaTestCode`. Each SDK produces the same codes as the JavaScript SDK's `calmlens/test-inputs` and rejects invalid scenarios with `sdk/invalid-argument`.

### Patch Changes

- 27862d5: `waitForDecision` waits at most 2 seconds between checks, down from 5, so it returns sooner after a decision is made. It still checks again after 0.5 seconds, waits 1.5 times longer each time and stops at the same timeout.

## 0.18.3

### Patch Changes

- 136292e: Assets carry link safety (preview) results in their types: `classification.linkSafety` lists each link CalmLens checked, where it leads and its verdict, and `classification.moderation.linkSafety` gives the action your policy took on those links.

## 0.18.2

No changes in this release.

## 0.18.1

### Patch Changes

- 34a8932: CDN URLs write viewer claims as `region` then `ageConfirmed`, whatever order you pass them in, so every SDK builds the same URL for the same claims. A placeholder's error message now says only what it rejects: a lens or a transform.

## 0.18.0

No changes in this release.

## 0.17.1

### Patch Changes

- edb65a0: Every SDK is released at the same version.

## 0.17.0

### Minor Changes

- 2e04da8: Assets have `classification.failureReason`, which says why processing failed while `classification.status` is `failed` (such as `duration-limit` or `unsupported-format`), and is `null` otherwise. The `asset.failed` event carries the same value in its `failure-reason` fact. The in-memory mocks give a failed asset `processing-error`. The JavaScript SDK exports the `AssetClassificationFailureReason` type.
- 4f80e37: Assets have `content.fileMetadata`, the descriptive metadata embedded in an uploaded image: `capturedAt` (ISO 8601, with a UTC offset only when the file records one), `cameraMake`, `cameraModel`, `lensModel`, `software`, `creator`, `copyright`, `digitalSourceType` (the IPTC code the file declares, such as `digitalCapture`), `containsLocation`, which says whether the uploaded file embedded GPS coordinates, and `location` (`latitude` and `longitude`). It is read-only, separate from your own `metadata`, and `null` when the image declares none, for other asset types, once the content is removed and while the asset is held.

  Uploads take `processingOptions.storeSensitiveMetadata`, which overrides the project's `storeSensitiveMetadata` setting. It is off by default: embedded image metadata (EXIF, XMP and IPTC) is removed before the image is stored, `checksums` and `sizeInBytes` describe the stored file, and `fileMetadata` leaves out `creator` and `location`. When it is on, the image is stored as uploaded and `fileMetadata` includes them.

  The in-memory mocks give assets `fileMetadata: null`. The SDKs export `FileMetadata` and `FileMetadataLocation` types (Go, Java, Rust and Python; JavaScript exports `FileMetadata`), and the typed processing options gain `storeSensitiveMetadata`.

- e460921: Breaking: an asset's picture is one field, `content.image`, with `width`, `height`, `thumbhash`, `averageColor` and `perceptualHash`. It replaces `content.image` (size and perceptual hash) and `content.previewImage`. For images, the width and height are the original upload's. For documents and websites, they are the page image's. The JavaScript SDK exports the `AssetImage` type, which replaces `ImageData` and `PreviewImage`. `CalmLensMedia` sizes itself and shows its placeholder colour from `content.image`.
- 11d0d81: CDN URL builders take a `placeholder` resource: a small blurred PNG of the asset that the CDN serves publicly for every asset, private ones included, whatever its moderation status, for example in place of an age-restricted image. It takes no lens, transform or `ageConfirmed`, and passing one is rejected with `sdk/invalid-argument`, as is an unknown resource.

  The JavaScript SDK exports `getAssetUrl` from `@calmlens/sdk/app` and `@calmlens/sdk`. It builds the same CDN URLs as the server client's `cdn.getAssetUrl` from a project ID, with no API key and no request, so it works in browsers.

- 33e0087: Read `automatedAction`, `source`, `rule`, `flaggedCategories`, `regions` and policy-adjusted `categories` directly from `classification.moderation`. Detection findings move into `moderation.raw`, and `explanationComplete` replaces `policy.evidence`. Allowed automated actions are explicitly `allow`. The `policy` and `decision` wrappers and aggregate moderation scores are removed. Offline mock responses use the same structure. Go preserves the moderation response's complete JSON in `Extra`, reserving `Raw` for detection findings.
- 7fa8620: `Lens` no longer includes `userId`.
- 2b11c12: Breaking: an asset's moderation outcome is now `classification.moderation.status`: `pending`, then `allowed`, `age-restricted`, `blocked` or `purged`. It replaces `classification.moderation.decision` and `classification.moderation.action`, and filters use `classification.moderation.status`. Manual reviews record their `decision` as one of the four decided statuses and no longer have an `action`. Policy actions are `allow`, `age-restrict`, `block` and `purge`; `flag` is removed.

  Webhook and event types `asset.flagged`, `asset.approved` and `asset.rejected` are replaced by `asset.classified` and one event per status: `asset.allowed`, `asset.age-restricted`, `asset.blocked` and `asset.purged`. Event asset snapshots carry `classification.moderation.status`, and the `moderation-action` and `review-action` facts are replaced by `moderation-status` and `decided-by`.

  Waiting for a decision returns once the status is no longer `pending`. Mock clients take the new statuses as outcomes, and `purged` removes the content.

  CDN URL builders take an `ageConfirmed` option that adds `ageConfirmed=true`, so a public age-restricted asset can be served from its public URL where your app has already decided the viewer may see it. Without it, age-restricted assets need a signed URL or an API key.

- dd08099: CalmLens IDs now name the kind of object they identify: a prefix, an underscore and 20 letters and digits, such as `proj_8fK2mQx7Lp4NvB3tRz9Y` for a project, `asset_5Gm2Rk8XqT3wLp9VbN4c` for an asset and `fldr_7Nc4Wq2Lm8Xt5Rk9Bv3P` for a folder. The in-memory mocks mint IDs the same way, and their ID option (`createId`, `create_id` or `CreateID`) now receives the prefix of the object it names (`asset`, `fldr`, `hl`, `hle`, `lens`, `evt` or `rev`). The mocks' `assets.batch` refuses an ID that is not an asset ID with `validation/invalid-format`, as the API does.
- af0bb68: Uploads no longer take `processingOptions.flaggedContentPolicy`: the project's moderation policy decides every asset, with its allowances and restrictions. The typed processing options drop it (Go, Java, Python, Ruby and Rust remove the `FlaggedContentPolicy` type), and `classification.moderation.source` no longer reports `asset-override` (Go drops `DecisionSourceAssetOverride`). JavaScript exports the policy action type as `PolicyAction` instead of `FlaggedContentAction`.
- 64e9180: Asset reviews no longer include `reviewerUserId`, and hash lists and hash list entries no longer include `createdByUserId`.
- 8cc1cae: Add `client.assets.batch(asset_ids:, operation:)`, which deletes up to 500 assets (`'delete'`) or removes their stored content (`'remove-content'`) in one request and returns `{ 'queued' => true }`. It sends `POST /projects/:projectId/assets/batch`. Every asset must exist in the project and the API key needs `assets:delete` for its folder, or the request fails (`asset/not-found`, `auth/permission-denied`) and nothing is queued; once queued, the work runs in the background and records `asset.deleted` or `asset.content-removed` for each asset. The method refuses an empty list, more than 500 IDs, an empty ID or an unknown operation with `sdk/invalid-argument` before sending, and is not retried. The new `auth/permission-denied` error code is available as a constant. `MockServerClient` validates the batch like the API and applies it at once.
- 58840e7: Adds `assets.decide(asset_id: ..., decision: ..., note: ...)`, with `confirm_purge: true` for purges, which records a reviewer's decision with a note and returns the asset. Every list now pages with cursors: `folders.list` takes `cursor`, `page_size` and `ordering` (by `name` or `createdAt`) instead of `page_index`, `sort` and `direction`, and returns `items`, `ancestors`, `nextCursor`, `hasMore`, `pageSize` and `ordering`. `hash_lists.list` takes `cursor` and `page_size` and returns one page. `events.list` and `each_page` take `cursor` and `page_size` instead of `after` and `limit`, and pages return `items` and `nextCursor` instead of `events` and `cursor`. An unreadable events cursor is `validation/invalid-cursor`. The testing client implements `assets.decide` with the API's validation and the new list shapes.
- 105ccc2: Assets can now have the moderation status `limited`, set by the new `limit` policy action, and reviewers can decide `limited`. A `limited` asset is delivered exactly like an `allowed` one, from the same URL; it is marked so your app can reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it lower or collapsing it. The new `asset.limited` event reports the decision. `CalmLens::MockServerClient` accepts `limited` as a `queued_outcome:`, `analyzed_outcome:` and `decide` decision, and its CDN serves limited assets like allowed ones.
- 958be0d: `CalmLens::MockServerClient` takes an `api_key:` from `MockServerClient.create_api_key(grants)`. Its CDN now answers like the real one, with JSON error bodies: blocked, purged and failed assets, and assets whose content was removed, return `403` with `asset/not-available`, and a private asset, or a public age-restricted one requested without `age_confirmed: true`, returns `403` with `asset/api-key-missing-permission` unless the key has an `assets:download` grant. The default key has no grants, so pass a key with one to read private content. `decide(asset_id, decision)` applies a reviewer's decision and adds the matching `asset.<decision>` event, and `assets.wait_for_decision` takes no real time.
- 7c7f2a7: Breaking: `CalmLens::MockServerClient` takes a `moderate:` callable in place of `queued_outcome:` and `analyzed_outcome:`. It receives a `CalmLens::MockModerationInput` with the stored asset, its content (`bytes`, and `text` for plain-text uploads), the trigger (`upload`, `retry`, `rerun` or `complete`) and whether CalmLens would queue the work, and returns a status or a decision built with `CalmLens::MockDecision.of(status)`, whose `flag(category, score, qualifiers)` and `not_evaluated(category)` fill in the asset's full moderation report, checking every category, qualifier and score. Uploads now add `asset.uploaded`, `asset.classified` and the automated `asset.<status>` or `asset.failed` events. `complete_processing(asset_id, decision = nil)` finishes a pending asset as CalmLens would. `fail_next_request` fails one request at a time, takes `details:` and `retry_after:` for API errors and rejects unknown operations; the mock's `max_retries:` defaults to 0. Recorded requests carry their response `status`, their paths have decoded segments, and `clear_requests` forgets them. `enqueue_event` with an `asset_id:` attaches the asset's snapshot, and `decide` refuses `pending` and `failed`.
- 6232efc: The Ruby client now behaves like the other CalmLens SDKs:
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
- 3e9c422: Follows the CalmLens API v1 contract:
  - `assets.list` and `assets.each` request `GET /v1/projects/{project_id}/assets`.
  - Sort directions in `ordering` are lowercase: `'asc'` and `'desc'`.
  - API errors no longer carry `traceId` in `details`. `request_id` comes from the `X-Request-Id` header, or from the error body's `requestId`. `details` is the body's object as sent.
  - `CalmLens::ErrorCodes` includes the validation codes and the new route, internal, authentication, search, transform, remote URL, copyright and permission codes.
  - Webhook bodies and `CalmLens.to_webhook_event_payload` use the same flat shape as `events.list` items: `{ id, projectId, type, severity, title, description, assetId, asset, facts, createdAt }`, without a `data` envelope.
  - `CalmLens::WebhookEvent` has the members `id`, `project_id`, `type`, `severity`, `title`, `description`, `asset_id`, `asset`, `facts`, `created_at` and `payload` (the body as received). `data` and `fields` are removed.
  - Listed events no longer include `userId`, `notify`, `updatedAt` or `readAt`; `description`, `assetId` and `asset` are nil when absent.
  - Assets no longer include `userId` or `content.safetyTest`.
  - `folders.list` no longer takes `search_all`, `ids` or `resolve_only`, and returns 50 folders by default.
  - `MockServerClient` follows the same contract: error bodies carry `requestId` and a `details` object, unknown routes answer `misc/route-not-found`, invalid `ordering` entries answer `validation/invalid-value`, and every cursor list defaults to 50 items.
- 454706c: Uploads and text classification take `authorId` and `context`: who wrote the content and the earlier posts of its conversation, oldest first, each with an optional author ID. CalmLens moderates only the content and uses the earlier posts to read who it addresses and whether it quotes, reports, counters or mocks something. The SDKs send only the posts CalmLens uses, the most recent 5 that fit in 2,000 characters, and export the rule that picks them. Assets return `authorId` and the `context` used, which is `null` once the content is removed. The offline mocks store both and drop the context with the content.
- 17cdb9b: CDN methods, signed URL creation and media widgets accept optional `viewerClaims` containing `region` and `ageConfirmed`. These replace the separate region and age options. The CDN defaults to the connecting country and no age confirmation, including authenticated requests. Customers determine the assertions; CalmLens applies content restrictions without independently verifying them.

  Asset retrieval returns stored moderation results without a request-specific `delivery` object or region parameter. Pass viewer context on the CDN request instead. Raw HTTP supports a JSON query parameter or `X-CalmLens-Viewer-Claims` header. Age-restricted delivery without confirmation returns `viewer/age-confirmation-required`; private access remains a separate requirement.

- 958be0d: New helpers build signed webhook deliveries for testing a webhook handler, as the JavaScript, Python and PHP SDKs already do. `CreateWebhookHeaders` (Go), `create_webhook_headers` (Rust), `CalmLens.create_webhook_headers` (Ruby) and `CalmLensServerClient.createWebhookHeaders` (Java) return the `content-type`, `x-calmlens-delivery`, `x-calmlens-timestamp` and `x-calmlens-signature` headers for a body. Ruby's `CalmLens.to_webhook_event_payload` and Java's `CalmLensServerClient.toWebhookEventPayload` convert an event from `events.list` to its delivery body.

### Patch Changes

- 6d65133: Event facts' `url` is now a stable link that opens the item in the CalmLens portal, such as `https://calmlens.com/go/asset/<asset-id>`, in webhook payloads and the events feed. The in-memory mocks give asset facts the same links.
- e4e9894: `CalmLensMedia` shows the CDN placeholder for private assets and signed URLs too, since the CDN serves every asset's placeholder publicly. It sends only viewer claims that differ from the defaults (a `region`, or `ageConfirmed: true`), so `ageConfirmed: false` no longer makes the CDN's responses private and uncacheable, and placeholder URLs carry only the region. The mock clients serve private assets' placeholders without `assets:download`, as the CDN does.
- 1e59923: The mock clients' `cdn.serve` now sends `Cache-Control` as the CDN does: `public` only when anyone may see the asset (including a public age-restricted asset requested with `ageConfirmed`), otherwise `private`, with `max-age=31536000, immutable` for images and `max-age=3600` for other content. JavaScript and Python previously sent `private, no-store` or `public, max-age=31536000`; Go and Ruby sent no `Cache-Control`.
- 97b991b: `MockServerClient` list filters accept `=in=` and `=out=` with a `(value,value)` list, and `=gt=`, `=ge=`, `=lt=` and `=le=`, like the API and the other SDKs' mocks.
- 91cd4a1: The `CalmLens::MockServerClient` in-memory API answers `folders.create` with `201 Created`, as the API does (it answered `200`).
- 92bf5db: `MockServerClient.assets.search` matches every word of the query in any searchable field and returns the API's keyword scores, matched fields and ranking. Mock list filters accept parentheses, with `;` binding tighter than `,`. The default mock clock gives assets created in a row increasing `createdAt`, so lists, cursors and search order them predictably. `CalmLens::Error#retryable?` is true for `sdk/transport-error`, `sdk/timeout` and `idempotency/request-in-progress` whichever error class carries them, and for `429`, `502`, `503` and `504`.
- 958be0d: Creating a signed URL now fails with `sdk/invalid-argument` before sending anything when the API would reject it: a resource other than `original` or `rendered` (a placeholder needs no signed URL), a lens or transform on the `original` resource, or a lifetime that is not a whole number of seconds from 1 to 86400 (24 hours). The longest lifetime is available as `MAX_SIGNED_URL_SECONDS` in Rust and Java, `MaxSignedURLSeconds` in Go, `CalmLens::Assets::MAX_SIGNED_URL_SECONDS` in Ruby and `CalmLens\Assets::MAX_SIGNED_URL_SECONDS` in PHP.

## 0.1.1

### Patch Changes

- 9da6766: Document image-owned OCR text in `content.extractedText` and the additional text moderation pass in the image’s combined report. Update the Java marketplace example to retrieve and remove image text without child assets.
