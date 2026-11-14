# @calmlens/sdk-java

## 0.26.0

### Minor Changes

- c1c8135: Redesign the Java SDK so new API fields and values arrive without breaking your code.
  - **Packages and module.** The SDK is the module `com.calmlens` (`requires com.calmlens;`). Request params are in `com.calmlens.params`, response models and enums are top-level classes in `com.calmlens.models`, exceptions are in `com.calmlens.exception`, and `MockCalmLensServerClient`, `MockDecision` and `TestInputs` are in `com.calmlens.testing`. `Models` is gone. Public types carry JSpecify nullness annotations, so Kotlin sees which values can be null.
  - **Client setup.** `CalmLensServerClient.fromEnv()` reads `CALMLENS_API_KEY`, `CALMLENS_PROJECT_ID` and `CALMLENS_BASE_URL` (or the `calmlens.apiKey`, `calmlens.projectId` and `calmlens.baseUrl` system properties). `builder()` takes no arguments: set `apiKey(...)` and `projectId(...)`, and `build()` refuses a missing one. `appInfo(name, version, url)` names your integration in the `User-Agent`.
  - **Resources.** Resources are methods: `client.assets()`, `client.folders()`, `client.cdn()` and so on.
  - **Params.** Each operation takes its IDs as arguments and its other options as immutable params from a builder, for example `client.assets().update(assetId, AssetUpdateParams.builder().setName("cover.png").clearDescription().build())`. `build()` refuses a missing required option. `clearX()` sends null to clear a field. `putExtraParam` sends a field this SDK version doesn't declare.
  - **Request options.** Every method takes a `RequestOptions` as its last argument: timeout, upload timeout, retries, idempotency key, extra headers and extra query or body fields. `RequestOptions` is now an immutable builder.
  - **Models.** Models are immutable classes with getters. A field the API may leave out or send as null has an `Optional` getter, and `hasField` tells a missing field from one sent as null. Reading a field the API always sends throws `sdk/invalid-response` when the response lacked it. `validate()`, or the builder's `responseValidation(true)`, checks a whole response at once. `getRawJsonObject()` and `getAdditionalProperties()` keep the fields this SDK version doesn't declare, and `getLastResponse()` gives each result's request ID, status and headers.
  - **Enums.** Fixed sets of values, such as asset types, failure reasons, likelihoods, policy actions and event types, are Java enums. A value added after your SDK version reads as `UNKNOWN`, so a `switch` keeps working.
  - **Moderation decision.** `classification.moderation.decision` is an `Optional<AssetModerationDecision>`, empty until the asset is decided.
  - **Exceptions.** Each kind of failure has its own class under `CalmLensException`:
    - `ApiException`, with `BadRequestException`, `AuthenticationException`, `PermissionDeniedException`, `NotFoundException`, `ConflictException`, `PayloadTooLargeException`, `UnprocessableEntityException`, `RateLimitException` and `ServerException` beneath it.
    - `ConnectionException`, `TimeoutException` and `CancelledException`.
    - `InvalidArgumentException`, with `ConfigurationException` beneath it.
    - `InvalidResponseException` and `WebhookVerificationException`.

    `getBody()` keeps the raw response body, such as a proxy's error page, and `getRequestId()` returns an `Optional`.
  - **Async client.** `client.async()` returns the same operations as `CompletableFuture`s.
  - **Raw requests.** `client.request(method, path, query, body, requestOptions)` calls an API path the SDK has no method for yet, with the client's authentication, retries and errors.
  - **Logging and hooks.** `CALMLENS_LOG=info|debug` (or `logLevel(...)` and `logger(...)`) logs retries, failures and requests through `System.Logger`. `requestListener(...)` receives every request attempt with its operation, status, request ID, duration and retry delay. Neither ever includes the API key, bodies, query strings or signed URLs.
  - **Events.** `events().iterate(...)` yields every event across pages, and `events().pages(...)` still yields whole pages.
  - **Option changes.** `FolderUpdateParams.setName`, `HashListUpdateParams.setName` and `HashListUpdateParams.setAction` take plain values, since a name and an action can't be cleared. Folders have no description option, and `assets().update` has no folder option: move an asset with `assets().move`.
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

- `AssetContent.hls()` now has `status()`, `reason()` and `renditions()`: it says whether a requested adaptive stream is `preparing` or `ready`, or `unavailable` with a reason (`allowance-used`, `billing-required`, `spend-limit`, `processing-failed` or `content-not-kept`), and lists its renditions once ready. Check `status()` rather than whether `hls()` is null. The offline mock prepares no stream, so it reports `null`. This replaces the separate HLS status field added in 0.22.0.
- 5ef6eb3: `MockCalmLensServerClient` now answers as production does on more points, and the client and models follow the API's latest defaults:
  - `mock.fetchCdn` of a private asset without a grant answers 404 `asset/not-found` whatever the asset's state, for every resource but its placeholder and `/info`. `cdn.serve` with the API key is unchanged.
  - Each `classification.moderation.categories` result from a mock decision reports its `source` and `settings`.
  - An API-key upload naming an `uploadPresetId` takes the upload preset stored by `uploadPresets.ensure`: its folder, visibility and, unless the upload sets its own, processing options. It fails with `upload-preset/not-found`, `upload-preset/disabled`, `upload-preset/field-not-allowed`, or `upload/unsupported-type` and `upload/too-large` with `source: "preset"`, so tests must ensure a preset before naming it.
  - `MockDecision.pendingReview(reason)` and `pendingReview(reason, uncertainCategories)` leave a decision waiting for human review. `mock.decide` clears it and `assets.decide` leaves it.
  - A lens's `active` is optional and defaults to true: `new LensDefinition(identifier, name, lensType)` sends none, and `lenses.update` without it leaves the lens as it is.
  - `TestInputs.GERMANY` is now no findings with a `DE` block in `regionalActions`. The `hate.regional-symbol` signal keeps its hate instance.
  - The client builder throws `sdk/invalid-config` for an API key that can't be sent in a header: one with spaces, line breaks or anything else outside printable ASCII. Other formats are left to the API.
- 928edde: Image transform options list only what the CDN accepts, and any other option fails locally with `sdk/invalid-argument`.

### Patch Changes

- c3bee2b: Adds the `sexual-artistic` qualifier, for sexual content that is art not made to arouse.

## 0.22.0

### Minor Changes

- d4f47e9: Events can report the new `configurator` role, and `auth/permission-denied` errors carry `details.role`, the least role that includes the permission in `details.permission`.
- 1c0eef1: An asset's `classification.moderation` names the policy that made the automated decision (`policy`: its `id`, its `revision` then and the `preset` release it used) and says when a human review is waiting (`pendingReview`: `requestedAt`, `reason` and `uncertainCategories`, `null` when none is waiting). A category's allowance or restriction `source` carries the `conditionScore` that triggered its rules, since a rule assessed as a whole can leave its qualifiers out of `raw`. A document or website decided by its parts lists the categories that decided it in `flaggedCategories`. The mocks keep no policies or review queue, so both new fields stay `null` in them.
- 008473f: Keep a project's configuration in code: `client.uploadPresets` lists, iterates, ensures by key and deletes upload presets, which have a `key` and `revision`; `client.projectSettings` reads and replaces the project's settings; and `client.metadataFields` lists, ensures by ID and deletes its metadata fields. Send the `revision` you read to refuse a change made since. `ErrorCodes` adds the codes these calls return, and `MockCalmLensServerClient` serves all of them.
- 11fd85b: `AssetContent.hlsStatus()` says whether a requested adaptive stream is `preparing` or `ready`, or `unavailable` with a reason (`allowance-used`, `billing-required`, `spend-limit`, `processing-failed` or `content-not-kept`). The offline mock prepares no stream, so it reports `null`. Adds the `ErrorCodes.MEDIA_DURATION_LIMIT` error code: audio or video whose file states it is over the duration limit is refused at upload, with `details.durationSeconds` and `details.limitSeconds`.
- 52cfb90: Exceptions raised by the SDK itself, with no HTTP response, report `isLocal()` as `true`. That covers invalid arguments and options, content checked before it is sent (such as `ErrorCodes.UNSUPPORTED_UPLOAD_TYPE` for an unsupported type), timeouts, interruptions and connection failures. They carry the code the API would use, with `getStatus()` 0 and `getRequestId()` null, so branch on `getCode()`.
- 1d9a0d0: Uploads no longer put asset fields in the URL. Text is sent as a JSON body, and files and first multipart parts as a `multipart/form-data` upload form: the name, description, metadata, tags, author, conversation context, external IDs, folder, upload preset and processing options go in its `options` part and the bytes in its `file` part, so none of them appear in proxy, CDN or server logs. The query string holds only `wait`, `contentType`, sizes and part numbers. The offline mock reads uploads the same way and refuses asset fields in a query string with `upload/options-in-query`, as the API does.

### Patch Changes

- Every project recognises its test inputs: the project setting that turned them on is gone, so test codes and test images made with the current signed format are always recognised. Nothing changes in how you generate or detect them.

## 0.21.0

### Minor Changes

- b6cd3f9: `asset/child-not-deletable` (`ErrorCodes.ASSET_CHILD_NOT_DELETABLE`, HTTP 409) is returned when `assets.delete` or an `assets.batch` deletion names an asset extracted from another (one with a `parentId`): delete the asset it was extracted from instead, which deletes it too.

  `assets.explain` with `rerun(true)` now returns the asset unchanged and records an `asset.rerun-requested` event, whose `moderation-status` fact is the asset's current status. The asset keeps its decision until the re-run's `asset.classified` and `asset.<status>` events report the new one, and a failed re-run keeps it. `MockCalmLensServerClient` does the same: a pending re-run decision keeps the asset's decision until `completeProcessing` decides it.

- e076d24: One URL per asset: every CDN resource is a path beneath it, signed or not.
  - `cdn.getAssetUrl(CdnRequest)` returns the asset URL itself, `{cdnBaseUrl}/assets/{projectId}/{asset}`, when no `resource` is set, and a resource URL beneath it otherwise. Name the asset by exactly one of `CdnRequest.assetId` and `CdnRequest.externalId` (the external ID it was uploaded with, written `ext:` and the URL-encoded ID); `CdnRequest.projectId` defaults to the client's project. `CdnRequest.assetIdentifier` is removed (`new CdnRequest(String)` now takes the asset ID), and a lens or transform without a resource fails with `sdk/invalid-argument`. Viewer claims leave out their defaults: a `region` only when set, which must be a country code, and `ageConfirmed` only when true.
  - `cdn.signAssetUrl(SignAssetUrlOptions)` replaces `assets.createSignedUrl`, `SignedUrlOptions`, `SignedUrl` and `SIGNED_CDN_RESOURCES`. It signs a private asset's URL (by `assetId` or `externalId`, with an optional `projectId`) for `expiresIn` seconds, from 1 to `MAX_SIGNED_URL_EXPIRES_IN_SECONDS` (24 hours; `DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS`, 15 minutes, when unset), and returns a `SignedAssetUrl` with `url` and `expiresAt`. Every resource is served beneath the signed URL; the original only when signed with `original(true)`. `resource`, `lens`, `transform` and `viewerClaims` aren't signed: they are appended as `cdn.getAssetUrl` appends them. `MAX_SIGNED_URL_SECONDS` is removed.
  - The new `info` resource, listed in `CDN_RESOURCES`, and `cdn.getAssetInfo(String url)` and `cdn.getAssetInfo(String url, ViewerClaims)` read an asset URL's display info: an `AssetInfo` with the asset's `id`, `projectId`, `type`, `externalUrl`, `content` (`AssetInfoContent`: format, size, duration, page count, rendered file, preview and stream) and `availability` (`AssetAvailability.AVAILABLE`, `AGE_RESTRICTED` or `UNAVAILABLE`) for the URL's viewer claims, or those given. It sends no API key; a refusal throws `ApiException` with the CDN's code, such as `signed-url/expired`.
  - `cdn.serve` takes the same asset options; its resource defaults to `rendered`.
  - `ErrorCodes.SIGNED_URL_ORIGINAL_NOT_GRANTED` (`signed-url/original-not-granted`, HTTP 403) is returned for the original beneath a signed URL that doesn't grant it.
  - `MockCalmLensServerClient` signs asset URLs beneath its client's CDN base URL with a readable grant, and its CDN serves them: private assets without the API key until the grant expires, the original only when granted, assets by external ID, and `info`. `MockCalmLensServerClient.fetchCdn(String)` fetches a mock CDN URL as a browser would, without the API key. `Options.signedUrlBaseUrl` is removed.
- e94b168: Each API failure has one error code, named resource first, and `CalmLensException.getDetails()` tells its cases apart.
  - Invalid requests fail with `validation/invalid-request` (`ErrorCodes.INVALID_REQUEST`); `details.issues` lists each problem's `path`, `message` and issue `code`, such as `validation/too-big`. `details.path` is gone.
  - `upload/too-large` (`ErrorCodes.UPLOAD_TOO_LARGE`, HTTP 413) replaces `upload/file-too-large`, `upload/multipart-image-too-large` and `upload-preset/too-large`, with `details.limitBytes` and `details.source` (`plan` or `preset`). The SDK's own size checks fail with it too, with the same details.
  - `upload/unsupported-type` (`ErrorCodes.UNSUPPORTED_UPLOAD_TYPE`, HTTP 415) replaces `upload/invalid-mime-type`, `upload-preset/content-type-not-allowed` and `image/unsupported-format`, with `details.source` (`calmlens` or `preset`). The SDK's own MIME type check fails with it, with `details.mimeType` and `details.source`.
  - `asset/held` (`ErrorCodes.ASSET_HELD`, HTTP 423, `details.hold` `safety` or `copyright`) replaces `asset/safety-held`, `appeal/safety-held` and `copyright/content-held`; `image/too-large` (`ErrorCodes.IMAGE_TOO_LARGE`, `details.limit`) replaces `image/input-limit` and `upload/image-exceeded-max-dimensions`; `auth/permission-denied` (`ErrorCodes.PERMISSION_DENIED`, `details.permission`) replaces `asset/api-key-missing-permission`.
  - Renamed codes: `api-key/invalid`, `api-key/missing`, `api-key/project-mismatch`, `api-key/not-accepted`, `session-token/expired`, `session-token/invalid`, `cursor/invalid`, `filter/invalid`, `ordering/unsupported-field`, `request/unsupported-content-type`, `request/route-not-found`, `server/internal-error`, `viewer-claims/invalid`, `viewer-region/invalid`, `transform/invalid`, `transform-options/invalid`, `upload-payload/invalid`, `upload-part/invalid-number`, `image/invalid`, `hash-list-entry/not-found`, `hash-list-entry/limit-reached`, `support-ticket/not-found`, `upload/website-rate-limit-reached`, `remote-url/not-allowed`, `remote-url/invalid`, `remote-url/unavailable` and `remote-url/too-many-redirects`. Usage limits fail with `usage/free-uploads-exhausted` and `usage/uploads-paused`.
  - `ErrorCodes` constants follow: `UPLOAD_TOO_LARGE`, `UNSUPPORTED_UPLOAD_TYPE`, `ASSET_HELD`, `IMAGE_TOO_LARGE`, `INVALID_IMAGE`, `INVALID_REQUEST`, `MISSING_API_KEY`, `FREE_UPLOADS_EXHAUSTED`, `UPLOADS_PAUSED`, `UNSUPPORTED_ORDERING_FIELD`, `WEBSITE_RATE_LIMIT_REACHED` and `REMOTE_URL_TOO_MANY_REDIRECTS`. `FILE_TOO_LARGE`, `MULTIPART_IMAGE_TOO_LARGE`, `IMAGE_EXCEEDED_MAX_DIMENSIONS`, `IMAGE_INVALID_INPUT`, `IMAGE_UNSUPPORTED_FORMAT`, `IMAGE_INPUT_LIMIT`, `UPLOAD_LIMIT_EXCEEDED`, `SPEND_LIMIT_REACHED`, `INVALID_UPLOAD_MIME_TYPE`, `ASSET_SAFETY_HELD`, `APPEAL_SAFETY_HELD`, `COPYRIGHT_CONTENT_HELD`, `DOWNLOAD_PERMISSION_REQUIRED`, `MISSING_TOKEN`, `INVALID_ORDERING_FIELD`, `REMOTE_URL_REDIRECT_LIMIT`, `WEBSITE_RATE_LIMIT_EXCEEDED`, `UPLOAD_PRESET_CONTENT_TYPE_NOT_ALLOWED` and `UPLOAD_PRESET_TOO_LARGE` are removed.
  - `MockCalmLensServerClient` answers with the same codes and details.
- e94b168: Events say who caused them, the events feed can be filtered, and batch operations can be followed.
  - Every `Event` and `WebhookEventPayload` has `actor()`, an `EventActor` with a `type` (`user` for a person in the portal or an assistant acting for one, `api-key`, `automated` moderation or CalmLens itself as `system`) and the user's or API key's `id`, null when it was not recorded. It replaces the `decided-by` fact and the per-type ID facts (`reviewer-user-id`, `invited-by-user-id`, `removed-by-user-id`, `changed-by-user-id`, `transferred-by-user-id`, `created-by-user-id`, `revoked-by-user-id`). The constructors that build an event or payload in code take the actor after `projectId`.
  - `ListEvents` takes `types(List<String>)` and `assetId(String)`, for `events.list` and `events.pages`. A cursor belongs to the filters it was issued with, so pass the same ones with each cursor.
  - `assets.batch` returns `BatchAssetsResponse(batchId, status, assetCount)` in place of `queued`, and the `asset.deleted` and `asset.content-removed` events it causes carry a `batch-id` fact naming `batchId`.
  - `assets.deleteContent` is now `assets.removeContent`.
  - Renamed and split event types: `asset.progress-updated`, `usage.free-uploads-exhausted`, `usage.uploads-paused` (with `resumes-at` in milliseconds), `connector.disabled`, `project.member-left` (no more `left` fact on `project.member-removed`) and `api-key.deleted` (no more `action` fact on `api-key.revoked`). `project.transferred` has `method` (`handover` or `move`) in place of `handover`.
  - `HashMatch` has `hashListId()` and `hashListEntryId()` in place of `listId()` and `entryId()`, and `HashListEntry` names its source asset `assetId()` in place of `sourceAssetId()`. The failure reasons `free-upload-limit` and `spend-limit` are `free-uploads-exhausted` and `uploads-paused`.
  - `MockCalmLensServerClient` records each event's actor (its API key, with no ID, for API calls; `automated` for the pipeline; a `user` for `decide`), filters its feed by `types` and `assetId`, answers batches with a `batch_` ID, and names hash list entries' source asset `assetId`. `enqueueEvent` takes an optional `EventActor`.
- aabe197: Every list pages and sorts the same way, policies are an organisation resource, and lenses can be managed one by one.
  - List options take `sort(String)`, a comma-separated list of fields descending when prefixed with `-` (such as `"-createdAt,id"`), in place of `ordering(...)` and `Models.Order`, and every page record has `items()`, `nextCursor()` and `hasMore()` only (`FolderPage` also has `ancestors()`). `ListAssets` filters by folder through `filter("folderId==fldr_…")` and no longer has `folderId(...)`; `SearchAssets` takes `pageSize(...)` in place of `limit(...)`.
  - Every list has an iterator: `folders.iterate`, `hashLists.iterate`, `hashLists.iterateEntries`, `policies.iterate`, `lenses.iterate` and `assets.iterateTimeline`, beside `assets.iterate` and `assets.iterateChildren`.
  - Policies are read and changed by ID for the API key's organisation: `policies.list` returns a `PolicyPage`, `policies.retrieveAssigned()` returns the project's policy, and `policies.reset(ResetPolicy)` and `policies.upgrade(UpgradePolicy)` replace `policies.applyPreset`. A policy's `preset().mode()` (`live`, `pinned` or `copy`) replaces `preset().own()` and `automaticUpdates()`. Policy settings define every category with its `action`, `allowances` and `restrictions`, and rules no longer have `match`; a decision report's category settings name the default action `action()`.
  - `lenses.list`, `lenses.iterate`, `lenses.create`, `lenses.retrieve`, `lenses.update` and `lenses.delete` manage a project's lenses. Lenses have no `version`: `LensDefinition` no longer takes one, and `ensureLens` and `ensureLenses` change a lens to the definition sent, and the CDN serves the new definition. `ErrorCodes.LENS_NOT_FOUND` and `ErrorCodes.LENS_IDENTIFIER_TAKEN` replace `ErrorCodes.LENS_VERSION_CONFLICT`.
  - Uploads send `wait` in place of `queue`; `UploadPart.wait(Boolean)` overrides the choice saved when the upload started. `SignUploadToken` takes `expiresIn(...)` in place of `expiresInSeconds(...)`.
  - Assets list `tags` and `metadata` as empty lists and always have a `visibility`; moderation fields are null until moderation decides, `raw().hashMatches()` is always a list, OCR's text regions are `classification().ocr()` (an `OcrResult`), and feature results no longer have `stage()`.
  - `CalmLensServerClient.getEventFact(event, key)` and `CalmLensServerClient.getEventFacts(event)` read an event's facts.
  - `MockCalmLensServerClient` follows all of these.
- b2fb53c: Long audio and video: `assets.listTimeline(new Models.ListTimeline(assetId))` pages through every segment of an audio or video asset's findings timeline in time order, at `GET /projects/{projectId}/assets/{assetId}/timeline` with the client's project ID; its cursors are opaque. `classification.moderation.timeline` (`Models.ModerationTimeline`, with `segmentCount`) says how many segments there are, or is `null` for other assets, and replaces `classification.moderation.raw.timeline`. `classification.progress` reports `completedSections` and `totalSections` while long media is analysed in sections, the `asset.processing-progress` event reports the same, and the failure reasons include `media-limit` and `spend-limit`.

  Breaking: an asset's content describes its file and how it is shown. `content.image` is removed: the upload's `width`, `height`, `durationSeconds`, `pageCount`, `perceptualHash` and `perceptualHashQuality` are on `content` itself, `content.rendered` (`Models.AssetRendered`, with a `Models.AssetRenderedKind` of `image`, `pdf`, `video` or `audio`, its `format`, `width`, `height` and audio `peaks`) describes the displayable file the CDN's `rendered` resource serves, and `content.preview` (`Models.AssetPreview`, with `width`, `height`, `thumbhash` and `averageColor`) the still image that stands for the asset. Either is `null` when the asset has none. `content.fileMetadata` is renamed `content.metadata`.

  The CDN has a `preview` resource, and signed URLs accept `original`, `rendered` or `preview` (`CalmLensServerClient.SIGNED_CDN_RESOURCES`; `CDN_RESOURCES` adds `placeholder`). Lenses and transforms apply to `preview`, and to `rendered` when it is an image; only `original` (and `placeholder` in URL building) refuses them in the SDK, and the CDN refuses them on rendered PDFs, video and audio with `asset/invalid-transform`.

  The mock client serves the timeline endpoint at the project path (empty, refusing any cursor, and `asset/safety-held` while a safety hold is on), gives each asset type its rendered file and preview at upload and decision, serves the `preview` resource, withholds the rendering and refuses every CDN resource while a safety hold is on, and gives mock assets a `null` progress and moderation timeline.

  Audio and video can be up to 2 GiB when sent in parts, whether `assets.create` and `assets.classify` split a large file or you use the multipart part API; one request still takes up to 50 MiB. Before billing is set up, the API keeps every audio and video upload to 50 MiB and answers `upload/file-too-large`.

- 401e477: `MockCalmLensServerClient` filters assets like the API: only the documented asset fields and the `==`, `!=`, `>`, `>=`, `<`, `<=`, `=in=` and `=out=` operators, with any other field or operator, such as `=like=` or `=gt=`, refused with `validation/invalid-filter` (HTTP 400). `*` wildcards ignore case, a number field needs a number, and a comparison never matches a missing value. Ordering by a field other than `createdAt` or `id` is refused with `validation/invalid-value`.
- 4bcaf59: `MockCalmLensServerClient` filters `tags` like the API: only `=in=`, an asset with any of the tags, and `=out=`, an asset with none of them, including one without tags. Any other operator on `tags`, such as `tags==homepage`, is refused with `validation/invalid-filter` (HTTP 400).
- e94b168: Moderation outcomes are reported as statuses, reviews no longer carry personal data, and uploads take tags.
  - `AssetClassificationStatus.QUEUED` replaces `PENDING`: the asset is waiting for its content, such as a multipart upload still receiving parts, or for its turn. An asset is settled once its `classification().status()` is `COMPLETED` or `FAILED`.
  - `assets.waitForDecision` returns once the asset is settled, and keeps waiting while it is queued or processing, even when a reviewer has already decided it. A failed asset is returned with its `classification().failureReason()`.
  - Each `AssetReview` has `decidedBy()`, a `ReviewDecider` with a `type` (`user` or `api-key`) and the user's or API key's `id`, and `applied()`, which replaces `appliedToAsset()`. Reviews no longer include `reviewerName` or `reviewerEmail`.
  - `AssetModeration.automatedStatus()` (`ALLOWED`, `LIMITED`, `AGE_RESTRICTED`, `BLOCKED` or `PURGED`) replaces `automatedAction()`, and is null before a decision.
  - Each `RegionalDecision` has a `status()` (`LIMITED`, `AGE_RESTRICTED`, `BLOCKED` or `PURGED`) in place of its `action()`.
  - `LinkSafetyDecision.links()` lists the `CheckedLink`s that take the link-safety action, each with its URL, final URL, redirects, source, verdict and evidence, in place of their indexes.
  - `CategoryPolicySource.indexes()` names the deciding allowance or restriction rules, the decisive rule first; `index()` is removed.
  - Assets no longer include `classification().labels()`, `classification().moderation().testCategoryActions()`, `testRegionalActions()`, `processingOptions()` or the policy-condition answers in `classification().moderation().raw().categories()`. `processingOptions` remains an upload option, and `UpdateAsset` no longer takes it. The `ClassificationLabel` and `TestRegionalAction` types are removed.
  - `SubmitAsset.tags` and `ClassifyText.tags` set the asset's tags, which it keeps in `tags()`.
  - Event facts: `asset.region-restricted` reports `status` in place of `action`, `asset.link-flagged` reports `link-status` in place of `link-action`, and `asset.review-requested` reports `automated-status` in place of `automated-outcome`. The asset snapshot's `classification.status` is `queued` where it was `pending`.
  - `MockCalmLensServerClient` follows: an open multipart upload is queued, reviews record `decidedBy` as the mock API key (with no ID) and `applied`, decided assets carry `automatedStatus`, created assets keep their tags, and assets no longer include `processingOptions`.
- a3c2fb3: Requests that fail with HTTP 500 (`misc/internal-error`) are retried like other transient errors, with the same backoff and idempotency keys; a 501 still isn't. The `asset/no-rendered-version` error code is available for a CDN request for a rendered version an asset doesn't have. The mock client signs viewer claims into signed URLs as the API does, gives an `asset.<status>` event the status it announces, and records an API key's decision with `decided-by` set to `api-key`.
- 92090b7: Adaptive streaming of audio and video, and an embed page for every asset (preview).
  - The CDN's new `hls` resource serves an audio or video asset's adaptive stream, its HLS master playlist at `/hls/index.m3u8` (one signature covers every playlist and segment beneath `/hls/`), and the new `embed` resource serves an HTML page at `/embed` that shows any asset in an iframe. `cdn.getAssetUrl`, `cdn.serve` and `assets.createSignedUrl` accept both, and `SIGNED_CDN_RESOURCES` and `CDN_RESOURCES` list them. Neither takes a lens or transform; the SDK refuses one with `sdk/invalid-argument`, as it does for the original.
  - `AssetContent.hls()` (`AssetHls`) describes the stream once one is prepared: its `renditions`, each an `AssetHlsRendition` with `kind` (`video` or `audio`), `width`, `height`, `bandwidth` and `codecs`. It is null for other assets and until then. `AssetContent` gains the `hls` component.
  - `ProcessingFeatures.streaming(FeatureOptions)` turns streaming on or off for an upload; left null, the project's setting decides. `ProcessingFeatures` gains the `streaming` component.
  - The mock client prepares no stream, so `hls()` is null and the `hls` resource answers `asset/no-rendered-version`; it serves an embed page for every asset it may deliver.
- f5c796b: Test scenarios can declare person and face detection results: `TestInput.withDetections` takes a `TestInput.Detections` of people and faces, each a `TestInput.DetectionList` of entries (`DetectionList.of(...)`, at most 32) or `DetectionList.unavailable()` to report the feature as not evaluated. Each `Person` and `Face` has a `Box` (`left`, `top`, `width` and `height` in basis points of the image, 0 to 10000) and an optional confidence (0 to 100), and a face can have an age (`FaceAge.ADULT`, `FaceAge.MINOR` or a `FaceAge.Range` of years). `TestInputs` adds the `ONE_FACE`, `NO_FACE`, `ADULT_FACE`, `MINOR_FACE` and `GROUP` presets. `AssetClassification.testInput()` and `EventAssetClassification.testInput()` tell whether results came from a test input, and `MockCalmLensServerClient` reports the person and face detection an image upload turned on, finding nobody, and never marks an asset as a test input.
- d9b5400: Text codes and test images from `TestInputs.generateTestTextCode` and `TestInputs.paintTestImage` now use the current signed format, which CalmLens requires. CalmLens recognises a text code only as the whole submitted text, and a test image only as the whole upload, in projects with "Recognise test inputs" turned on. Codes and images made by earlier versions are no longer recognised.

## 0.20.0

### Minor Changes

- 244ef8e: `MockCalmLensServerClient.Options` has a `projectId` option for a mock built without a client builder, which uses `project-1` (`MockCalmLensServerClient.MOCK_PROJECT_ID`) by default. A builder sets its own project ID, so setting the option alongside one throws `sdk/invalid-argument`.
- e1b32c3: Structured transform options are checked against the image transform schema before a CDN or signed URL is built: an unknown option (such as the earlier `{ type: "imageTransform", options: { ... } }` shape) or an invalid value (such as `width: 0` or `format: "bmp"`) fails with `sdk/invalid-argument`, naming each option, instead of building a URL the CDN refuses. Selector strings are passed to the CDN unchanged.

  Every SDK refuses an upload whose type CalmLens can't moderate (anything other than an image, audio, video, text, document or web page, such as `application/zip`) with `upload/invalid-mime-type` before sending it, as the API does.

  An option given as `null` (`None` in Python, `nil` in Ruby) is left out of the request, as if omitted, unless the API takes `null` for it, such as `description` to clear it or `folderId` for the project root. Passing `viewer_claims=None` to `create_signed_url` now works. In Java and Rust, `UpdateAsset`'s name is a plain optional string, since a name can't be cleared.

  The mock clients answer more like the API: they refuse `metadata` that isn't a list of `{ id, value }` items and `null` for fields the API refuses it for with the same `validation/...` error, refuse the same upload types, and their CDN refuses a transform it can't read (`asset/invalid-transform`) or whose options are invalid (`asset/invalid-transform-options`).

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
- 8cc1cae: Add `client.assets.batch(new BatchAssets().assetIds(...).operation(...))`, which deletes up to 500 assets (`AssetBatchOperation.DELETE`) or removes their stored content (`AssetBatchOperation.REMOVE_CONTENT`) in one request and returns a `BatchAssetsResponse` with `queued()`. It sends `POST /projects/:projectId/assets/batch`. Every asset must exist in the project and the API key needs `assets:delete` for its folder, or the request fails (`asset/not-found`, `auth/permission-denied`) and nothing is queued; once queued, the work runs in the background and records `asset.deleted` or `asset.content-removed` for each asset. The method refuses an empty list, more than 500 IDs, an empty ID or a missing operation with `sdk/invalid-argument` before sending, and is not retried. The new `auth/permission-denied` error code is available as a constant. The mock client validates the batch like the API and applies it at once.
- 58840e7: Adds `assets.decide(new DecideAsset(assetId, decision, note))`, with `confirmPurge(true)` for purges, which records a reviewer's decision with a note and returns the asset. Every list now pages with cursors: `ListFolders` takes `cursor`, `pageSize` and `ordering` (by `name` or `createdAt`) instead of `pageIndex`, `sort` and `direction`, and `FolderPage` returns `items`, `ancestors`, `nextCursor`, `pageSize`, `hasMore` and `ordering`. `hashLists.list(ListHashLists)` returns a `HashListPage`, replacing `HashListList`. `ListEvents` takes `cursor` and `pageSize` instead of `after` and `limit`, and `EventsPage` returns `items` and `nextCursor`. `ErrorCodes.INVALID_EVENT_CURSOR` is removed: an unreadable events cursor is `INVALID_CURSOR`. The mock client implements `assets.decide` with the API's validation and the new list shapes.
- 105ccc2: Add the `limited` moderation status and the `limit` policy action. A `limited` asset is delivered like an allowed one, from the same public URL, but is marked so your app can reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it lower or collapsing it. `AssetModerationStatus.LIMITED` and `AssetModerationDecision.LIMITED` represent it, decisions to limit an asset arrive as `asset.limited` events, and `assets.waitForDecision` returns once an asset is limited. `MockCalmLensServerClient.Outcome.LIMITED` sets the outcome in the mock, which serves limited assets like allowed ones, and `mock.decide(assetId, Outcome.LIMITED)` adds an `asset.limited` event with `low` severity.
- 7c7f2a7: `MockCalmLensServerClient.Options.moderate` decides each asset the mock moderates from the stored asset, its uploaded bytes and text, why it is moderated (an upload, a retry, a rerun or `completeProcessing`) and whether CalmLens would queue the work. It returns a `MockDecision`: `MockDecision.of(status)` with `flag(category, score, qualifiers)` and `notEvaluated(category)`, which fills the asset's report with every category, the highest score and the policy's flagged categories. It replaces `queuedOutcome` and `analyzedOutcome`. `completeProcessing(assetId, decision)` finishes processing a pending asset as CalmLens would, and finished uploads record `asset.uploaded`, `asset.classified` and the automated `asset.<status>`, or `asset.failed`. `failNextRequest(failure, FailureOptions)` sets an operation, an API error's `details` and `Retry-After`, fails exactly one request per queued failure and refuses unknown operations; `enqueueRateLimited` is removed. The mock's client makes no retries unless its builder sets `maxRetries`. `decide` refuses `PENDING` and `FAILED`. Recorded requests carry the response `status()` and a `path()` relative to the base URL with decoded segments, and `clearRequests()` forgets them.
- 958be0d: `MockCalmLensServerClient`'s CDN now answers like the real one: blocked, purged and failed assets, and assets whose content was removed or is still uploading, return `403` with `asset/not-available` whatever the key, before any permission check. Missing or removed content previously returned `404` with `asset/content-unavailable`. `decide` gives its event the event catalog's severity: `low` for `allowed`, `high` otherwise.
- 6232efc: The client now matches the other CalmLens SDKs request for request:
  - API requests have a 120-second deadline by default, and binary uploads have none unless you set `uploadTimeout`; text uploads keep the API deadline.
  - `RequestOptions` takes `timeout`, `uploadTimeout` and `maxRetries` for one call, and `client.withRequestOptions(options)` returns a client whose every call uses them, sharing the connection and lens cache.
  - Retries wait half the backoff plus a random part of it, honour `Retry-After` given as a date, and retry a `Retry-After: 0` at once. Redirects fail with `sdk/http-error`, `cdn.serve` included, and `cdn.serve` returns the last response once its retries run out.
  - `assets.iterate`, `assets.iterateChildren` and `events.pages` fail with `sdk/invalid-response`, naming the `cursor`, instead of looping when a page hands back a cursor they already sent.
  - Concurrent `ensureLenses` calls for the same new definitions share one request.
  - `Content.stream(inputStream, mimeType)` uploads a stream of unknown size. Idempotency keys are checked by CalmLens, which answers with its own error codes.
  - `verifyWebhookRequest` and `parseWebhookRequest` take the request's headers, in any letter case and with repeated headers joined. Parsing requires a numeric `createdAt` and the API's types for known fields, and `WebhookEventPayload.json()` and `Event.json()` keep fields this SDK version doesn't model. `isTestWebhookEvent` tells test sends apart.
  - Transport errors no longer carry a `network` detail, and requests send `Accept: application/json` and `User-Agent: calmlens-java/<version> (java/<runtime version>)`.
  - The mock follows the API more closely: validation errors with the field's `path`, scoped list cursors, `asset.retried`, `asset.content-removed` and `asset.deleted` events, ThumbHash placeholders and the CDN's headers, multipart and idempotency rules (a key is read without surrounding whitespace, as HTTP sends it), folder and lens error details, and lenses saved in order. `failNextRequest`, `setApiKeyGrants`, per-asset outcome functions and `MockCalmLensServerClient.signUploadToken` for exact test tokens are new.
- 3d58076: `MockCalmLensServerClient` now answers from an in-memory API, like the other SDKs' mock clients. Uploads create assets you can retrieve, list, search, update, move and delete, and the CDN serves their stored bytes. `Options` sets the outcome of queued and analyzed uploads (`pending`, `allowed`, `age-restricted`, `blocked`, `purged` or `failed`) and makes IDs and timestamps deterministic. `decide(assetId, outcome)` applies a reviewer decision and adds the matching event, `enqueueEvent` adds events to the feed, and `createMockApiKey` creates keys with the download grant for private and age-restricted CDN reads. Queued responses still take precedence.
- 5ef0bc2: Follows the CalmLens API v1 contract:
  - `assets.list` and `assets.iterate` request `GET /v1/projects/{projectId}/assets`.
  - Sort directions in `Order` are lowercase: `"asc"` and `"desc"`.
  - `ApiException.getTraceId()` is removed and `getDetails()` no longer carries `traceId`. `getRequestId()` is the `X-Request-Id` header, or the error body's `requestId`.
  - `ErrorCodes` includes the validation codes (`INVALID_TYPE`, `TOO_SMALL`, `TOO_BIG`, `INVALID_FORMAT`, `INVALID_VALUE`, `UNKNOWN_FIELD`, `UNSUPPORTED_CONTENT_TYPE`, `INVALID_FILTER`, `INVALID_ORDERING_FIELD`) and `ROUTE_NOT_FOUND`, `INTERNAL_ERROR`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_TOKEN`, `SEARCH_UNAVAILABLE`, `INVALID_TRANSFORM`, `INVALID_TRANSFORM_OPTIONS`, `REMOTE_URL_REDIRECT_LIMIT`, `COPYRIGHT_CONTENT_HELD` and `DOWNLOAD_PERMISSION_REQUIRED`.
  - Webhook bodies use the same flat shape as `events.list` items. `WebhookEventPayload` has `id`, `projectId`, `type`, `severity`, `title`, `description`, `assetId`, `asset`, `facts` and `createdAt`; `data()` and `WebhookEventData` are removed. `parseWebhookEvent`, `isTestWebhookEvent` and `toWebhookEventPayload` read and write that shape.
  - `Event` no longer has `userId`, `notifies`, `updatedAt` or `readAt`, and its components follow the API's field order.
  - `Asset` no longer has `userId`, and `AssetContent` no longer has `safetyTest`.
  - `ListFolders` no longer takes `searchAll`, `ids` or `resolveOnly`; `folders.list` returns 50 folders by default.
  - `MockCalmLensServerClient` follows the same contract: error bodies are `{ code, message, requestId, details }`, and every cursor list defaults to 50 items.
- 7fa8620: `Lens` no longer includes `userId`.
- 2b11c12: Breaking: an asset's moderation outcome is now `classification.moderation.status`: `pending`, then `allowed`, `age-restricted`, `blocked` or `purged`. It replaces `classification.moderation.decision` and `classification.moderation.action`, and filters use `classification.moderation.status`. Manual reviews record their `decision` as one of the four decided statuses and no longer have an `action`. Policy actions are `allow`, `age-restrict`, `block` and `purge`; `flag` is removed.

  Webhook and event types `asset.flagged`, `asset.approved` and `asset.rejected` are replaced by `asset.classified` and one event per status: `asset.allowed`, `asset.age-restricted`, `asset.blocked` and `asset.purged`. Event asset snapshots carry `classification.moderation.status`, and the `moderation-action` and `review-action` facts are replaced by `moderation-status` and `decided-by`.

  Waiting for a decision returns once the status is no longer `pending`. Mock clients take the new statuses as outcomes, and `purged` removes the content.

  CDN URL builders take an `ageConfirmed` option that adds `ageConfirmed=true`, so a public age-restricted asset can be served from its public URL where your app has already decided the viewer may see it. Without it, age-restricted assets need a signed URL or an API key.

- dd08099: CalmLens IDs now name the kind of object they identify: a prefix, an underscore and 20 letters and digits, such as `proj_8fK2mQx7Lp4NvB3tRz9Y` for a project, `asset_5Gm2Rk8XqT3wLp9VbN4c` for an asset and `fldr_7Nc4Wq2Lm8Xt5Rk9Bv3P` for a folder. The in-memory mocks mint IDs the same way, and their ID option (`createId`, `create_id` or `CreateID`) now receives the prefix of the object it names (`asset`, `fldr`, `hl`, `hle`, `lens`, `evt` or `rev`). The mocks' `assets.batch` refuses an ID that is not an asset ID with `validation/invalid-format`, as the API does.
- af0bb68: Uploads no longer take `processingOptions.flaggedContentPolicy`: the project's moderation policy decides every asset, with its allowances and restrictions. The typed processing options drop it (Go, Java, Python, Ruby and Rust remove the `FlaggedContentPolicy` type), and `classification.moderation.source` no longer reports `asset-override` (Go drops `DecisionSourceAssetOverride`). JavaScript exports the policy action type as `PolicyAction` instead of `FlaggedContentAction`.
- 64e9180: Asset reviews no longer include `reviewerUserId`, and hash lists and hash list entries no longer include `createdByUserId`.
- 454706c: Uploads and text classification take `authorId` and `context`: who wrote the content and the earlier posts of its conversation, oldest first, each with an optional author ID. CalmLens moderates only the content and uses the earlier posts to read who it addresses and whether it quotes, reports, counters or mocks something. The SDKs send only the posts CalmLens uses, the most recent 5 that fit in 2,000 characters, and export the rule that picks them. Assets return `authorId` and the `context` used, which is `null` once the content is removed. The offline mocks store both and drop the context with the content.
- 17cdb9b: CDN methods, signed URL creation and media widgets accept optional `viewerClaims` containing `region` and `ageConfirmed`. These replace the separate region and age options. The CDN defaults to the connecting country and no age confirmation, including authenticated requests. Customers determine the assertions; CalmLens applies content restrictions without independently verifying them.

  Asset retrieval returns stored moderation results without a request-specific `delivery` object or region parameter. Pass viewer context on the CDN request instead. Raw HTTP supports a JSON query parameter or `X-CalmLens-Viewer-Claims` header. Age-restricted delivery without confirmation returns `viewer/age-confirmation-required`; private access remains a separate requirement.

- 958be0d: New helpers build signed webhook deliveries for testing a webhook handler, as the JavaScript, Python and PHP SDKs already do. `CreateWebhookHeaders` (Go), `create_webhook_headers` (Rust), `CalmLens.create_webhook_headers` (Ruby) and `CalmLensServerClient.createWebhookHeaders` (Java) return the `content-type`, `x-calmlens-delivery`, `x-calmlens-timestamp` and `x-calmlens-signature` headers for a body. Ruby's `CalmLens.to_webhook_event_payload` and Java's `CalmLensServerClient.toWebhookEventPayload` convert an event from `events.list` to its delivery body.

### Patch Changes

- 6d65133: Event facts' `url` is now a stable link that opens the item in the CalmLens portal, such as `https://calmlens.com/go/asset/<asset-id>`, in webhook payloads and the events feed. The in-memory mocks give asset facts the same links.
- 91cd4a1: The `MockCalmLensServerClient` in-memory API answers with the HTTP statuses the API sends: `201 Created` for `folders.create`, `202 Accepted` for `assets.batch`, and `200` with an empty JSON object for asset and folder deletes (it answered `200` for creates and the batch, and `204 No Content` for deletes).
- 92bf5db: `MockCalmLensServerClient` `assets.search` matches every word of the query in any searchable field and returns the API's keyword scores, matched fields and ranking. Mock list filters accept parentheses, with `;` binding tighter than `,`. The default mock clock gives assets created in a row increasing `createdAt`, so lists, cursors and search order them predictably. `CalmLensException.isRetryable()` follows from the code and status whichever exception class carries them: the `sdk/timeout` that `assets.waitForDecision` throws at its deadline is now retryable, like `sdk/transport-error`, `idempotency/request-in-progress` and `429`, `502`, `503` and `504`.
- e4e9894: `CalmLensMedia` shows the CDN placeholder for private assets and signed URLs too, since the CDN serves every asset's placeholder publicly. It sends only viewer claims that differ from the defaults (a `region`, or `ageConfirmed: true`), so `ageConfirmed: false` no longer makes the CDN's responses private and uncacheable, and placeholder URLs carry only the region. The mock clients serve private assets' placeholders without `assets:download`, as the CDN does.
- 1e59923: The mock clients' `cdn.serve` now sends `Cache-Control` as the CDN does: `public` only when anyone may see the asset (including a public age-restricted asset requested with `ageConfirmed`), otherwise `private`, with `max-age=31536000, immutable` for images and `max-age=3600` for other content. They previously sent `private, no-store` or `public, max-age=31536000`. PHP's `MockServerClient::decide` now also records the review in the asset's `manualReviews`, as the Rust and Java mocks already did.
- 958be0d: Creating a signed URL now fails with `sdk/invalid-argument` before sending anything when the API would reject it: a resource other than `original` or `rendered` (a placeholder needs no signed URL), a lens or transform on the `original` resource, or a lifetime that is not a whole number of seconds from 1 to 86400 (24 hours). The longest lifetime is available as `MAX_SIGNED_URL_SECONDS` in Rust and Java, `MaxSignedURLSeconds` in Go, `CalmLens::Assets::MAX_SIGNED_URL_SECONDS` in Ruby and `CalmLens\Assets::MAX_SIGNED_URL_SECONDS` in PHP.

## 0.1.2

### Patch Changes

- 9da6766: Document image-owned OCR text in `content.extractedText` and the additional text moderation pass in the image’s combined report. Update the Java marketplace example to retrieve and remove image text without child assets.
