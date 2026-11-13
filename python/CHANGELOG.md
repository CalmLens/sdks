# @calmlens/sdk-python

## 0.26.0

### Minor Changes

- 621ea6d: Results are now typed objects read through snake_case attributes, such as
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
- db4c0dc: `wait_for_decision` now raises `CalmLensTimeoutError` when its deadline passes, the same class as a
  request timeout, so one `except CalmLensTimeoutError` handles both. `CalmLensTimeoutError` now
  subclasses `CalmLensError` directly instead of `CalmLensTransportError`.
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

### Patch Changes

- 6b857e4: Clarify classification and moderation status labels in decision timeout messages.

## 0.23.1

### Patch Changes

- d47bc14: Apply the decision timeout to in-flight asset lookups and their retries. A zero timeout still checks once.

  Python also reports truncated CDN downloads during streaming reads. PHP returns the original upload error when a stream of unknown size cannot be rewound for a retry.

## 0.23.0

### Minor Changes

- `content["hls"]` now has `status`, `reason` and `renditions`: it says whether a requested adaptive stream is `preparing` or `ready`, or `unavailable` with a reason (`allowance-used`, `billing-required`, `spend-limit`, `processing-failed` or `content-not-kept`), and lists its renditions once ready. Check `status` rather than whether `hls` is `None`. The offline mock prepares no stream, so it reports `null`. This replaces the separate HLS status field added in 0.22.0.
- 0f0a8bb: The mock matches CalmLens in more places. A private asset fetched with `fetch_cdn`, without a grant or the API key, returns `404 asset/not-found` whatever its state. Each result in `classification.moderation.categories` includes `settings` and `source`. API-key uploads naming `uploadPresetId` take the preset's visibility, folder and processing options, keep to its type and size limits, and are refused for an unknown or paused preset or a visibility or folder that differs from the preset's. `mock_decision(status).pending_review(reason, uncertain_categories)` leaves a decision waiting for human review; `decide` clears it and `assets.decide` leaves it.

  `text.classify` takes `upload_preset_id`. `active` is optional in lens definitions and defaults to true, also in the mock. The `germany` test input preset has no category instances and an explicit block in Germany; the `hate.regional-symbol` signal still sends a hate-symbol instance. An API key that can't be sent in a header, one with spaces or line breaks, now fails with `sdk/invalid-config` when the client is created.

- 928edde: Image transform options list only what the CDN accepts, and any other option fails locally with `sdk/invalid-argument`.

### Patch Changes

- c3bee2b: Adds the `sexual-artistic` qualifier, for sexual content that is art not made to arouse.

## 0.22.0

### Minor Changes

- d4f47e9: Events can report the new `configurator` role, and `auth/permission-denied` errors carry `details.role`, the least role that includes the permission in `details.permission`.
- 1c0eef1: An asset's `classification.moderation` names the policy that made the automated decision (`policy`: its `id`, its `revision` then and the `preset` release it used) and says when a human review is waiting (`pendingReview`: `requestedAt`, `reason` and `uncertainCategories`, `null` when none is waiting). A category's allowance or restriction `source` carries the `conditionScore` that triggered its rules, since a rule assessed as a whole can leave its qualifiers out of `raw`. A document or website decided by its parts lists the categories that decided it in `flaggedCategories`. The mocks keep no policies or review queue, so both new fields stay `null` in them.
- 008473f: Keep a project's configuration in code: `client.upload_presets` lists, iterates, ensures by key and deletes upload presets, which now carry a `key` and `revision`; `client.project_settings` reads and replaces the project's settings; and `client.metadata_fields` lists, ensures by ID and deletes its metadata fields. Send the `revision` you read to refuse a change made since. `MockCalmLensServerClient` serves all of them.
- 11fd85b: `content["hlsStatus"]` says whether a requested adaptive stream is `preparing` or `ready`, or `unavailable` with a reason (`allowance-used`, `billing-required`, `spend-limit`, `processing-failed` or `content-not-kept`). The offline mock prepares no stream, so it reports `null`. Adds the `media/duration-limit` error code: audio or video whose file states it is over the duration limit is refused at upload, with `details.durationSeconds` and `details.limitSeconds`.
- 52cfb90: Errors raised by the SDK itself, with no HTTP response, report `error.is_local` as `True`. That covers invalid arguments and options, content checked before it is sent (such as `upload/unsupported-type` for an unsupported type), timeouts and connection failures. They carry the code the API would use, with `status` and `request_id` set to `None`, so branch on `code`.
- 1d9a0d0: Uploads no longer put asset fields in the URL. Text is sent as a JSON body, and files and first multipart parts as a `multipart/form-data` upload form: the name, description, metadata, tags, author, conversation context, external IDs, folder, upload preset and processing options go in its `options` part and the bytes in its `file` part, so none of them appear in proxy, CDN or server logs. The query string holds only `wait`, `contentType`, sizes and part numbers. The offline mock reads uploads the same way and refuses asset fields in a query string with `upload/options-in-query`, as the API does.

### Patch Changes

- Every project recognises its test inputs: the project setting that turned them on is gone, so test codes and test images made with the current signed format are always recognised. Nothing changes in how you generate or detect them.

## 0.21.0

### Minor Changes

- b6cd3f9: `error_codes.ASSET_CHILD_NOT_DELETABLE` (`asset/child-not-deletable`, HTTP 409) is raised when `assets.delete` or an `assets.batch` deletion names an asset extracted from another (one with a `parentId`): delete the asset it was extracted from instead, which deletes it too.

  `assets.explain` with `rerun=True` now returns the asset unchanged and records an `asset.rerun-requested` event, with the asset's current status in its `moderation-status` fact. The asset keeps its decision until the re-run's `asset.classified` and `asset.<status>` events report the new one, and a failed re-run keeps it. `calmlens.testing` does the same: a `pending` re-run decision keeps the asset's decision until `complete_processing` decides it.

- 4b12b76: One URL per asset: every CDN resource is a path beneath it, signed or not.
  - `cdn.get_asset_url` returns the asset URL itself, `{cdn_base_url}/assets/{projectId}/{asset}`, without `resource`, and a resource URL beneath it otherwise. Name the asset by exactly one of `asset_id` and `external_id` (the external ID it was uploaded with, written `ext:` and the URL-encoded ID); `project_id` defaults to the client's project. `asset_identifier` is removed, and a `lens` or `transform` without a resource fails with `sdk/invalid-argument`. Viewer claims leave out their defaults: `region` only when set, which must be a country code (`calmlens.client.VIEWER_COUNTRIES`), and `ageConfirmed` only when true.
  - `cdn.sign_asset_url(project_id=, asset_id= | external_id=, expires_in=, original=, resource=, lens=, transform=, viewer_claims=)` replaces `assets.create_signed_url`, `SignedUrlOptions`, `SignedUrl`, `SignedCdnResource` and `SIGNED_CDN_RESOURCES`. It signs a private asset's URL for `expires_in` seconds, from 1 to `MAX_SIGNED_URL_EXPIRES_IN` (24 hours; default `DEFAULT_SIGNED_URL_EXPIRES_IN`, 15 minutes), and returns a `SignedAssetUrl` with `url` and `expiresAt`. Every resource is served beneath the signed URL; the original only when signed with `original=True`. `resource`, `lens`, `transform` and `viewer_claims` aren't signed: they are appended as `cdn.get_asset_url` appends them. `DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS` is removed.
  - The new `info` resource and `cdn.get_asset_info(url, viewer_claims=)` read an asset URL's display info: an `AssetInfo` with the asset's `id`, `projectId`, `type`, `externalUrl`, `content` (format, size, duration, page count, rendered file, preview and stream) and `availability` (`available`, `age-restricted` or `unavailable`) for the URL's viewer claims, or those you pass. It sends no API key; a refusal raises `CalmLensAPIError` with the CDN's code, such as `signed-url/expired`. `CDN_RESOURCES` lists every resource.
  - `cdn.serve` takes the same asset options (`project_id`, `asset_id` or `external_id`); its resource defaults to `rendered`.
  - `error_codes.SIGNED_URL_ORIGINAL_NOT_GRANTED` (`signed-url/original-not-granted`, HTTP 403) is raised for the original beneath a signed URL that doesn't grant it.
  - `MockCalmLensServerClient` signs asset URLs beneath its `cdn_base_url` with a readable grant, and its CDN serves them: private assets without the API key until the grant expires, the original only when granted, assets by external ID, and `info`. `fetch_cdn(url)` fetches a mock CDN URL as a browser would, without the API key. The `signed_url_base_url` mock option is removed.
- b973353: Each API failure has one error code, named resource first, and `CalmLensError.details` tells its cases apart.
  - Invalid requests fail with `validation/invalid-request`; `details["issues"]` lists each problem's `path`, `message` and issue `code`, such as `validation/too-big`. `details["path"]` is gone.
  - `upload/too-large` (HTTP 413) replaces `upload/file-too-large`, `upload/multipart-image-too-large` and `upload-preset/too-large`, with `details["limitBytes"]` and `details["source"]` (`plan` or `preset`). The SDK's own size checks raise it too.
  - `upload/unsupported-type` (HTTP 415) replaces `upload/invalid-mime-type`, `upload-preset/content-type-not-allowed` and `image/unsupported-format`, with `details["source"]` (`calmlens` or `preset`). The SDK's own upload type check raises it with `source` `calmlens`.
  - `asset/held` (HTTP 423, `details["hold"]` `safety` or `copyright`) replaces `asset/safety-held`, `appeal/safety-held` and `copyright/content-held`; `image/too-large` (`details["limit"]`) replaces `image/input-limit` and `upload/image-exceeded-max-dimensions`; `auth/permission-denied` (`details["permission"]`) replaces `asset/api-key-missing-permission`.
  - Renamed codes: `api-key/invalid`, `api-key/missing`, `api-key/project-mismatch`, `api-key/not-accepted`, `session-token/expired`, `session-token/invalid`, `cursor/invalid`, `filter/invalid`, `ordering/unsupported-field`, `request/unsupported-content-type`, `request/route-not-found`, `server/internal-error`, `viewer-claims/invalid`, `viewer-region/invalid`, `transform/invalid`, `transform-options/invalid`, `upload-payload/invalid`, `upload-part/invalid-number`, `image/invalid`, `hash-list-entry/not-found`, `hash-list-entry/limit-reached`, `support-ticket/not-found`, `upload/website-rate-limit-reached`, `remote-url/not-allowed`, `remote-url/invalid`, `remote-url/unavailable` and `remote-url/too-many-redirects`. Usage limits fail with `usage/free-uploads-exhausted` and `usage/uploads-paused`.
  - `calmlens.error_codes` constants follow: `UPLOAD_TOO_LARGE`, `UNSUPPORTED_UPLOAD_TYPE`, `ASSET_HELD`, `IMAGE_TOO_LARGE`, `INVALID_IMAGE`, `INVALID_REQUEST`, `MISSING_API_KEY`, `FREE_UPLOADS_EXHAUSTED`, `UPLOADS_PAUSED`, `UNSUPPORTED_ORDERING_FIELD`, `WEBSITE_RATE_LIMIT_REACHED` and `REMOTE_URL_TOO_MANY_REDIRECTS`; the constants for removed codes are gone.
  - `MockCalmLensServerClient` answers with the same codes and details.
- b973353: Events say who caused them, the events feed can be filtered, and batch operations can be followed.
  - Every event has `actor` (`{"type", "id"}`, typed as `Actor`): a `user` (a person in the portal, or an assistant acting for one), an `api-key`, `automated` moderation or CalmLens itself (`system`), with `id` `None` when no ID was recorded. Webhook payloads carry it too. It replaces the `decided-by` fact and the per-type ID facts (`reviewer-user-id`, `invited-by-user-id`, `removed-by-user-id`, `changed-by-user-id`, `transferred-by-user-id`, `created-by-user-id`, `revoked-by-user-id`).
  - `events.list`, `events.iter_pages` and `events.iter` take `types` (a list of event types, sent as one comma-separated value) and `asset_id`. A cursor belongs to the filters it was issued with.
  - `assets.batch` returns `{"batchId", "status": "queued", "assetCount"}`, and the `asset.deleted` and `asset.content-removed` events it causes carry a `batch-id` fact.
  - `assets.delete_content` is now `assets.remove_content`.
  - Renamed and split event types: `asset.progress-updated`, `usage.free-uploads-exhausted`, `usage.uploads-paused` (with `resumes-at` in epoch milliseconds), `connector.disabled`, `project.member-left` (no more `left` fact on `project.member-removed`) and `api-key.deleted` (no more `action` fact on `api-key.revoked`). `project.transferred` has `method` (`handover` or `move`) in place of `handover`.
  - Hash matches name `hashListId` and `hashListEntryId`, and hash list entries name their source asset `assetId`. The failure reasons `free-upload-limit` and `spend-limit` are `free-uploads-exhausted` and `uploads-paused`.
  - `MockCalmLensServerClient` records an actor on every event (its API key, which has no ID, for API calls; `automated` for the pipeline; a `user` for `decide`), and `enqueue_event` takes an `actor`. It filters its feed by `types` and `asset_id`, refusing a cursor reused with other filters with `cursor/invalid`, and answers batches with a `batch_` ID.
- f8acab1: Every list pages and sorts the same way, policies are an organisation resource, and lenses can be managed one by one.
  - List methods take `sort`, a comma-separated list of fields descending when prefixed with `-` (such as `"-createdAt,id"`), in place of `ordering`, and every page is `{"items", "nextCursor", "hasMore"}` (folders also return `ancestors`). `assets.list` and `assets.iter` filter by folder through `filter` (`folderId==fldr_…`) and no longer take `folder_id`; `assets.search` takes `page_size` in place of `limit`.
  - Every list has an iterator: `folders.iter`, `hash_lists.iter`, `hash_lists.iter_entries`, `policies.iter`, `lenses.iter` and `assets.iter_timeline`, beside `assets.iter` and `assets.iter_children`.
  - Policies are read and changed by ID for the API key's organisation: `policies.list` returns a page, `policies.retrieve_assigned` returns the project's policy, and `policies.reset` and `policies.upgrade` replace `policies.apply_preset`. A policy's `preset["mode"]` (`live`, `pinned` or `copy`) replaces `preset["own"]` and `automaticUpdates`. Policy settings define every category with its `action`, `allowances` and `restrictions`, and rules no longer have `match`.
  - `lenses.list`, `lenses.iter`, `lenses.create`, `lenses.retrieve`, `lenses.update` and `lenses.delete` manage a project's lenses. Lenses have no `version`: `ensure_lens` and `ensure_lenses` change a lens to the definition sent, and the CDN serves the new definition.
  - Uploads send `wait` in place of `queue`; `assets.upload_part` takes `wait` to override the choice saved when the upload started. `upload_tokens.sign` takes `expires_in` in place of `expires_in_seconds`.
  - Assets list `tags` and `metadata` as empty lists and `visibility` always; moderation fields are `None` until moderation decides, `raw["hashMatches"]` is always a list, OCR's text regions are `classification["ocr"]`, and feature results no longer include `stage`.
  - `get_event_fact(event, key)` and `get_event_facts(event)` read an event's facts.
  - `MockCalmLensServerClient` follows all of these.
- b2fb53c: Long audio and video, rendered media and previews.
  - `assets.list_timeline(asset_id=..., cursor=..., page_size=...)` pages through every segment of an audio or video asset's findings timeline in time order, from `GET /v1/projects/:projectId/assets/:assetId/timeline` in the client's project. Pass each page's `nextCursor` back unchanged; cursors are opaque.
  - `classification["moderation"]["timeline"]` is `{"segmentCount": ...}` for an audio or video asset with a findings timeline, and `None` otherwise. `classification["moderation"]["raw"]` no longer includes the timeline.
  - `classification["progress"]` reports `completedSections` and `totalSections` while long media is analysed in sections, and the `asset.processing-progress` event reports the same. The failure reasons include `media-limit` and `spend-limit`.
  - `content["rendered"]` describes the asset's displayable file (`kind` `image`, `pdf`, `video` or `audio`, with its `format`, `width`, `height` and, for audio, waveform `peaks`), and `content["preview"]` describes its still image (`width`, `height`, `thumbhash` and `averageColor`). They replace `content["image"]`. The file's own `width`, `height`, `durationSeconds`, `pageCount`, `perceptualHash` and `perceptualHashQuality` are on `content`, and `content["fileMetadata"]` is now `content["metadata"]`. New types: `AssetRendered`, `AssetRenderedKind`, `AssetPreview`, `AssetModerationTimeline` and `SignedCdnResource`.
  - The CDN's new `preview` resource serves the asset's still image: the image itself, a document's first page or slide, a website's first screen, a video's poster frame or an audio waveform. `cdn.get_asset_url`, `cdn.serve` and `assets.create_signed_url` accept it, and it takes lenses and transforms. The `rendered` resource takes them only when it is an image; the CDN answers `asset/invalid-transform` otherwise, and `asset/no-rendered-version` for a resource the asset doesn't have. The `original` and `placeholder` resources take no lens or transform. `SIGNED_CDN_RESOURCES` lists the resources a signed URL can be created for.
  - The mock client serves the timeline endpoint (empty, as the mock analyses no media), fills `content["rendered"]` and `content["preview"]` for each asset type, serves the `preview` and `rendered` resources as the CDN does, and gives mock assets a `None` progress and timeline.
  - Audio and video can be up to 2 GiB when sent in parts, whether `assets.create` and `assets.classify` split a large file or you use the multipart part API; one request still takes up to 50 MiB. Before billing is set up, the API keeps every audio and video upload to 50 MiB and answers `upload/file-too-large`.
- 401e477: `MockCalmLensServerClient` filters assets like the API: only the documented asset fields and the `==`, `!=`, `>`, `>=`, `<`, `<=`, `=in=` and `=out=` operators, with any other field or operator, such as `=like=` or `=gt=`, refused with `validation/invalid-filter` (HTTP 400). `*` wildcards ignore case, a number field needs a number, and a comparison never matches a missing value. Ordering by a field other than `createdAt` or `id` is refused with `validation/invalid-value`.
- 4bcaf59: `MockCalmLensServerClient` filters `tags` like the API: only `=in=`, an asset with any of the tags, and `=out=`, an asset with none of them, including one without tags. Any other operator on `tags`, such as `tags==homepage`, is refused with `validation/invalid-filter` (HTTP 400).
- b973353: Moderation outcomes are reported as statuses, reviews no longer carry personal data, and uploads take tags.
  - `classification["status"]` is `queued`, `processing`, `completed` or `failed`. `queued` replaces `pending`: the asset is waiting for its content, such as a multipart upload still receiving parts, or for its turn. An asset is settled once it is `completed` or `failed`.
  - `assets.wait_for_decision` returns once the asset is settled, and keeps waiting while it is `queued` or `processing`, even when a reviewer has already decided it. A failed asset is returned with its `classification["failureReason"]`.
  - Each review in `classification["moderation"]["manualReviews"]` has `decidedBy` (`{"type", "id"}`, with `type` `user` or `api-key` and the user's or API key's ID, typed as `ReviewActor`) and `applied`, which replaces `appliedToAsset`. Reviews no longer include `reviewerName` or `reviewerEmail`.
  - `classification["moderation"]["automatedStatus"]` (`allowed`, `limited`, `age-restricted`, `blocked` or `purged`) replaces `automatedAction`, and is absent before a decision.
  - Each regional decision in `classification["moderation"]["regions"]` has a `status` (`limited`, `age-restricted`, `blocked` or `purged`) in place of its `action`.
  - `classification["moderation"]["linkSafety"]["links"]` lists the checked links that take the link-safety action, each with its `url`, `finalUrl`, `redirects`, `source`, `verdict` and `evidence`, in place of their indexes.
  - A category's `source` names the deciding allowance or restriction rules as `indexes`, the decisive rule first, in place of a single `index`. `CategoryPolicySource` is a union of `CategoryPolicyDefaultSource` and `CategoryPolicyRuleSource`.
  - Assets no longer include `classification["labels"]`, `classification["moderation"]["testCategoryActions"]`, `classification["moderation"]["testRegionalActions"]`, `processingOptions` or the policy-condition answers in `classification["moderation"]["raw"]["categories"]` and findings timeline segments. `processing_options` remains an upload option. The `ClassificationLabel` and `TestRegionalAction` types are removed.
  - `assets.create`, `assets.classify` and `text.classify` take a `tags` option, a list of strings, which the asset keeps in `tags`. Uploads through an upload preset can't set tags.
  - Event facts: `asset.region-restricted` reports `status` (`limited`, `age-restricted`, `blocked` or `purged`) in place of `action`, `asset.link-flagged` reports `link-status` (`limited`, `age-restricted` or `blocked`) in place of `link-action`, and `asset.review-requested` reports `automated-status` in place of `automated-outcome`. The asset snapshot's `classification["status"]` is `queued` where it was `pending`.
  - `MockCalmLensServerClient` follows: an open multipart upload is `queued`, reviews record `decidedBy` as the mock API key with `applied: True`, decided assets carry `automatedStatus`, created assets keep their `tags`, and assets no longer include `processingOptions`.
- a3c2fb3: Requests that fail with HTTP 500 (`misc/internal-error`) are retried like other transient errors, with the same backoff and idempotency keys; a 501 still isn't. The `asset/no-rendered-version` error code is available for a CDN request for a rendered version an asset doesn't have. The mock client signs viewer claims into signed URLs as the API does, gives an `asset.<status>` event the status it announces, and records an API key's decision with `decided-by` set to `api-key`.
- d840aa4: Adaptive streaming of audio and video (preview), and an embed page for every asset.
  - The CDN's new `hls` resource serves an audio or video asset's adaptive stream, its HLS master playlist at `/hls/index.m3u8` (one signature covers every playlist and segment beneath `/hls/`), and the new `embed` resource serves an HTML page at `/embed` that shows any asset, as a viewer for its type, for an iframe. `cdn.get_asset_url`, `cdn.serve` and `assets.create_signed_url` accept both, and `SIGNED_CDN_RESOURCES` lists them. Neither takes a lens or transform; the SDK refuses one with `sdk/invalid-argument`, as it does for the original.
  - `content["hls"]` describes the stream once one is prepared (its `renditions`, each with `kind`, `width`, `height`, `bandwidth` and `codecs`), and is `None` for other assets, until then, once the content is removed and while the asset is held. New types: `AssetHls`, `AssetHlsRendition` and `StreamingFeatureOptions`.
  - `processing_options={"features": {"streaming": {"enabled": ...}}}` turns streaming on or off for an upload; left out, the project's setting decides.
  - The mock client prepares no stream, so `content["hls"]` is `None` and it answers `asset/no-rendered-version` for the `hls` resource; it serves an embed page for every asset it may deliver.
- f5c796b: Test scenarios can declare person and face detection results: `detections["people"]` and `detections["faces"]` list boxes (`[left, top, width, height]` in basis points of the image, 0 to 10000) with an optional confidence (0 to 100), each face optionally with an age (`"adult"`, `"minor"` or `{"low": ..., "high": ...}`), or `"unavailable"` to report the feature as not evaluated. A list holds at most 32 entries, and `calmlens.testing` types them as `SignedTestDetections`, `SignedTestDetectedPerson`, `SignedTestDetectedFace` and `SignedTestFaceAge`. `TEST_INPUT_PRESETS` adds `one_face`, `no_face`, `adult_face`, `minor_face` and `group`. Assets and event snapshots carry `classification["testInput"]`, and `MockCalmLensServerClient` reports the person and face detection an image upload turned on, finding nobody, and never marks an asset as a test input.
- d9b5400: Text codes and test images from `generate_test_text_code` and `paint_test_image` now use the current signed format, which CalmLens requires. CalmLens recognises a text code only as the whole submitted text, and a test image only as the whole upload, in projects with "Recognise test inputs" turned on. Codes and images made by earlier versions are no longer recognised.

## 0.20.0

### Minor Changes

- e1b32c3: Structured transform options are checked against the image transform schema before a CDN or signed URL is built: an unknown option (such as the earlier `{ type: "imageTransform", options: { ... } }` shape) or an invalid value (such as `width: 0` or `format: "bmp"`) fails with `sdk/invalid-argument`, naming each option, instead of building a URL the CDN refuses. Selector strings are passed to the CDN unchanged.

  Every SDK refuses an upload whose type CalmLens can't moderate (anything other than an image, audio, video, text, document or web page, such as `application/zip`) with `upload/invalid-mime-type` before sending it, as the API does.

  An option given as `null` (`None` in Python, `nil` in Ruby) is left out of the request, as if omitted, unless the API takes `null` for it, such as `description` to clear it or `folderId` for the project root. Passing `viewer_claims=None` to `create_signed_url` now works. In Java and Rust, `UpdateAsset`'s name is a plain optional string, since a name can't be cleared.

  The mock clients answer more like the API: they refuse `metadata` that isn't a list of `{ id, value }` items and `null` for fields the API refuses it for with the same `validation/...` error, refuse the same upload types, and their CDN refuses a transform it can't read (`asset/invalid-transform`) or whose options are invalid (`asset/invalid-transform-options`).

- 244ef8e: `MockCalmLensServerClient` uses the project ID `project-1`, available as `calmlens.testing.MOCK_PROJECT_ID`, when you don't pass `project_id`. `fail_next_request` raises `sdk/invalid-argument` for `details` or `retry_after` with `"transport-error"`, `"timeout"` or an exception, which they don't apply to.

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
- 8cc1cae: Add `client.assets.batch(asset_ids=..., operation=...)`, which deletes up to 500 assets (`"delete"`) or removes their stored content (`"remove-content"`) in one request and returns `{"queued": True}`. It sends `POST /projects/:projectId/assets/batch`. Every asset must exist in the project and the API key needs `assets:delete` for its folder, or the request fails (`asset/not-found`, `auth/permission-denied`) and nothing is queued; once queued, the work runs in the background and records `asset.deleted` or `asset.content-removed` for each asset. The method refuses an empty list, more than 500 IDs, an empty ID or an unknown operation with `sdk/invalid-argument` before sending, and is not retried. The new `auth/permission-denied` error code is available as a constant. The `AssetBatchOperation`, `BatchAssetsOptions` and `BatchAssetsResponse` types are exported. The mock client validates the batch like the API and applies it at once.
- 6232efc: The Python SDK now behaves like the other CalmLens SDKs in every shared contract case.
  - API requests send `Accept: application/json`, and every request `User-Agent: calmlens-python/<version> (<implementation>/<Python version>)`. The default `timeout` is 120 seconds.
  - `upload_timeout` sets the timeout of binary uploads and `max_response_bytes` the largest response body read (default 32 MiB); `with_options` accepts both. A declared `Content-Length` over the limit fails before the body is read, and an upload answered with something other than an asset raises `sdk/invalid-response`.
  - Retries wait between half and all of the exponential backoff and honour `Retry-After` in whole seconds or as an HTTP date (`0` retries at once). `cdn.serve` retries network failures, timeouts and 429, 502, 503 and 504, returning the last response once retries run out. A redirect raises `sdk/http-error` with its status and is never followed or retried, from `cdn.serve` too.
  - API errors no longer add `network: True` to `details`. An empty successful response to anything but a delete raises `sdk/invalid-response`.
  - A non-seekable stream without `sizeInBytes` is uploaded with chunked encoding instead of being refused.
  - `assets.iter`, `assets.iter_children` and `events.iter_pages` raise `sdk/invalid-response` (`details["cursor"]`) when a page that says more follow repeats a cursor, and event pages with more to follow continue past empty pages.
  - Webhooks: header names match in any case and repeated signature headers are joined, including from `email.message.Message`, `http.client.HTTPMessage` and Werkzeug headers. `parse_webhook_event` checks the API's event shape and keeps unknown fields. `is_test_webhook_event` tells test sends from real events. Upload tokens encode claims exactly as the server does.
  - `calmlens.testing` adds `sign_upload_token`, `MockCalmLensServerClient.fail_next_request` and `set_api_key_grants`, and outcomes that are functions of the asset. The mock answers schema errors with `validation/<issue>` and `details["path"]`, scopes list cursors to their query, uses positional event cursors, records `asset.retried`, `asset.content-removed` and `asset.deleted` events, purges with reason `requested` for reviewers, serves a ThumbHash placeholder PNG and the CDN's cache and protection headers, and checks multipart image totals, idempotency key rules, lens versions and folder rules like the API. It reads an idempotency key without surrounding whitespace, as HTTP sends it.
- 58840e7: Adds `assets.decide(asset_id=..., decision=..., note=...)`, with `confirm_purge=True` for purges, which records a reviewer's decision with a note and returns the asset. Every list now pages with cursors: `folders.list` takes `cursor`, `page_size` and `ordering` (by `name` or `createdAt`) instead of `pageIndex`, `sort` and `direction`, and returns `items`, `ancestors`, `nextCursor`, `hasMore`, `pageSize` and `ordering`. `hash_lists.list(cursor, page_size)` returns a `HashListPage`. `events.list`, `iter_pages` and `iter` take `cursor` and `page_size` instead of `after` and `limit`, and pages return `items` and `nextCursor` instead of `events` and `cursor`. An unreadable events cursor is `validation/invalid-cursor`. `MockCalmLensServerClient` implements `assets.decide` with the API's validation and the new list shapes.
- 105ccc2: Add the `limited` moderation status and reviewer decision, the `limit` policy action and the `asset.limited` event to `AssetModerationStatus`, `AssetModerationDecision`, `ModerationAction` and `EventType`. A limited asset is delivered exactly like an allowed one, from the same URLs, but is marked so your app can reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it lower or collapsing it. `MockCalmLensServerClient` accepts `limited` as a `queued_outcome`, `analyzed_outcome` and `decide` decision, serves limited assets from the CDN like allowed ones, and `decide(asset_id, "limited")` adds a low-severity `asset.limited` event.
- 958be0d: `MockCalmLensServerClient.cdn.serve` now answers like the CDN: blocked, purged and failed assets, and assets whose content was removed, return `403` with `asset/not-available` whatever the key, before any permission check. `decide(asset_id, decision)` applies a reviewer's decision (`allowed`, `age-restricted`, `blocked` or `purged`) and adds the matching `asset.<decision>` event with a `decided-by: reviewer` fact.
- 7c7f2a7: `MockCalmLensServerClient` now decides uploads through a `moderate` function in `mock_options`, which replaces `queued_outcome` and `analyzed_outcome`. It receives a `MockModerationInput` with the stored asset, its content (the uploaded `bytes`, and the `text` of a plain-text upload), the `trigger` (`upload`, `retry`, `rerun` or `complete`) and whether the work is `queued`, and returns a status or a decision built with `mock_decision(status).flag(category, score, qualifiers).not_evaluated(category)`, which fills the asset's report with every category, its score and the policy's `flaggedCategories` as CalmLens does. Without it, queued uploads, retries and reruns stay pending and everything else is allowed. `complete_processing(asset_id, decision=None)` finishes a pending asset as the pipeline would. Uploads add `asset.uploaded`, then `asset.classified` and the automated `asset.<status>`, or `asset.failed`, to the events feed. `fail_next_request` takes `details` and `retry_after` for API errors, fails one request per queued failure and refuses unknown operations. Recorded requests carry their decoded `path` and response `status`, and `clear_requests()` forgets them. `decide` refuses `pending` and `failed`.
- a65ee25: Follows the CalmLens API v1 contract:
  - `assets.list` and `assets.iter` request `GET /v1/projects/{projectId}/assets`.
  - Sort directions in `ordering` are lowercase: `"asc"` and `"desc"`.
  - API errors no longer carry `traceId` in `details`. `request_id` comes from the `X-Request-Id` header, or from the error body's `requestId`. `details` is the body's object as sent.
  - `calmlens.error_codes` includes the validation codes and the new route, internal, authentication, search, transform, remote URL, copyright and permission codes.
  - Webhook bodies, `parse_webhook_event` and `to_webhook_event_payload` use the same flat shape as `events.list` items: `{id, projectId, type, severity, title, description, assetId, asset, facts, createdAt}`, without a `data` envelope. `is_test_webhook_event` reads that shape. `WebhookEventData` is removed.
  - Listed events no longer include `userId`, `notify`, `updatedAt` or `readAt`; `description`, `assetId` and `asset` are `None` when absent.
  - `Asset` no longer includes `userId` or `content.safetyTest`.
  - `folders.list` no longer takes `search_all`, `ids` or `resolve_only`, and returns 50 folders by default.
  - The testing mock follows the same contract: error bodies carry `requestId` and `details`, unknown routes answer `misc/route-not-found`, and every cursor list defaults to 50 items.
- af0bb68: Uploads no longer take `processingOptions.flaggedContentPolicy`: the project's moderation policy decides every asset, with its allowances and restrictions. The typed processing options drop it (Go, Java, Python, Ruby and Rust remove the `FlaggedContentPolicy` type), and `classification.moderation.source` no longer reports `asset-override` (Go drops `DecisionSourceAssetOverride`). JavaScript exports the policy action type as `PolicyAction` instead of `FlaggedContentAction`.
- 64e9180: Asset reviews no longer include `reviewerUserId`, and hash lists and hash list entries no longer include `createdByUserId`.
- 454706c: Uploads and text classification take `authorId` and `context`: who wrote the content and the earlier posts of its conversation, oldest first, each with an optional author ID. CalmLens moderates only the content and uses the earlier posts to read who it addresses and whether it quotes, reports, counters or mocks something. The SDKs send only the posts CalmLens uses, the most recent 5 that fit in 2,000 characters, and export the rule that picks them. Assets return `authorId` and the `context` used, which is `null` once the content is removed. The offline mocks store both and drop the context with the content.
- 17cdb9b: CDN methods, signed URL creation and media widgets accept optional `viewerClaims` containing `region` and `ageConfirmed`. These replace the separate region and age options. The CDN defaults to the connecting country and no age confirmation, including authenticated requests. Customers determine the assertions; CalmLens applies content restrictions without independently verifying them.

  Asset retrieval returns stored moderation results without a request-specific `delivery` object or region parameter. Pass viewer context on the CDN request instead. Raw HTTP supports a JSON query parameter or `X-CalmLens-Viewer-Claims` header. Age-restricted delivery without confirmation returns `viewer/age-confirmation-required`; private access remains a separate requirement.

### Patch Changes

- 6d65133: Event facts' `url` is now a stable link that opens the item in the CalmLens portal, such as `https://calmlens.com/go/asset/<asset-id>`, in webhook payloads and the events feed. The in-memory mocks give asset facts the same links.
- e4e9894: `CalmLensMedia` shows the CDN placeholder for private assets and signed URLs too, since the CDN serves every asset's placeholder publicly. It sends only viewer claims that differ from the defaults (a `region`, or `ageConfirmed: true`), so `ageConfirmed: false` no longer makes the CDN's responses private and uncacheable, and placeholder URLs carry only the region. The mock clients serve private assets' placeholders without `assets:download`, as the CDN does.
- 1e59923: The mock clients' `cdn.serve` now sends `Cache-Control` as the CDN does: `public` only when anyone may see the asset (including a public age-restricted asset requested with `ageConfirmed`), otherwise `private`, with `max-age=31536000, immutable` for images and `max-age=3600` for other content. JavaScript and Python previously sent `private, no-store` or `public, max-age=31536000`; Go and Ruby sent no `Cache-Control`.
- e4e9894: The mock clients accept the real client's upload timeout and response size limit: `upload_timeout` and `max_response_bytes` on Python's `MockCalmLensServerClient`, `UploadTimeout` and `MaxResponseBytes` on Go's `calmlenstest.Options`, `uploadTimeout` and `maxResponseBytes` on PHP's `MockServerClient`, and `MockOptions::upload_timeout` and `MockOptions::max_response_bytes` in Rust. They are validated like the real client's, and the size limit applies to the mock's answers.
- 91cd4a1: The `calmlens.testing` mock answers with the HTTP statuses the API sends: `201 Created` for `folders.create`, and `200` with an empty JSON object for asset and folder deletes (it answered `200` for creates and `204 No Content` for deletes).
- 92bf5db: `CalmLensError.is_retryable` now depends only on the error's `code` and `status`, so every error class agrees: the `sdk/timeout` that `assets.wait_for_decision` raises is now retryable. `MockCalmLensServerClient` search works like the API's keyword search: every word of the query must appear in a searchable field, `matchedFields` and `score` follow the API, and results are ranked by score, then newest first. Mock list filters accept parentheses for grouping, with `;` binding tighter than `,`. The mock's default clock moves on by at least a millisecond per reading, so assets created in a row have increasing `createdAt` values.
- 958be0d: Creating a signed URL now fails with `sdk/invalid-argument` before sending anything when the API would reject it: a resource other than `original` or `rendered` (a placeholder needs no signed URL), a lens or transform on the `original` resource, or a lifetime that is not a whole number of seconds from 1 to 86400 (24 hours). The longest lifetime is available as `MAX_SIGNED_URL_SECONDS` in Rust and Java, `MaxSignedURLSeconds` in Go, `CalmLens::Assets::MAX_SIGNED_URL_SECONDS` in Ruby and `CalmLens\Assets::MAX_SIGNED_URL_SECONDS` in PHP.

## 0.1.2

### Patch Changes

- 9da6766: Document image-owned OCR text in `content.extractedText` and the additional text moderation pass in the image’s combined report. Update the Java marketplace example to retrieve and remove image text without child assets.
