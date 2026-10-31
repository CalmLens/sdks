## 1.0.0

### Major Changes

- 25d93f5: Follows the CalmLens API v1 contract:
  
  - `assets.list` and `assets.iterate` request `GET /v1/projects/{projectId}/assets`.
  - `ensureLens` sends its definition through `PUT /v1/projects/{projectId}/lenses`, the request `ensureLenses` uses.
  - Sort directions in `ordering` are lowercase: `"asc"` and `"desc"`.
  - API errors no longer carry `traceId` in `details`. `requestId` comes from the `X-Request-Id` header, or from the error body's `requestId`. `details` is the body's object as sent.
  - `API_ERROR_CODES` includes the validation codes and the new route, internal, authentication, search, transform, remote URL, copyright and permission codes.
  - Webhook bodies and `toWebhookEventPayload` use the same flat shape as `events.list` items: `{ id, projectId, type, severity, title, description, assetId, asset, facts, createdAt }`, without a `data` envelope. `parseWebhookEvent` and `isTestWebhookEvent` read that shape.
  - Listed events no longer include `userId`, `notify`, `updatedAt` or `readAt`; `description`, `assetId` and `asset` are `null` when absent.
  - `Asset` no longer includes `userId` or `content.safetyTest`. The person, face and AI-generated detection results are not part of the asset while those features are off.
  - `folders.list` no longer takes `searchAll`, `ids` or `resolveOnly`, and returns 50 folders by default.
  - The testing mocks follow the same contract, and every cursor list in them defaults to 50 items.
- 7fa8620: `Lens` no longer includes `userId`.
- 64e9180: Asset reviews no longer include `reviewerUserId`, and hash lists and hash list entries no longer include `createdByUserId`.

### Minor Changes

- 2e04da8: Assets have `classification.failureReason`, which says why processing failed while `classification.status` is `failed` (such as `duration-limit` or `unsupported-format`), and is `null` otherwise. The `asset.failed` event carries the same value in its `failure-reason` fact. The in-memory mocks give a failed asset `processing-error`. The JavaScript SDK exports the `AssetClassificationFailureReason` type.
- e460921: Breaking: an asset's picture is one field, `content.image`, with `width`, `height`, `thumbhash`, `averageColor` and `perceptualHash`. It replaces `content.image` (size and perceptual hash) and `content.previewImage`. For images, the width and height are the original upload's. For documents and websites, they are the page image's. The JavaScript SDK exports the `AssetImage` type, which replaces `ImageData` and `PreviewImage`. `CalmLensMedia` sizes itself and shows its placeholder colour from `content.image`.
- 11d0d81: CDN URL builders take a `placeholder` resource: a small blurred PNG of the asset that the CDN serves publicly for every asset, private ones included, whatever its moderation status, for example in place of an age-restricted image. It takes no lens, transform or `ageConfirmed`, and passing one is rejected with `sdk/invalid-argument`, as is an unknown resource.
  
  The JavaScript SDK exports `getAssetUrl` from `@calmlens/sdk/app` and `@calmlens/sdk`. It builds the same CDN URLs as the server client's `cdn.getAssetUrl` from a project ID, with no API key and no request, so it works in browsers.
- 22bbbba: Breaking: the UI components no longer add their stylesheet to the page at runtime. The React components render it with them, and React places it in the page's head once, including when rendering on the server, so React 19 or later is required. With Vue, Svelte or the web components, import `@calmlens/sdk/styles.css` once. `injectCalmLensStyles` is removed, and `unstyled` is now a React-only prop.
- 8cc1cae: Add `client.assets.batch({ assetIds, operation })`, which deletes up to 500 assets (`"delete"`) or removes their stored content (`"remove-content"`) in one request and resolves with `{ queued: true }`. It sends `POST /projects/:projectId/assets/batch`. Every asset must exist in the project and the API key needs `assets:delete` for its folder, or the request fails (`asset/not-found`, `auth/permission-denied`) and nothing is queued; once queued, the work runs in the background and records `asset.deleted` or `asset.content-removed` for each asset. The method refuses an empty list, more than 500 IDs, an empty ID or an unknown operation with `sdk/invalid-argument` before sending, and is not retried. The new `auth/permission-denied` error code is available as a constant. The `AssetBatchOperation`, `BatchAssetsOptions` and `BatchAssetsResponse` types are exported. `MockCalmLensServerClient` validates the batch like the API and applies it at once.
- 58840e7: Add `assets.decide` to record a reviewer's decision (`allowed`, `limited`, `age-restricted`, `blocked` or `purged`) with a required note. Breaking: every list now uses cursor pages. `folders.list` takes `cursor`, `pageSize` and `ordering` instead of `pageIndex`, `sort` and `direction`, and returns `items` and `nextCursor` instead of `folders`. `hashLists.list` takes `cursor` and `pageSize` and returns a `HashListPage` (replacing `HashListList`). `events.list` and `events.pages` take `cursor` and `pageSize` instead of `after` and `limit`, and return `items` and `nextCursor` instead of `events` and `cursor`; an unreadable cursor fails with `validation/invalid-cursor`. `MockCalmLensServerClient` implements `assets.decide` and the new list shapes.
- 105ccc2: Assets can now have the moderation status `limited`, decided by the new `limit` policy action. A limited asset is delivered exactly like an allowed one, from the same public URL, but is marked so your app can reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it lower or collapsing it. The new `asset.limited` event reports it. `<CalmLensMedia>` shows limited media like allowed media, and `MockCalmLensServerClient` accepts `limited` for `queuedOutcome`, `analyzedOutcome` and `decide`, serving it from the mock CDN like an allowed asset.
- 6232efc: `MockCalmLensServerClient` follows the API more closely:
  
  - `setApiKeyGrants(grants)` changes the mock API key's grants mid-test, and `failNextRequest` also takes an API error code, such as `"upload/limit-exceeded"`, to fail the next request with that error and its HTTP status.
  - Classified images get a placeholder: `cdn.serve` with `resource: "placeholder"` returns a PNG for public assets whatever their moderation status (private ones need `assets:download`), and `403` `asset/not-available` once the asset is purged, its content is removed, or it has no placeholder yet. Originals carry `Cache-Tag`, `X-Content-Type-Options` and `Content-Security-Policy`; images also carry `ETag` and `Expires`. Plain text uploads are served too.
  - Unset asset fields such as `description`, `externalId`, `tags` and `metadata` are `null`, as the API returns them. A completed multipart upload has `upload.partsReceived: null`, and `content.sizeInBytes` adds up its parts.
  - Multipart images must total 10 MiB to 20 MiB (`upload/multipart-image-too-small`, `upload/multipart-image-too-large`), parts must add up to a declared `totalSizeInBytes` (`upload/size-mismatch`), and `upload/invalid-part-number` details include `receivedPartNumber`.
  - Out-of-range `pageSize`, `limit` and search queries fail with the API's `validation/too-small` and `validation/too-big` (HTTP 400). Asset list cursors only continue the query they came from, and other cursors fail with `validation/invalid-cursor`. `events/invalid-cursor` details include `after`.
  - `assets.delete`, `assets.deleteContent` and `assets.retry` add `asset.deleted`, `asset.content-removed` and `asset.retried` events. A reviewer's `purged` decision removes the content with reason `requested` and adds `asset.content-removed` before `asset.purged`.
  - Uploads into an unknown folder fail with `folder/not-found`, `assets.update` keeps `externalId` unique, `assets.listChildren` fails with `asset/not-found` for an unknown asset, idempotency keys may contain inner spaces and are used without surrounding whitespace, as HTTP sends them, and folders sort by name with uppercase before lowercase.
- 958be0d: `MockCalmLensServerClient` now answers CDN requests like the CDN: blocked, purged and failed assets, and assets whose content was removed, return `403` with `asset/not-available` whatever the key, before any permission check. `decide(assetId, decision)` applies a reviewer's decision (`allowed`, `age-restricted`, `blocked` or `purged`) and adds the matching `asset.<decision>` event with a `decided-by: reviewer` fact. `assets.waitForDecision` takes no real time: an asset that stays pending fails with `sdk/timeout` straight away.
- 656bae9: `MockCalmLensServerClient` and `MockCalmLensAppClient` now run the real `CalmLensServerClient` and `CalmLensAppClient` against an in-memory CalmLens API and CDN, so your tests exercise the client code your app runs. The mock server client is a `CalmLensServerClient` (`instanceof` holds), and every request gets the API's HTTP status, body, error body and `X-Request-Id`.
  
  - `calls` and `callsTo(operation)` list the requests the client sent: each is `{ operation, method, url, path, query, headers, body, status }` instead of `{ operation, options }`. A request several methods send matches each of them in `callsTo`, so `callsTo("text.classify")` also lists text uploads through `assets.classify`, and `calls` records them as `assets.classify`. Methods that send no request, such as `uploadTokens.sign` and an `ensureLens` answered from the lens cache, are no longer recorded. The `MockCalmLensOperationOptions` type is removed, and `MockCalmLensCall` no longer takes a type parameter.
  - `failNextRequest` fails the next request rather than the next method call, so options the client refuses before sending fail without using it. An `Error` that is not a `CalmLensError` now fails the request with `sdk/transport-error`, with the error as its `cause`, as an exception from `fetch` would; a `CalmLensError` is still thrown as is.
  - Options the client checks before sending, such as a missing asset name or an unsupported MIME type, now fail as the real client fails them, without an HTTP status or request ID.
  - `maxRetries` is accepted and defaults to 0; with retries on, the backoff takes no real time. `uploadTokens.sign` signs at `mockOptions.now` with a random nonce.
  - `MockCalmLensAppClient` uploads get the preset's `uploadPresetId`, and `mockOptions.preset.folderId` is documented.
  - `MockReviewDecision` is exported from `@calmlens/sdk/testing`.
- 6232efc: A redirect response now fails with `sdk/http-error` and the redirect's HTTP status (and request ID), instead of `sdk/transport-error`. It is not retried, and the redirect is still never followed. `assets.iterate`, `assets.iterateChildren` and `events.pages` now fail with `sdk/invalid-response` (with the cursor in `details.cursor`) when a page that says more pages follow returns a cursor the iteration has already used, instead of repeating pages or stopping without notice.
- 6232efc: `isTestWebhookEvent(event)` from `@calmlens/sdk/server` tells a test send from the portal or the CLI apart from a real event. `parseWebhookEvent` now also refuses a body whose known `data` fields have the wrong types, such as `facts` that is not a list of `{ key, value }` facts, with `sdk/invalid-webhook-payload`. `@calmlens/sdk/testing` exports `signUploadToken(apiKey, options, { now, nonce })`, which signs an upload token with a fixed clock and nonce for comparing with known tokens in tests.
- 2b11c12: Breaking: an asset's moderation outcome is now `classification.moderation.status`: `pending`, then `allowed`, `age-restricted`, `blocked` or `purged`. It replaces `classification.moderation.decision` and `classification.moderation.action`, and filters use `classification.moderation.status`. Manual reviews record their `decision` as one of the four decided statuses and no longer have an `action`. Policy actions are `allow`, `age-restrict`, `block` and `purge`; `flag` is removed.
  
  Webhook and event types `asset.flagged`, `asset.approved` and `asset.rejected` are replaced by `asset.classified` and one event per status: `asset.allowed`, `asset.age-restricted`, `asset.blocked` and `asset.purged`. Event asset snapshots carry `classification.moderation.status`, and the `moderation-action` and `review-action` facts are replaced by `moderation-status` and `decided-by`.
  
  Waiting for a decision returns once the status is no longer `pending`. Mock clients take the new statuses as outcomes, and `purged` removes the content.
  
  CDN URL builders take an `ageConfirmed` option that adds `ageConfirmed=true`, so a public age-restricted asset can be served from its public URL where your app has already decided the viewer may see it. Without it, age-restricted assets need a signed URL or an API key.
- dd08099: CalmLens IDs now name the kind of object they identify: a prefix, an underscore and 20 letters and digits, such as `proj_8fK2mQx7Lp4NvB3tRz9Y` for a project, `asset_5Gm2Rk8XqT3wLp9VbN4c` for an asset and `fldr_7Nc4Wq2Lm8Xt5Rk9Bv3P` for a folder. The in-memory mocks mint IDs the same way, and their ID option (`createId`, `create_id` or `CreateID`) now receives the prefix of the object it names (`asset`, `fldr`, `hl`, `hle`, `lens`, `evt` or `rev`). The mocks' `assets.batch` refuses an ID that is not an asset ID with `validation/invalid-format`, as the API does.
- 3c4817f: `@calmlens/sdk/react-native` has `CalmLensUploader`, `CalmLensMedia` and `useCalmLensUpload` for React Native and Expo apps, built on the same upload queue, messages and media states as the web components and with no native modules. The uploader takes a `pick` function that opens your app's picker, such as `expo-image-picker`, and a `theme` for its colours and corner radius. The media component loads the width in `widths` that covers its measured size, and hands video and audio to your player through `renderPlayer`.
  
  Breaking: the upload queue takes any `UploadFile`, a file with a name, MIME type, size and `arrayBuffer()`, instead of only a browser `File`. A `File` from `expo-file-system` works as it is, and its `uri` becomes the image preview. The queue's types take your file type as a parameter, such as `UploadItem<PickedPhoto>`. In `@calmlens/sdk/react`, `/vue`, `/svelte` and `/elements` they default to `File`, so browser code is unchanged; in `@calmlens/sdk/react-native` and `@calmlens/sdk/ui` they default to `UploadFile`.
  
  `resolveTheme` and `CALMLENS_THEME` hold the components' default colours, and `pickMediaSource` picks an image width for a measured box, for building your own components.
  
  `retry` checks an upload again, with the token it was uploaded with, when the upload finished but its status check failed, instead of uploading the file again as a new asset. It also checks a finished upload that is still `pending` again.
- adc7d6a: Use one authenticated test-input format for presets and custom combinations of category instances, qualifiers, confidence scores and missing evidence. `generateTestTextCode` and `paintTestImage` accept the same input object; image generation returns compact square RGBA pixels with their dimensions. Regenerate older fixed-category samples. Normal project policy and jurisdiction rules determine every outcome.
- 454706c: Uploads and text classification take `authorId` and `context`: who wrote the content and the earlier posts of its conversation, oldest first, each with an optional author ID. CalmLens moderates only the content and uses the earlier posts to read who it addresses and whether it quotes, reports, counters or mocks something. The SDKs send only the posts CalmLens uses, the most recent 5 that fit in 2,000 characters, and export the rule that picks them. Assets return `authorId` and the `context` used, which is `null` once the content is removed. The offline mocks store both and drop the context with the content.
- f4c9e39: The upload controller, `useCalmLensUpload` and the Vue `useCalmLensUpload` have `cancel(key)`: it stops a queued or running file and keeps it in the list as failed with `sdk/cancelled`, so `retry` can upload it again. `remove` still drops the file.
- 4cb9b1a: Adds an upload widget and a media component for React (`@calmlens/sdk/react`), Vue (`@calmlens/sdk/vue`), Svelte 5 (`@calmlens/sdk/svelte`) and web components (`@calmlens/sdk/elements`), on a framework-free core in `@calmlens/sdk/ui`.
  
  `CalmLensUploader` uploads through an upload preset or your own `upload` function, shows byte progress, waits for the moderation decision and shows a message for each outcome and error code. `CalmLensMedia` serves an asset's rendered image from the CDN, in the format the browser accepts, with `srcset` widths and a blurred placeholder, takes either an asset from the API or its project and ID, keeps age-restricted assets behind the placeholder and a reveal button until `ageConfirmed` is set, and shows an unavailable notice for blocked and purged assets. The stylesheet is also published as `@calmlens/sdk/styles.css`.
  
  `@calmlens/sdk/testing` adds `MockCalmLensAppClient`, which applies upload preset rules and stores uploads in a `MockCalmLensServerClient`. The mock server client's `queuedOutcome` and `analyzedOutcome` accept a function of the asset, and its `cdn.serve` refuses blocked assets and serves placeholders whatever the moderation status, as the CDN does.
- d815f4c: The upload widget shows a file-type icon, coloured by kind of file and labelled with its extension, for files without an image preview. The icons are also available on their own from `@calmlens/sdk/file-icons` (`getFileIcon`, `renderFileIconSvg` and the families' colours and paths), so apps can show files the same way elsewhere. `UploadItemView.extension` is replaced by `fileIcon`, the icon's SVG markup. The focus ring is themeable with `--calmlens-focus-ring`, `--calmlens-focus-width` and `--calmlens-focus-offset`, and outlined buttons tint with the accent colour on hover.
- 4521e35: The upload widget can wait to upload: with `autoUpload: false` (the `no-auto-upload` attribute on the web component), picked files stay in a new `selected` stage until you call `start()` on the upload controller, for example when a form is submitted. Pass `controller` (from `useCalmLensUpload` or `createUploadController`) to show a queue your app owns, so it can read the picked files and start or clear them; the upload options then come from that controller. An uploader that takes one file now replaces its drop zone with the picked file and a "Choose another" button. The drop zone has a new look with an outlined picker button, and the new messages are `chooseFile`, `chooseAnother` and `selected`. The default `dropzoneTitle` and `chooseFiles` text changed.
- 17cdb9b: CDN methods, signed URL creation and media widgets accept optional `viewerClaims` containing `region` and `ageConfirmed`. These replace the separate region and age options. The CDN defaults to the connecting country and no age confirmation, including authenticated requests. Customers determine the assertions; CalmLens applies content restrictions without independently verifying them.
  
  Asset retrieval returns stored moderation results without a request-specific `delivery` object or region parameter. Pass viewer context on the CDN request instead. Raw HTTP supports a JSON query parameter or `X-CalmLens-Viewer-Claims` header. Age-restricted delivery without confirmation returns `viewer/age-confirmation-required`; private access remains a separate requirement.

### Patch Changes

- 6d65133: Event facts' `url` is now a stable link that opens the item in the CalmLens portal, such as `https://calmlens.com/go/asset/<asset-id>`, in webhook payloads and the events feed. The in-memory mocks give asset facts the same links.
- 92bf5db: Timeouts are retried like network failures: reads, and creates and uploads with an `Idempotency-Key`, are sent again after `sdk/timeout`, up to `maxRetries`. `error.isRetryable()` is now true for `sdk/timeout`, including `waitForDecision`'s deadline, and stays false for `sdk/cancelled`.
  
  `MockCalmLensServerClient` now behaves more like the API: `assets.search` runs the API's keyword search, with every word matched against the name, ID, external ID, description, tags, type, content format or extension and moderation status, and returns the API's scores and `matchedFields`; `assets.list` filters accept parentheses; and assets created in a row get increasing `createdAt` values.
- e4e9894: `CalmLensMedia` shows the CDN placeholder for private assets and signed URLs too, since the CDN serves every asset's placeholder publicly. It sends only viewer claims that differ from the defaults (a `region`, or `ageConfirmed: true`), so `ageConfirmed: false` no longer makes the CDN's responses private and uncacheable, and placeholder URLs carry only the region. The mock clients serve private assets' placeholders without `assets:download`, as the CDN does.
- 01ce2c7: `CalmLensMedia` shows its unavailable notice, without requesting anything from the CDN, for an `asset` whose `content.status` is `removed`. Set `contentRemoved` to do the same without passing an asset.
- 4dc28f3: `CalmLensMedia` no longer requests a `rendered` poster or a CDN placeholder for video and audio, which the CDN doesn't render. Videos play their original file without a poster, and the CDN placeholder is used only for images.
- 1e59923: The mock clients' `cdn.serve` now sends `Cache-Control` as the CDN does: `public` only when anyone may see the asset (including a public age-restricted asset requested with `ageConfirmed`), otherwise `private`, with `max-age=31536000, immutable` for images and `max-age=3600` for other content. JavaScript and Python previously sent `private, no-store` or `public, max-age=31536000`; Go and Ruby sent no `Cache-Control`.
- 958be0d: Creating a signed URL now fails with `sdk/invalid-argument` before sending anything when the API would reject it: a resource other than `original` or `rendered` (a placeholder needs no signed URL), a lens or transform on the `original` resource, or a lifetime that is not a whole number of seconds from 1 to 86400 (24 hours). The longest lifetime is available as `MAX_SIGNED_URL_SECONDS` in Rust and Java, `MaxSignedURLSeconds` in Go, `CalmLens::Assets::MAX_SIGNED_URL_SECONDS` in Ruby and `CalmLens\Assets::MAX_SIGNED_URL_SECONDS` in PHP.
- e84bd9d: `parseWebhookEvent` returns a typed event: `data.asset` is the asset snapshot CalmLens sends, so `externalId` and `classification` no longer need casting, and `createdAt` is always a number. A signed body without a numeric `createdAt` is refused with `sdk/invalid-webhook-payload`, like any other body that isn't a CalmLens event.

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
