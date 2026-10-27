# CalmLens PHP SDK

PHP 8.2+ server-side client for moderation, uploads, assets, folders, hash lists, events, webhooks,
upload tokens, named lenses and CDN delivery. Uses Guzzle 7 and PSR-7 streams.
Methods and option keys use camelCase; responses are associative arrays with the
API's field names. Unknown response fields and event types are preserved.

PHP 8.2.35, 8.3.36, 8.4.27, 8.5.12 or later is required because of PHP2Shell (CVE-2026-109618, CVE-2026-109619).

## Install from this checkout

This SDK is pre-release and has not been published to Packagist. In your application's
`composer.json`, add a path repository pointing at this checkout's `php` directory:

```json
{
  "repositories": [{"type": "path", "url": "/path/to/sdks/php", "options": {"versions": {"calmlens/sdk": "dev-main"}}}],
  "require": {"calmlens/sdk": "dev-main"}
}
```

Run `composer install`. The [Laravel comment board](../examples/comment-board-laravel)
and [Chirp](../examples/chirp-php), a short-post app with images, age-restricted media and
webhooks, are runnable directly from this repository and include tests.

```php
require 'vendor/autoload.php';

$client = new CalmLens\ServerClient(
    apiKey: getenv('CALMLENS_API_KEY'),
    projectId: getenv('CALMLENS_PROJECT_ID'),
);
$asset = $client->text->classify(['text' => 'Hello world']);
// pending, then allowed, limited, age-restricted, blocked or purged. Treat any other value as not ready.
if (in_array($asset['classification']['moderation']['status'], ['allowed', 'limited'], true)) {
    // Publish the comment.
}
```

Keep API keys on the server. Reuse a client within a request or worker; each client
caches its named lens definitions. Configure `baseUrl`, `cdnBaseUrl`, `timeout`
(seconds per API request attempt, response included; default 120), `uploadTimeout`
(seconds per binary upload attempt; none by default, since files may be large; text uses
`timeout`), `connectTimeout` (10), `maxRetries` (2), `maxResponseBytes` (the largest API
response read, 32 MiB) or inject a Guzzle `httpClient` for your application's transport
configuration. The defaults are constants on `ServerClient`. Requests send a
`calmlens-php/<version> (php/<version>)` User-Agent.

## API coverage

| Resource | Methods |
| --- | --- |
| `assets` | `create`, `classify`, `search`, `list`, `each`, `retrieve`, `waitForDecision`, `update`, `retry`, `explain`, `deleteContent`, `delete`, `batch`, `move`, `listChildren`, `eachChild`, `uploadPart`, `createSignedUrl` |
| `folders` | `list`, `create`, `retrieve`, `update`, `move`, `delete` |
| `hashLists` | `list`, `retrieve`, `create`, `update`, `delete`, `listEntries`, `addEntry`, `removeEntry` |
| `text` | `classify` |
| `events` | `list`, `each`, `eachPage` |
| `cdn` | `getAssetUrl`, `serve` |
| `uploadTokens` | `sign` |
| Client | `ensureLens`, `ensureLenses` |
| `Webhooks` | `signatureHeader`, `verify`, `parseEvent`, `isTest`, `createHeaders`, `toPayload` |

Methods take option arrays matching the API, e.g. `['assetId' => 'asset-1']`.
Use `['folderId' => null]` or `['parentId' => null]` to move to the root.
`delete` and `removeEntry` return void; other network methods return decoded JSON.

Hash lists hold PDQ hashes of images you never want again. Image uploads are compared with
every list in the project: a `flag` list reports matches, a `block` list also blocks close ones.

```php
$list = $client->hashLists->create(['name' => 'Removed images', 'action' => 'block']);
// Add a 64-character hex PDQ hash, or the hash of an image asset that finished processing.
$entry = $client->hashLists->addEntry(['hashListId' => $list['id'], 'assetId' => $assetId, 'label' => 'Report 1042']);
$page = $client->hashLists->listEntries(['hashListId' => $list['id'], 'pageSize' => 50]);
$client->hashLists->removeEntry(['entryId' => $entry['id']]);
```

Adding a hash the list already holds returns the existing entry. An asset without a perceptual
hash fails with `ErrorCodes::HASH_LIST_ASSET_NOT_HASHED`. `update` takes `name`, `description`
(null clears it) and `action`; deleting a list deletes its entries.

### Uploads and moderation

`create` queues processing; `classify` requests a synchronous decision where supported.
Audio and video still process asynchronously. Watch webhooks or call
`$client->assets->waitForDecision(['assetId' => $asset['id'], 'timeout' => 60])`.
It returns once `classification.moderation.status` is no longer `pending` (`allowed`,
`limited`, `age-restricted`, `blocked` or `purged`) or classification has failed, and otherwise throws
`sdk/timeout`. A classification failure is not a decision to allow. Manual reviews in
`classification.moderation.manualReviews` record their `decision` as one of those five
statuses. Filter lists with `classification.moderation.status==allowed`.

Supply a `name` and exactly one of `content`, `part` or `url`. Content accepts one of
`plainText`, `base64`, or `data`/`bytes` (binary string, PHP stream resource or PSR-7
stream), with a concrete MIME `type`. Sized streams send from their current position. A
non-seekable file stream may leave out `sizeInBytes` and is sent without a declared size;
multipart parts need exact byte counts. Streams are not loaded into memory by the SDK.
The caller owns and closes input streams.

```php
$file = fopen('/path/to/photo.jpg', 'rb');
try {
    $asset = $client->assets->create([
        'name' => 'photo.jpg',
        'content' => ['data' => $file, 'type' => 'image/jpeg'],
        'processingOptions' => ['keepContentAfterProcessing' => true],
        'metadata' => [['id' => 'source', 'value' => 'profile']],
    ]);
} finally {
    fclose($file);
}
```

A URL submission is `['name' => 'page', 'url' => 'https://example.com']`.
Multipart uploads start with `part` in place of `content`; later calls use
`uploadPart(['assetId' => $id, 'part' => ['data' => $bytes, 'partNumber' => 2,
'isFinal' => true]])`. Non-final parts must be at least 5MiB. Multipart image totals
must be 10–20MiB; pass `totalSizeInBytes` on the first call when known. The server
persists the initial queue mode, so later parts can come from another process.
Only pass `queue` to `uploadPart` to override it.

For a post in a conversation, pass `authorId` (your label for who wrote it) and `context`,
the earlier posts oldest first. CalmLens moderates only the content and reads the earlier
posts to understand who it addresses and what it refers to:

```php
$asset = $client->text->classify([
    'text' => 'Same to you',
    'authorId' => 'user-9',
    'context' => ['items' => [
        ['text' => 'You played well today', 'authorId' => 'user-1'],
        ['text' => 'Thanks!', 'authorId' => 'user-9'],
    ]],
]);
```

The SDK sends only the posts CalmLens uses: the 5 most recent that fit in 2,000 characters
(Unicode code points), always including the newest. `CalmLens\ModerationContext::select($items)`
applies the same rule, with the limits in `ModerationContext::USED_ITEMS` and
`USED_CHARACTERS`. Assets return `authorId` and the `context` used, which becomes null once the
content is removed.

### Pagination, events and errors

```php
foreach ($client->assets->each(['pageSize' => 100]) as $asset) {
    // Process each asset; opaque cursors are forwarded unchanged.
}
foreach ($client->events->eachPage(['after' => $savedCursor]) as $page) {
    // Handle $page['events'], then persist $page['cursor'].
}
```

Asset lists use `cursor`, `pageSize`, `ordering` and `filter`. Child lists work the
same way, as do hash list entries (`listEntries`, newest first). Folder lists retain `pageIndex`. An event list without `after` starts at
the current feed position; save the returned cursor to consume subsequent events.
`assets->each` and `eachChild` stop at a page without a next cursor, with `hasMore` false or
with no items, and `events->eachPage` when `hasMore` is false. Rather than loop, they throw
`sdk/invalid-response` (with the repeated cursor in `details['cursor']`) when a page with more
to follow returns a cursor they already sent, without yielding that page.

Every error the SDK throws is a `CalmLens\CalmLensException` with `errorCode`, `status`
(null without a response), `details`, `headers`, `requestId` (the `X-Request-Id` header;
include it when contacting support) and the underlying exception in `getPrevious()`.
Helpers: `retryAfter()` (seconds from `Retry-After`, or null), `isNotFound()`,
`isRetryable()` and `header($name)`. API error codes pass through unchanged; compare them
with the constants in `CalmLens\ErrorCodes` (with each code's HTTP status in
`ErrorCodes::STATUSES`) and the SDK's own codes in `CalmLens\SdkErrorCodes`, never with the
message. Catch a subclass from `CalmLens\Exception` to handle one kind of failure:

| Class | When |
| --- | --- |
| `ApiException` and its subclasses `BadRequestException` (400), `AuthenticationException` (401), `PermissionDeniedException` (403), `NotFoundException` (404), `ConflictException` (409), `RateLimitException` (429), `ServerException` (5xx) | The API answered with an error status. |
| `ConnectionException` (`sdk/transport-error`) and its subclass `TimeoutException` (`sdk/timeout`) | No complete response arrived, or `waitForDecision` had no decision in time. |
| `InvalidResponseException` (`sdk/invalid-response`, `sdk/response-too-large`) | A successful response could not be read, or its body or declared `Content-Length` was larger than `maxResponseBytes`. |
| `InvalidArgumentException` (`sdk/invalid-argument`, or an `upload/*` code for payload checks the API also makes) | An argument was rejected before sending. |
| `ConfigurationException` (`sdk/invalid-config`), a subclass of `InvalidArgumentException` | `ServerClient` received an invalid setting. |
| `WebhookVerificationException` (`sdk/invalid-webhook-signature`, `sdk/invalid-webhook-payload`) | A webhook delivery failed verification; respond with 400. |

GET requests and uploads with idempotency keys retry connection failures, timeouts,
429/502/503/504 and `idempotency/request-in-progress`. Upload keys are generated once
and reused on every retry. Other writes are not retried unless you explicitly supply
a key. Non-seekable streams are never replayed. Retry `n` (from 0) waits half of
`min(8, 0.5 × 2ⁿ)` seconds plus a random part of the other half; a `Retry-After` header (whole
seconds or an HTTP date; `0` retries at once) replaces that wait, and one over 60 seconds
returns the error. `cdn->serve` retries the same way and returns the last response.
Redirects are never followed, to protect credentials: a 3xx fails with `sdk/http-error`, its
status and request ID, and is not retried (`cdn->serve` too). Transport errors carry no
`details`. `requestOptions` supports `timeout`, `uploadTimeout`, `connectTimeout`,
`maxRetries`, `maxResponseBytes` and `idempotencyKey` on each operation; the API checks the
key (1 to 255 printable characters, no space at either end). Timeouts bound each attempt,
not the whole retry loop.
Calls are synchronous: `waitForDecision`'s `timeout` bounds the whole wait, and there is no
separate cancellation handle.

### CDN, lenses and signed URLs

```php
$url = $client->cdn->getAssetUrl([
    'assetIdentifier' => $asset['id'],
    'transform' => ['type' => 'imageTransform', 'options' => ['width' => 640, 'format' => 'webp']],
]);
$signed = $client->assets->createSignedUrl(['assetId' => $asset['id'], 'expiresInSeconds' => 900]);
$response = $client->cdn->serve(['assetIdentifier' => $asset['id']]);
// Check $response->getStatusCode(); read $response->getBody() in chunks, then close it.
```

A `transform` is a selector string or one or more structured steps. A selector has one path
segment per step, such as `fit=cover,width=640/format=webp`, and a lens and a transform are
joined with `/` (`/rendered/@thumbnail/width=320`). Structured options are sorted, nested
options are dotted (`border.color`) and hex colours drop the `#`, so the example above builds
`.../rendered/format=webp,width=640`.

CDN `serve` returns a streaming PSR-7 response, including HTTP error responses. Its
`init` option accepts `method` (`GET` or `HEAD`) and `headers` (e.g. `Range`). Signed
URLs let browsers access private content without your API key; `createSignedUrl` takes
`resource` (`rendered`, the default, or `original`). URL builders accept `resource`
(`rendered`, the default, `original` or `placeholder`), `lens`, a string or structured
`transform` and `allowAgeRestricted`. Only `rendered` takes a lens or transform. `placeholder` is a small blurred PNG that the CDN serves for
public assets whatever their moderation status; it takes no lens, transform or `allowAgeRestricted`.

The CDN treats an `age-restricted` asset like a private one: its plain public URL is
refused. Pass `'allowAgeRestricted' => true` to append `allowAgeRestricted=true`, so a public
age-restricted asset is served from its public URL. Do that only where your app has
already decided the viewer may see age-restricted content; otherwise use a signed URL.
A `limited` asset is delivered exactly like an `allowed` one; it is marked so your app can
reduce its reach, such as keeping it out of recommendations, trending and notifications,
ranking it lower or collapsing it. `blocked` assets are not served, and `purged` assets have no content.

`ensureLens` takes one definition (`identifier`, `name`, `type`, `version`,
`transforms`, etc.); `ensureLenses` takes `['lenses' => [...]]`, sends batches of at
most 100 and caches successful definitions. Updating a lens requires a higher version.

### Webhooks and browser upload tokens

```php
$event = CalmLens\Webhooks::parseEvent(
    file_get_contents('php://input'),
    $_SERVER['HTTP_X_CALMLENS_SIGNATURE'] ?? null,
    $_SERVER['HTTP_X_CALMLENS_TIMESTAMP'] ?? null,
    getenv('CALMLENS_WEBHOOK_SECRET'),
);
// Deduplicate using $event['id']; resource facts are in $event['data']['facts'].
```

Moderation sends `asset.classified` when classification finishes and one event per
status: `asset.allowed`, `asset.limited`, `asset.age-restricted`, `asset.blocked` and `asset.purged`,
for automated and reviewer decisions alike. `asset.failed` reports failed processing.
Event asset snapshots carry `classification.moderation.status`.

Pass `null` for the signature and timestamp and `headers: getallheaders()` (or `$_SERVER`,
or a PSR-7 request's `getHeaders()`) to read them from the request headers. Header names
match in any case, and repeated headers are joined with `,`, so a signature list split across
headers verifies and a repeated timestamp does not. Verification uses the exact raw bytes,
constant-time HMAC comparison and a default timestamp tolerance of
`Webhooks::SIGNATURE_TOLERANCE_SECONDS` (300); a tolerance of 0 accepts only the current
second. `parseEvent` throws `sdk/invalid-webhook-payload` unless the body is an object with
string `id`, `type` and `projectId`, a numeric `createdAt` and a `data` object whose known
fields have the API's types. Retries of one delivery repeat its
`x-calmlens-delivery` ID (`Webhooks::DELIVERY_HEADER`), so use it to skip duplicates. Future event types, extra fields and structured
fact values are preserved. Test deliveries use the registered `test: true` fact;
`Webhooks::isTest($event)` recognizes it.

To test your receiver, `Webhooks::toPayload($event)` builds the body CalmLens delivers for a
stored event (such as one from `events->list` or the mock's `enqueueEvent`), and
`Webhooks::createHeaders($body, $deliveryId, $secret)` the signed headers for it.

`$client->uploadTokens->sign(['uploadPresetId' => $presetId, 'externalId' => $id])`
returns `token` and `expiresAt` (Unix milliseconds). Signing is local; the default
TTL is 600 seconds, configurable with `expiresInSeconds` from 1 to 3600. Issue a
fresh token per upload after authenticating and authorizing the browser user.

### Offline tests

`CalmLens\Testing\MockServerClient` is an in-memory CalmLens behind the real client, which
runs its usual validation, encoding, retries and error handling: uploads (including multipart
uploads with `uploadPart`) create assets you can retrieve, list, search, update, move and
delete; folders, hash lists, lenses, idempotency keys and the events feed behave like the API's
(uploads are not matched against hash lists); errors
carry the API's codes, statuses, `X-Request-Id` and body shape (schema errors are
`validation/<issue>` with the field in `details['path']`); and the CDN serves stored bytes and
placeholders. Unset asset fields are `null`, as in the API. Like the API, deleting an asset,
removing its content and retrying it add `asset.deleted`, `asset.content-removed` and
`asset.retried` events; processing adds none. Arrange or inspect state through the public
`assets`, `content`, `folders`, `hashLists`, `hashListEntries`, `events` and `lenses` arrays.
New objects get IDs like the API's: their prefix, `_` and 20 random base62 characters, such as
`asset_5Gm2Rk8XqT3wLp9VbN4c`. For predictable IDs, pass `createId`, a callable that receives the
prefix (`asset`, `fldr`, `hl`, `hle`, `lens`, `evt` or `rev`) and returns the ID.

```php
$mock = new CalmLens\Testing\MockServerClient(queuedOutcome: 'age-restricted');
$client = $mock->client();
$asset = $client->assets->create(['name' => 'photo.png', 'visibility' => 'public',
    'content' => ['data' => $bytes, 'type' => 'image/png']]);
$mock->decide($asset['id'], 'blocked'); // as a reviewer would; adds asset.blocked
```

It does not classify content. `create` gives assets `queuedOutcome` (default `pending`)
and `classify` gives them `analyzedOutcome` (default `allowed`): `pending`, `allowed`,
`limited`, `age-restricted`, `blocked`, `purged` (which also removes the content, with reason
`policy`) or `failed`. A classified image gets a ThumbHash, which the `placeholder` resource
serves as a PNG, and which goes with the content when it is removed.
`analyzedOutcome` may also be fields to merge into the asset or a callable that receives
the asset and returns either. Content is kept only with `keepContentAfterProcessing`.
Like the CDN, the mock refuses blocked, purged and failed assets, and assets whose content
was removed, with `403` `asset/not-available` whatever the key. The default key has no
grants, like a real key without `assets:download`, so it also refuses private assets and
public age-restricted ones requested without `allowAgeRestricted` (`403`
`asset/api-key-missing-permission`). Pass `apiKey: MockServerClient::createApiKey([['actions' =>
['assets:download'], 'folderId' => null, 'includeSubfolders' => true]])` to read them; a
`folderId` limits the grant to that folder, and `setApiKeyGrants($grants)` replaces the
grants of the same key later. Served content carries its stored `Content-Type` and
`Cache-Control` as the CDN sets it: `public` only when anyone may see the asset, otherwise
`private`, with `max-age=31536000, immutable` for images and `max-age=3600` for other
content; plus `Cache-Tag`, `X-Content-Type-Options: nosniff`, a sandboxing
`Content-Security-Policy` and, for images, an `ETag` and `Expires`. `decide` records the review
in `manualReviews` and adds an `asset.<outcome>` event with the event catalog's severity
(`low` for `allowed` and `limited`, `high` otherwise) and a `decided-by: reviewer` fact; a
reviewer's `purged` removes the content with reason `requested` and first adds
`asset.content-removed`. `decide` on an unknown asset throws `asset/not-found`.

List filters support `==` (with `*` wildcards), `!=`, `=in=`, `=out=`, `=gt=`, `=ge=`, `=lt=`
and `=le=` joined by `;` (and), which binds tighter than `,` (or), and grouped with `( … )`, on
nested names such as `classification.moderation.status`; other syntax throws instead of being
ignored. List cursors resume after the last item returned, so assets created or deleted between
pages are neither repeated nor skipped. `assets->search` runs the API's keyword search: every
word of the query must appear, case-insensitively, in the name, ID, external ID, description,
tags, type, content format or extension, or moderation status, and results carry the API's
scores and `matchedFields`, best first, then newest. The default clock moves on by at least a
millisecond per reading, so assets created in a row have increasing `createdAt`.

```php
$mock->failNextRequest();          // the next call throws ConnectionException (sdk/transport-error)
$mock->failNextRequest('timeout'); // ... TimeoutException (sdk/timeout)
$mock->failNextRequest('upload/limit-exceeded', 'assets.create'); // the next upload fails with that API error
$mock->failNextRequest(new CalmLens\CalmLensException('upload/limit-exceeded', 'Busy', 429, headers: ['Retry-After' => '5']));
$request = $mock->requests()[0];   // every request received, as PSR-7 snapshots
```

`failNextRequest` failures are used first (each once, for any request or the next to the
named client method), then responses enqueued with `enqueueJson` or `enqueue`, in order; both
leave the stored state unchanged. `MockServerClient::signUploadToken($apiKey, $options, $now,
$nonce)` signs an upload token at a fixed clock (epoch milliseconds) and nonce, for exact
tokens in tests. Retries are off unless you pass
`maxRetries`. Waits take no real time: retry backoff and `waitForDecision` advance a virtual
clock, so an asset whose decision never comes times out at once.

For exact responses only, `MockTransport` replays a FIFO queue:

```php
$mock = new CalmLens\Testing\MockTransport();
$mock->enqueueJson(['id' => 'asset-1']);
$client = $mock->client();
$client->assets->retrieve(['assetId' => 'asset-1']);
$request = $mock->requests()[0]; // PSR-7 request snapshot
```

Responses are FIFO, and an exhausted queue fails. `enqueue` also accepts PSR-7
responses or exceptions; `pending()` reports unused responses. This exercises the
real SDK serialization and validation. Uploads must be answered with an asset (an `id`,
`upload.status`, `classification.status` and `classification.moderation.status`), or they fail
with `sdk/invalid-response`. It does not simulate moderation or a storage backend. For custom retry tests, inject Guzzle's MockHandler through `httpClient`.

## Development

From `php/`, run `composer install`, `composer check`, and `composer test`.
Tests replay every generated fixture in `../ruby/testdata` directly (requests, paths, errors,
client cases, webhooks, upload tokens, transform options, mock scenarios, surface and
rejections), and check `src/ErrorCodes.php` against `errors.json`. The application repo's `bun packages/sdk-contract/generate.ts`
refreshes that shared source; PHP needs no independently maintained fixture copy.
The HTTP tests also start a real loopback PHP server to verify streaming and redirects.
CI runs PHP 8.2 and 8.5 and builds a Composer archive.

The PHP package has its own version, tracked by `package.json` and `src/Version.php`.
See [release notes](../.changeset/README.md) for the remaining registry setup before
publishing. No app version is changed by adding this SDK.
