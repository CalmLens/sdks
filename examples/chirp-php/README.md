# Chirp — PHP short posts with images

A small Twitter-style app using the [CalmLens PHP SDK](../../php/README.md): short posts with
optional images, replies, a home timeline and profiles with bios. Everyone's words and images
are moderated before anyone else sees them.

- **Posts, replies and bios** are classified synchronously with `text->classify`. Text whose
  `classification.moderation.status` isn't `allowed` is refused and never saved; the author sees
  why ("may contain harassment"). Text has no sensitive view, so `age-restricted` text is
  refused too. If CalmLens can't be reached, nothing is saved.
- **Images** are uploaded with `assets->create` and stay `pending` until CalmLens decides. A
  pending post is visible only to its author.
  - `allowed`: shown to everyone from the CDN.
  - `age-restricted`: shown as the CDN's blurred `/placeholder` image behind a **Sensitive
    content** warning, unless the viewer turned on **Show sensitive media** on their profile
    (after confirming they are 18 or older). Then the image is the CDN URL with
    `allowAgeRestricted=true`.
  - `blocked` or `purged`: the post leaves the timeline and profiles. Its author still sees it,
    with the reason.
  - Failed processing (`asset.failed`): only the author sees the post, with a note to try again.
- Decisions arrive by **webhook** (`asset.classified`, `asset.allowed`, `asset.age-restricted`,
  `asset.blocked`, `asset.purged` and `asset.failed`), with polling as a fallback.

Chirp mirrors [Calmgram](../calmgram)'s behaviour; `Content::mediaFor` is its `postMediaFor`.

## Run locally

PHP 8.2+ with the `fileinfo` and `gd` extensions, and Composer. The SDK is installed from
`../../php` through a Composer path repository, so keep the repository layout intact.

PHP 8.2.35, 8.3.36, 8.4.27, 8.5.12 or later is required because of PHP2Shell (CVE-2026-109618, CVE-2026-109619).

```sh
cd examples/chirp-php
composer install
composer demo     # or `composer start` with the live credentials below
```

Open **http://127.0.0.1:6407** and pick a username (there are no passwords: this is a local,
single-machine example). Data lives in `var/`; delete it to start over.

The app refuses to start without credentials unless you ask for demo mode, so a missing key
never silently runs the demo instead of live mode.

## Demo mode

`composer demo` sets `CHIRP_DEMO=1`. The app then uses the SDK's offline
`CalmLens\Testing\MockServerClient` (see [src/Demo.php](src/Demo.php)), labelled **Demo** in the
header. The live code path never loads it. It is not a moderation model:

- Text is checked against a handful of obvious phrases. Try `I will hurt you` (blocked),
  `kys` (blocked) or `nsfw` (age-restricted, so refused as text). Everything else is allowed.
- The compose form has a **Demo image outcome** picker. About two seconds after you post, the
  demo decides the image that way and delivers a signed `asset.<status>` webhook through the
  same handler live mode uses. The page reloads itself while your image is pending.
- Demo images are served from `/demo-cdn/v1/…` by the mock CDN acting as a browser without an
  API key: it refuses `blocked` assets and age-restricted ones requested without
  `allowAgeRestricted=true`, like the real CDN. Its placeholder is the image shrunk to a few pixels.

## Live mode

```sh
export CALMLENS_API_KEY='your-project-api-key'
export CALMLENS_PROJECT_ID='your-project-id'
export CALMLENS_WEBHOOK_SECRET='your-webhook-secret'   # optional; polling works without it
composer start
```

To use a local CalmLens instead of the hosted one, also set:

```sh
export CALMLENS_API_URL='http://localhost:6110/v1'
export CALMLENS_CDN_URL='http://localhost:6130/v1'
```

The browser loads images straight from `CALMLENS_CDN_URL`, so it must be reachable from the
browser. No API key is sent to the browser.

Images are uploaded as **public** assets with `keepContentAfterProcessing`, so allowed images
can be served from their public CDN URL. The CDN serves a public asset while it is still
pending, so Chirp never puts an image URL in a page until the image is decided. Images use the
`chirp-feed` lens (resized WebP), created on first upload with `ensureLens`.

### Webhooks

Set the same secret on the app and on the
[CalmLens CLI](https://calmlens.com/docs/guides/local-development) listener, then forward events:

```sh
npx calmlens listen --forward-to http://127.0.0.1:6407/webhooks/calmlens
```

The handler passes the **exact raw body** to `CalmLens\Webhooks::parseEvent`, which verifies the
signature and timestamp before parsing. It checks the project ID, ignores test sends (the
`test: true` fact) and skips delivery IDs it already applied. For a status event it retrieves the
asset and applies its **current** status, only to the post whose image has that asset ID and
the externalId `post-<id>` Chirp created it with. If CalmLens can't be reached it answers 503,
so the delivery is retried.

Without webhooks, a page showing your own pending image re-checks it at most every two seconds.

## Read the code

- [src/Moderation.php](src/Moderation.php): every SDK call, the lens, and turning an asset into
  Chirp's outcome (unknown statuses count as pending).
- [src/Content.php](src/Content.php): what is saved, `isVisibleTo`, `mediaFor`, syncing a
  decision, polling and deleting (which also deletes the image on CalmLens).
- [src/Webhooks.php](src/Webhooks.php): verification, deduplication and syncing.
- [src/App.php](src/App.php) and [src/View.php](src/View.php): routes, signed session cookie,
  CSRF tokens, upload checks (the file's bytes decide its type) and server-rendered HTML with no
  JavaScript. Every dynamic value is escaped.
- [tests/ChirpTest.php](tests/ChirpTest.php): text refusals, the outage path, pending, allowed,
  age-restricted (placeholder and opt-in), blocked, purged and failed images, polling, webhook
  tampering, test sends, replays, foreign assets, retries, deletion, CSRF and demo mode.

```sh
composer test
```

## Local example versus production

Chirp keeps everything in one JSON file and lets anyone pick any username. A production app
needs real accounts, a database, a real age check behind **Show sensitive media**, durable
records of applied webhook deliveries, rate limits, and a plan for deleting content when users
delete their accounts.
