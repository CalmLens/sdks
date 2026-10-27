# CalmLens Python SDK

Server-side SDK for CalmLens moderation, storage and CDN delivery: every API operation,
streamed uploads, safe retries, webhook verification and an in-memory testing client.
Python 3.10+; no runtime dependencies; fully typed (`py.typed`, checked with `mypy --strict`).

## Install

```sh
python -m pip install calmlens
```

## Quick start

```python
from calmlens import CalmLensServerClient

# Reads CALMLENS_API_KEY and CALMLENS_PROJECT_ID from the environment when not passed.
client = CalmLensServerClient()

asset = client.text.classify(text="Great photo!", external_id="comment-42")
if asset["classification"]["moderation"]["status"] == "allowed":
    print("Allowed: safe to show")

with open("photo.jpg", "rb") as file:  # streamed, not read into memory
    queued = client.assets.create(name="photo.jpg", content={"data": file, "type": "image/jpeg"})
```

Every method takes snake_case keyword arguments, or one options dict with the API's camelCase
keys (`client.assets.retrieve({"assetId": "..."})`); nested dicts accept either spelling.
Responses are plain dicts with the API's camelCase field names, typed as `TypedDict`s in
`calmlens.types`. Unknown fields from newer API versions stay in the dict, and enum-like
values (`classification.moderation.status`, `classification.status`, `type`, `visibility`, ...) are plain strings, so
values this SDK version doesn't list never fail: treat an unknown status as "not allowed".

## Configuration

| Argument                   | Default                                                      | Meaning                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_key`                  | `CALMLENS_API_KEY`                                           | Project API key                                                                                                                                                                     |
| `project_id`               | `CALMLENS_PROJECT_ID`                                        | Project ID                                                                                                                                                                          |
| `base_url`, `cdn_base_url` | `https://api.calmlens.com/v1`, `https://cdn.calmlens.com/v1` | Endpoints                                                                                                                                                                           |
| `timeout`                  | `120`                                                        | Seconds a connection may stay silent before `sdk/timeout`. An inactivity limit, not a limit on the whole transfer, so large uploads and downloads are never cut off                 |
| `upload_timeout`           | `None`                                                       | The `timeout` of binary uploads (file content and multipart parts); `None` uses `timeout`. Text uploads always use `timeout`                                                        |
| `connect_timeout`          | `10`                                                         | Seconds to open a connection (TCP, proxy and TLS)                                                                                                                                   |
| `max_retries`              | `2`                                                          | Retries for requests that are safe to resend (see [Retries](#retries)); `0` disables them                                                                                           |
| `max_response_bytes`       | `33554432` (32 MiB)                                          | The largest API response body the client reads; a larger one (or a larger declared `Content-Length`, before reading) raises `sdk/response-too-large`. CDN downloads are not limited |
| `transport`                | pooled `http.client`                                         | `transport(request, timeout)` returning a context-managed response with `status`, `headers` and `read()`                                                                            |

Invalid options raise `CalmLensValidationError` with code `sdk/invalid-config` before the
client creates any state. `client.with_options(timeout=..., upload_timeout=..., max_retries=...,
max_response_bytes=...)` returns a client that shares the connections and lens cache with
different per-call settings, e.g.
`client.with_options(timeout=300).cdn.serve(...)`.

Reuse one client: it pools HTTP keep-alive connections and is **thread-safe**, so share it
between threads. Use `with CalmLensServerClient() as client:` or `client.close()` to close the pool;
custom transports remain caller-owned. After `os.fork()` (gunicorn, Celery, multiprocessing)
the child opens its own connections instead of sharing the parent's sockets. Redirects are
not followed, so the API key never leaves the configured endpoint: a `3xx` response raises
`sdk/http-error` with its status and request ID, and is not retried (`cdn.serve` included).
`repr(client)` never includes the API key. API requests send `Accept: application/json` and
every request `User-Agent: calmlens-python/<version> (<implementation>/<Python version>)`, such
as `calmlens-python/0.1.2 (cpython/3.12.4)`; the version is `calmlens.__version__`.

### Async applications

Calls are synchronous. From `asyncio`, run them in a worker thread with one shared client:

```python
asset = await asyncio.to_thread(client.text.classify, text=body, external_id=comment_id)
```

### Proxies

The default transport follows `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`, including
`user:password@` proxy credentials. HTTPS requests tunnel through the proxy with `CONNECT`, so
TLS still runs end to end to CalmLens. Point `HTTPS_PROXY` at the proxy's `http://` address:
an `https://` proxy URL (TLS to the proxy itself) is not supported for HTTPS requests and
raises `sdk/invalid-config`.

## Errors

Every failure raises `CalmLensError` or a subclass, with a stable `code` (constants in
`calmlens.error_codes`, generated from the API's error codes):

| Exception                 | When                                                                                                                                                                      | `code`                                                                                                                                          | `status`    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `CalmLensAPIError`        | Non-2xx API response                                                                                                                                                      | The API code, e.g. `asset/not-found`; `sdk/http-error` without an error body                                                                    | HTTP status |
| `CalmLensTimeoutError`    | Connecting or waiting for data timed out                                                                                                                                  | `sdk/timeout`                                                                                                                                   | `None`      |
| `CalmLensTransportError`  | Any other network or protocol failure (refused, reset, DNS, TLS, truncated response)                                                                                      | `sdk/transport-error`                                                                                                                           | `None`      |
| `CalmLensValidationError` | Invalid arguments or configuration, before anything is sent                                                                                                               | `sdk/invalid-argument`, `sdk/invalid-config`, or the API's code for the same problem, e.g. `upload/invalid-payload`, `upload/invalid-mime-type` | `None`      |
| `CalmLensError`           | A 2xx response that isn't the JSON the operation returns (an upload answered with something other than an asset included), or a response larger than `max_response_bytes` | `sdk/invalid-response`, `sdk/response-too-large`                                                                                                | HTTP status |
| `CalmLensError`           | An iterator received a page that says more follow with a cursor it had already sent; `details` has the `cursor`                                                           | `sdk/invalid-response`                                                                                                                          | `None`      |
| `CalmLensError`           | `assets.wait_for_decision` saw no decision within its `timeout`; `details` has `assetId` and the last `classificationStatus` and `moderationStatus`                       | `sdk/timeout`                                                                                                                                   | `None`      |

Each error also has `message`, `details` (the API's details, plus `traceId` when sent; empty for
transport errors), `request_id` (the response's `X-Request-Id`, to quote to support), `headers`
(lower-case names), `retry_after` (whole seconds from `Retry-After`, given in seconds or as an
HTTP date), `is_not_found` and `is_retryable`.
`is_retryable` depends only on `code` and `status`, so every error class agrees: it is True for
`sdk/transport-error`, `sdk/timeout` (including `wait_for_decision`'s) and
`idempotency/request-in-progress`, and for HTTP 429, 502, 503 and 504.
Transport errors keep the native exception (`ConnectionResetError`, `ssl.SSLError`,
`http.client.IncompleteRead`, `TimeoutError`, ...) as `__cause__`. `CalmLensValidationError`
is also a `ValueError`.

```python
from calmlens import CalmLensAPIError, error_codes

try:
    asset = client.assets.retrieve(asset_id="asset_5Gm2Rk8XqT3wLp9VbN4c")
except CalmLensAPIError as error:
    if error.code != error_codes.ASSET_NOT_FOUND:
        print(error.code, error.status, error.request_id)
        raise
    asset = None
```

### Retries

The client retries a request when resending it cannot duplicate work: `GET` requests, and
uploads (`create`, `classify`, `text.classify`, `upload_part`), which always carry an
`Idempotency-Key`. It retries network failures and timeouts, `429`, `502`, `503`, `504` and
`idempotency/request-in-progress`, up to `max_retries` times. Retry `n` (from 0) waits between
half and all of `min(8, 0.5 × 2ⁿ)` seconds, or the `Retry-After` delay when the response sends
one (`0` retries at once; a `Retry-After` above 60 seconds raises the error instead). Other
writes (`update`, `move`, `retry`, `explain`, deletes, folder changes, signed URLs and lens
definitions) are never retried. `cdn.serve` retries network failures, timeouts and `429`, `502`,
`503` and `504` the same way and returns the last response once retries run out.

Each upload call generates one `Idempotency-Key` and reuses it for its own retries; the API
replays the saved response for 24 hours instead of creating a second asset. Pass
`idempotency_key=` to retry across processes, e.g. a key derived from your own record ID.
Reusing a key for a different request raises `idempotency/key-reused`. A stream body is
rewound for a retry when it is seekable; uploads from one-shot (non-seekable) streams are not
retried.

## Operations

| JavaScript                                                    | Python                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `assets.create/classify/retrieve/update/list/search(options)` | Same names                                                                                                         |
| `assets.listChildren(options)`                                | `assets.list_children(...)`; `assets.iter_children(...)` walks every page                                          |
| (pagination)                                                  | `assets.iter(...)` yields every matching asset                                                                     |
| `assets.uploadPart(options)`                                  | `assets.upload_part(...)`                                                                                          |
| `assets.createSignedUrl(options)`                             | `assets.create_signed_url(...)`                                                                                    |
| `assets.move/retry/delete(options)`                           | Same names; `delete` returns `None`                                                                                |
| `assets.explain({ assetId, rerun })`                          | `assets.explain(asset_id=, rerun=True)`                                                                            |
| `assets.deleteContent(options)`                               | `assets.delete_content(...)`                                                                                       |
| `assets.batch({ assetIds, operation })`                       | `assets.batch(asset_ids=[...], operation="delete")`; returns `{"queued": True}`                                    |
| `assets.waitForDecision({ assetId, timeoutMs })`              | `assets.wait_for_decision(asset_id=, timeout=60)`; `timeout` in seconds, no `signal`                               |
| `folders.list()`                                              | `folders.list()`                                                                                                   |
| `folders.create/retrieve/update/move/delete(options)`         | Same names                                                                                                         |
| `hashLists.list()`                                            | `hash_lists.list()`; returns `{"items": [...]}`, newest first                                                      |
| `hashLists.create/retrieve/update/delete(options)`            | `hash_lists.create/retrieve/update/delete(...)`; `delete` returns `None`                                           |
| `hashLists.listEntries/addEntry/removeEntry(options)`         | `hash_lists.list_entries/add_entry/remove_entry(...)`; `remove_entry` returns `None`                               |
| `events.list(options)`                                        | `events.list(...)`; `events.iter(...)` and `events.iter_pages(...)` (see [Events feed](#events-feed))              |
| `ensureLens/ensureLenses(options)`                            | `ensure_lens/ensure_lenses(...)`                                                                                   |
| `cdn.getAssetUrl/serve(options)`                              | `cdn.get_asset_url/serve(...)`                                                                                     |
| `verifyWebhookSignature(options)`                             | `verify_webhook_signature(payload, *, signature=, timestamp=, secret=, headers=, tolerance_seconds=300, now=None)` |
| `parseWebhookEvent(options)`                                  | `parse_webhook_event(payload, *, ...)` (same keywords)                                                             |
| `createWebhookSignatureHeader`                                | `create_webhook_signature_header(payload, timestamp, secret)`                                                      |

```python
page = client.assets.list(page_size=20, ordering=[{"field": "createdAt", "direction": "DESC"}])
for asset in client.assets.iter(filter="classification.moderation.status==allowed"):  # requests pages lazily
    print(asset["id"])
children = client.assets.list_children(asset_id=queued["id"])
client.assets.update(asset_id=queued["id"], description=None, tags=["reviewed"])
folder = client.folders.create(name="Photos")
client.assets.move(asset_id=queued["id"], folder_id=folder["id"])
client.assets.move(asset_id=queued["id"], folder_id=None)  # project root
# Retrieve the asset until its moderation status is no longer pending, or processing failed
# (sdk/timeout after 60 seconds by default):
decided = client.assets.wait_for_decision(asset_id=queued["id"], timeout=30)
# For an asset whose processing failed and whose content is still held:
# client.assets.retry(asset_id=failed_asset_id)
# Remove stored content but keep the record and report (content.status becomes "removed"):
client.assets.delete_content(asset_id=queued["id"])
# Delete the record and its content:
client.assets.delete(asset_id=queued["id"])
# Up to 500 assets at once, "delete" or "remove-content"; runs in the background once queued:
client.assets.batch(asset_ids=[first_id, second_id], operation="remove-content")

# Compare image uploads with known images: a "flag" list reports matches, a "block" list also
# blocks close matches. Add a PDQ hash, or the hash of an image asset in the project:
removed = client.hash_lists.create(name="Removed images", action="block")
client.hash_lists.add_entry(hash_list_id=removed["id"], asset_id=asset_id, label="Report 1042")
entries = client.hash_lists.list_entries(hash_list_id=removed["id"], page_size=50)  # entries["nextCursor"]

client.ensure_lens(identifier="thumbnail", name="Thumbnail", type="image", active=True, version=1,
                   transforms=[{"type": "imageTransform", "options": {"width": 128}}])
signed = client.assets.create_signed_url(asset_id=asset_id, resource="rendered", lens="thumbnail")
```

`create` queues processing; `classify` waits for classification. Text uses UTF-8 `text/plain`
content with an explicit asset name. List pagination starts at 0. `None` clears nullable
update fields and moves assets/folders to the root; omitted fields remain unchanged.
Signed URLs default to the `rendered` resource and 900 seconds.

`wait_for_decision` checks again after 0.5 seconds, then waits 1.5 times longer each time, up
to 5 seconds between checks and never past `timeout`. Without a decision in time it raises
`CalmLensError` with code `sdk/timeout` and `details`
`{"assetId": ..., "classificationStatus": ..., "moderationStatus": ...}`.
It has no cancellation argument: it blocks the calling thread for at most `timeout` seconds
(plus one request), so pass a shorter `timeout` to stop waiting sooner. Webhooks report
decisions without polling.

### What `classify` returns

`assets.classify`, `text.classify`, `assets.create` and the other asset methods return
the asset as a plain `dict` (typed as `calmlens.types.Asset`) with the API's
**camelCase** keys, e.g. `asset["externalId"]`, `asset["classification"]["moderation"]["status"]`. `id`,
`projectId`, `name`, `type`, `createdAt` and three nested objects are always present:

- `upload`: receipt of source content, with `status` (`uploading` or `completed`), `updatedAt` and `partsReceived` for multipart uploads.
- `classification`: `status` (`pending`, `processing`, `completed` or `failed`), `updatedAt`, `completedAt`, optional `personDetection`, `faceDetection`, `linkDetection`, `aiGeneratedDetection`, `textRegions` and `labels`, and `moderation`. The moderation section contains `status`, category scores, policy assessment, an optional `timeline`, optional `hashMatches` (the hash list entries an image matched) and `manualReviews` (each with a reviewer's `decision`: `allowed`, `limited`, `age-restricted`, `blocked` or `purged`). A reviewer's decision takes precedence over the automated one and does not change `completedAt`.
  `status` is `pending` until moderation decides, then:
  - `allowed`: show the content.
  - `limited`: delivered like `allowed`, but reduce its reach: keep it out of recommendations, trending and notifications, rank it lower or collapse it.
  - `age-restricted`: delivered only with `viewerClaims.ageConfirmed=true`; show it only behind your own age gate.
  - `blocked`: not delivered, content kept; don't show it.
  - `purged`: not delivered and stored content deleted; don't show it.

  `categories` maps category names to `{status, score, likelihood, ...}`; a
  `not-evaluated` category has no score.
- `content`: `status` (`temporary` while CalmLens holds the content only until processing
  finishes, `stored` when `keepContentAfterProcessing` is on, or `removed`), `removalReason`
  (`policy`, `retention`, `requested`, `parent-removed` or `disposed`), `updatedAt`,
  `safetyHold`, `format` (MIME type), `extension`, `sizeInBytes`, `checksums`, `image` (the
  picture served at the rendered resource, with its size, ThumbHash, average colour and
  perceptual hash with its quality) and
  `extractedText`. Fields that don't apply are `None`.

`description`, `externalId`, `externalUrl`, `folderId`, `parentId`, `metadata` and `tags`
may be missing or `None`, so use `.get()` for them.

Lens definitions are cached by full definition and version; repeated concurrent
ensures share the cached result. A changed version invalidates the previous cached
definition for that identifier. API version conflicts remain errors.

## Uploads

Supply exactly one of `content`, `url` or `part`. A payload has exactly one of:

| Key                        | Value                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `plainText` (`plain_text`) | A string, sent as UTF-8                                                                                            |
| `base64`                   | Base64 or a data URL                                                                                               |
| `data`                     | `bytes`, `bytearray`, `memoryview`, or a binary file object (`open(path, "rb")`, `io.BytesIO`, a socket file, ...) |

File objects are streamed in chunks, never read into memory. The size is computed for bytes
and for seekable files (from the current position). A non-seekable stream (a pipe, socket or
generator wrapped in a reader) without `sizeInBytes` is sent to its end with chunked transfer
encoding and no `sizeInBytes`; multipart parts from such streams need `sizeInBytes`. Exactly
`sizeInBytes` bytes are sent; a stream that ends early raises `upload/invalid-payload`. Text-mode files are rejected. Use a concrete MIME `type`
(e.g. `image/jpeg`) on the first request. Metadata and processing options accompany raw bytes
as query data; URL submissions use JSON.

```python
upload = client.assets.create(
    name="large.png",
    total_size_in_bytes=12 * 1024 * 1024,          # optional: checked before any part is stored
    part={"type": "image/png", "data": first_part},  # at least 5 MiB
)
completed = client.assets.upload_part(
    asset_id=upload["id"],
    part={"data": final_part, "partNumber": 2, "isFinal": True},
)
```

Parts are sequential. Non-final parts are at least 5 MiB. Multipart image totals must be
10–20 MiB; direct images must be below 10 MiB. Split bytes before base64-encoding each part.
The API saves the upload's `create` (queued) or `classify` (wait for the decision) choice when
it starts and applies it to the final part, from any client or process; pass `queue=` to
`upload_part` only to override it. With `total_size_in_bytes`, parts that don't add up to the
declared size raise `upload/size-mismatch`.

### Replies in a conversation

When the content is a reply, pass who wrote it and the earlier posts in the conversation,
oldest first. CalmLens moderates only the content, and uses the earlier posts to understand
who it addresses and what it refers to. `author_id` is your own label for a person; CalmLens
only compares it with the author IDs of the earlier posts.

```python
asset = client.text.classify(
    text="Same to you",
    author_id="user-9",
    context={"items": [
        {"text": "You're an idiot", "authorId": "user-1"},
        {"text": "Calm down, both of you"},
    ]},
)
```

`assets.create` and `assets.classify` take the same options. Only the posts CalmLens uses are
sent: the 5 most recent that fit within 2,000 characters (the most recent post is always
sent). `select_moderation_context_items` applies the same rule. The asset's `authorId` and
`context` hold what was used, and `context` becomes `None` once the content is removed.

## Upload presets

Pass `upload_preset_id` to `client.assets.create` or `client.assets.classify` to apply an upload preset's folder, visibility, file types and size limit. To let a browser upload through a preset that requires tokens, sign a single-use token on your server. Signing happens locally with your API key and makes no request.

```python
signed = client.upload_tokens.sign(
    upload_preset_id="preset_4Lk8Qw2Xm9Rt5Vb3Nc7P",
    external_id="post-42",       # optional: the uploaded asset gets this ID
    expires_in_seconds=600,      # optional: 1 to 3600, 600 by default
)
# signed["token"], signed["expiresAt"] (milliseconds since the Unix epoch)
```

See [Upload presets](https://calmlens.com/docs/guides/upload-presets). `MockCalmLensServerClient` signs tokens with its own key.

## CDN

```python
url = client.cdn.get_asset_url(asset_identifier=queued["id"], lens="thumbnail")
with client.cdn.serve(asset_identifier=queued["id"]) as response:
    if response.ok:
        with open("copy.jpg", "wb") as out:
            for chunk in response.iter_bytes():  # streamed
                out.write(chunk)
```

`resource` is `rendered` (the default), `original` or `placeholder`; only `rendered` takes a lens or
transform. Use either `lens` or `transform`. A `transform` is a selector string or one or more structured
steps (the shape of a lens's `transforms`); both forms also work for `assets.create_signed_url`:

```python
client.cdn.get_asset_url(asset_identifier=queued["id"], transform="format=png,width=1024")
client.cdn.get_asset_url(asset_identifier=queued["id"],
                         transform={"type": "imageTransform", "options": {"format": "png", "width": 1024}})
```

A selector has one path segment per step, such as `fit=cover,width=640/format=webp`, and a lens
and a transform are joined with `/` (`/rendered/@thumbnail/width=320`). Structured options are
sorted, nested options are dotted (`border.color`), hex colours drop the `#` and values are
percent-encoded, so both calls return the same URL. The `redact` option
(`{"text": True, "personalInformation": True}`, `redact.text=true` in a selector) blurs the
text regions OCR found when the image was processed, before any other option applies. `serve` returns a `CDNResponse` (`status`, `ok`, `headers`,
`content_type`, `request_id`, `read()`, `iter_bytes()`, `close()`) even for non-2xx responses
(after retrying retryable ones, see [Retries](#retries)); check `response.ok` and close it. Use signed URLs for private CDN delivery in browsers.

A public asset whose moderation status is `age-restricted` is served from its public URL only
with `viewer_claims={"ageConfirmed": True}` (a JSON `viewerClaims` query parameter containing `{ "ageConfirmed": true }`); otherwise delivery is refused, even with a signed URL or API key. Set it only where your app has already decided the viewer may see age-restricted content:

```python
client.cdn.get_asset_url(asset_identifier=queued["id"], lens="thumbnail", age_confirmed=True)
```

## Webhooks

Verify the **exact raw request body** before parsing it. Parsed JSON can't be verified: a
parsed and re-serialised body rarely has the same bytes (Python writes `1e-07` where the
sender wrote `1e-7`), so the helpers accept only `str` or `bytes` and raise `TypeError` for
anything else.

```python
import os
from calmlens import WebhookVerificationError, parse_webhook_event

try:
    event = parse_webhook_event(raw_body, headers=request_headers,
                            secret=os.environ["CALMLENS_WEBHOOK_SECRET"])
except WebhookVerificationError:
    ...  # respond 401
# event["type"], event["data"]["facts"]; deduplicate with the x-calmlens-delivery header
```

`parse_webhook_event` verifies, then parses into a `WebhookEventPayload` dict
(`{id, type, createdAt, projectId, data}`, with `data` holding `severity`, `title`,
`description`, `assetId`, `asset` and `facts`); unknown fields are kept. It raises
`WebhookVerificationError` with code `sdk/invalid-webhook-signature`, or
`sdk/invalid-webhook-payload` when the verified body is not an event: a JSON object with string
`id`, `type` and `projectId`, a numeric `createdAt` and a `data` object whose known fields have
the API's types (each fact needs a string `key` and a `value`). `verify_webhook_signature` takes
the same keyword arguments and returns `True`/`False`. Pass `headers=` (a mapping, an
`email.message.Message`/`http.client.HTTPMessage` or a framework's header object; names are
matched case-insensitively and a header repeated in the request is joined with `,`), or
`signature=` and `timestamp=` from the `x-calmlens-signature` and `x-calmlens-timestamp`
headers. `is_test_webhook_event(event)` is `True` for a test send from the portal or the CLI
(an event with the `{"key": "test", "value": True}` fact). Any matching `v1=` entry of a comma-separated signature
list is accepted; timestamps more than `tolerance_seconds` (default
`WEBHOOK_SIGNATURE_TOLERANCE_SECONDS`, 300) from `now` are rejected.

Getting the raw body in common frameworks:

```python
# Flask
@app.post("/webhooks/calmlens")
def calmlens_webhook():
    try:
        event = parse_webhook_event(request.get_data(), headers=request.headers, secret=SECRET)
    except WebhookVerificationError:
        return "", 401
    queue_work(event)
    return "", 204

# Django (exempt the view from CSRF; request.body is the raw bytes)
@csrf_exempt
@require_POST
def calmlens_webhook(request):
    try:
        event = parse_webhook_event(request.body, headers=request.headers, secret=SECRET)
    except WebhookVerificationError:
        return HttpResponse(status=401)
    queue_work(event)
    return HttpResponse(status=204)

# FastAPI / Starlette (read the body yourself; don't declare a pydantic body model)
@app.post("/webhooks/calmlens", status_code=204)
async def calmlens_webhook(request: Request):
    try:
        event = parse_webhook_event(await request.body(), headers=request.headers, secret=SECRET)
    except WebhookVerificationError:
        raise HTTPException(status_code=401)
    queue_work(event)
```

Each delivery carries three headers, exported as constants:

| Constant                   | Header                 | Value                                             |
| -------------------------- | ---------------------- | ------------------------------------------------- |
| `WEBHOOK_SIGNATURE_HEADER` | `x-calmlens-signature` | `v1=<hex>`, possibly a comma-separated list       |
| `WEBHOOK_TIMESTAMP_HEADER` | `x-calmlens-timestamp` | Unix seconds used in the signature                |
| `WEBHOOK_DELIVERY_HEADER`  | `x-calmlens-delivery`  | Unique delivery ID; use it to deduplicate retries |

`x-calmlens-signature` is `v1=` plus the hex HMAC-SHA256 of `"<x-calmlens-timestamp>.<raw
body>"`. To sign test deliveries, use `create_webhook_signature_header(payload, timestamp,
secret)` or `create_webhook_headers(payload, delivery_id, secret, *, timestamp=None)`:

```python
from calmlens import create_webhook_headers, verify_webhook_signature
body = b'{"id":"evt_1","type":"asset.allowed"}'
headers = create_webhook_headers(body, "delivery-1", webhook_secret)
assert verify_webhook_signature(body, headers=headers, secret=webhook_secret)
```

Moderation decisions arrive as `asset.allowed`, `asset.limited`, `asset.age-restricted`, `asset.blocked` and
`asset.purged` events (`asset.classified` reports each finished classification); the event's
`asset.classification.moderation.status` holds the status. A `not-evaluated` category has no
safe zero score and must not be treated as allowed coverage.

## Events feed

`events.list` polls the project's event feed, the same events webhooks deliver. It
returns an `EventsPage` dict: `{"events": [...], "cursor": str, "hasMore": bool}`. Each
event has `id`, `type` (e.g. `asset.allowed`), `createdAt`, `severity`, `title`,
`description`, `assetId`, `asset` and `facts` (a list of `{key, value, url?}`).

- Calling it **without `after`** returns **no events** and a cursor for _now_. Save that
  cursor: the feed only returns events created after the cursor you pass.
- Pass the previous `cursor` as `after` to get the next events (at most `limit`, default
  50, oldest first). When there are no new events, the same cursor is returned.
- `hasMore` is True when more events are already waiting. An invalid cursor raises
  `CalmLensAPIError` with code `events/invalid-cursor`.

`events.iter_pages(after=...)` follows the cursor until a page reports `hasMore=False` (without
`after` it yields the one empty page for now), and `events.iter(after=...)` yields the events of
those pages. A page that says more follow but repeats a cursor already sent raises
`sdk/invalid-response` with `details["cursor"]` instead of looping; `assets.iter` and
`assets.iter_children` do the same with `nextCursor`:

```python
import time

cursor = client.events.list()["cursor"]           # start from now; no events
while True:
    for page in client.events.iter_pages(after=cursor, limit=50):
        for event in page["events"]:
            handle(event)
        cursor = page["cursor"]                    # persist to resume after a restart
    time.sleep(5)
```

## Local webhook forwarding

Use the standalone [CalmLens CLI](https://calmlens.com/docs/guides/local-development) for local
development with any SDK. Install it separately through Homebrew, a platform download or npm.

## Testing

```python
from calmlens import CalmLensAPIError, CalmLensError, CalmLensTimeoutError
from calmlens.testing import MockCalmLensServerClient, create_mock_api_key

client = MockCalmLensServerClient(
    api_key=create_mock_api_key(), project_id="proj_8fK2mQx7Lp4NvB3tRz9Y", timeout=5,
    mock_options={"now": lambda: 123, "create_id": lambda prefix: f"{prefix}_00000000000000000001"},
)
assert client.text.classify(text="Hello", external_id="c-1")["classification"]["moderation"]["status"] == "allowed"
assert client.database_storage.assets["asset_00000000000000000001"]["createdAt"] == 123

request = client.requests[-1]            # MockRequest(method, url, path, query, body, headers)
assert (request.method, request.path) == ("POST", "/projects/proj_8fK2mQx7Lp4NvB3tRz9Y/assets")
assert request.query["externalId"] == "c-1" and request.body == b"Hello"

client.enqueue_error(TimeoutError("timed out"))      # or ConnectionResetError(), ssl.SSLError(), ...
try:
    client.text.classify(text="Hello")
except CalmLensTimeoutError as error:
    assert error.code == "sdk/timeout" and isinstance(error.__cause__, TimeoutError)

client.enqueue_error(CalmLensError("rate-limit/exceeded", status=429, retry_after=5))
try:
    client.assets.retrieve(asset_id="asset_00000000000000000001")
except CalmLensAPIError as error:
    assert (error.status, error.retry_after) == (429, 5.0) and error.request_id

client.enqueue_event("asset.allowed", asset_id="asset_00000000000000000001",
                     facts=[{"key": "decided-by", "value": "automated"}])
```

`MockCalmLensServerClient` is the real client with an in-memory transport: every call goes through
the real client's validation, encoding, response handling, errors and retries, and the fake
API answers with the real status codes, JSON error bodies and headers (`X-Request-Id`,
`Retry-After`, `Idempotent-Replayed`). It accepts the real client's configuration (validated
the same way; `max_retries` defaults to 0 so enqueued failures surface), plus `mock_options`:
`database_storage`, `image_storage`, `create_id`, `now`, `queued_outcome`, `analyzed_outcome`
and `signed_url_base_url`. Unknown mock options raise. Unset asset fields are `None`, as the API
returns them. Like the API, the mock gives each new object an ID with its kind's prefix, `_` and
20 random base62 characters (`asset_5Gm2Rk8XqT3wLp9VbN4c`); `create_id` receives the prefix
(`asset`, `fldr`, `hl`, `hle`, `lens`, `evt` or `rev`) and returns the ID.

- `queued_outcome` (default `pending`) applies to `assets.create` and queued multipart uploads;
  `analyzed_outcome` (default `allowed`) to `assets.classify` and `text.classify`. An outcome
  is `pending` (processing `processing`, moderation `pending`), `allowed`, `limited`, `age-restricted`,
  `blocked` or `purged` (processing `completed` with that moderation status; `purged` also
  removes the content with `removalReason` `policy`) or `failed` (processing `failed`, retryable).
  Either option can also be a function that takes the uploaded asset and returns its outcome.
  A classified image gets a ThumbHash (`content.image.thumbhash` and `averageColor`), which goes
  when its content is removed.
- Hash lists and their entries live in `database_storage.hash_lists` and
  `database_storage.hash_list_entries`; deleting a list deletes its entries. `add_entry` with an
  `asset_id` copies the asset's `content.image.perceptualHash` and `perceptualHashQuality`
  (seed them through `database_storage`; the mock computes no hashes) and raises
  `hash-list/asset-not-hashed` without one. Uploads are not matched against the lists.
  `cdn.serve` serves a `limited` asset like an `allowed` one. Age-restricted assets always require `viewer_claims={"ageConfirmed": True}`; private assets separately need `assets:download`.
- Like the API, content is `stored` when `processingOptions.keepContentAfterProcessing` is
  `True`; otherwise it is `temporary` and is removed (`removalReason` `retention`) once
  classification is `completed`, after which `cdn.serve` answers 403 `asset/not-available`. Pass
  `keepContentAfterProcessing: True` to serve content after a decision.

- `client.requests` returns copies of every captured request, oldest first, as
  `MockRequest` objects: `method`, full `url`, `path` (relative to `base_url`, or to
  `cdn_base_url` for `cdn.serve`), decoded `query` values, `body` (the JSON body as
  Python objects, upload bytes, or `None`) and `headers` (left out of `repr`).
- `client.enqueue_error(error)` makes the next request fail and leaves storage unchanged.
  A `CalmLensError` becomes an HTTP error response with its `status` (or the API's status for
  its `code`, e.g. 404 for `asset/not-found`) and `retry_after`, raised as a
  `CalmLensAPIError`. Network exceptions are raised like real failures (`TimeoutError` →
  `sdk/timeout`, other `OSError`s and `http.client` errors → `sdk/transport-error`, with the
  exception as `__cause__`).
- `client.fail_next_request(failure="transport-error", operation=None)` makes the next request
  (or the next to `operation`, a JavaScript-style method path such as `assets.create` or
  `cdn.serve`) fail without running: `transport-error` raises `sdk/transport-error`, `timeout`
  `sdk/timeout`, and an API error code that error with its HTTP status. Each queued failure is
  used once. Operations are told apart by their requests, so `text.classify` counts as
  `assets.classify`.
- `client.set_api_key_grants(grants)` replaces the mock key's grants for later requests, as
  editing the key in the portal would; the key, and the idempotency keys it used, stay the same.
- `client.enqueue_event(type, facts=..., asset_id=..., severity=..., title=...)` adds an event
  to the feed; `events.list`, `events.iter` and cursors behave like the API's (cursors are
  positions in the feed, so events added later reach cursors taken before them; `limit` is 1 to
  100, default 50). Like the API, deleting an asset, removing its content and retrying it record
  `asset.deleted`, `asset.content-removed` and `asset.retried` events with `asset-name` and
  `asset-type` facts.
- `client.decide(asset_id, decision)` applies a reviewer's decision (`allowed`, `limited`,
  `age-restricted`, `blocked` or `purged`, which also removes the content with `removalReason`
  `requested` after an `asset.content-removed` event) and adds the matching `asset.<decision>`
  event with `decided-by: reviewer`, `asset-type`, `asset-name` and `note` facts.
- `cdn.serve` answers like the CDN: blocked, purged and failed assets and removed content get
  `403` `asset/not-available` whatever the key; private assets get `403` `asset/api-key-missing-permission` unless the
  key has `assets:download` (the default key has no grants). Served content has `Cache-Control`
  as the CDN sets it: `public` only when anyone may see the asset, otherwise `private`, with
  `max-age=31536000, immutable` for images and `max-age=3600` for other content. It also carries
  `Cache-Tag: asset-<id>`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox;
  default-src 'none'`, `Content-Disposition: attachment` for content a browser could run, and,
  for images, an `ETag` and an `Expires` a year ahead. The `placeholder` resource is the image's
  ThumbHash as a PNG, served for public assets whatever their moderation status (`max-age=3600`)
  and refused with `asset/not-available` once purged or removed, for assets without one, and for
  private assets without `assets:download`.
- `assets.wait_for_decision` reads the mock's `database_storage` and takes no real time: it
  returns an asset that is already decided (or whose processing failed) and raises
  `sdk/timeout` at once for one whose moderation stays `pending`. Set the stored asset's
  `classification.moderation.status` or `classification.status` to simulate a decision or failure.
- Idempotency keys are honoured like the API: a repeated key replays the saved response, a key
  reused for a different request raises `idempotency/key-reused` (raw uploads are compared by
  their query, type and length, not their bytes), a failed request frees its key, and keys must
  be 1 to 255 printable ASCII characters without a space at either end
  (`idempotency/invalid-key`).
- Requests the API's schema refuses fail with `validation/<issue>` (`too-small`, `too-big`,
  `invalid-type`), HTTP 400 and the field in `details["path"]`: list `pageSize` (1 to 100, default
  10), folder `pageSize` (1 to 100), events `limit` and search `query` (1 to 200 characters) and
  `limit` (1 to 20, default 10).
- `assets.search` is keyword search like the API's: the query is split on whitespace (at most
  8 distinct words, case-insensitive) and an asset matches when every word appears in its name,
  ID, external ID, description, tags, type, content format or extension, or moderation status.
  `matchedFields` lists the fields containing any word, `score` is the API's keyword score
  (exact ID 1000, external ID 950, name 900; ID, external ID and name prefixes 800, 750 and 700;
  name 600, tags 500, otherwise 100), results are ranked by score then newest first, and
  `semanticStatus` is `disabled` whatever the `mode`.
- List cursors resume after the last item returned, so assets created or deleted between pages
  are neither skipped nor repeated, and only continue the query (filter, folder or parent and
  ordering) they came from; another query raises `validation/invalid-cursor`.
- Folder names are unique among siblings (case-sensitive) and list in code-point order;
  deleting a folder that is not empty raises `folder/not-empty` with `hasAssets` and
  `hasChildren` in `details`. Unchanged lens definitions return the saved lens, a changed one
  needs a greater `version` (`lens/version-conflict` with `currentVersion`, `minimumVersion` and
  `requestedVersion`), and earlier lenses in the same call stay saved.
- `calmlens.testing.sign_upload_token(api_key, options, now=..., nonce=...)` signs exactly what
  `upload_tokens.sign` signs at a fixed `now` (milliseconds since the epoch) and `nonce`, for
  comparing with known tokens.
- The default `now` clock moves on by at least a millisecond per reading, so assets created in a
  row have increasing `createdAt` values; a `now` you pass is used as is.

The mock supports the same resource methods, folder constraints, lens version checks,
multipart uploads (saved queue mode, declared sizes, part order), stored content, content
and asset deletion, retries of failed assets, keyword search, list filters on top-level and nested
fields such as `classification.moderation.status`, `classification.status` and `content.format` (a subset of RSQL: `==` with `*`, `!=`,
`=in=`, `=out=`, `=gt=`/`=ge=`/`=lt=`/`=le=`, `;` (and), which binds tighter than `,` (or), and
`( … )` groups; other syntax raises `NotImplementedError`) and ordering (newest first by default), and CDN download grants with
realistic response headers. It does not classify content, transform media or fetch external
URLs. Mock signatures and URLs are for tests only; inspect or seed the storage dictionaries
between calls. Keep `calmlens.testing` out of production imports.

## Development and release

From the repository root (CI runs Python 3.10 and 3.14, and `mypy --strict`):

```sh
PYTHONPATH=python python -m unittest discover -s python/tests -v
(cd python && python -m mypy)
python -m pip wheel --no-deps ./python --wheel-dir /tmp/calmlens-dist
```

`calmlens/error_codes.py` is generated with the cross-language fixtures by
`bun packages/sdk-contract/generate.ts`. See [cross-language parity](https://calmlens.com/docs/sdk)
for the shared contract fixtures. The version lives only in `pyproject.toml`
(`calmlens.__version__` reads it). Publishing is manual: build with `python -m build` in this
package, inspect the wheel and sdist, then upload through the project's approved PyPI release
process.

Image moderation considers readable text directly. Optional OCR (`processingOptions.features.ocr.enabled: true` on the wire) adds a text moderation pass and stores retained text in the image’s `content.extractedText`. No separate text child is created. Read the image’s combined `classification.moderation`; removing its content also removes the extracted text.

Folder listings return a page with `folders`, visible `ancestors`, and `hasMore`. Set `parentId` to open a branch (omit it for project root), and advance `pageIndex` to load another page. `pageSize` is at most 100. `search` with `searchAll` finds names in unopened branches; `ids` with `resolveOnly` resolves selected folder paths. Use the SDK’s language-specific option names.

### Viewer context for CDN delivery

CDN methods accept optional viewer claims (`viewerClaims`, or the language's `viewer_claims` / `ViewerClaims` field). The object contains `region` and `ageConfirmed`, using the SDK's normal field naming. Region defaults to the country of the connection reaching CalmLens; age confirmation defaults to false. Proxies should forward the incoming viewer country rather than rely on their outgoing connection's country. CalmLens accepts these as customer assertions without independently verifying them.

Age-restricted content returns `403` with `viewer/age-confirmation-required` unless age confirmation is true, including API-key and signed-URL requests. Private assets separately require access permission. Blocks and safety holds cannot be overridden by claims. Applications that never use age-restricted content should leave confirmation false, including processing jobs.

Raw HTTP clients can send a JSON `viewerClaims` query parameter or the JSON `X-CalmLens-Viewer-Claims` header; the query takes precedence. Signed URLs include claims when created and must be forwarded unchanged. Asset retrieval returns stored moderation results without a request-specific `delivery` object. Proxy caches must not bypass current viewer and moderation checks; honour `private, no-store` responses.
