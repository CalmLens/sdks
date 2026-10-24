# Calmlibrary: Rust team media library

A browser app using the [CalmLens Rust SDK](../../rust/README.md). It is a private
media library (digital asset management) for a team's images, built on CalmLens storage and
moderation:

- **Folders.** Browse a folder tree, and create, rename, move and delete folders with
  `folders().list/create/update/move_folder/delete`. Only an empty folder can be deleted. The
  app shows the API's error code when a request is refused, such as `folder/not-empty`,
  `folder/parent-cycle` (moving a folder inside its own subfolder) or `folder/duplicate-name`.
- **Uploads.** Images are uploaded privately into a folder with `assets().create`, with
  `keep_content_after_processing: Some(true)`, metadata items `photographer`, `licence` and
  `campaign`, and a catalogue ID. The catalogue ID is stored as the asset's `external_id` with
  the prefix `calmlibrary:` (for example `calmlibrary:CAM-2026-014`). A reused catalogue ID
  shows `asset/duplicate-external-id`.
- **Details.** Edit an asset's description, tags and metadata with `assets().update`, and move
  it between folders with `assets().move_asset`.
- **Listing.** Each folder lists 12 images a page with `assets().list`, using `cursor`,
  `folder_id` and a `filter` built only from fixed values: `parentId==null`, optionally with
  one status: `classification.moderation.status==allowed`, `==limited`, `==age-restricted`, `==blocked` or
  `==purged`, `classification.moderation.status==pending;classification.status!=failed` for
  images in review, or `classification.status==failed`. See
  [Pagination and filtering](https://calmlens.com/docs/guides/pagination-and-filtering).
- **Search.** Describe an image in natural language with `assets().search` in `hybrid`,
  `keyword` or `semantic` mode. Results show `semanticStatus` and each item's `matchedFields`.
  Search never returns blocked, purged, safety-held or removed content.
- **Delivery.** Only an image whose `classification.moderation.status` is `allowed` or `limited` and whose
  `content.status` is `stored` gets a thumbnail or a download. Each request retrieves the asset's current state, calls `ensure_lens` for a 320px
  square thumbnail lens (`calmlibrary-thumb`) or a 1600px web lens (`calmlibrary-web`), and
  redirects to a 60-second signed URL from `assets().create_signed_url`. Pending, blocked,
  purged and failed images never get either. CalmLens delivers `age-restricted` images only
  through signed URLs or API keys so an app can show them behind its own age check; this team
  library has no age check, so it doesn't deliver them either. CalmLens delivers `limited`
  images like allowed ones and marks them so an app can reduce their reach; this library has no
  recommendations or feeds, so it shows them like allowed images.
- **Lifecycle.** **Remove file** calls `assets().delete_content`: the record, its metadata and
  classification results stay, `content.status` becomes `removed`, and the CDN stops serving the
  content. **Delete** calls
  `assets().delete` and removes the asset.
- **Moderation decisions.** Verified webhooks for `asset.classified`, `asset.allowed`,
  `asset.limited`, `asset.age-restricted`, `asset.blocked`, `asset.purged` (sent for automated and reviewer
  decisions alike, with a `decided-by` fact saying which) and `asset.failed` refresh the asset
  from the API and log its status.

## Run locally

Rust stable with Cargo. `Cargo.toml` uses the sibling SDK by path, with its default async
client. The other dependencies are `axum` (with multipart forms) on a multi-threaded `tokio`
runtime, `tower-http` (body limits and timeouts), `http-body-util`, `serde`, `serde_json`,
`form_urlencoded`, `url` and `getrandom`.

The app needs CalmLens credentials, or an explicit request for the offline demo. Without
either, it refuses to start and exits with status 1.

```sh
cd examples/media-library-rust
CALMLENS_DEMO=1 cargo run
```

Open **http://127.0.0.1:6405**. `cargo run -- --demo` also starts the demo, and
`cargo run -- --port 6415` changes the port.

## Demo mode

Demo mode runs only when you ask for it with `CALMLENS_DEMO=1` or `--demo`, and the page is
labelled as a demo. The library lives in memory in [src/demo.rs](src/demo.rs) and resets when
the app restarts. It holds up to 40 assets and 30 folders. Folder rules (empty deletes only, no
cycles, unique sibling names) and duplicate catalogue IDs return the same error codes as the
API. Demo mode does not use the SDK's test mock.

Each upload takes the moderation outcome you select: **Allow**, **Age-restrict**, **Block**,
**Purge** or **Processing error**. Nothing is classified. A demo upload stays in review for two
seconds, then takes the selected outcome when the page refreshes; **Purge** also deletes the
kept file, with removal reason `policy`. Allowed and limited demo images are served from the bytes
the app kept. An allowed or limited image offers **Simulate a reviewer blocking it**, which applies a synthetic
`asset.blocked` event through the same code as a webhook.

Demo search results are **simulated** and labelled as such: local keyword matching over names,
descriptions, tags and metadata, with `semanticStatus: "disabled"`. There is no semantic
matching offline, so `semantic` mode finds nothing in demo mode. Like CalmLens, simulated
search skips blocked and purged images and removed files; it also skips unfinished uploads.

## Use live CalmLens

```sh
export CALMLENS_API_KEY='your-project-api-key'
export CALMLENS_PROJECT_ID='your-project-id'
cargo run
```

The banner shows **Live** and the demo outcome selector disappears. The library shows the
project's real folders and assets. Uploads, searches and deliveries consume project quota.
Restarting the app clears only its activity log; folders and assets live in CalmLens.

To filter or group by the metadata items in the CalmLens portal, define fields with the IDs
`photographer`, `licence` and `campaign` under **Configuration → Metadata**. Semantic search
covers retained images that are not blocked or purged automatically; results may be incomplete while indexing runs
(`semanticStatus: "indexing"`).

Startup stops with a clear message when only one credential is set, or when demo mode is
requested while credentials are set. `CALMLENS_API_URL` and `CALMLENS_CDN_URL` optionally
point to a local CalmLens. Live SDK requests time out after 30 seconds.

## Errors and notices

After a form is submitted, the app redirects with a notice identifier such as
`?notice=folder-created`, which it maps to a fixed message. Any other value is ignored. When a
CalmLens request fails, the page shows a fixed explanation and the error code for the codes the
library expects (such as `folder/not-empty`), and a generic message otherwise. Error messages
from the API are never shown in the page; the app logs the code, status and request ID
(`error.request_id()`) to stderr instead.

## Webhooks

Set the same secret on this app and on the [CalmLens CLI](https://calmlens.com/docs/guides/local-development)
listener:

```sh
export CALMLENS_WEBHOOK_SECRET='a-local-development-secret'
cargo run
```

In another terminal:

```sh
export CALMLENS_API_KEY='your-project-api-key'
export CALMLENS_PROJECT_ID='your-project-id'
export CALMLENS_WEBHOOK_SECRET='a-local-development-secret'
npx calmlens listen --forward-to http://127.0.0.1:6405/webhooks/calmlens
```

The handler passes the **exact raw body bytes** and the request headers to
`calmlens::construct_webhook_event`, which checks the signature and timestamp before parsing.
A forged, tampered or stale delivery gets 401, and a signed body that is not an event gets 400.
Each event ID, and each `x-calmlens-delivery` ID, is applied once: a repeated delivery has no
further effect, also when two copies arrive at the same time. A test send (fact
`{ key: "test", value: true }`) is logged and changes nothing.

For an asset event, the app retrieves the asset's current state instead of trusting the
event's snapshot. In live mode CalmLens is the library's record store, so the app ties each
event back to its own records by checking that the asset belongs to the configured project
and that its `external_id` is a catalogue ID this app issued (`calmlibrary:` followed by the
catalogue ID). Events for other assets are logged as ignored and change nothing. Known assets
are logged with the event's registered facts, such as **Reviewer** and **Note**. If retrieval
fails, the handler returns 502 so delivery retries. In demo mode, webhooks work for demo
assets when the secret is set.

## Read the code

- [src/app.rs](src/app.rs): `router` (routes, per-route body limits, request timeout and
  security headers), `AppState` (shared library, form token, activity log and processed
  webhook IDs), the folder and asset handlers, `upload` and `prepare_upload` (multipart
  parsing, image sniffing, catalogue IDs), `media` (fail-closed delivery through lenses and
  signed URLs), and `webhook`, `apply_event` and `owns` (verified, deduplicated events tied to
  the library's records).
- [src/library.rs](src/library.rs): `Library`, with one method per operation, answered by the
  shared SDK client in live mode or by the demo store.
- [src/demo.rs](src/demo.rs): the in-memory demo library, including the simulated keyword
  search.
- [src/config.rs](src/config.rs): `settings_from_env`, which refuses to start without
  credentials unless demo mode is requested.
- [src/messages.rs](src/messages.rs): the fixed notices and error explanations, and error
  logging with request IDs.
- [src/page.rs](src/page.rs): server-rendered HTML with no JavaScript or external assets. Every
  dynamic value is escaped.
- [src/tests.rs](src/tests.rs): startup checks, folder operations and error codes, the upload,
  list, search, edit, move and delete requests the SDK sends, delivery only for allowed
  images, file removal, webhook verification, replays and unknown assets, notices and error
  text, form tokens, body limits, timeouts, security headers and escaping. Tests send requests
  to the router with `tower::ServiceExt::oneshot`; live-mode tests use a client from the SDK's
  `MockServerClient`, which is enabled only as a development dependency.

```sh
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

## From local example to production

This is a **learning example**: it has no sign-in and keeps its activity log and processed
webhook IDs in memory. It listens only on 127.0.0.1, and anyone who can reach it can browse,
upload to and delete from the library. Request bodies are limited per route (16KiB for forms,
5MiB plus form fields for uploads, 1MiB for webhooks), and each request must finish within 60
seconds. A production library also needs team accounts mapped to CalmLens folder permissions,
durable storage for processed webhook IDs, HTTPS, and connection limits at the proxy.
