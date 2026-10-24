# CalmLens Rust SDK

The Rust SDK for CalmLens moderation, storage and CDN delivery: an async client (Tokio and reqwest), an optional blocking client, typed requests and responses, streamed uploads and downloads, retries with idempotency keys, webhook verification and an offline mock. Rust 1.88 or later.

```rust
use calmlens::{models::*, ServerClient};

#[tokio::main]
async fn main() -> calmlens::Result<()> {
    let client = ServerClient::new("your-api-key", "your-project-id")?;
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

Install with `cargo add calmlens`. Request and response models live in `calmlens::models`. `Patch::Missing` leaves a field unchanged, `Patch::Null` clears it and `Patch::Value(value)` replaces it. Requests never follow redirects.

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
    .timeout(Duration::from_secs(60))         // whole-request limit for API calls
    .connect_timeout(Duration::from_secs(10))
    .read_timeout(Duration::from_secs(60))    // longest wait for the next response bytes
    .max_retries(2)
    .build()?;
```

- `timeout` applies to API calls. Uploads and CDN downloads have no whole-request limit, so large transfers are not cut off; `connect_timeout` and `read_timeout` still bound stalled connections. `client.with_timeout(duration)` returns a handle whose calls, uploads included, time out after `duration`, and `client.with_max_retries(n)` one with its own retry limit. Both share the client's connections.
- `http_client(reqwest::Client)` sends requests through your own reqwest client (a proxy, custom root certificates, a shared pool). Its own timeouts and redirect policy apply; disable redirects on it.
- Invalid options fail with `sdk/invalid-config`.
- `Debug` output of the client and builder never includes the API key.
- Every request sends `User-Agent: calmlens-rust/<version> (rustc <compiler version>)`; `calmlens::VERSION` is the crate version.

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

GET and HEAD requests, uploads and multipart parts are retried up to `max_retries` times (2 by default) after transport failures and timeouts, `429`, `502`, `503` and `504` responses, and `idempotency/request-in-progress`. The client waits for `Retry-After` when the API sends it (and gives up when it asks for more than 60 seconds), and otherwise for a random delay of up to 0.5 s, 1 s, 2 s and so on, capped at 8 s.

Each upload (`assets().create`, `assets().classify`, `text().classify`) and each part (`assets().upload_part`) is sent with a new `Idempotency-Key`, reused across the client's own retries, so a retried request returns the original response instead of creating a second asset. Set `idempotency_key` on `SubmitAsset`, `UploadPart` or `ClassifyText` to reuse a key across processes. Other writes (folders, updates, deletes) are sent once. Uploads from a reader or stream are read once, so they are never retried.

## Uploads

| Constructor | Sends |
| --- | --- |
| `Content::text(text)` | `text/plain` text |
| `Content::bytes(bytes, mime_type)` | A `Vec<u8>`, `bytes::Bytes` or `&'static [u8]` without copying |
| `Content::reader(reader, size, mime_type)` | A `std::io::Read` that yields exactly `size` bytes, read in 64 KiB chunks on Tokio's blocking pool |
| `Content::stream(stream, size, mime_type)` | A `Stream` of `Bytes` chunks totalling `size` |
| `Content::file(path, mime_type)` | A file, streamed from disk |
| `Content { payload: Payload::Base64(..), .. }` | Base64 (or a `data:` URL) |

Readers, streams and files are sent as they are read, so a file is never held in memory. A reader or stream that yields a different number of bytes than `size` fails with `sdk/transport-error`.

Set `Content.size_in_bytes` to declare a payload's byte length explicitly. A value that differs from the measured payload length or the reader/stream size fails with `upload/invalid-payload` before the request is sent.

For a multipart upload, start with `SubmitAsset::multipart(name, content.part(1, is_final))` and send later parts with `assets().upload_part(UploadPart { asset_id, part: content.part(n, is_final), .. })`. Non-final parts must be at least 5 MiB. Set `total_size_in_bytes` on the first request when you know the file's size; CalmLens then refuses an upload that could never finish and parts that overshoot or fall short. CalmLens saves the `queue` choice when the upload starts, so any process or client that knows the asset ID can send the remaining parts; set `queue` on a part only to override it.

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

## Upload presets

Set `upload_preset_id` on `SubmitAsset` (or `ClassifyText`) to apply an upload preset's folder, visibility, file types and size limit. To let a browser upload through a preset that requires tokens, sign a single-use token on your server. Signing happens locally with your API key and makes no request; `blocking::ServerClient` and `MockServerClient` have `upload_tokens()` too.

```rust
let signed = client.upload_tokens().sign(SignUploadToken {
    external_id: Some("post-42".into()), // optional: the uploaded asset gets this ID
    expires_in_seconds: Some(600),       // optional: 1 to 3600, 600 by default
    ..SignUploadToken::new("your-upload-preset-id")
})?;
// signed.token, signed.expires_at (milliseconds since the Unix epoch)
```

See [Upload presets](https://calmlens.com/docs/guides/upload-presets).

## CDN delivery

`cdn().get_asset_url(&CdnRequest)` builds an asset's CDN URL. `cdn().serve(CdnRequest)` fetches it with your API key and returns a streaming `CdnResponse` whatever its status, with `status()` and `headers()`. Read it with `chunk().await`, `into_stream()` or `bytes().await`; drop an unfinished response to close it. `HttpOptions` sets the method and headers, for `HEAD` or a `Range` request; the SDK always sends its own API key.

`resource` is `CdnResource::Rendered` (the default), `CdnResource::Original` or `CdnResource::Placeholder`; only the rendered resource takes a lens or transform. Set `lens` to deliver through a named lens, or `transform` to a `CdnTransform`: a selector string, one `Transform` step or a `Vec<Transform>` of steps. A selector has one path segment per step, such as `fit=cover,width=640/format=webp`, and a lens and a transform are joined with `/` (`/rendered/@thumbnail/width=320`). Structured steps become a selector with sorted, percent-encoded options, dotted nested keys (`border.color`) and hex colours without `#`, so equal transforms share a URL. `assets().create_signed_url` takes the same `transform`. Set both `lens` and `transform` to apply the lens first, then the extra transforms.

A public asset whose moderation status is `age-restricted` is served from its public URL only with `allow_age_restricted: Some(true)`, which appends `?allowAgeRestricted=true`; otherwise it needs a signed URL or an API key. Set it only where your app has already decided the viewer may see age-restricted content.

```rust
let url = client.cdn().get_asset_url(&CdnRequest {
    asset_identifier: "asset-1".into(),
    transform: Some("format=png,width=1024".into()),
    ..Default::default()
})?;
let same = client.cdn().get_asset_url(&CdnRequest {
    asset_identifier: "asset-1".into(),
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

## Pagination and events

- `assets().iterate(ListAssets)` and `assets().iterate_children(ListChildren)` return a `Stream` of assets (`Iterator` for the blocking client) that fetches pages from `cursor` on as it is read, keeping the filter and ordering. An error ends the stream.
- `events().pages(ListEvents)` returns pages of the events feed, following each page's cursor until a page has `has_more: false`. Store the last page's `cursor` and pass it as `after` on the next poll. Without `after`, the first page is empty and its cursor marks the current time.

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
| `details()` | The API's `details`, plus `traceId` and `network: true` for API errors |
| `headers()` | The failed response's headers |
| `source()` | The underlying reqwest, IO or JSON error |
| `is_not_found()`, `is_retryable()`, `is_timeout()` | Common checks |

SDK codes: `sdk/transport-error` (the request could not be sent or the response read), `sdk/timeout` (also returned by `wait_for_decision` when no decision arrives in time), `sdk/invalid-response` (a successful response that isn't the expected JSON), `sdk/http-error` (an error response without a CalmLens error body), `sdk/response-too-large` (an API response over 64 MiB), `sdk/invalid-argument` (an empty, `.` or `..` ID, an invalid transform or CDN header), `sdk/invalid-config`, `sdk/invalid-webhook-signature` and `sdk/invalid-webhook-payload`. Upload validation uses the API's codes, such as `upload/invalid-payload` and `upload/invalid-mime-type`, before anything is sent. `Error::new(code, message)` and the `with_*` methods build errors for tests.

## Models

Rust fields are snake_case; the wire JSON is camelCase. Response models are `#[non_exhaustive]` and keep fields this version doesn't know in `extra`. Every enumerated value (`AssetClassificationStatus`, `AssetModerationStatus`, `AssetContentStatus`, `AssetType`, `Visibility`, `Likelihood`, `ClassificationCategory`, `EventType`, `ImageFormat` and the rest) keeps values it doesn't know in an `Unknown(String)` variant, and `Transform::Unknown` keeps transform types it doesn't know with their options as received. Only metadata values and event fact values are plain JSON (`serde_json::Value`), because the API accepts any JSON there. New API fields and values therefore never fail decoding. Build response models for tests with `Asset::new`, `AssetPage::new`, `Folder::new`, `Event::new` and `EventsPage::new`, or `Default::default()` and field assignment.

`assets().classify(SubmitAsset)` and `text().classify(ClassifyText)` return an `Asset`. Its state is in three parts:

- `upload`: receipt of source content, with `status` (`uploading` or `completed`), `updatedAt` and `partsReceived` for multipart uploads.
- `classification`: `status` (`pending`, `processing`, `completed` or `failed`), `updatedAt`, `completedAt`, optional `personDetection`, `faceDetection` and `labels`, and `moderation`. The moderation section contains `status`, category scores, policy assessment, an optional `timeline` and reviewer decisions (`manual_reviews`, each with a `decision` of `allowed`, `age-restricted`, `blocked` or `purged`). A reviewer decision does not change `completedAt`.
- `content`: `status` (`temporary` until processing finishes, `stored` or `removed`), `removal_reason` (`policy`, `retention`, `requested`, `parent-removed` or `disposed`), `updated_at`, `safety_hold`, `format` (the MIME type), `extension`, `size_in_bytes`, `checksums`, `image` (the picture served at the rendered resource) and `extracted_text`.

The moderation status also decides delivery:

- `pending`: not decided yet; don't show the content.
- `allowed`: show it.
- `age-restricted`: the CDN serves it only through signed URLs or with an API key, like a private asset. Show it only behind your own age check.
- `blocked`: not delivered; the content is kept.
- `purged`: not delivered, and the stored content is deleted.

Treat an unknown moderation status as not allowed:

```rust
let asset = client.text().classify(ClassifyText::new("Hello world")).await?;
let publishable = asset.classification.moderation.status == AssetModerationStatus::Allowed;
let needs_age_check =
    asset.classification.moderation.status == AssetModerationStatus::AgeRestricted;
```

`ensure_lens` and `ensure_lenses` create or update named lenses and return them in request order; definitions the client has already ensured are answered from its cache.

## Webhooks

CalmLens signs each delivery with `WEBHOOK_SIGNATURE_HEADER` (`x-calmlens-signature`, `v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`), `WEBHOOK_TIMESTAMP_HEADER` (`x-calmlens-timestamp`, Unix seconds) and `WEBHOOK_DELIVERY_HEADER` (`x-calmlens-delivery`, for deduplicating retries).

`construct_webhook_event(raw_body, &http::HeaderMap, secret)` verifies the signature against the exact raw bytes, rejects timestamps more than `WEBHOOK_SIGNATURE_TOLERANCE_SECONDS` (300) from now, and returns a `models::WebhookEventPayload`. It fails with `sdk/invalid-webhook-signature` (answer 401) or `sdk/invalid-webhook-payload` (answer 400). It takes raw bytes (`&[u8]`, `Bytes`, `Vec<u8>` or `&str`), never a parsed JSON value, because re-serialized JSON may not match the signed bytes.

With axum, extract the body as `axum::body::Bytes`, not `Json`:

```rust
use axum::{body::Bytes, http::{HeaderMap, StatusCode}};

async fn calmlens_webhook(headers: HeaderMap, body: Bytes) -> StatusCode {
    let secret = std::env::var("CALMLENS_WEBHOOK_SECRET").unwrap_or_default();
    match calmlens::construct_webhook_event(&body, &headers, &secret) {
        Ok(event) => {
            if let Some(asset) = &event.data.asset {
                println!("{} {} {}", event.event_type, asset.id, asset.classification.moderation.status);
            }
            StatusCode::NO_CONTENT
        }
        Err(error) if error.code() == "sdk/invalid-webhook-signature" => StatusCode::UNAUTHORIZED,
        Err(_) => StatusCode::BAD_REQUEST,
    }
}
```

actix-web has its own header types: extract `web::Bytes` and pass the header values to `construct_webhook_event_at(body, signature, timestamp, secret, now_seconds, tolerance_seconds)`. `verify_webhook_signature` and `parse_webhook_event` are also available separately, `create_webhook_signature_header` signs test deliveries, and `WebhookEventPayload::from_event` builds the body CalmLens sends for an event. `event.data.asset` is an `EventAsset`, a snapshot of the asset when the event was created: `id`, `external_id`, `classification.status`, `classification.moderation.status` and `content.status`.

## Offline testing

Enable the mock in `[dev-dependencies]`:

```toml
[dev-dependencies]
calmlens = { version = "0.1", features = ["testing"] }
```

```rust
use calmlens::{models::*, testing::MockServerClient};

let mock = MockServerClient::new()?;
mock.enqueue(200, Asset::new("asset-1", AssetClassificationStatus::Completed, AssetModerationStatus::Allowed));
let asset = mock.assets().classify(SubmitAsset::text("hello")).await?;
assert_eq!(mock.last_request().unwrap().body, b"hello");
```

`MockServerClient` answers from a FIFO queue and uses the real client's validation, encoding, retries and error mapping; it creates no HTTP client, so it works inside any runtime. Queue responses with `enqueue(status, model)`, `enqueue_api_error(code, message)` (the API's body shape and the HTTP status the API uses for that code), `enqueue_response(MockResponse::new(206).header(..).body(..))` (CDN responses, `Retry-After`), `enqueue_raw`, `enqueue_timeout()`, `enqueue_transport_error(message)` and `enqueue_error(error)`. Responses carry an `x-request-id` unless you set one. `requests()` and `last_request()` return captured requests (`method`, `url`, `path`, `query`/`query_param`, `headers`/`header` with the API key redacted, `body` including streamed uploads, `json()`). `client()` returns a `ServerClient` and `blocking()` a `blocking::ServerClient` sharing the queue. An empty queue fails with `sdk/transport-error` and never reaches the network. `MockServerClient::new()` disables retries; build one with `MockServerClient::from_builder(ServerClient::builder(key, project).max_retries(2))` to test them.

## Development

```sh
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo check --no-default-features
```

The tests enable the `blocking` and `testing` features through a dev-dependency on the crate itself. CI tests the minimum (1.88, matching `rust-version` and the locked dependencies) and current stable compilers. `bun packages/sdk-contract/generate.ts` regenerates the request, path and webhook fixtures in `testdata/` and the error-code list in `src/codes.rs`. Run `bun run test:sdk:e2e` from the repository root to test all six SDKs against the local backend.

Image moderation considers readable text directly. Optional OCR (`processingOptions.features.ocr.enabled: true` on the wire) adds a text moderation pass and stores retained text in the image’s `content.extractedText`. No separate text child is created. Read the image’s combined `classification.moderation`; removing its content also removes the extracted text.

Folder listings return a page with `folders`, visible `ancestors`, and `hasMore`. Set `parentId` to open a branch (omit it for project root), and advance `pageIndex` to load another page. `pageSize` is at most 100. `search` with `searchAll` finds names in unopened branches; `ids` with `resolveOnly` resolves selected folder paths. Use the SDK’s language-specific option names.
