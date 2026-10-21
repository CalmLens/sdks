## 0.16.3

### Patch Changes

- 9da6766: Document image-owned OCR text in `content.extractedText` and the additional text moderation pass in the image’s combined report. Update the Java marketplace example to retrieve and remove image text without child assets.

## 0.16.0

## 0.16.2

- Maintain the SDK and examples in the public CalmLens/sdks repository, with standalone buildable TypeScript source and public issue links.

### Minor Changes

- bf9eaa5: Breaking: asset and child-asset lists now accept `cursor` instead of `pageIndex` and return `nextCursor`. The exported generic page type is now `CursorPage`. Iterators follow continuation cursors automatically. Public list ordering supports `createdAt` and `id`, with an ID tie-breaker; exact totals are no longer returned.

  Webhook parsing returns an extensible payload type that admits future event types, fact keys and fields. Signature verification remains required.

## 0.15.0

### Minor Changes

- 6ee8e46: `generateMediaTestCode` from `@calmlens/sdk/testing` takes your project's test input key, shown in the portal's test inputs panel, in place of the project ID. Test inputs only work with that key, so people outside your project can't make one.

## 0.14.0

### Minor Changes

- 3fa1cdf: `Asset` groups its state into `processing`, `moderation` and `content`. `classification.status` is `uploading`, `processing`, `done` or `failed`; `moderation` has the decision in force (`status`: `pending`, `approved` or `rejected`), what your policy did (`action`: `alert`, `hide`, `purge` or `null`), the automated `note`, the reviewer's decision (`reviewerAction`, `reviewerNote`, `reviewerUserId`, `reviewedAt`), `completedAt` and the `report`; `content` has whether CalmLens holds the content (`status`: `temporary`, `stored` or `removed`, with a `removalReason`), the safety hold, `format`, `extension`, `sizeInBytes`, `checksums`, `image`, `previewImage` and `extractedText`. Event asset snapshots carry `classification.status`, `classification.moderation.decision`, `classification.moderation.action` and `content.status`.

  This is a breaking change: the top-level `status`, `moderationAction`, `rejectionNote`, `report`, `safetyHold`, `storageDeletedAt`, `fileFormat`, `fileExtension`, `sizeInBytes`, `checksums`, `imageData`, `previewImage`, `extractedText` and `uploadPartsReceived` fields, `report.flagged`, `documentData` and the `AssetStatus` type are gone; a flagged asset is one whose `classification.moderation.action` is not `null`. Filter lists with `classification.moderation.decision`, `classification.status` or `content.status`. `assets.waitForDecision` returns once `classification.moderation.decision` is `approved` or `rejected`, or `classification.status` is `failed`. `MockCalmLensServerClient` takes `mockOptions.queuedOutcome` and `analyzedOutcome` (`pending`, `approved`, `rejected` or `failed`) in place of `queuedStatus` and `analyzedStatus`, and removes content after processing unless `keepContentAfterProcessing` is set.

## 0.13.0

### Minor Changes

- ed7ad07: Wait for an asset's moderation decision with `assets.waitForDecision({ assetId, timeoutMs, signal })`. It resolves with the asset once it's `approved`, `rejected` or `error`, checking every few seconds, and rejects with `sdk/timeout` if no decision arrives within `timeoutMs` (default 60000) or `sdk/cancelled` when `signal` aborts. `MockCalmLensServerClient` supports it too.

## 0.12.0

### Minor Changes

- 8a18b7b: Turn on optional analyses per upload with `processingOptions.features`: `ocr`, and in beta `personDetection` and `faceDetection` (with `ageEstimation` for an estimated age range per face). Person and face results are typed in `asset.report.features`.

  `processingOptions.image.ocrEnabled` is replaced by `processingOptions.features.ocr.enabled`; the API rejects the old option.

  Every public request and response type is now exported and precise, including checksums, image and document data, preview images, safety holds, extracted text, report labels and qualifiers, event asset snapshots and `SearchAssetsOptions`. `LensTransform` accepts only typed image transforms, and the testing client's recorded calls are typed per operation.

- 8a18b7b: The SDK has two clients, each with its own import. `CalmLensServerClient` from `@calmlens/sdk/server` replaces `CalmLensClient` on your server: it takes your API key and has every method, plus `uploadTokens.sign` and webhook verification. `CalmLensAppClient` from `@calmlens/sdk/app` uploads from browsers and React Native apps through an upload preset with `uploadPresetId` and an optional `token`; it has `assets.create`, `assets.classify`, `assets.uploadPart` and `assets.retrieve`, and refuses an API key. The app import leaves out server-only code such as webhook verification.

  This is a breaking change: `@calmlens/sdk` now exports only types, `CalmLensError`, error codes and `SDK_VERSION`. Replace `import { CalmLensClient } from "@calmlens/sdk"` with `import { CalmLensServerClient } from "@calmlens/sdk/server"`, and `MockCalmLensClient` with `MockCalmLensServerClient` from `@calmlens/sdk/testing`. Webhook helpers such as `verifyWebhookSignature` and `parseWebhookEvent` move to `@calmlens/sdk/server`.

### Patch Changes

- 8a18b7b: The SDK runs in React Native and Expo apps. Uploads no longer fail there for lack of `crypto.randomUUID` or `AbortSignal.throwIfAborted`, and `uint8Array`, `buffer`, `base64` and text content upload without building a `Blob`, which React Native can't create from bytes. `CalmLensServerClient` refuses to start in a React Native app unless you set `dangerouslyAllowBrowser: true`, as it does in browsers; apps upload with `CalmLensAppClient` instead.

## 0.11.0

### Minor Changes

- a6cc8c8: `cdn.getAssetUrl`, `cdn.serve` and `assets.createSignedUrl` accept structured transforms as well as selector strings: pass `{ type: "imageTransform", options: { format: "png", width: 1024 } }` or an array of steps. The new `CdnTransform` type describes both forms.

  Selector strings such as `imageTransform[format=png,width=1024]` work with `cdn.getAssetUrl` and `cdn.serve` again. The SDK escaped their brackets, so the CDN answered `400 asset/invalid-transform`.

## 0.10.1

### Patch Changes

- 163a162: Requests work in Cloudflare Workers again. 0.10.0 asked `fetch` to fail on redirects with `redirect: "error"`, which Workers don't support, so every request failed with `sdk/transport-error`. The SDK now refuses redirects itself, so the API key still never follows a redirect to another origin.

## 0.10.0

### Minor Changes

- ef0c32e: Safer retries, richer errors, streaming transfers and a much smaller bundle.

  **Breaking changes** (pre-1.0, so released as a minor version):

  - `verifyWebhookSignature` no longer accepts a parsed object as `payload`; it throws `sdk/invalid-argument`, because re-serializing JSON can change the signed bytes. Pass the raw body as a string, `Uint8Array`/`Buffer` (for example from `express.raw()`, which previously failed to verify) or `ArrayBuffer`.
  - `toWebhookEventPayload`, `createWebhookHeaders`, `generateMediaTestCode` and `MEDIA_TEST_SIGNALS` moved from `@calmlens/sdk` to `@calmlens/sdk/testing`.
  - The `requestBackend` option is removed; pass `fetch` instead, which is now used for every request. Passing `requestBackend` throws `sdk/invalid-config`.
  - Missing or invalid method arguments (such as an empty or `..` asset ID) throw `sdk/invalid-argument`, and invalid client options `sdk/invalid-config`, instead of `upload/invalid-payload`. Upload content checks keep the API's codes.
  - API errors no longer set `details.network`; use `status` and `requestId`.
  - `CalmLensClient` refuses to start in a web page, where every visitor could read the API key, unless you pass `dangerouslyAllowBrowser: true`.
  - `Asset["status"]`, `Asset["type"]` and `Asset["visibility"]` also allow values this SDK version doesn't know, so handle unknown values instead of switching exhaustively.
  - Binary uploads no longer have a 120-second deadline by default; set `uploadTimeoutMs` to add one. `cdn.serve`'s `timeoutMs` now ends when response headers arrive, so long downloads aren't cut off.

  **New:**

  - Reads, and creates and uploads, which now send an `Idempotency-Key`, are retried after network failures, `429`, `502`, `503`, `504` and `idempotency/request-in-progress`, with jittered backoff that honours `Retry-After`. Configure with `maxRetries` (default 2). Pass `idempotencyKey` to `assets.create`, `assets.classify`, `text.classify` or `assets.uploadPart` to retry safely across processes.
  - `CalmLensError` exposes `requestId`, `headers` and `retryAfter`, and `isNotFound()` and `isRetryable()`. `instanceof CalmLensError` and the new `CalmLensError.isCalmLensError()` recognise errors from both the ES module and CommonJS builds. `CALMLENS_ERROR_CODES` lists every documented code.
  - `parseWebhookEvent` verifies a delivery and returns the parsed event. Webhook helpers can read the signature and timestamp from `headers`.
  - `assets.iterate`, `assets.iterateChildren` and `events.pages` page through results for you.
  - Multipart uploads use the queue mode CalmLens saves when they start, so `uploadPart` no longer needs the same client instance; pass `queue` to override it and `totalSizeInBytes` to declare the file's size up front.
  - `ensureLenses` fails with `sdk/invalid-response` if the API returns fewer lenses than requested.
  - Requests send `User-Agent: calmlens-js/<version> (<runtime>)`; `SDK_VERSION` exports the version. JSON responses are limited to `maxResponseBytes` (32 MiB by default), and the API key is kept out of `console.log` and `JSON.stringify`.
  - `MockCalmLensClient` errors carry the API's status, a request ID and headers. The mock applies list ordering and simple filters, implements `assets.search`, serves events added with `enqueueEvent`, enforces multipart part order, replays idempotency keys and returns CDN-like responses.
  - The package loads no other packages at runtime (`zod` is installed only for its type declarations): importing only `verifyWebhookSignature` adds about 5 KB instead of 111 KB, and the client about 25 KB. It declares the MIT license, a `default` export condition and `./package.json`.

## 0.9.1

### Patch Changes

- 0f2e174: The SDK's API definitions include the new `idempotency/invalid-key`, `idempotency/key-reused`, `idempotency/request-in-progress` and `upload/size-mismatch` error codes and the updated upload descriptions, so these errors are recognised by code. Request behaviour is unchanged.

## 0.9.0

### Minor Changes

- d65c25f: Add `assets.deleteContent({ assetId })`, which removes an asset's stored content (source, preview and retained extracted text) and returns the asset with `storageDeletedAt` set, keeping its record and classification results, and `assets.delete({ assetId })`, which deletes the asset record with its content. `MockCalmLensClient` implements both, records them as `assets.deleteContent` and `assets.delete`, and stops serving the removed content from `cdn.serve`. The `DeleteAssetOptions` and `DeleteAssetContentOptions` types are exported.

### Patch Changes

- 9008176: Asset, folder, lens and project IDs are always sent as a single encoded path segment, so an ID containing `/`, `?`, `#`, `%` or spaces can no longer reach a different API route, and `.` or `..` IDs are rejected with an `upload/invalid-payload` error before any request is sent. CDN transform selectors containing `..`, `?` or `#` are rejected the same way.

  `assets.list` and `assets.listChildren` now send `ordering` correctly instead of as `[object Object]`, and query values such as RSQL filters with commas, `&` or `#`, and search text, are fully encoded. `assets.list()` can be called without options.

## 0.8.1

### Patch Changes

- 4c999b8: Webhook signature verification uses the same signing helpers as the CalmLens API, with no change to its behaviour or API. Development dependencies are updated.

## 0.8.0

### Minor Changes

- 5f7868e: Add typed facts for appeal submission and resolution events. Appeal endpoints remain unavailable while the appeals feature is disabled.

## 0.7.0

### Minor Changes

- 3f3e584: Add `assets.search({ query, mode?, limit? })` to find assets in the project. `mode` is `"keyword"`, `"semantic"` or `"hybrid"` (the default), and `limit` is 1–20 (default 10). Each result has the `asset`, a `score` and the `matchedFields` it matched on. The response's `semanticStatus` is `"disabled"` when AI asset search is off for the project, `"indexing"` while assets are still being indexed, `"unavailable"` when semantic search could not run, and `"ready"` otherwise; keyword matches are returned in every case. The `AssetSearchQuery`, `AssetSearchResponse` and `AssetSearchResult` types are exported.

## 0.6.0

### Minor Changes

- d854cf3: Errors while reading a response body (connection resets, truncated bodies, decompression failures) now reject with `CalmLensError` code `sdk/transport-error`, with the original error as `cause`. Previously they were reported as `sdk/invalid-response`. `sdk/invalid-response` now means a fully received body that is not the expected JSON. The JSON API and upload requests read the whole body before parsing it. `cdn.serve` still returns the response as a stream.

  The client now checks `baseUrl` and `cdnBaseUrl` before setting anything up: each must be an absolute http(s) URL. An invalid value throws a `CalmLensError` instead of a `TypeError` on the first request. The package now declares `engines.node >= 22`, the minimum its dependencies support.

  `MockCalmLensClient` accepts and validates the same options as `CalmLensClient`. Breaking: it now reads the top-level `cdnBaseUrl`, and `mockOptions.cdnBaseUrl` has been removed. It also has new testing features:

  - `failNextRequest("transport-error" | "timeout" | error, { operation? })` simulates network failures and timeouts.
  - `calls` and `callsTo(operation)` record each call as `{ operation, options }`.
  - `assets.update` was added.

  The mock now rejects missing IDs, names, content and part options with `CalmLensError` code `upload/invalid-payload`, and unknown assets with `asset/not-found`, as the real client does. Previously it threw plain `Error`s without a code.

  The README now covers paging through `events.list`, the shape returned by `assets.classify` and `text.classify`, and the webhook header constants. It also fixes the webhook body example, which now shows `facts`.

- d854cf3: Move the CLI to the standalone `calmlens` package. Use `npx calmlens` or install the standalone binary for local webhook development. Export webhook delivery helpers for CLI integrations.

## 0.5.0

### Minor Changes

- e08ebc2: Add a media test-code generator and typed timestamped audio/video classification reports. Audio and video uploads are always processed asynchronously.
- e08ebc2: Rename the npm package to `@calmlens/sdk`. Update installation and import paths, including the `@calmlens/sdk/testing` entry point. The `calmlens` CLI command stays the same.
- e08ebc2: BREAKING: Replace `assets.analyze()` with `assets.classify()` without a compatibility alias. Both `assets.create()` and `assets.classify()` take the same asset options; create queues processing and classify waits for classification. Keep `text.classify()` as a convenience wrapper around `assets.classify()`. Update mocks, examples, documentation, and cross-language contracts.
- e08ebc2: Breaking: webhook deliveries (now sent by `webhook` connectors) use a new body and signature. The body is `{ id, type, createdAt, projectId, data }` (exported as the `WebhookEventPayload` type) and deliveries carry `x-calmlens-timestamp` plus `x-calmlens-signature: v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`; the `x-calmlens-delivery-attempt` header is gone. `verifyWebhookSignature` now takes `{ payload, signature, timestamp, secret, toleranceSeconds?, now? }` (replacing `signatureHex`) and rejects deliveries whose timestamp is more than 5 minutes from now. `calmlens listen` forwards events in the new format. The header names and tolerance are exported as `WEBHOOK_DELIVERY_HEADER`, `WEBHOOK_TIMESTAMP_HEADER`, `WEBHOOK_SIGNATURE_HEADER` and `WEBHOOK_SIGNATURE_TOLERANCE_SECONDS`.

### Patch Changes

- d348850: Refresh bundled shared cookie metadata for documentation language preferences. SDK request behavior is unchanged.
- e08ebc2: Bundle schema metadata helpers and exclude unused database side effects so the SDK builds and runs outside the monorepo.
- e08ebc2: Reject authenticated HTTP redirects, validate successful upload responses, preserve error causes and HTTP status, and expose configurable request deadlines and cancellation. Export the SDK's core request and response types.

## 0.4.0

### Minor Changes

- cb687ee: Add `client.assets.retry({ assetId })` to process an asset that failed (status `error`) again. The asset returns to `pending` and is moderated like a new upload; its content must still be stored. It throws `asset/not-retryable` for assets that aren't in the error state and `asset/content-unavailable` when the content has been deleted. The mock client supports it too.

## 0.3.1

### Patch Changes

- 16158d1: API keys now belong to their project: a key's access is exactly its own grants, and is no longer limited by the access of the person who created it. API key records expose `createdBy` (audit only) instead of `userId`, plus `systemPermissions`. API keys are only accepted by the public API and CDN; internal portal routes now reject them with `auth/api-key-not-accepted`.

## 0.3.0

### Minor Changes

- 476b331: Replace legacy API-key roles with action grants scoped to a project or folder. Mock API keys now accept permission grants through `createMockApiKey`, expose them through `getMockApiKeyGrants`, and enforce `assets:download` for private CDN access. Existing mock keys must be recreated with grants; existing project API keys need permissions assigned under the new model.

## 0.2.1

### Patch Changes

- a8f573f: The CLI help and README now point to `npx calmlens` and `npm install -g calmlens`, since the SDK is also published as `calmlens`.

## 0.2.0

### Minor Changes

- a5b000e: Add the `calmlens` CLI for local development. `npx calmlens listen --forward-to <url>` forwards your project's events to a local webhook handler with the same body, headers and signature as real deliveries, so no public HTTPS URL is needed. `npx calmlens trigger` moderates a harmless test input to create events. Also add `client.events.list({ after, limit })` for reading the project's event feed with a cursor.

## 0.1.1

### Patch Changes

- fad4453: Depend on `api-def@^0.17.1`, whose type declarations no longer reference the optional `axios` package or a missing `./util/retry/interfaces` file. Projects with `skipLibCheck: false` now type-check without errors.

## 0.1.0

### Minor Changes

- b302afc: Fix installing the SDK outside the CalmLens repository. Previous releases imported unpublished internal modules (`shared/...`) and packages missing from `dependencies`, so `require`, Node ESM `import` and bundlers failed, and TypeScript types silently became `any`. The SDK is now bundled with its internal code included, declares `zod`, `sendable-error` and `json-schema-to-ts` as dependencies, marks `esm/` as ES modules for Node, and ships CommonJS type declarations for `require` users.

  Add `client.assets.classify({ text })` for moderating comments, captions, bios and other short text. It waits for the decision and is also available on `MockCalmLensClient`. The README quick start now covers text first, how to read `status` and `report.flagged`, and where to find the project ID.

## 0.0.25

### Patch Changes

- 4dc65d7: Report value names now use kebab-case: category statuses are `evaluated`, `partial` and `not-evaluated`; likelihoods are `very-unlikely` through `very-likely`; not-evaluated reasons are `not-supported` and `unavailable`. Moderation topics have been removed from reports and policy settings.

## 0.0.24

### Patch Changes

- 4f037d1: Publish the current SDK with automated stable versioning and release notes.

# 0.1.0

Initial release
