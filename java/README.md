# CalmLens Java SDK

A synchronous, thread-safe Java 17+ client for CalmLens moderation, storage, events, webhooks and CDN delivery. Responses are immutable records; JSON stays inside the SDK.

```xml
<dependency>
  <groupId>com.calmlens</groupId>
  <artifactId>calmlens-sdk</artifactId>
  <version>0.1.0</version>
</dependency>
```

The JAR declares the module name `com.calmlens` (`requires com.calmlens;`).

```java
import com.calmlens.CalmLensServerClient;
import com.calmlens.Models.*;

try (var client = CalmLensServerClient.builder(System.getenv("CALMLENS_API_KEY"), System.getenv("CALMLENS_PROJECT_ID")).build()) {
  Asset asset = client.text.classify("Hello world");
  if (asset.classification().moderation().status() == AssetModerationStatus.ALLOWED) System.out.println(asset.id());

  Asset queued = client.assets.create(new SubmitAsset("photo.jpg", Content.file(Path.of("photo.jpg"), "image/jpeg"))
      .externalId("post-42").visibility(Visibility.PRIVATE));
  client.assets.update(new UpdateAsset(queued.id()).description(Patch.clear()));
}
```

Create one client per API key, share it across threads and close it on shutdown. Requests never follow redirects.

## Operations

| Resource | Methods |
| --- | --- |
| `client.assets` | `create`, `classify`, `search`, `list`, `iterate`, `retrieve`, `waitForDecision`, `update`, `retry`, `explain`, `deleteContent`, `delete`, `batch`, `move`, `listChildren`, `iterateChildren`, `uploadPart`, `createSignedUrl` |
| `client.text` | `classify` |
| `client.folders` | `list`, `create`, `retrieve`, `update`, `move`, `delete` |
| `client.hashLists` | `list`, `create`, `retrieve`, `update`, `delete`, `listEntries`, `addEntry`, `removeEntry` |
| `client.events` | `list`, `pages` |
| `client.cdn` | `getAssetUrl`, `serve` |
| `client` | `ensureLens`, `ensureLenses` |

`assets.create` queues processing and returns the asset while its `classification().status()` is `processing`; `assets.classify` and `text.classify` wait for classification. `text.classify` supplies `text/plain` content and names the asset `text` unless you set a name. `assets.deleteContent` removes the stored bytes (the record and report stay, with `content().status()` `removed` and `content().removalReason()` `requested`); `assets.retry` processes an asset whose `classification().status()` is `failed` again; `assets.explain` completes the policy evidence behind a decision (`policy().evidence()` becomes `full`, every action stays as decided), or with `rerun(true)` moderates the asset again with the current policy; `assets.delete` removes everything. `assets.batch(new BatchAssets().assetIds(ids).operation(AssetBatchOperation.DELETE))` deletes up to 500 assets, or removes their content with `AssetBatchOperation.REMOVE_CONTENT`, in one request: every asset must exist and the key needs `assets:delete` for its folder, or nothing is queued (`asset/not-found`, `auth/permission-denied`). It returns `BatchAssetsResponse` (`queued()` is true) once queued, the work runs in the background, and it is not retried.

Hash lists hold PDQ perceptual hashes that image uploads are compared with. A `HashListAction.FLAG` list reports matches in `classification().moderation().hashMatches()`; a `HashListAction.BLOCK` list also blocks close matches (the decision's `policy().decision().source()` is `hash-list`). `hashLists.addEntry` takes a 64-character hex `hash` (with an optional `quality`) or an image `assetId`, whose `content().image().perceptualHash()` is added (`hash-list/asset-not-hashed` when it has none); adding a hash the list already holds returns the existing entry. `hashLists.delete` removes the list and every entry in it.

```java
HashList list = client.hashLists.create(new CreateHashList("Removed images", HashListAction.BLOCK));
HashListEntry entry = client.hashLists.addEntry(new AddHashListEntry(list.id()).assetId(asset.id()).label("Report 1042"));
HashListEntryPage page = client.hashLists.listEntries(new ListHashListEntries(list.id()).pageSize(50));
client.hashLists.update(new UpdateHashList(list.id()).action(Patch.value(HashListAction.FLAG)).description(Patch.clear()));
client.hashLists.removeEntry(new HashListEntryId(entry.id()));
```

`assets.waitForDecision` retrieves an asset until its `classification().moderation().status()` is no longer `pending` (`allowed`, `limited`, `age-restricted`, `blocked` or `purged`), or its `classification().status()` is `failed`, and returns it. It checks again after 0.5 seconds, then waits 1.5 times longer each time, up to 5 seconds. If there's no decision within the timeout (60 seconds by default), it throws `sdk/timeout` with `assetId` and the last `classificationStatus` and `moderationStatus` in `getDetails()`. Interrupting the thread stops it with `sdk/cancelled` and keeps the interrupt flag. Webhooks report decisions without polling.

```java
Asset queued = client.assets.create(new SubmitAsset("photo.jpg", Content.file(Path.of("photo.jpg"), "image/jpeg")));
Asset decided = client.assets.waitForDecision(new WaitForDecision(queued.id()).timeout(Duration.ofSeconds(30)));
AssetModerationStatus status = decided.classification().moderation().status();
if (status != AssetModerationStatus.ALLOWED && status != AssetModerationStatus.LIMITED) unpublishPhoto(decided.id());
```

Request options live in `com.calmlens.Models`: required fields have constructors and fluent setters configure the rest. Unset options are not sent. In update options, `Patch.value(value)` sets a field, `Patch.clear()` clears it, and leaving it unset keeps it.

Optional analyses are turned on per request with `ProcessingOptions.features`. Every feature is off unless you enable it. OCR stores text in the image’s `content().extractedText()` and adds a text moderation pass to its combined report; person and face detection (beta) write their results to `asset.classification()`, where each result has a `status` of `evaluated` (with `people()` or `faces()`, boxes as fractions of the image size) or `not-evaluated` (with a `reason()`):

```java
SubmitAsset photo = new SubmitAsset("photo.jpg", Content.file(Path.of("photo.jpg"), "image/jpeg"))
    .processingOptions(new ProcessingOptions().features(new ProcessingFeatures()
        .ocr(new FeatureOptions(true))
        .faceDetection(new FaceDetectionOptions().enabled(true).ageEstimation(true))));
Asset asset = client.assets.classify(photo);
FaceDetectionResult faces = asset.classification().faceDetection();
if ("evaluated".equals(faces.status())) faces.faces().forEach(face -> System.out.println(face.box() + " " + face.ageRange()));
```

## Responses

Responses are records whose accessors keep the API's camelCase names: `asset.id()`, `asset.classification().moderation().status()`, `asset.classification().moderation().categories()`, `event.type()`. An asset's state is grouped in three records: `upload()` (`AssetUpload`: receipt of source content), `classification()` (`AssetClassification`: progress, completion time, detections and labels, with safety findings and decisions in `classification().moderation()`) and `content()` (`AssetContent`: whether CalmLens holds the content, and its `format()`, `sizeInBytes()`, `checksums()`, `image()`, `extractedText()` and `safetyHold()`). Event and webhook snapshots (`EventAsset`) carry the processing, moderation and content statuses when the event was created. Optional values are `null` when the API omits them; lists inside responses are immutable. Timestamps are `java.time.Instant`. Nested objects are typed records (`AssetClassification`, `AssetModeration`, `AssetContent`, `Checksums`, `AssetImage`, `SafetyHold`, `ExtractedText`, `FlaggedContentPolicy`, `ImageTransformOptions` and so on), and values from a fixed set are strings so values added later still read. Only metadata values and event fact values, where the API accepts any JSON, are untyped: they use `String`, `Long`, `Double`, `Boolean`, `List` and `Map`, so `9007199254740993` stays exact and `5` is `5L`, never `5.0`. `toString()` is readable and never includes the API key; `SignedUrl.toString()` hides the URL's signature.

Responses read from newer API versions keep working: unknown fields are ignored, and an unknown status or visibility keeps its raw value (`classification().moderation().status().value()`, `classification().moderation().status().isKnown()` is `false`) instead of failing. Known values are `AssetClassificationStatus`, `AssetModerationStatus`, `AssetModerationDecision` (a reviewer's decision in `manualReviews()`) and `AssetContentStatus` constants you can compare with `==`. Show content publicly only when its moderation status is `ALLOWED` or `LIMITED`; `LIMITED` content is delivered like allowed content, but keep it out of recommendations, trending and notifications, rank it lower or collapse it; show `AGE_RESTRICTED` content only behind your own age gate, through signed URLs; don't show `BLOCKED` or `PURGED` content, or any status this SDK version doesn't know. `classification().moderation().categories()` and `score()` are absent until findings are available.

## Uploads

`Content.text(text)`, `Content.bytes(bytes, mime)`, `Content.file(path, mime)` and `Content.stream(inputStream, sizeInBytes, mime)` create upload content. Files and streams are sent as they are read, with a `Content-Length`, so large uploads are never held in memory; bytes are sent without copying or base64 encoding. `Content.stream(inputStream, mime)` sends a stream whose size you don't know, chunked and without `sizeInBytes`.

Multipart uploads: send the first part with `assets.create(new SubmitAsset().name(...).part(content.partNumber(1).isFinal(false)))` (optionally `.totalSizeInBytes(size)` so CalmLens checks the total up front), then each later part with `assets.uploadPart(new UploadPart(assetId, content.partNumber(n).isFinal(last)))`. Non-final parts must be at least 5 MiB, and image uploads in parts must total 10 to 20 MiB. The client refuses a part it can measure before sending it: a non-final part under 5 MiB with `upload/invalid-payload`, and a first image part over 20 MiB, or a final one under 10 MiB, with `upload/multipart-image-too-large` or `upload/multipart-image-too-small`. CalmLens checks the totals across parts and answers with the same codes, or `upload/size-mismatch`. CalmLens saves the queue choice when the upload starts, so parts can be sent from any client or process; `UploadPart.queue(Boolean)` overrides it for the final part.

Every upload carries an `Idempotency-Key`. The client generates one per call and reuses it for that call's retries, so a retried upload never creates a second asset. Pass your own key (1 to 255 printable ASCII characters, without a space at either end; CalmLens refuses others with `idempotency/invalid-key`) to retry safely across processes:

```java
client.assets.create(options, new RequestOptions().idempotencyKey(listing.id() + ":photo-1"));
```

### Conversation context

For a reply in a thread, set `authorId` (your label for who wrote the content) and `context` (earlier posts in the conversation, oldest first) on `SubmitAsset` or `ClassifyText`. CalmLens moderates only the content itself and uses the earlier posts to read who it addresses, what it refers to and whether it quotes or reports something:

```java
Asset reply = client.text.classify(new ClassifyText("Same to you")
    .authorId("user-9")
    .context(new ModerationContext(List.of(
        new ModerationContextItem("Nobody asked you", "user-3"),
        new ModerationContextItem("Please keep it civil")))));
```

The client sends only the posts CalmLens uses: the most recent `MODERATION_CONTEXT_USED_ITEMS` (5) posts within `MODERATION_CONTEXT_USED_CHARACTERS` (2,000) characters, counted as Unicode code points. The newest post is always sent. `Models.selectModerationContextItems(items)` returns the posts that would be sent. A null item list, post or text is refused with `sdk/invalid-argument`. The asset returns `authorId()` and the `context()` it used; `context()` is null once the content is removed.

## Upload presets

Call `.uploadPresetId(id)` on `SubmitAsset` or `ClassifyText` to apply an upload preset's folder, visibility, file types and size limit. To let a browser upload through a preset that requires tokens, sign a single-use token on your server. Signing happens locally with your API key and makes no request.

```java
Models.SignedUploadToken signed = client.uploadTokens.sign(
    new Models.SignUploadToken("preset_4Lk8Qw2Xm9Rt5Vb3Nc7P")
        .externalId("post-42")        // optional: the uploaded asset gets this ID
        .expiresInSeconds(600));      // optional: 1 to 3600, 600 by default
// signed.token(), signed.expiresAt() (milliseconds since the Unix epoch)
```

See [Upload presets](https://calmlens.com/docs/guides/upload-presets). `MockCalmLensServerClient.client` signs tokens with its own key.

## Pagination

`assets.iterate` and `assets.iterateChildren` return an `AutoPager`, an `Iterable` that requests the next page only when needed:

```java
for (Asset asset : client.assets.iterate(new ListAssets().filter("classification.moderation.status==blocked").pageSize(100))) { ... }
client.assets.iterateChildren(new ListChildren(photoId)).stream().filter(child -> "plaintext-document".equals(child.type()));
```

## Events feed

`events.list(new ListEvents())` without `after` returns no events and a cursor for the current time. Pass that cursor as `after` to receive newer events, oldest first. `events.pages` yields pages while `hasMore` is true; save each page's cursor after handling it:

```java
String cursor = client.events.list(new ListEvents()).cursor(); // "now"
// later:
for (EventsPage page : client.events.pages(new ListEvents().after(cursor).limit(100))) {
  for (Event event : page.events()) System.out.println(event.type() + " " + event.assetId());
  cursor = page.cursor(); // persist this to resume
}
```

The feed returns every event type; filter by `type()` and `assetId()`. Prefer webhooks in production.

## Webhooks

Verify the exact raw body bytes, then parse them, with `parseWebhookEvent`. It throws `CalmLensException` with code `sdk/invalid-webhook-signature` for a forged, tampered or stale delivery (respond 401) and `sdk/invalid-webhook-payload` for a verified body that is not a CalmLens event. Deliveries whose timestamp is more than `WEBHOOK_SIGNATURE_TOLERANCE_SECONDS` (300) from your clock are rejected. The API takes only `byte[]` or `String` bodies: never pass a body your framework has already parsed and re-serialized.

Spring (the `byte[]` parameter receives the raw body):

```java
@PostMapping("/webhooks/calmlens")
ResponseEntity<Void> calmlens(@RequestBody byte[] body,
    @RequestHeader(CalmLensServerClient.WEBHOOK_SIGNATURE_HEADER) String signature,
    @RequestHeader(CalmLensServerClient.WEBHOOK_TIMESTAMP_HEADER) String timestamp) {
  WebhookEventPayload event;
  try {
    event = CalmLensServerClient.parseWebhookEvent(body, signature, timestamp, webhookSecret);
  } catch (CalmLensException invalid) {
    return ResponseEntity.status(invalid.getCode().equals(ErrorCodes.SDK_INVALID_WEBHOOK_SIGNATURE) ? 401 : 400).build();
  }
  queue.add(event); // deduplicate by event.id(), then retrieve the asset for its current state
  return ResponseEntity.noContent().build();
}
```

Servlet (Jakarta or javax):

```java
protected void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException {
  byte[] body = request.getInputStream().readNBytes(1024 * 1024 + 1);
  if (body.length > 1024 * 1024) { response.setStatus(413); return; }
  try {
    WebhookEventPayload event = CalmLensServerClient.parseWebhookEvent(body,
        request.getHeader(CalmLensServerClient.WEBHOOK_SIGNATURE_HEADER),
        request.getHeader(CalmLensServerClient.WEBHOOK_TIMESTAMP_HEADER), webhookSecret);
    queue.add(event);
    response.setStatus(204);
  } catch (CalmLensException invalid) {
    response.setStatus(invalid.getCode().equals(ErrorCodes.SDK_INVALID_WEBHOOK_SIGNATURE) ? 401 : 400);
  }
}
```

With the request's headers at hand, `parseWebhookRequest(headers, body, secret)` and `verifyWebhookRequest(headers, body, secret)` read the signature and timestamp themselves: header names match in any case, and a header repeated in the request (a list value, as in `HttpHeaders.map()`) is joined with commas.

A delivery must be a JSON object with string `id`, `type` and `projectId`, a numeric `createdAt` and an object `data` whose known fields have the API's types. The payload has `id()`, `type()`, `createdAt()`, `projectId()` and `data()` (`severity`, `title`, `description`, `assetId`, the `asset` snapshot and `facts`), and `json()` holds the whole body as received, including fields this SDK version doesn't model. `isTestWebhookEvent(event)` is true for test sends from the portal or API, which carry the `{ key: "test", value: true }` fact. `verifyWebhookSignature(body, signature, timestamp, secret)` returns a boolean if you prefer, and overloads take `nowSeconds` and `toleranceSeconds`. `createWebhookSignatureHeader(secret, timestamp, body)` and `createWebhookHeaders(secret, body, deliveryId, timestampSeconds)` sign test deliveries, and `toWebhookEventPayload(event)` turns an event from `events.list` into its delivery body. The headers are exported as `WEBHOOK_SIGNATURE_HEADER`, `WEBHOOK_TIMESTAMP_HEADER` and `WEBHOOK_DELIVERY_HEADER`.

## CDN

`cdn.getAssetUrl(new CdnRequest(id).lens("thumb"))` builds a CDN URL. `CdnRequest.resource` is `rendered` (the default), `original` or `placeholder`; only `rendered` takes a lens or transform. `cdn.serve` streams content with the API key and returns a `CdnResponse` for any status but a redirect, which fails with `sdk/http-error` and is never followed; close the response when done. Transport failures and HTTP 429, 502, 503 and 504 are retried like API reads, and once retries run out the last response is returned:

```java
try (CdnResponse response = client.cdn.serve(new CdnRequest(asset.id()))) {
  if (response.status() == 200) response.transferTo(outputStream);
}
```

A public asset whose moderation status is `age-restricted` is served from its public URL only with `allowAgeRestricted(true)`, which appends `?allowAgeRestricted=true`; otherwise it needs a signed URL or the API key. Set it only where your app has already decided the viewer may see age-restricted content.

To transform an asset without a saved lens, pass `transform` (here or on `SignedUrlOptions`) either a selector string or structured steps, which the SDK serializes with sorted, encoded options:

```java
client.cdn.getAssetUrl(new CdnRequest(id).transform("format=png,width=1024"));
client.cdn.getAssetUrl(new CdnRequest(id).transform(
    Transform.image(new ImageTransformOptions().format("png").width(1024))));
client.cdn.getAssetUrl(new CdnRequest(id).transform(List.of(
    Transform.image(new ImageTransformOptions().border(new ImageBorder("#fff", 2.0))
        .gravity(Gravity.position("face")).trim(Trim.border())),
    Transform.image(new ImageTransformOptions().format("webp")))));
```

A selector has one path segment per step, such as `fit=cover,width=640/format=webp`: options are sorted `key=value` pairs, nested options are dotted (`border.color=fff`) and hex colours drop the `#`. `redact(new Redaction().text(true))` blurs the text regions found when the image was processed (`personalInformation(true)` blurs only those holding personal information) before any other option applies; text regions need OCR on the upload. A lens runs before any additional transforms, and the two are joined with `/` (`/rendered/@thumbnail/width=320`). `quality` takes `Quality.of(80)` or `Quality.level("high")`.

`readAllBytes(maxBytes)` buffers a body up to a limit. The client's `timeout` bounds the wait for the response headers, and a stream read that then receives nothing for that long fails with `HttpTimeoutException`; pass `new RequestOptions().timeout(...)` to `cdn.serve` to change it per call. Use `assets.createSignedUrl` for private content in browsers.

## Errors

Every failure is an unchecked `CalmLensException` with a stable `getCode()`; compare it with the constants in `ErrorCodes`, which include every public API error code.

| Type | When | Extra information |
| --- | --- | --- |
| `ApiException` | The API answered with an error, or with a body the SDK could not read (`sdk/invalid-response`, `sdk/response-too-large`, `sdk/http-error`) | `getStatus()`, `getRequestId()` (`X-Request-Id`), `getHeaders()`, `getRetryAfter()`, `getTraceId()`, `getDetails()` |
| `TransportException` | The request could not be sent or its response could not be read (`sdk/transport-error`) | `getCause()` is the original exception |
| `RequestTimeoutException` | A timeout (`sdk/timeout`); a `TransportException` | |
| `CalmLensException` | Invalid arguments (`sdk/invalid-argument`), configuration (`sdk/invalid-config`), upload payloads (`upload/*`), webhooks (`webhook/*`), interruption (`sdk/cancelled`, the interrupt flag is preserved) and use after `close()` (`sdk/client-closed`) | |

`isNotFound()` and `isRetryable()` help branch on common cases. `isRetryable()` follows from the code and status alone, whatever the exception's class: it is true for `sdk/transport-error`, `sdk/timeout` (including `waitForDecision`'s deadline), `idempotency/request-in-progress` and HTTP 429, 502, 503 and 504, and false otherwise. Repeat a write only with the same idempotency key. Validation failures are reported before anything is sent; header values containing line breaks or control characters are rejected as `sdk/invalid-argument`. Log `getRequestId()` with failures and include it when contacting support.

## Retries and timeouts

Reads (`GET`, `HEAD`) and uploads (which carry an `Idempotency-Key`, and reuse it on every retry) are retried up to `maxRetries` times (2 by default; `0` disables retries) after network failures, timeouts, HTTP 429, 502, 503 and 504, and `idempotency/request-in-progress`. Before retry `n` (from 0) the client waits `d/2` plus a random part of `d/2`, where `d` is 500 ms doubled `n` times, at most 8 seconds; a `Retry-After` in seconds or as an HTTP date replaces that wait (`0` retries at once), and one over 60 seconds is returned as the error instead. Other writes are never retried automatically. Uploads from `Content.stream` can be read once, so they are not retried either. Redirects are never followed: a 3xx fails with `sdk/http-error` and its status.

```java
CalmLensServerClient.builder(apiKey, projectId)
    .connectTimeout(Duration.ofSeconds(10))   // opening a connection
    .timeout(Duration.ofSeconds(120))         // each API request attempt, response body included; text uploads too
    .uploadTimeout(Duration.ofMinutes(30))    // each binary upload attempt; none by default
    .maxRetries(2)
    .maxResponseBytes(32L * 1024 * 1024)      // larger API responses fail with sdk/response-too-large
    .build();
```

Override these for one call with `RequestOptions` (`timeout`, `uploadTimeout`, `maxRetries`), or for every call of a derived client that shares this one's connection and lens cache with `client.withRequestOptions(new RequestOptions().timeout(Duration.ofMinutes(5)))`. Pass `httpClient(...)` to use your own `java.net.http.HttpClient` (proxy, TLS, executor), or `transport(...)` to send requests through another HTTP stack.

`ensureLenses` sends only definitions this client hasn't ensured yet, in requests of at most 100, and concurrent calls for the same new definitions share one request.

## Identification and lifecycle

Requests send `User-Agent: calmlens-java/<version> (java/<runtime version>)` and, for API requests, `Accept: application/json`; `CalmLensServerClient.VERSION` is read from the Maven manifest. `close()` makes later calls fail with `sdk/client-closed` and, on Java 21 and later, closes the built-in `HttpClient` (on Java 17 it is released by garbage collection). An `httpClient` you pass is never closed by the SDK.

## Naming compared with the JavaScript SDK

The Java SDK follows the JavaScript SDK's names (`assets.classify`, `cdn.serve`, `verifyWebhookSignature`, `createWebhookSignatureHeader(secret, timestamp, body)`, `WEBHOOK_SIGNATURE_TOLERANCE_SECONDS`, `event.type()`), with these Java-specific differences:

- Webhook helpers are static methods on `CalmLensServerClient`, and `parseWebhookEvent` takes the body, signature, timestamp and secret as arguments instead of an options object.
- `cdn.serve` returns a closeable `CdnResponse` with a streamed body instead of a fetch `Response`.
- Request options are builders: `Content.mimeType(...)` and `LensDefinition.lensType(...)` set the API's `type` field, because `type` would be ambiguous among the other setters.
- `assets.iterate`, `assets.iterateChildren` and `events.pages` return `Iterable` pagers instead of async generators.
- Per-call idempotency keys, deadlines and retries are passed as `RequestOptions`, and `withRequestOptions` takes the same class. Cancel a call by interrupting its thread: it fails with `sdk/cancelled` and is not retried.

## Testing

See [Java testing](https://calmlens.com/docs/sdk/java/testing). In short:

```java
var mock = new MockCalmLensServerClient(new MockCalmLensServerClient.Options()
    .queuedOutcome(MockCalmLensServerClient.Outcome.PENDING)          // assets.create (default)
    .analyzedOutcome(MockCalmLensServerClient.Outcome.ALLOWED));      // assets.classify and text.classify (default)
Asset asset = mock.client.assets.create("photo.png", bytes, "image/png");
mock.decide(asset.id(), MockCalmLensServerClient.Outcome.BLOCKED);   // records a review and adds an asset.blocked event
mock.client.assets.retrieve(new Models.AssetId(asset.id()));         // classification.moderation.status is blocked
MockCalmLensServerClient.Request sent = mock.requests().get(0);      // method(), path(), query(), header(...), bodyText()
```

The mock is the real client in front of an in-memory API: validation, encoding, retries and error mapping all run, without waiting between retries. It keeps assets, folders, hash lists, events and content, so uploads can be retrieved, listed (RSQL filters such as `classification.moderation.status==blocked`, with `;` binding tighter than `,` and parenthesised groups; ordering; folders; cursors that resume after the last item), searched (the API's keyword search, scores and ranking, without semantic search), updated, moved and deleted. It does not classify content: outcomes are `PENDING`, `ALLOWED`, `LIMITED` (served by the CDN like `ALLOWED`), `AGE_RESTRICTED`, `BLOCKED`, `PURGED` (which also removes the content) and `FAILED`. Finished processing removes content unless the upload sets `keepContentAfterProcessing`.

- **Errors** use the API's codes, HTTP statuses and error body, and every response has an `X-Request-Id`. Requests the API's schema refuses fail with `validation/too-small` or `validation/too-big` and the field in `getDetails().get("path")` (page sizes from 1 to 100, event limits from 1 to 100, search limits from 1 to 20 and queries of 1 to 200 characters), and a list cursor only continues the query it came from. Idempotency keys replay the first response; a key reused for a different request fails with `idempotency/key-reused`, an invalid key with `idempotency/invalid-key`, and a failed request frees its key.
- **Multipart uploads** follow the API's order of checks: parts arrive in order (`upload/invalid-part-number` with the expected and received numbers), non-final parts are at least 5 MiB, image uploads total 10 to 20 MiB, parts add up to a declared `totalSizeInBytes`, and the final part uses the queue choice saved when the upload started.
- **Events** from `decide` (with the event catalog's severity: `low` for `allowed` and `limited`, `high` otherwise) and `enqueueEvent(type, assetId, facts...)` are returned by `events.list` and `events.pages` after cursors taken earlier. Like the API, `assets.retry`, `assets.deleteContent` and `assets.delete` add `asset.retried`, `asset.content-removed` and `asset.deleted` events, and `assets.batch` adds one per asset (it checks every ID first, then applies the operation at once, in request order, rather than in the background), and a reviewer's purge removes the content with reason `requested` after an `asset.content-removed` event.
- **Failures and grants**: `failNextRequest("transport-error")`, `failNextRequest("timeout")` or `failNextRequest(apiErrorCode)` fails the next request without running it; `failNextRequest(failure, "assets.create")` waits for that operation. `setApiKeyGrants(grants...)` replaces the key's grants for later requests, keeping the key itself.
- **Outcomes per upload**: `queuedOutcome` and `analyzedOutcome` also take a function of the uploaded `Asset`, for example to block assets by name.
- **Waiting for decisions** with `assets.waitForDecision` checks storage; its waits are skipped but count towards its timeout, so a pending asset times out at once. Use `mock.withStorage(storage -> ...)` to read or change stored records.
- **CDN responses** from `cdn.serve` carry the stored bytes, content type and length, `Cache-Tag`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy` and, for images, `ETag` and `Expires`, and `Cache-Control` as the CDN sets it (`public` only when anyone may see the asset, otherwise `private`; `max-age=31536000, immutable` for images and `max-age=3600` for other content). Like the CDN, blocked, purged and failed assets, and assets whose content was removed or is still uploading, are refused first with `403` `asset/not-available` whatever the key. Then private and age-restricted assets need a key with the download grant (the default key has none): build the mock from `CalmLensServerClient.builder(MockCalmLensServerClient.createMockApiKey(MockCalmLensServerClient.Grant.download()), "proj_8fK2mQx7Lp4NvB3tRz9Y")`. A public age-restricted asset is also served with `allowAgeRestricted(true)`. A classified image's `placeholder` is a small PNG rendered from its ThumbHash, served for public assets whatever their moderation and refused once the asset is purged or its content removed.
- **Upload tokens**: `MockCalmLensServerClient.signUploadToken(apiKey, options, now, nonce)` signs like `uploadTokens.sign` at a fixed time and nonce, for exact tokens in tests.
- **IDs** are like the API's: each new object's prefix, `_` and 20 random base62 characters, such as `asset_5Gm2Rk8XqT3wLp9VbN4c` or `fldr_7Nc4Wq2Lm8Xt5Rk9Bv3P`. `assets.batch` refuses an ID that is not an asset ID with `validation/invalid-format`.
- **Options** `createId` and `now` make IDs and timestamps deterministic (`createId` receives the prefix: `asset`, `fldr`, `hl`, `hle`, `lens`, `evt` or `rev`; the default clock moves on by at least a millisecond per reading, so assets created in a row have increasing `createdAt`); `signedUrlBaseUrl` sets the base of signed URLs, which are not production URLs.

Queued responses take precedence, in order: `enqueue(status, body)`, `enqueueError(code)`, `enqueueRateLimited`, `enqueueEvents`, `enqueueCdn`, `enqueueFailure(exception)` and `enqueueTimeout()` answer the next request instead of the in-memory API. `enqueue(method, path, status, body)` binds a response to one route and waits for a request to it. Queue one response per retry attempt, or build the mock with `maxRetries(0)`.

## Development

Run `mvn verify` (tests and Javadoc with doclint). The shared request, path, webhook and error-code fixtures in `testdata/` are generated from the JavaScript SDK by `bun packages/sdk-contract/generate.ts`. Run `bun run test:sdk:e2e` from the repository root for all SDKs against the local backend.

Folder listings return a page with `folders`, visible `ancestors`, and `hasMore`. Set `parentId` to open a branch (omit it for project root), and advance `pageIndex` to load another page. `pageSize` is at most 100. `search` with `searchAll` finds names in unopened branches; `ids` with `resolveOnly` resolves selected folder paths. Use the SDK’s language-specific option names.
