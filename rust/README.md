# CalmLens Rust SDK

The Rust SDK for CalmLens moderation, storage and CDN delivery: an async client (Tokio and reqwest), an optional blocking client, typed requests and responses, streamed uploads and downloads, retries with idempotency keys, webhook verification and an offline mock. Rust 1.88 or later.

```rust
use calmlens::{models::*, ServerClient};

#[tokio::main]
async fn main() -> calmlens::Result<()> {
    let client = ServerClient::new("your-api-key", "proj_8fK2mQx7Lp4NvB3tRz9Y")?;
    let asset = client.assets().classify(SubmitAsset::text("Hello world")).await?;
    if asset.classification.moderation.status == AssetModerationStatus::Allowed {
        println!("{}", asset.id);
    }
    let queued = client
        .assets()
        .create(SubmitAsset::new("note.txt", Content::bytes(b"Hello".to_vec(), "text/plain")))
        .await?;
    client
        .assets()
        .update(UpdateAsset { asset_id: queued.id, description: Patch::Null, ..Default::default() })
        .await?;
    Ok(())
}
```

Install with `cargo add calmlens`. Request and response models live in `calmlens::models`. `Patch::Missing` leaves a field unchanged, `Patch::Null` clears it and `Patch::Value(value)` replaces it. Requests never follow redirects: a `3xx` response fails with `sdk/http-error`, its status and request ID, and is not retried.

## Features

| Feature | Default | Adds |
| --- | --- | --- |
| `async` | yes | The async `calmlens::ServerClient` |
| `rustls` | yes | TLS through rustls with the bundled Mozilla root certificates |
| `rustls-native-roots` | | TLS through rustls with the operating system's root certificates |
| `native-tls` | | TLS through the platform library |
| `blocking` | | `calmlens::blocking::ServerClient`, the same API without `async` |
| `testing` | | `calmlens::testing::MockServerClient`; enable it in `[dev-dependencies]` only |

With `default-features = false` the crate contains only the models and the webhook helpers, with no HTTP stack, for services that only receive webhooks.

## Sharing a client

Create one `ServerClient` when your application starts and reuse it. Clones are cheap (an `Arc` inside) and share the connection pool and lens cache, so store it in your axum or actix-web application state. Every method returns a `Send` future.

`calmlens::blocking::ServerClient` (feature `blocking`) wraps the async client and runs it on a private single-worker Tokio runtime. It can be created, cloned and dropped anywhere, including inside an async runtime. Its methods block the calling thread: call them from synchronous code or `tokio::task::spawn_blocking`, never directly from async code. Its paginators are `Iterator`s and its `CdnResponse` implements `std::io::Read`.

## Configuration

```rust
let client = calmlens::ServerClient::builder(api_key, project_id)
    .base_url("http://localhost:6110/v1")       // default https://api.calmlens.com/v1
    .cdn_base_url("http://localhost:6110/cdn/v1") // default https://cdn.calmlens.com/v1
    .timeout(Duration::from_secs(120))        // each API call attempt, response body included
    .upload_timeout(Duration::from_secs(900)) // each binary upload attempt (none by default)
    .connect_timeout(Duration::from_secs(10))
    .read_timeout(Duration::from_secs(120))   // longest wait for the next response bytes
    .max_retries(2)
    .max_response_bytes(32 * 1024 * 1024)     // the largest API response body read
    .build()?;
```

- `timeout` (120 seconds by default) applies to each API call attempt, including text uploads, and to the wait for a CDN download's response headers; the CDN body then streams for as long as it takes. Binary uploads use `upload_timeout`, which is unset by default so large files are not cut off; `connect_timeout` and `read_timeout` still bound stalled connections. The defaults are exported as constants such as `DEFAULT_TIMEOUT`, `DEFAULT_MAX_RETRIES` and `DEFAULT_MAX_RESPONSE_BYTES`.
- `max_response_bytes` (32 MiB by default) limits API response bodies: a larger body, or a larger declared `Content-Length`, fails with `sdk/response-too-large` before it is read. `client.with_timeout(duration)` returns a handle whose calls, uploads included, time out after `duration`, and `client.with_max_retries(n)` one with its own retry limit. Both share the client's connections.
- `http_client(reqwest::Client)` sends requests through your own reqwest client (a proxy, custom root certificates, a shared pool). Its own timeouts and redirect policy apply; disable redirects on it.
- Invalid options fail with `sdk/invalid-config`.
- `Debug` output of the client and builder never includes the API key.
- Every request sends `User-Agent: calmlens-rust/<version> (rustc/<compiler version>)` (`calmlens::VERSION` is the crate version) and the API key in `x-api-key`; API calls also send `Accept: application/json`.

## Waiting for a decision

`assets().wait_for_decision(WaitForDecision::new(asset_id))` retrieves a queued asset until it is decided (moderation status no longer `pending`, or classification status `failed`) and returns it. It checks again after 0.5 s, waiting 1.5 times longer each time up to 5 s, and fails with `sdk/timeout` if there's no decision within the timeout (60 s by default, or `.timeout(duration)`). The error's `details()` carry `assetId` and the last `classificationStatus` and `moderationStatus`. Drop the future to stop waiting; the blocking client's method blocks until the decision or the timeout. `Asset::is_decided` tells you whether an asset's outcome is final. Webhooks report decisions without polling.

```rust
let queued = client.assets().create(SubmitAsset::text("Hello world")).await?;
let decided = client
    .assets()
    .wait_for_decision(WaitForDecision::new(queued.id).timeout(Duration::from_secs(30)))
    .await?;
if decided.classification.moderation.status != AssetModerationStatus::Allowed {
    block(&decided.id);
}
```

## Retries and idempotency

GET and HEAD requests, uploads and multipart parts are retried up to `max_retries` times (2 by default) after transport failures and timeouts, `429`, `502`, `503` and `504` responses, and `idempotency/request-in-progress`. The client waits for `Retry-After` when the API sends it, in seconds or as an HTTP date (`0` or a past date retries at once), and gives up when it asks for more than 60 seconds (`RETRY_AFTER_MAX`). Otherwise it backs off from `RETRY_BASE_DELAY` (0.5 s), doubling per retry up to `RETRY_MAX_DELAY` (8 s), and waits half that delay plus a random share of the other half. `cdn().serve` retries the same way and returns the last response when retries run out.

Each upload (`assets().create`, `assets().classify`, `text().classify`) and each part (`assets().upload_part`) is sent with a new `Idempotency-Key`, reused across the client's own retries, so a retried request returns the original response instead of creating a second asset. Set `idempotency_key` on `SubmitAsset`, `UploadPart` or `ClassifyText` to reuse a key across processes. Other writes (folders, updates, deletes, batches) are sent once. Uploads from a reader or stream are read once, so they are never retried.

## Batch operations

`assets().batch(BatchAssets { asset_ids, operation })` deletes up to 500 assets (`AssetBatchOperation::Delete`, with their child assets and stored content) or removes their stored content (`AssetBatchOperation::RemoveContent`) in one request, and returns `BatchAssetsResponse { queued: true, .. }`. Every asset must exist in the project and the key needs `assets:delete` for its folder (`asset/not-found` or `auth/permission-denied` otherwise), or nothing is queued. The work then runs in the background and records `asset.deleted` or `asset.content-removed` for each asset; assets under a safety hold are skipped. The client refuses an empty list, more than 500 IDs or an empty ID with `sdk/invalid-argument` before sending.

```rust
client
    .assets()
    .batch(BatchAssets {
        asset_ids: vec![first_id, second_id],
        operation: AssetBatchOperation::RemoveContent,
    })
    .await?;
```

## Uploads

| Constructor | Sends |
| --- | --- |
| `Content::text(text)` | `text/plain` text |
| `Content::bytes(bytes, mime_type)` | A `Vec<u8>`, `bytes::Bytes` or `&'static [u8]` without copying |
| `Content::reader(reader, size, mime_type)` | A `std::io::Read` that yields exactly `size` bytes, read in 64 KiB chunks on Tokio's blocking pool |
| `Content::stream(stream, size, mime_type)` | A `Stream` of `Bytes` chunks totalling `size` |
| `Content::unsized_stream(stream, mime_type)` | A `Stream` whose length isn't known in advance, sent chunked without `sizeInBytes` |
| `Content::file(path, mime_type)` | A file, streamed from disk |
| `Content { payload: Payload::Base64(..), .. }` | Base64 (or a `data:` URL) |

Readers, streams and files are sent as they are read, so a file is never held in memory. A reader or stream that yields a different number of bytes than `size` fails with `sdk/transport-error`.

Set `Content.size_in_bytes` to declare a payload's byte length explicitly. A value that differs from the measured payload length or the reader/stream size fails with `upload/invalid-payload` before the request is sent.

For a multipart upload, start with `SubmitAsset::multipart(name, content.part(1, is_final))` and send later parts with `assets().upload_part(UploadPart { asset_id, part: content.part(n, is_final), .. })`. Non-final parts must be at least 5 MiB, and image uploads in parts must total 10 to 20 MiB. The client refuses a part of known size before sending it: a non-final part under 5 MiB with `upload/invalid-payload`, and a first image part over 20 MiB, or a final one under 10 MiB, with `upload/multipart-image-too-large` or `upload/multipart-image-too-small`. The API checks the totals across parts and answers with the same codes. Set `total_size_in_bytes` on the first request when you know the file's size; CalmLens then refuses an upload that could never finish and parts that overshoot or fall short. CalmLens saves the `queue` choice when the upload starts, so any process or client that knows the asset ID can send the remaining parts; set `queue` on a part only to override it.

Optional analyses are off unless a request turns them on in `ProcessingOptions::features`. Person and face detection are in beta; their results are informational, never change the moderation decision, and are returned in `asset.classification.personDetection` and `asset.classification.faceDetection`:

```rust
let asset = client.assets().classify(SubmitAsset {
    processing_options: Some(ProcessingOptions {
        features: Some(ProcessingFeatures {
            ocr: Some(FeatureOptions::enabled()),
            face_detection: Some(FaceDetectionOptions { age_estimation: Some(true), ..FaceDetectionOptions::enabled() }),
            ..Default::default()
        }),
        ..Default::default()
    }),
    ..SubmitAsset::new("photo.jpg", Content::file("photo.jpg", "image/jpeg")?)
}).await?;
let faces = asset.classification.face_detection.and_then(|f| f.faces);
```

### Conversations

For a post in a conversation, set `author_id` to your identifier for who wrote it and `context` to the earlier posts, oldest first. CalmLens moderates only the content itself and uses the earlier posts to read who it addresses, what it refers to and whether it quotes, reports or counters something. `SubmitAsset` and `ClassifyText` both take these fields:

```rust
use calmlens::models::{ModerationContext, ModerationContextItem};

let asset = client.text().classify(ClassifyText {
    author_id: Some("user-9".into()),
    context: Some(ModerationContext::new([
        ModerationContextItem::new("Anyone going tonight?").author_id("user-3"),
        ModerationContextItem::new("Not after last time").author_id("user-5"),
    ])),
    ..ClassifyText::new("Same here")
}).await?;
```

The SDK sends only the posts CalmLens uses: the 5 most recent (`MODERATION_CONTEXT_USED_ITEMS`) that fit in 2,000 characters (`MODERATION_CONTEXT_USED_CHARACTERS`, counted in Unicode code points). The newest post is always sent. `select_moderation_context_items` returns the posts that would be sent. The asset's `author_id` and `context` hold what was stored; `context` is `None` once the content is removed.

## Upload presets

Set `upload_preset_id` on `SubmitAsset` (or `ClassifyText`) to apply an upload preset's folder, visibility, file types and size limit. To let a browser upload through a preset that requires tokens, sign a single-use token on your server. Signing happens locally with your API key and makes no request; `blocking::ServerClient` and `MockServerClient` have `upload_tokens()` too.

```rust
let signed = client.upload_tokens().sign(SignUploadToken {
    external_id: Some("post-42".into()), // optional: the uploaded asset gets this ID
    expires_in_seconds: Some(600),       // optional: 1 to 3600, 600 by default
    ..SignUploadToken::new("preset_4Lk8Qw2Xm9Rt5Vb3Nc7P")
})?;
// signed.token, signed.expires_at (milliseconds since the Unix epoch)
```

For tests that compare whole tokens, `calmlens::testing::sign_upload_token(api_key, options, now_ms, nonce)` signs with the same validation at a fixed time and nonce.

See [Upload presets](https://calmlens.com/docs/guides/upload-presets).

## CDN delivery

`cdn().get_asset_url(&CdnRequest)` builds an asset's CDN URL. `cdn().serve(CdnRequest)` fetches it with your API key and returns a streaming `CdnResponse` whatever its status, with `status()` and `headers()`. Read it with `chunk().await`, `into_stream()` or `bytes().await`; drop an unfinished response to close it. `HttpOptions` sets the method and headers, for `HEAD` or a `Range` request; the SDK always sends its own API key.

`resource` is `CdnResource::Rendered` (the default), `CdnResource::Original` or `CdnResource::Placeholder`; only the rendered resource takes a lens or transform. Set `lens` to deliver through a named lens, or `transform` to a `CdnTransform`: a selector string, one `Transform` step or a `Vec<Transform>` of steps. A selector has one path segment per step, such as `fit=cover,width=640/format=webp`, and a lens and a transform are joined with `/` (`/rendered/@thumbnail/width=320`). Structured steps become a selector with sorted, percent-encoded options, dotted nested keys (`border.color`) and hex colours without `#`, so equal transforms share a URL. `assets().create_signed_url` takes the same `transform`. Set both `lens` and `transform` to apply the lens first, then the extra transforms. `ImageTransformOptions::redact` takes an `ImageRedaction` that blurs text regions (`text`, which needs OCR on the upload) or regions with personal information (`personal_information`) found when the image was processed, before any other option applies.

A public asset whose moderation status is `age-restricted` is served from its public URL only with `allow_age_restricted: Some(true)`, which appends `?allowAgeRestricted=true`; otherwise it needs a signed URL or an API key. Set it only where your app has already decided the viewer may see age-restricted content.

```rust
let url = client.cdn().get_asset_url(&CdnRequest {
    asset_identifier: "asset_5Gm2Rk8XqT3wLp9VbN4c".into(),
    transform: Some("format=png,width=1024".into()),
    ..Default::default()
})?;
let same = client.cdn().get_asset_url(&CdnRequest {
    asset_identifier: "asset_5Gm2Rk8XqT3wLp9VbN4c".into(),
    transform: Some(
        Transform::image(ImageTransformOptions {
            format: Some("png".into()),
            width: Some(1024),
            ..Default::default()
        })
        .into(),
    ),
    ..Default::default()
})?;
assert_eq!(url, same);
```

## Hash lists

Hash lists hold PDQ hashes of images the project never wants again. Image uploads are compared with every list in the project: a `HashListAction::Flag` list records matches in `classification.moderation.hash_matches`, and a `HashListAction::Block` list also blocks close matches. `hash_lists()` has `list()`, `retrieve(HashListId)`, `create(CreateHashList)`, `update(UpdateHashList)` (set `description: Patch::Null` to clear it), `delete(HashListId)` (which also deletes the list's entries), `list_entries(ListHashListEntries)` (a cursor page, newest first), `add_entry(AddHashListEntry)` and `remove_entry(HashListEntryId)`. Add an entry from a `hash` of 64 hexadecimal characters, or from an image asset's perceptual hash with `asset_id`; an asset without one fails with `hash-list/asset-not-hashed`. Adding a hash the list already holds returns the existing entry.

```rust
let list = client
    .hash_lists()
    .create(CreateHashList {
        name: "Removed images".into(),
        action: HashListAction::Block,
        ..Default::default()
    })
    .await?;
client
    .hash_lists()
    .add_entry(AddHashListEntry {
        hash_list_id: list.id.clone(),
        asset_id: Some("asset_5Gm2Rk8XqT3wLp9VbN4c".into()),
        label: Some("Report 1042".into()),
        ..Default::default()
    })
    .await?;
```

## Pagination and events

- `assets().iterate(ListAssets)` and `assets().iterate_children(ListChildren)` return a `Stream` of assets (`Iterator` for the blocking client) that fetches pages from `cursor` on as it is read, keeping the filter and ordering. It ends at a page without a next cursor, with `has_more: false` or without items. An error ends the stream.
- `events().pages(ListEvents)` returns pages of the events feed, following each page's cursor until a page has `has_more: false`.
- A page with more to follow whose cursor the iteration already sent fails with `sdk/invalid-response` and `details.cursor`, instead of repeating pages forever; that page is not yielded. Store the last page's `cursor` and pass it as `after` on the next poll. Without `after`, the first page is empty and its cursor marks the current time.

```rust
use futures_util::TryStreamExt;

let mut pages = client.events().pages(ListEvents { after: Some(cursor), limit: Some(100) });
while let Some(page) = pages.try_next().await? {
    for event in &page.events {
        println!("{} {:?}", event.id, event.event_type);
    }
    cursor = page.cursor;
}
// Persist `cursor`, then poll again later.
```

## Errors

Every call returns `calmlens::Error`. `Display` prefixes the message with `[calmlens] `.

| Method | Returns |
| --- | --- |
| `code()` | `&ErrorCode`: a variant per API error code (generated from the API's public error list, with `http_status()`) and per SDK code, or `ErrorCode::Other(String)` for codes this version doesn't know. Compare with strings: `error.code() == "asset/not-found"` |
| `message()` | The message without the prefix |
| `status()` | The HTTP status of an API error |
| `request_id()` | The response's `X-Request-Id`; log it and quote it to support |
| `retry_after()` | The `Retry-After` delay of a `429` or `idempotency/request-in-progress` response |
| `details()` | The API's `details`, plus its `traceId`; empty for SDK errors such as transport failures |
| `headers()` | The failed response's headers |
| `source()` | The underlying reqwest, IO or JSON error |
| `is_not_found()`, `is_retryable()`, `is_timeout()` | Common checks |

SDK codes: `sdk/transport-error` (the request could not be sent or the response read), `sdk/timeout` (also returned by `wait_for_decision` when no decision arrives in time), `sdk/invalid-response` (a successful response that isn't the expected JSON), `sdk/http-error` (an error response without a CalmLens error body), `sdk/response-too-large` (an API response over `max_response_bytes`), `sdk/invalid-argument` (an empty, `.` or `..` ID, an invalid transform or CDN header), `sdk/invalid-config`, `sdk/invalid-webhook-signature` and `sdk/invalid-webhook-payload`. Upload validation uses the API's codes, such as `upload/invalid-payload` and `upload/invalid-mime-type`, before anything is sent. `Error::new(code, message)` and the `with_*` methods build errors for tests.

## Models

Rust fields are snake_case; the wire JSON is camelCase. Response models are `#[non_exhaustive]` and keep fields this version doesn't know in `extra`. Every enumerated value (`AssetClassificationStatus`, `AssetModerationStatus`, `AssetContentStatus`, `AssetType`, `Visibility`, `Likelihood`, `ClassificationCategory`, `EventType`, `ImageFormat` and the rest) keeps values it doesn't know in an `Unknown(String)` variant, and `Transform::Unknown` keeps transform types it doesn't know with their options as received. Only metadata values and event fact values are plain JSON (`serde_json::Value`), because the API accepts any JSON there. New API fields and values therefore never fail decoding. Build response models for tests with `Asset::new`, `AssetPage::new`, `Folder::new`, `HashList::new`, `Event::new` and `EventsPage::new`, or `Default::default()` and field assignment.

`assets().classify(SubmitAsset)` and `text().classify(ClassifyText)` return an `Asset`. Its state is in three parts:

- `upload`: receipt of source content, with `status` (`uploading` or `completed`), `updatedAt` and `partsReceived` for multipart uploads.
- `classification`: `status` (`pending`, `processing`, `completed` or `failed`), `updatedAt`, `completedAt`, optional `personDetection`, `faceDetection` and `labels`, and `moderation`. The moderation section contains `status`, category scores, policy assessment, an optional `timeline` and reviewer decisions (`manual_reviews`, each with a `decision` of `allowed`, `limited`, `age-restricted`, `blocked` or `purged`). A reviewer decision does not change `completedAt`.
- `content`: `status` (`temporary` until processing finishes, `stored` or `removed`), `removal_reason` (`policy`, `retention`, `requested`, `parent-removed` or `disposed`), `updated_at`, `safety_hold`, `format` (the MIME type), `extension`, `size_in_bytes`, `checksums`, `image` (the picture served at the rendered resource) and `extracted_text`.

The moderation status also decides delivery:

- `pending`: not decided yet; don't show the content.
- `allowed`: show it.
- `limited`: delivered like `allowed`, but marked so your app can reduce its reach: keep it out of recommendations, trending and notifications, rank it lower, or collapse it behind a "show" control.
- `age-restricted`: the CDN serves it only through signed URLs or with an API key, like a private asset. Show it only behind your own age check.
- `blocked`: not delivered; the content is kept.
- `purged`: not delivered, and the stored content is deleted.

Treat an unknown moderation status as not allowed:

```rust
let asset = client.text().classify(ClassifyText::new("Hello world")).await?;
let publishable = matches!(
    asset.classification.moderation.status,
    AssetModerationStatus::Allowed | AssetModerationStatus::Limited
);
let reduce_reach = asset.classification.moderation.status == AssetModerationStatus::Limited;
let needs_age_check =
    asset.classification.moderation.status == AssetModerationStatus::AgeRestricted;
```

`ensure_lens` and `ensure_lenses` create or update named lenses and return them in request order; definitions the client has already ensured are answered from its cache.

## Webhooks

CalmLens signs each delivery with `WEBHOOK_SIGNATURE_HEADER` (`x-calmlens-signature`, `v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`), `WEBHOOK_TIMESTAMP_HEADER` (`x-calmlens-timestamp`, Unix seconds) and `WEBHOOK_DELIVERY_HEADER` (`x-calmlens-delivery`, for deduplicating retries).

`construct_webhook_event(raw_body, &http::HeaderMap, secret)` verifies the signature against the exact raw bytes, rejects timestamps more than `WEBHOOK_SIGNATURE_TOLERANCE_SECONDS` (300) from now, and returns a `models::WebhookEventPayload`. It reads the headers in any case and joins repeated ones with `,`, so a signature list split across headers verifies. It fails with `sdk/invalid-webhook-signature` (answer 401) or `sdk/invalid-webhook-payload` (answer 400): the body must be a JSON object with string `id`, `type` and `projectId`, a numeric `createdAt` and an object `data` whose fields have the API's types. `payload.json()` returns the body as received, with fields this SDK version doesn't model, and `payload.is_test()` tells a test send (a `test` fact with the value `true`) from a real event. `verify_webhook_headers(raw_body, &headers, secret, now_seconds, tolerance_seconds)` only verifies. It takes raw bytes (`&[u8]`, `Bytes`, `Vec<u8>` or `&str`), never a parsed JSON value, because re-serialized JSON may not match the signed bytes.

With axum, extract the body as `axum::body::Bytes`, not `Json`:

```rust
use axum::{body::Bytes, http::{HeaderMap, StatusCode}};

async fn calmlens_webhook(headers: HeaderMap, body: Bytes) -> StatusCode {
    let secret = std::env::var("CALMLENS_WEBHOOK_SECRET").unwrap_or_default();
    match calmlens::construct_webhook_event(&body, &headers, &secret) {
        Ok(event) => {
            if let Some(asset) = &event.data.asset {
                println!("{} {} {:?}", event.event_type, asset.id(), asset.moderation_status());
            }
            StatusCode::NO_CONTENT
        }
        Err(error) if error.code() == "sdk/invalid-webhook-signature" => StatusCode::UNAUTHORIZED,
        Err(_) => StatusCode::BAD_REQUEST,
    }
}
```

actix-web has its own header types: extract `web::Bytes` and pass the header values to `construct_webhook_event_at(body, signature, timestamp, secret, now_seconds, tolerance_seconds)`. `verify_webhook_signature` and `parse_webhook_event` are also available separately, `create_webhook_signature_header` signs test deliveries, and `WebhookEventPayload::from_event` builds the body CalmLens sends for an event. `event.data.asset` is an `EventAsset`, a snapshot of the asset when the event was created, holding the fields CalmLens sent: read them with `id()`, `external_id()`, `upload_preset_id()`, `upload_status()`, `classification_status()`, `moderation_status()` and `content_status()`, or `get(field)`.

## Offline testing

Enable the mock in `[dev-dependencies]`:

```toml
[dev-dependencies]
calmlens = { version = "0.1", features = ["testing"] }
```

```rust
use calmlens::{models::*, testing::MockServerClient};

let mock = MockServerClient::new()?;
mock.enqueue(200, Asset::new("asset_5Gm2Rk8XqT3wLp9VbN4c", AssetClassificationStatus::Completed, AssetModerationStatus::Allowed));
let asset = mock.assets().classify(SubmitAsset::text("hello")).await?;
assert_eq!(mock.last_request().unwrap().body, b"hello");
```

`MockServerClient` answers from a FIFO queue and uses the real client's validation, encoding, retries and error mapping; it creates no HTTP client, so it works inside any runtime. Queue responses with `enqueue(status, model)`, `enqueue_api_error(code, message)` (the API's body shape and the HTTP status the API uses for that code), `enqueue_response(MockResponse::new(206).header(..).body(..))` (CDN responses, `Retry-After`), `enqueue_raw`, `enqueue_timeout()`, `enqueue_hang()` (no response until the attempt's timeout passes on the virtual clock), `enqueue_transport_error(message)` and `enqueue_error(error)`. Responses carry an `x-request-id` unless you set one, and a declared `content-length` over `max_response_bytes` fails as it would over the network. `requests()` and `last_request()` return captured requests (`method`, `url`, `path`, `query`/`query_param`, `headers`/`header`, `body` including streamed uploads, `json()`, `response_status`: the status the mock answered with, or `None` after a transport failure), and `sleeps()` the waits between attempts and polls. `client()` returns a `ServerClient` and `blocking()` a `blocking::ServerClient` sharing the queue. An empty queue fails with `sdk/transport-error` and never reaches the network. `MockServerClient::new()` disables retries; build one with `MockServerClient::from_builder(ServerClient::builder(key, project).max_retries(2))` to test them.

`MockServerClient::in_memory(MockOptions::new())` adds an in-memory API behind the queue, so tests can simulate moderation outcomes. Queued replies are still used first. Uploads create stored assets: `assets().create` (and queued multipart uploads) get `queued_outcome` (default `MockOutcome::Pending`), and `assets().classify` and `text().classify` get `analyzed_outcome` (default `MockOutcome::Allowed`); `queued_outcome_for(|asset| ..)` and `analyzed_outcome_for(|asset| ..)` choose one per upload from the asset. The outcomes are `Pending`, `Allowed`, `Limited` (served like an allowed asset), `AgeRestricted`, `Blocked`, `Purged` (removes the content with reason `policy`) and `Failed` (retryable). Finished processing removes the content unless the upload sets `keep_content_after_processing`. Retrieve, list (`field==value` RSQL filters with `;`, `,`, `( … )` groups, `!=`, `=in=`, `=out=` and comparisons, with `;` binding tighter than `,`; ordering; folder; cursors that resume after the last item returned, so assets created or deleted between pages are neither repeated nor skipped), children, update, move, delete, delete content, batches (applied at once, in request order; mock assets have no safety holds), retry, explain, keyword search (every word of the query must appear in the name, ID, external ID, description, tags, type, content format or extension, or moderation status; results carry the API's keyword scores and matched fields and rank by score, then newest first), signed URLs, folders, hash lists (entries can be added from a stored asset's `content.image.perceptualHash`; uploads are not matched against them), lenses and `wait_for_decision` read and change that storage, with the API's error codes, statuses and details (schema errors are `validation/<issue>` with HTTP 400 and the field in `details.path`), `x-request-id` and idempotent replays. List cursors continue only the query they came from. Deletions, content removal and retries record `asset.deleted`, `asset.content-removed` and `asset.retried` events, as the API does. `set_api_key_grants(&grants)` changes the mock key's grants for later requests, and `fail_next_request(MockFailure::TransportError | Timeout | Api(code), Some("assets.create"))` fails the next request (of that operation, by its JavaScript method path) without running it.

```rust
use calmlens::{models::*, testing::*};

let mock = MockServerClient::in_memory(MockOptions::new().analyzed_outcome(MockOutcome::AgeRestricted))?;
let asset = mock.assets().create(SubmitAsset::text("hello")).await?; // pending
let start = mock.events().list(ListEvents::default()).await?.cursor;
mock.decide(&asset.id, AssetModerationDecision::Blocked)?; // adds an asset.blocked event
let page = mock.events().list(ListEvents { after: Some(start), ..Default::default() }).await?;
```

`decide(asset_id, decision)` applies a reviewer decision and adds the matching `asset.<status>` event with the event catalog's severity (`low` for `allowed` and `limited`, `high` otherwise) and a `decided-by: reviewer` fact; a purge removes the content with reason `requested` after an `asset.content-removed` event. `enqueue_event(event)` adds any event to the feed. `cdn().serve` returns stored bytes with their stored `content-type`, `content-length`, `cache-tag`, `x-content-type-options: nosniff`, a sandboxing `content-security-policy` and `cache-control` as the CDN sets it (`public` only when anyone may see the asset, otherwise `private`; `max-age=31536000, immutable` with an `etag` and `expires` for images and `max-age=3600` for other content). A classified image gets a ThumbHash, and its `placeholder` resource is served as the PNG it renders; removing the content removes it. Like the CDN, it first refuses blocked, purged and failed assets, and assets whose content was removed or is still uploading, with `403` `asset/not-available` whatever the key; then it serves private and age-restricted assets only when the API key has a download grant, such as `MockOptions::new().api_key(create_mock_api_key(&[MockApiKeyGrant::download()]))`, or a public age-restricted asset with `allow_age_restricted`. The default key has no grants. `with_storage(|storage| ..)` reads or seeds `assets`, `folders`, `hash_lists`, `hash_list_entries`, `content` and `events` in the API's JSON shape. New objects get IDs like the API's: their kind's prefix, `_` and 20 random base62 characters, such as `asset_5Gm2Rk8XqT3wLp9VbN4c`. `create_id(|prefix| ..)` (it receives `asset`, `fldr`, `hl`, `hle`, `lens`, `evt` or `rev`), `now` and `project_id` make results deterministic (the default clock moves on by at least a millisecond per reading, so assets created in a row get increasing `created_at`), and `api_base_url` and `cdn_base_url` set the URLs the mock client uses. Waits take no real time: retry backoff and `wait_for_decision` advance the mock's virtual clock (`mock.elapsed()`), so a pending asset fails with `sdk/timeout` at once. This applies to `MockServerClient::new()` and `from_builder` too. The mock does not classify or transform content.

## Development

```sh
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo check --no-default-features
```

The tests enable the `blocking` and `testing` features through a dev-dependency on the crate itself. CI tests the minimum (1.88, matching `rust-version` and the locked dependencies) and current stable compilers. `bun packages/sdk-contract/generate.ts` regenerates the request, path and webhook fixtures in `testdata/` and the error-code list in `src/codes.rs`. Run `bun run test:sdk:e2e` from the repository root to test all six SDKs against the local backend.

Image moderation considers readable text directly. Optional OCR (`processingOptions.features.ocr.enabled: true` on the wire) adds a text moderation pass and stores retained text in the image’s `content.extractedText`. No separate text child is created. Read the image’s combined `classification.moderation`; removing its content also removes the extracted text.

Folder listings return a page with `folders`, visible `ancestors`, and `hasMore`. Set `parentId` to open a branch (omit it for project root), and advance `pageIndex` to load another page. `pageSize` is at most 100. `search` with `searchAll` finds names in unopened branches; `ids` with `resolveOnly` resolves selected folder paths. Use the SDK’s language-specific option names.
