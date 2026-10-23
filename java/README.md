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
| `client.assets` | `create`, `classify`, `search`, `list`, `iterate`, `retrieve`, `waitForDecision`, `update`, `retry`, `deleteContent`, `delete`, `move`, `listChildren`, `iterateChildren`, `uploadPart`, `createSignedUrl` |
| `client.text` | `classify` |
| `client.folders` | `list`, `create`, `retrieve`, `update`, `move`, `delete` |
| `client.events` | `list`, `pages` |
| `client.cdn` | `getAssetUrl`, `serve` |
| `client` | `ensureLens`, `ensureLenses` |

`assets.create` queues processing and returns the asset while its `classification().status()` is `processing`; `assets.classify` and `text.classify` wait for classification. `text.classify` supplies `text/plain` content and names the asset `text` unless you set a name. `assets.deleteContent` removes the stored bytes (the record and report stay, with `content().status()` `removed` and `content().removalReason()` `requested`); `assets.retry` processes an asset whose `classification().status()` is `failed` again; `assets.delete` removes everything.

`assets.waitForDecision` retrieves an asset until its `classification().moderation().status()` is no longer `pending` (`allowed`, `age-restricted`, `blocked` or `purged`), or its `classification().status()` is `failed`, and returns it. It checks again after 0.5 seconds, then waits 1.5 times longer each time, up to 5 seconds. If there's no decision within the timeout (60 seconds by default), it throws `sdk/timeout` with `assetId` and the last `classificationStatus` and `moderationStatus` in `getDetails()`. Interrupting the thread stops it with `sdk/cancelled` and keeps the interrupt flag. Webhooks report decisions without polling.

```java
Asset queued = client.assets.create(new SubmitAsset("photo.jpg", Content.file(Path.of("photo.jpg"), "image/jpeg")));
Asset decided = client.assets.waitForDecision(new WaitForDecision(queued.id()).timeout(Duration.ofSeconds(30)));
if (decided.classification().moderation().status() != AssetModerationStatus.ALLOWED) unpublishPhoto(decided.id());
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

Responses are records whose accessors keep the API's camelCase names: `asset.id()`, `asset.classification().moderation().status()`, `asset.classification().moderation().categories()`, `event.type()`. An asset's state is grouped in three records: `upload()` (`AssetUpload`: receipt of source content), `classification()` (`AssetClassification`: progress, completion time, detections and labels, with safety findings and decisions in `classification().moderation()`) and `content()` (`AssetContent`: whether CalmLens holds the content, and its `format()`, `sizeInBytes()`, `checksums()`, `image()`, `previewImage()`, `extractedText()` and `safetyHold()`). Event and webhook snapshots (`EventAsset`) carry the processing, moderation and content statuses when the event was created. Optional values are `null` when the API omits them; lists inside responses are immutable. Timestamps are `java.time.Instant`. Nested objects are typed records (`AssetClassification`, `AssetModeration`, `AssetContent`, `Checksums`, `ImageData`, `PreviewImage`, `SafetyHold`, `ExtractedText`, `FlaggedContentPolicy`, `ImageTransformOptions` and so on), and values from a fixed set are strings so values added later still read. Only metadata values and event fact values, where the API accepts any JSON, are untyped: they use `String`, `Long`, `Double`, `Boolean`, `List` and `Map`, so `9007199254740993` stays exact and `5` is `5L`, never `5.0`. `toString()` is readable and never includes the API key; `SignedUrl.toString()` hides the URL's signature.

Responses read from newer API versions keep working: unknown fields are ignored, and an unknown status or visibility keeps its raw value (`classification().moderation().status().value()`, `classification().moderation().status().isKnown()` is `false`) instead of failing. Known values are `AssetClassificationStatus`, `AssetModerationStatus`, `AssetModerationDecision` (a reviewer's decision in `manualReviews()`) and `AssetContentStatus` constants you can compare with `==`. Show content publicly only when its moderation status is `ALLOWED`; show `AGE_RESTRICTED` content only behind your own age gate, through signed URLs; don't show `BLOCKED` or `PURGED` content, or any status this SDK version doesn't know. `classification().moderation().categories()` and `score()` are absent until findings are available.

## Uploads

`Content.text(text)`, `Content.bytes(bytes, mime)`, `Content.file(path, mime)` and `Content.stream(inputStream, sizeInBytes, mime)` create upload content. Files and streams are sent as they are read, with a `Content-Length`, so large uploads are never held in memory; bytes are sent without copying or base64 encoding.

Multipart uploads: send the first part with `assets.create(new SubmitAsset().name(...).part(content.partNumber(1).isFinal(false)))` (optionally `.totalSizeInBytes(size)` so CalmLens checks the total up front), then each later part with `assets.uploadPart(new UploadPart(assetId, content.partNumber(n).isFinal(last)))`. Non-final parts must be at least 5 MiB. CalmLens saves the queue choice when the upload starts, so parts can be sent from any client or process; `UploadPart.queue(Boolean)` overrides it for the final part.

Every upload carries an `Idempotency-Key`. The client generates one per call and reuses it for that call's retries, so a retried upload never creates a second asset. Pass your own key to retry safely across processes:

```java
client.assets.create(options, new RequestOptions().idempotencyKey(listing.id() + ":photo-1"));
```

## Upload presets

Call `.uploadPresetId(id)` on `SubmitAsset` or `ClassifyText` to apply an upload preset's folder, visibility, file types and size limit. To let a browser upload through a preset that requires tokens, sign a single-use token on your server. Signing happens locally with your API key and makes no request.

```java
Models.SignedUploadToken signed = client.uploadTokens.sign(
    new Models.SignUploadToken("your-upload-preset-id")
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

The payload has `id()`, `type()`, `createdAt()`, `projectId()` and `data()` (`severity`, `title`, `description`, `assetId`, the `asset` snapshot and `facts`). `verifyWebhookSignature(body, signature, timestamp, secret)` returns a boolean if you prefer, and an overload takes `nowSeconds` and `toleranceSeconds`. `createWebhookSignatureHeader(secret, timestamp, body)` signs test deliveries. The headers are exported as `WEBHOOK_SIGNATURE_HEADER`, `WEBHOOK_TIMESTAMP_HEADER` and `WEBHOOK_DELIVERY_HEADER`.

## CDN

`cdn.getAssetUrl(new CdnRequest(id).lens("thumb"))` builds a CDN URL. `cdn.serve` streams content with the API key and returns a `CdnResponse` for any status; close it when done:

```java
try (CdnResponse response = client.cdn.serve(new CdnRequest(asset.id())
    .init(new HttpOptions().headers(Map.of("Range", "bytes=0-1023"))))) {
  if (response.status() == 206) response.transferTo(outputStream);
}
```

A public asset whose moderation status is `age-restricted` is served from its public URL only with `ageRestricted(true)`, which appends `?ageRestricted=true`; otherwise it needs a signed URL or the API key. Set it only where your app has already decided the viewer may see age-restricted content.

To transform an asset without a saved lens, pass `transform` (here or on `SignedUrlOptions`) either a selector string or structured steps, which the SDK serializes with sorted, encoded options:

```java
client.cdn.getAssetUrl(new CdnRequest(id).transform("imageTransform[format=png,width=1024]"));
client.cdn.getAssetUrl(new CdnRequest(id).transform(
    Transform.image(new ImageTransformOptions().format("png").width(1024))));
client.cdn.getAssetUrl(new CdnRequest(id).transform(List.of(
    Transform.image(new ImageTransformOptions().border(new ImageBorder("#fff", 2.0))
        .gravity(Gravity.position("face")).trim(Trim.border())),
    Transform.image(new ImageTransformOptions().format("webp")))));
```

A lens runs before any additional transforms.

`readAllBytes(maxBytes)` buffers a body up to a limit. A stream read that receives nothing for the client's `timeout` fails with `HttpTimeoutException`; pass `new RequestOptions().timeout(...)` to change it per call. Use `assets.createSignedUrl` for private content in browsers.

## Errors

Every failure is an unchecked `CalmLensException` with a stable `getCode()`; compare it with the constants in `ErrorCodes`, which include every public API error code.

| Type | When | Extra information |
| --- | --- | --- |
| `ApiException` | The API answered with an error, or with a body the SDK could not read (`sdk/invalid-response`, `sdk/response-too-large`, `sdk/http-error`) | `getStatus()`, `getRequestId()` (`X-Request-Id`), `getHeaders()`, `getRetryAfter()`, `getTraceId()`, `getDetails()` |
| `TransportException` | The request could not be sent or its response could not be read (`sdk/transport-error`) | `getCause()` is the original exception |
| `RequestTimeoutException` | A timeout (`sdk/timeout`); a `TransportException` | |
| `CalmLensException` | Invalid arguments (`sdk/invalid-argument`), configuration (`sdk/invalid-config`), upload payloads (`upload/*`), webhooks (`webhook/*`), interruption (`sdk/cancelled`, the interrupt flag is preserved) and use after `close()` (`sdk/client-closed`) | |

`isNotFound()` and `isRetryable()` help branch on common cases. Validation failures are reported before anything is sent; header values containing line breaks or control characters are rejected as `sdk/invalid-argument`. Log `getRequestId()` with failures and include it when contacting support.

## Retries and timeouts

Reads (`GET`, `HEAD`) and uploads (which carry an `Idempotency-Key`) are retried up to `maxRetries` times (2 by default; `0` disables retries) after network failures, HTTP 429, 502, 503 and 504, and `idempotency/request-in-progress`. The client waits with jittered exponential backoff, or for the `Retry-After` delay when the API sends one (up to 60 seconds; longer delays are returned as the error). Other writes are never retried automatically. Uploads from `Content.stream` can be read once, so they are not retried either.

```java
CalmLensServerClient.builder(apiKey, projectId)
    .connectTimeout(Duration.ofSeconds(10))  // opening a connection
    .timeout(Duration.ofSeconds(60))         // API responses, response bodies and idle CDN streams
    .uploadTimeout(Duration.ofMinutes(15))   // uploads, which may take long for large files; null for none
    .maxRetries(2)
    .maxResponseBytes(32L * 1024 * 1024)
    .build();
```

Override the upload timeout for one call with `new RequestOptions().timeout(...)`. Pass `httpClient(...)` to use your own `java.net.http.HttpClient` (proxy, TLS, executor), or `transport(...)` to send requests through another HTTP stack.

## Identification and lifecycle

Requests send `User-Agent: calmlens-java/<version> (Java <runtime version>)`; `CalmLensServerClient.VERSION` is read from the Maven manifest. `close()` makes later calls fail with `sdk/client-closed` and, on Java 21 and later, closes the built-in `HttpClient` (on Java 17 it is released by garbage collection). An `httpClient` you pass is never closed by the SDK.

## Naming compared with the JavaScript SDK

The Java SDK follows the JavaScript SDK's names (`assets.classify`, `cdn.serve`, `verifyWebhookSignature`, `createWebhookSignatureHeader(secret, timestamp, body)`, `WEBHOOK_SIGNATURE_TOLERANCE_SECONDS`, `event.type()`), with these Java-specific differences:

- Webhook helpers are static methods on `CalmLensServerClient`, and `parseWebhookEvent` takes the body, signature, timestamp and secret as arguments instead of an options object.
- `cdn.serve` returns a closeable `CdnResponse` with a streamed body instead of a fetch `Response`.
- Request options are builders: `Content.mimeType(...)` and `LensDefinition.lensType(...)` set the API's `type` field, because `type` would be ambiguous among the other setters.
- `assets.iterate`, `assets.iterateChildren` and `events.pages` return `Iterable` pagers instead of async generators.
- Per-call idempotency keys and timeouts are passed as `RequestOptions`.

## Testing

See [Java testing](https://calmlens.com/docs/sdk/java/testing). In short:

```java
var mock = new MockCalmLensServerClient();
mock.enqueue(200, Map.of("id", "asset-1", "upload", Map.of("status", "completed"),
    "classification", Map.of("status", "completed", "moderation", Map.of("status", "allowed")),
    "content", Map.of("status", "removed")));
mock.enqueueError(ErrorCodes.ASSET_NOT_FOUND);            // HTTP 404 with the API's error body and a request ID
mock.enqueueEvents("cursor-2", false, Map.of("id", "e1", "type", "asset.blocked", "assetId", "asset-1"));
mock.enqueueCdn(200, "image/webp", bytes);
Asset asset = mock.client.text.classify("hello");
MockCalmLensServerClient.Request sent = mock.requests().get(0); // method(), path(), query(), header(...), bodyText()
```

The mock is the real client with a queued transport: validation, encoding, retries and error mapping all run, without waiting between retries. `assets.waitForDecision` reads queued responses until one's moderation status is no longer `pending` (or its classification failed); its waits are skipped but count towards its timeout. `enqueue(method, path, status, body)` binds a response to one route; `enqueueFailure(exception)` and `enqueueTimeout()` simulate network failures. Queue one response per retry attempt, or build the mock with `maxRetries(0)`. It does not classify content or keep state.

## Development

Run `mvn verify` (tests and Javadoc with doclint). The shared request, path, webhook and error-code fixtures in `testdata/` are generated from the JavaScript SDK by `bun packages/sdk-contract/generate.ts`. Run `bun run test:sdk:e2e` from the repository root for all SDKs against the local backend.

Folder listings return a page with `folders`, visible `ancestors`, and `hasMore`. Set `parentId` to open a branch (omit it for project root), and advance `pageIndex` to load another page. `pageSize` is at most 100. `search` with `searchAll` finds names in unopened branches; `ids` with `resolveOnly` resolves selected folder paths. Use the SDK’s language-specific option names.
