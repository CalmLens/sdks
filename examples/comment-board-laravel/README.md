# Laravel comment board

A runnable Laravel 12 / PHP 8.2+ example using the local CalmLens PHP SDK. Comments
are moderated on the server and stored in the visitor's session only when their
moderation status is `allowed`. Pending, age-restricted, blocked, purged, unknown or
failed results never publish. The board keeps the most recent 50 comments; no database is
required. Blade escapes displayed input and Laravel protects the form with CSRF.

## Run

PHP 8.2.35, 8.3.36, 8.4.27, 8.5.12 or later is required because of PHP2Shell (CVE-2026-109618, CVE-2026-109619).

From this directory:

```sh
composer install
cp .env.example .env
php artisan key:generate
```

Set `CALMLENS_API_KEY`, `CALMLENS_PROJECT_ID` and `CALMLENS_WEBHOOK_SECRET` in `.env`.
To use a local CalmLens instead of the hosted one, also set
`CALMLENS_API_URL=http://localhost:6110/v1` and `CALMLENS_CDN_URL=http://localhost:6130/v1`;
leave them empty for the hosted API and CDN.
Then run `php artisan serve --host=127.0.0.1` and open http://127.0.0.1:8000.
The SDK is installed from `../../php` through Composer's path repository, so the
example works before the PHP package is published. Keep the repository layout intact.

The client is registered as a singleton in `app/Providers/AppServiceProvider.php`.
`CommentController` shows text moderation, failure handling and checking the decision
before publishing. API keys never reach browser code.

## Webhooks

Configure a CalmLens webhook to POST to your reachable
`/api/webhooks/calmlens` endpoint. Laravel's API route has no browser session or CSRF
requirement. `WebhookController` verifies the **raw** body and timestamp before
parsing, checks the project ID, ignores registered test facts, and deduplicates event
IDs for one day. The last received event's ID, type and facts are held in Laravel's
cache as `calmlens-last-event` for inspection; webhooks do not change the session board.

For a production integration, store comments and processed event IDs in your database,
apply the event and record its ID in one transaction, authenticate your users, and
rate-limit submissions. This example's local cache and per-session board are for
learning the integration, not a durable event-processing service.

## Tests

```sh
composer test
```

Route tests inject `MockTransport` through Laravel's container; they exercise the
real PHP client, request validation, publication decisions, API failures, signed
webhooks, tampering and duplicate handling without API credentials.
