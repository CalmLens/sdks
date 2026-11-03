# CalmLens PHP SDK

Server-side PHP client for [CalmLens](https://calmlens.com) content moderation, storage and CDN
delivery, built on Guzzle 7 or 8 and PSR-7 streams.

PHP 8.2.35, 8.3.36, 8.4.27, 8.5.12 or later is required because of PHP2Shell (CVE-2026-109618, CVE-2026-109619).

## Installation

```bash
composer require calmlens/sdk
```

The
[Laravel comment board](https://github.com/CalmLens/sdks/tree/main/examples/comment-board-laravel)
and [Chirp](https://github.com/CalmLens/sdks/tree/main/examples/chirp-php), a short-post app with
images, age-restricted media and webhooks, run directly from this repository and include tests.

## Quick start

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

Keep API keys on the server, and reuse a client within a request or worker. Methods take one
options array with camelCase keys; responses are associative arrays with the API's field names.

| Status           | What to do                                                                   |
| ---------------- | ---------------------------------------------------------------------------- |
| `pending`        | Keep it unpublished; wait with a webhook or `assets->waitForDecision()`.     |
| `allowed`        | Publish it.                                                                  |
| `limited`        | Publish it, with reduced reach (out of recommendations and notifications).   |
| `age-restricted` | Show it only to viewers your app has decided may see age-restricted content. |
| `blocked`        | Don't show it.                                                               |
| `purged`         | Don't show it; its content has been deleted.                                 |

A failed classification (`classification.status` is `failed`) is not a decision to allow.

## What you can do

- [Classify text and upload files](https://calmlens.com/docs/sdk/php#moderate-content), from strings,
  PHP stream resources or PSR-7 streams, including
  [multipart uploads](https://calmlens.com/docs/sdk/php/reference#multipart-uploads) and
  [conversation context](https://calmlens.com/docs/sdk/php/reference#conversation-context).
- [Wait for queued decisions](https://calmlens.com/docs/sdk/php#waiting-for-a-decision) and
  [read classification results](https://calmlens.com/docs/guides/classification-results).
- [Record reviewer decisions and run batch operations](https://calmlens.com/docs/sdk/php/reference#moderation-results).
- [Manage assets, folders and hash lists](https://calmlens.com/docs/sdk/php#methods), with
  [hash list details](https://calmlens.com/docs/sdk/php/reference#hash-lists).
- [Manage moderation policies](https://calmlens.com/docs/sdk/php/reference#policies) and choose the one the project uses.
- [Page through lists and the events feed](https://calmlens.com/docs/sdk/php/reference#pagination-and-filters),
  with [filters](https://calmlens.com/docs/guides/pagination-and-filtering).
- [Build CDN URLs, sign URLs and stream content](https://calmlens.com/docs/sdk/php/reference#cdn-urls-and-transforms),
  with [viewer claims](https://calmlens.com/docs/sdk/php/reference#viewer-claims) for age-restricted
  content and [named lenses](https://calmlens.com/docs/sdk/php/reference#lenses).
- [Verify and parse webhooks](https://calmlens.com/docs/sdk/php/reference#webhooks); see also the
  [webhooks guide](https://calmlens.com/docs/guides/webhooks).
- [Sign browser upload tokens](https://calmlens.com/docs/sdk/php/reference#upload-tokens) for
  [upload presets](https://calmlens.com/docs/guides/upload-presets).
- [Handle errors](https://calmlens.com/docs/sdk/php/reference#errors) with typed exceptions and
  [automatic retries](https://calmlens.com/docs/sdk/php/reference#retries-and-idempotency).
- [Configure timeouts, retries and the HTTP client](https://calmlens.com/docs/sdk/php/reference#client-settings).

## Testing

`CalmLens\Testing\MockServerClient` runs the real client against an in-memory CalmLens, and
`MockTransport` replays queued responses. `CalmLens\Testing\TestInputs` signs text codes and media
phrases with your project's test input key, so the real API returns a chosen scenario.
See [PHP testing](https://calmlens.com/docs/sdk/php/testing).

## Links

- [Documentation](https://calmlens.com/docs/sdk/php)
- [SDK reference](https://calmlens.com/docs/sdk/php/reference)
- [API reference](https://calmlens.com/docs/api)
- [Changelog](https://github.com/CalmLens/sdks/blob/main/php/CHANGELOG.md)
- [License](https://github.com/CalmLens/sdks/blob/main/php/LICENSE)
