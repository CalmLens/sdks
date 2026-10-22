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
if asset["classification"]["moderation"]["decision"] == "approved":
    print("Approved; policy action:", asset["classification"]["moderation"]["action"])

with open("photo.jpg", "rb") as file:  # streamed, not read into memory
    queued = client.assets.create(name="photo.jpg", content={"data": file, "type": "image/jpeg"})
```

Every method takes snake_case keyword arguments, or one options dict with the API's camelCase
keys (`client.assets.retrieve({"assetId": "..."})`); nested dicts accept either spelling.
Responses are plain dicts with the API's camelCase field names, typed as `TypedDict`s in
`calmlens.types`. Unknown fields from newer API versions stay in the dict, and enum-like
values (`classification.moderation.decision`, `classification.status`, `type`, `visibility`, ...) are plain strings, so
values this SDK version doesn't list never fail: treat an unknown status as "not approved".

## Configuration

| Argument | Default | Meaning |
| --- | --- | --- |
| `api_key` | `CALMLENS_API_KEY` | Project API key |
| `project_id` | `CALMLENS_PROJECT_ID` | Project ID |
| `base_url`, `cdn_base_url` | `https://api.calmlens.com/v1`, `https://cdn.calmlens.com/v1` | Endpoints |
| `timeout` | `60` | Seconds a connection may stay silent before `sdk/timeout`. An inactivity limit, not a limit on the whole transfer, so large uploads and downloads are never cut off |
| `connect_timeout` | `10` | Seconds to open a connection (TCP, proxy and TLS) |
| `max_retries` | `2` | Retries for requests that are safe to resend (see [Retries](#retries)); `0` disables them |
| `transport` | pooled `http.client` | `transport(request, timeout)` returning a context-managed response with `status`, `headers` and `read()` |

Invalid options raise `CalmLensValidationError` with code `sdk/invalid-config` before the
client creates any state. `client.with_options(timeout=..., max_retries=...)` returns a client
that shares the connections and caches with different per-call settings, e.g.
`client.with_options(timeout=300).cdn.serve(...)`.

Reuse one client: it pools HTTP keep-alive connections and is **thread-safe**, so share it
between threads. Use `with CalmLensServerClient() as client:` or `client.close()` to close the pool;
custom transports remain caller-owned. After `os.fork()` (gunicorn, Celery, multiprocessing)
the child opens its own connections instead of sharing the parent's sockets. Redirects are
not followed, so the API key never leaves the configured endpoint. `repr(client)` never
includes the API key. Requests send `User-Agent: calmlens-python/<version> (<Python> <version>;
<platform>)`; the version is `calmlens.__version__`.

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

| Exception | When | `code` | `status` |
| --- | --- | --- | --- |
| `CalmLensAPIError` | Non-2xx API response | The API code, e.g. `asset/not-found`; `sdk/http-error` without an error body | HTTP status |
| `CalmLensTimeoutError` | Connecting or waiting for data timed out | `sdk/timeout` | `None` |
| `CalmLensTransportError` | Any other network or protocol failure (refused, reset, DNS, TLS, truncated response) | `sdk/transport-error` | `None` |
| `CalmLensValidationError` | Invalid arguments or configuration, before anything is sent | `sdk/invalid-argument`, `sdk/invalid-config`, or the API's code for the same problem, e.g. `upload/invalid-payload`, `upload/invalid-mime-type` | `None` |
| `CalmLensError` | A 2xx response that isn't valid JSON, or a JSON response larger than 32 MiB | `sdk/invalid-response`, `sdk/response-too-large` | HTTP status |
| `CalmLensError` | `assets.wait_for_decision` saw no decision within its `timeout`; `details` has `assetId` and the last `classificationStatus` and `moderationStatus` | `sdk/timeout` | `None` |

Each error also has `message`, `details` (the API's details, plus `traceId` when sent),
`request_id` (the response's `X-Request-Id`, to quote to support), `headers` (lower-case
names), `retry_after` (seconds from `Retry-After`), `is_not_found` and `is_retryable`.
Transport errors keep the native exception (`ConnectionResetError`, `ssl.SSLError`,
`http.client.IncompleteRead`, `TimeoutError`, ...) as `__cause__`. `CalmLensValidationError`
is also a `ValueError`.

```python
from calmlens import CalmLensAPIError, error_codes

try:
    asset = client.assets.retrieve(asset_id="asset-id")
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
`idempotency/request-in-progress`, up to `max_retries` times with jittered exponential
backoff (0.5s doubling, at most 8s), or after the `Retry-After` delay when the response sends
one (a `Retry-After` above 60 seconds raises the error instead). Other writes (`update`,
`move`, `retry`, folder changes, signed URLs) and CDN downloads are never retried.

Each upload call generates one `Idempotency-Key` and reuses it for its own retries; the API
replays the saved response for 24 hours instead of creating a second asset. Pass
`idempotency_key=` to retry across processes, e.g. a key derived from your own record ID.
Reusing a key for a different request raises `idempotency/key-reused`. A stream body is
rewound for a retry when it is seekable; uploads from non-seekable streams are not retried.

## Operations

| JavaScript | Python |
| --- | --- |
| `assets.create/classify/retrieve/update/list/search(options)` | Same names |
| `assets.listChildren(options)` | `assets.list_children(...)`; `assets.iter_children(...)` walks every page |
| (pagination) | `assets.iter(...)` yields every matching asset |
| `assets.uploadPart(options)` | `assets.upload_part(...)` |
| `assets.createSignedUrl(options)` | `assets.create_signed_url(...)` |
| `assets.move/retry/delete(options)` | Same names; `delete` returns `None` |
| `assets.deleteContent(options)` | `assets.delete_content(...)` |
| `assets.waitForDecision({ assetId, timeoutMs })` | `assets.wait_for_decision(asset_id=, timeout=60)`; `timeout` in seconds, no `signal` |
| `folders.list()` | `folders.list()` |
| `folders.create/retrieve/update/move/delete(options)` | Same names |
| `events.list(options)` | `events.list(...)`; `events.iter(...)` and `events.iter_pages(...)` (see [Events feed](#events-feed)) |
| `ensureLens/ensureLenses(options)` | `ensure_lens/ensure_lenses(...)` |
| `cdn.getAssetUrl/serve(options)` | `cdn.get_asset_url/serve(...)` |
| `verifyWebhookSignature(options)` | `verify_webhook_signature(payload, *, signature=, timestamp=, secret=, headers=, tolerance_seconds=300, now=None)` |
| `parseWebhookEvent(options)` | `parse_webhook_event(payload, *, ...)` (same keywords) |
| `createWebhookSignatureHeader` | `create_webhook_signature_header(payload, timestamp, secret)` |

```python
page = client.assets.list(page_size=20, ordering=[{"field": "createdAt", "direction": "DESC"}])
for asset in client.assets.iter(filter="classification.moderation.decision==approved"):  # requests pages lazily
    print(asset["id"])
children = client.assets.list_children(asset_id=queued["id"])
client.assets.update(asset_id=queued["id"], description=None, tags=["reviewed"])
folder = client.folders.create(name="Photos")
client.assets.move(asset_id=queued["id"], folder_id=folder["id"])
client.assets.move(asset_id=queued["id"], folder_id=None)  # project root
# Retrieve the asset until it is approved or rejected, or processing failed (sdk/timeout after 60
# seconds by default):
decided = client.assets.wait_for_decision(asset_id=queued["id"], timeout=30)
# For an asset whose processing failed and whose content is still held:
# client.assets.retry(asset_id=failed_asset_id)
# Remove stored content but keep the record and report (content.status becomes "removed"):
client.assets.delete_content(asset_id=queued["id"])
# Delete the record and its content:
client.assets.delete(asset_id=queued["id"])

client.ensure_lens(identifier="thumbnail", name="Thumbnail", type="image", active=True, version=1,
                   transforms=[{"type": "imageTransform", "options": {"width": 128}}])
signed = client.assets.create_signed_url(asset_id=asset_id, resource="preview", lens="thumbnail")
```

`create` queues processing; `classify` waits for classification. Text uses UTF-8 `text/plain`
content with an explicit asset name. List pagination starts at 0. `None` clears nullable
update fields and moves assets/folders to the root; omitted fields remain unchanged.
Signed URLs default to `content` and 900 seconds.

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
**camelCase** keys, e.g. `asset["externalId"]`, `asset["classification"]["moderation"]["decision"]`. `id`,
`projectId`, `name`, `type`, `createdAt` and three nested objects are always present:

- `upload`: receipt of source content, with `status` (`uploading` or `completed`), `updatedAt` and `partsReceived` for multipart uploads.
  `failed`), `updatedAt` and `uploadPartsReceived` for multipart uploads.
- `classification`: `status` (`pending`, `processing`, `completed` or `failed`), `updatedAt`, `completedAt`, optional `personDetection`, `faceDetection` and `labels`, and `moderation`. The moderation section contains `decision` (`pending`, `approved` or `rejected`), `action`, category scores, policy assessment, an optional `timeline` and reviewer details. A reviewer decision does not change `completedAt`.
  precedence over the automated one), `action` (what your policy did with flagged content:
  `flag`, `hide` or `purge`, or `None` when nothing was flagged), `note` (why automated
  moderation rejected the asset), `manualReviews`, `completedAt` and `report`. `report` (the classification: `score`,
  `categories`, `processedAt`, ...) is `None` until classification finishes. Inside it,
  `categories` maps category names to `{status, score, likelihood, reason}`; a
  `not-evaluated` category has no score.
- `content`: `status` (`temporary` while CalmLens holds the content only until processing
  finishes, `stored` when `keepContentAfterProcessing` is on, or `removed`), `removalReason`
  (`policy`, `retention`, `requested`, `parent-removed` or `disposed`), `updatedAt`,
  `safetyHold`, `format` (MIME type), `extension`, `sizeInBytes`, `checksums`, `image`,
  `previewImage` and `extractedText`. Fields that don't apply are `None`.

`description`, `externalId`, `externalUrl`, `folderId`, `parentId`, `metadata` and `tags`
may be missing or `None`, so use `.get()` for them.

Lens definitions are cached by full definition and version; repeated concurrent
ensures share the cached result. A changed version invalidates the previous cached
definition for that identifier. API version conflicts remain errors.

## Uploads

Supply exactly one of `content`, `url` or `part`. A payload has exactly one of:

| Key | Value |
| --- | --- |
| `plainText` (`plain_text`) | A string, sent as UTF-8 |
| `base64` | Base64 or a data URL |
| `data` | `bytes`, `bytearray`, `memoryview`, or a binary file object (`open(path, "rb")`, `io.BytesIO`, a socket file, ...) |

File objects are streamed in chunks, never read into memory. The size is computed for bytes
and for seekable files (from the current position); for non-seekable streams (pipes,
sockets, generators wrapped in a reader) pass `sizeInBytes`, or the call raises
`upload/invalid-payload`. Exactly `sizeInBytes` bytes are sent; a stream that ends early
raises `upload/invalid-payload`. Text-mode files are rejected. Use a concrete MIME `type`
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

## Upload presets

Pass `upload_preset_id` to `client.assets.create` or `client.assets.classify` to apply an upload preset's folder, visibility, file types and size limit. To let a browser upload through a preset that requires tokens, sign a single-use token on your server. Signing happens locally with your API key and makes no request.

```python
signed = client.upload_tokens.sign(
    upload_preset_id="your-upload-preset-id",
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

Use either `lens` or `transform`. A `transform` is a selector string or one or more structured
steps (the shape of a lens's `transforms`); both forms also work for `assets.create_signed_url`:

```python
client.cdn.get_asset_url(asset_identifier=queued["id"], transform="imageTransform[format=png,width=1024]")
client.cdn.get_asset_url(asset_identifier=queued["id"],
                         transform={"type": "imageTransform", "options": {"format": "png", "width": 1024}})
```

Structured options are sorted and percent-encoded, so both calls return the same URL. `serve` returns a `CDNResponse` (`status`, `ok`, `headers`,
`content_type`, `request_id`, `read()`, `iter_bytes()`, `close()`) even for non-2xx responses;
check `response.ok` and close it. Use signed URLs for private CDN delivery in browsers.

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
`description`, `assetId`, `asset` and `facts`). It raises `WebhookVerificationError` with code
`sdk/invalid-webhook-signature` or `sdk/invalid-webhook-payload`. `verify_webhook_signature` takes the
same keyword arguments and returns `True`/`False`. Pass `headers=` (any mapping; names are
matched case-insensitively), or `signature=` and `timestamp=` from the `x-calmlens-signature`
and `x-calmlens-timestamp` headers. Any matching `v1=` entry of a comma-separated signature
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

| Constant | Header | Value |
| --- | --- | --- |
| `WEBHOOK_SIGNATURE_HEADER` | `x-calmlens-signature` | `v1=<hex>`, possibly a comma-separated list |
| `WEBHOOK_TIMESTAMP_HEADER` | `x-calmlens-timestamp` | Unix seconds used in the signature |
| `WEBHOOK_DELIVERY_HEADER` | `x-calmlens-delivery` | Unique delivery ID; use it to deduplicate retries |

`x-calmlens-signature` is `v1=` plus the hex HMAC-SHA256 of `"<x-calmlens-timestamp>.<raw
body>"`. To sign test deliveries, use `create_webhook_signature_header(payload, timestamp,
secret)` or `create_webhook_headers(payload, delivery_id, secret, *, timestamp=None)`:

```python
from calmlens import create_webhook_headers, verify_webhook_signature
body = b'{"id":"evt_1","type":"asset.approved"}'
headers = create_webhook_headers(body, "delivery-1", webhook_secret)
assert verify_webhook_signature(body, headers=headers, secret=webhook_secret)
```

For moderation decisions, check `asset.classification.moderation.decision` and `asset.classification.moderation.action` (set when
content was flagged); a `not-evaluated`
category has no safe zero score and must not be treated as approved coverage.

## Events feed

`events.list` polls the project's event feed, the same events webhooks deliver. It
returns an `EventsPage` dict: `{"events": [...], "cursor": str, "hasMore": bool}`. Each
event has `id`, `type` (e.g. `asset.approved`), `createdAt`, `severity`, `title`,
`description`, `assetId`, `asset` and `facts` (a list of `{key, value, url?}`).

- Calling it **without `after`** returns **no events** and a cursor for *now*. Save that
  cursor: the feed only returns events created after the cursor you pass.
- Pass the previous `cursor` as `after` to get the next events (at most `limit`, default
  50, oldest first). When there are no new events, the same cursor is returned.
- `hasMore` is True when more events are already waiting. An invalid cursor raises
  `CalmLensAPIError` with code `events/invalid-cursor`.

`events.iter_pages(after=...)` follows the cursor until a page reports `hasMore=False`, and
`events.iter(after=...)` yields the events of those pages:

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
    api_key=create_mock_api_key(), project_id="project", timeout=5,
    mock_options={"now": lambda: 123, "create_id": lambda: "asset-1"},
)
assert client.text.classify(text="Hello", external_id="c-1")["classification"]["moderation"]["decision"] == "approved"
assert client.database_storage.assets["asset-1"]["createdAt"] == 123

request = client.requests[-1]            # MockRequest(method, url, path, query, body, headers)
assert (request.method, request.path) == ("POST", "/projects/project/assets")
assert request.query["externalId"] == "c-1" and request.body == b"Hello"

client.enqueue_error(TimeoutError("timed out"))      # or ConnectionResetError(), ssl.SSLError(), ...
try:
    client.text.classify(text="Hello")
except CalmLensTimeoutError as error:
    assert error.code == "sdk/timeout" and isinstance(error.__cause__, TimeoutError)

client.enqueue_error(CalmLensError("rate-limit/exceeded", status=429, retry_after=5))
try:
    client.assets.retrieve(asset_id="asset-1")
except CalmLensAPIError as error:
    assert (error.status, error.retry_after) == (429, 5.0) and error.request_id

client.enqueue_event("asset.approved", asset_id="asset-1",
                     facts=[{"key": "decided-by", "value": "automated"}])
```

`MockCalmLensServerClient` is the real client with an in-memory transport: every call goes through
the real client's validation, encoding, response handling, errors and retries, and the fake
API answers with the real status codes, JSON error bodies and headers (`X-Request-Id`,
`Retry-After`, `Idempotent-Replayed`). It accepts the real client's configuration (validated
the same way; `max_retries` defaults to 0 so enqueued failures surface), plus `mock_options`:
`database_storage`, `image_storage`, `create_id`, `now`, `queued_outcome`, `analyzed_outcome`
and `signed_url_base_url`. Unknown mock options raise.

- `queued_outcome` (default `pending`) applies to `assets.create` and queued multipart uploads;
  `analyzed_outcome` (default `approved`) to `assets.classify` and `text.classify`. An outcome
  is `pending` (processing `processing`, moderation `pending`), `approved` or `rejected`
  (processing `completed` with that decision) or `failed` (processing `failed`, retryable).
- Like the API, content is `stored` when `processingOptions.keepContentAfterProcessing` is
  `True`; otherwise it is `temporary` and is removed (`removalReason` `retention`) once
  classification is `completed`, after which `cdn.serve` answers 404. Pass
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
- `client.enqueue_event(type, facts=..., asset_id=..., severity=..., title=...)` adds an event
  to the feed; `events.list`, `events.iter` and cursors behave like the API's. The mock does
  not create events by itself.
- `assets.wait_for_decision` reads the mock's `database_storage` and takes no real time: it
  returns an asset that is already decided (or whose processing failed) and raises
  `sdk/timeout` at once for one whose moderation stays `pending`. Set the stored asset's
  `classification.moderation.decision` or `classification.status` to simulate a decision or failure.
- Idempotency keys are honoured: a repeated key replays the saved response, and a key reused
  for a different request raises `idempotency/key-reused`.

The mock supports the same resource methods, folder constraints, lens version checks,
multipart uploads (saved queue mode, declared sizes, part order), stored content, content
and asset deletion, retries of failed assets, keyword search, list filters on top-level and nested
fields such as `classification.moderation.decision`, `classification.status` and `content.format` (a subset of RSQL: `==` with `*`, `!=`,
`=in=`, `=out=`, `=gt=`/`=ge=`/`=lt=`/`=le=`, `;` and `,`; other syntax raises
`NotImplementedError`) and ordering (newest first by default), and CDN download grants with
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
