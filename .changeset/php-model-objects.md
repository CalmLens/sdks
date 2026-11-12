---
"@calmlens/sdk-php": minor
---

Results are now objects. Every method returns a model from `CalmLens\Model`, such as `Asset`,
`Folder`, `Lens`, `Policy` or `Event`, instead of an associative array. Read a field as a property
(`$asset->classification->moderation->decision`) or as an array key, iterate over its fields, or
turn it back into arrays with `toArray()`; `json_encode` writes it as the API sent it. Fields
this version doesn't know yet are kept. Objects are read-only: change a resource through its
service. Each model documents every field and its type, null included, for PHPStan and IDEs.

Enumerated values are class constants on the model, such as `Moderation::DECISION_BLOCKED`,
`Asset::TYPE_IMAGE` and `Event::TYPE_ASSET_ALLOWED`; moderation categories and policy qualifiers
are on `Model\Category` and `Model\Qualifier`.

Lists return a `Collection` page: iterate it for its `items`, or call `autoPagingIterator()` to
yield every item across pages. `events->list` returns an `EventCollection` and `folders->list` a
`FolderCollection`, with their extra fields.

Request options, such as `idempotencyKey`, `timeout` and `maxRetries`, are now each method's
second argument, apart from its params: `$client->assets->create([...], ['idempotencyKey' => $key])`.
Webhooks::parseEvent returns an `Event`, and the `Webhooks` helpers take an `Event` or an array.

The client sends requests with any PSR-18 HTTP client: pass one as `httpClient`, or the installed
one is found for you. Guzzle is no longer a dependency; install it, or another PSR-18 client,
alongside the SDK. With Guzzle, `timeout`, `connectTimeout` and `uploadTimeout` apply to each
attempt. `Testing\MockHttpClient` scripts responses as a PSR-18 client, and
`Testing\MockNetworkException` simulates a connection failure or timeout.

Webhooks take a PSR-7 server request: `Webhooks::parseRequest($request, $secret)` and
`Webhooks::verifyRequest`. `parseEvent` and `verify` now take the signature and timestamp as
strings; `parseEventHeaders` and `verifyHeaders` read them from request headers or `$_SERVER`.

API errors with status 413 and 422 raise `PayloadTooLargeException` and
`UnprocessableEntityException`, and `TimeoutException` no longer extends `ConnectionException`.

The SDK requires PHP 8.2 or later, so distribution builds that backport security fixes install.

`ServerClient` reads `CALMLENS_API_KEY`, `CALMLENS_PROJECT_ID` and `CALMLENS_BASE_URL` when you
don't pass them, and `appInfo` (`name`, `version`, `url`) adds your application to the user agent.
Request options also take `headers`, `extraQuery` and `extraBody`, and an unknown request option
fails with `sdk/invalid-argument`. `$client->request($method, $path, $query, $body)` sends an API
request the SDK has no method for, with the client's authentication, retries and errors, and
returns an `ApiResponse` with its decoded `json`.

Every result's `getLastResponse()` returns the response it came from, with its `status`, `headers`
and `requestId`. Pass a PSR-3 `logger`, or set `CALMLENS_LOG=info` or `debug`, to log each
request's outcome and retries; `onAttempt` receives each attempt's operation, method, path,
attempt number, retry delay, status, request ID and duration. Logs and events never include the
API key, bodies, queries or a CDN URL's asset segment.

API exceptions keep the response body (`$error->body`, up to 16 KiB), such as a proxy's error page,
and every SDK exception implements `CalmLens\Exception\ExceptionInterface`.

`events->eachPage()` is removed: `events->each()` yields every event, and an event page's
`autoPagingPages()` yields each page from there on, to save its `nextCursor` and resume.
