# Calmmarket: marketplace photos with text in them (Java)

A browser app using the [CalmLens Java SDK](../../java/README.md). On a
marketplace, much of what matters is written *inside* the photos: sellers add prices,
slogans, phone numbers and claims to their images. A photo can look harmless while the text
on it offers something the marketplace does not allow.

Calmmarket uploads every listing photo with OCR enabled, so CalmLens moderates both what the
photo shows and the text it reads in it, and the seller sees which of the two led to a
decision:

1. The title and then the description are moderated synchronously with `text.moderate`. If
   either is not approved, the listing is held, nothing is stored and no photo is uploaded.
2. Up to four photos are uploaded privately with `assets.create` and
   `processingOptions.features.ocr.enabled: true`. When OCR finds text, CalmLens creates a linked
   `plaintext-document` child asset, moderates it like any text, and merges its report into
   the photo's report. The photo's `moderation.status` is the combined decision, and
   `moderation.report` the combined report.
3. The page polls `assets.retrieve` for each photo. Once a photo is decided, it finds the OCR
   child with `assets.listChildren` and shows:
   - the combined decision of the photo;
   - the text found in the photo, the child's own status, and its own report;
   - for a rejected photo, **what caused it**: the text in the photo (the child was rejected
     on its own), the visual content (the child passed, or there was no text), or a
     reviewer's decision (the policy took no action: `moderation.action` is `null`);
   - each report category of the combined report next to the same category of the child's
     report. The combined report keeps the higher evaluated score per category, so a
     combined score the text reaches came from the text, and a higher one from the image.
     Scores below 0.1 do not contribute to merging and are not attributed.
4. The listing goes live only when its text **and every photo** are approved. A pending,
   rejected, unknown or failed photo (`processing.status` `failed`) holds the whole listing. Approved photos are delivered
   through a CDN lens with a 60-second signed URL.

Categories are read the way [moderation reports](https://calmlens.com/docs/guides/moderation-reports)
describe: `evaluated` and `partial` results have a score; a `not-evaluated` result has a
reason and no score, and is never shown or compared as zero. If the child lookup fails, the
cause is shown as unknown and the lookup is retried; the decision itself always comes from
the photo. See the [OCR guide](https://calmlens.com/docs/guides/ocr) for how
reports are merged.

## Withdrawing a listing and what is retained

A seller can withdraw a listing at any time. It leaves the market at once, and the app calls
`assets.deleteContent` for every photo **and** its OCR text child. This is the retention
choice of this example: the stored bytes (the photo and the text read from it) are removed
(`content.status` becomes `removed`) and the CDN stops serving them, while the asset records and their moderation reports stay in
CalmLens for audit and for any later dispute. The title and description assets keep their
text so a reviewer can still read the listing in the portal. A removal that fails can be
retried from the page; content under a safety hold cannot be removed and is left alone. Use
`assets.delete` instead when nothing should be kept; Calmmarket uses it only to delete photos
it already uploaded for a listing whose next upload failed, so no orphaned photos remain.

## Run locally

Java 17+ and Maven. The example depends on the SDK from this repository, so install it into
your local Maven repository first. The JDK's built-in HTTP server is the only other runtime
dependency.

```sh
mvn -q -f java/pom.xml install -DskipTests   # from the repository root
cd examples/marketplace-listing-java
CALMLENS_DEMO=1 mvn -q compile exec:java                  # or set credentials, below
```

Open **http://127.0.0.1:6404**. Use `-Dexec.args="--port 6414"` to change the port.

The app fails closed: without `CALMLENS_API_KEY` and `CALMLENS_PROJECT_ID` it refuses to start
unless demo mode is requested with `CALMLENS_DEMO=1` (or `-Dexec.args="--demo"`), and partial
credentials never fall back to demo mode.

The server listens only on 127.0.0.1.

Requests are handled concurrently (on virtual threads on Java 21 and later, otherwise a bounded
pool). No lock is held while CalmLens answers: the app makes each call first and then applies the
result under the affected listing's own lock, so a slow call never holds up other pages.

## Demo mode

With `CALMLENS_DEMO=1`, the app runs in an explicitly labelled demo mode. Its CalmLens calls go
to [Demo.java](src/main/java/calmmarket/Demo.java), which answers from the SDK's
`MockCalmLensServerClient`; the live code path never uses the mock. Choose a result for the text and
one for each photo:

- **Approved, no text found**: the photo has no OCR child.
- **Approved, text in it clean**: an approved OCR child.
- **Text in photo rejected**: the photo itself looks fine, but its OCR child is rejected, so
  the merged report and the photo are rejected; the cause shown is the text in the photo.
- **Visually rejected, text clean**: the child passes; the cause is visual.
- **Processing error**, and for the text **Description rejected** or **CalmLens
  unavailable**.

Each choice queues fake responses on a fresh mock, which then runs the real client's
validation and encoding. Reports, OCR children and their text are **synthetic** and labelled
as such on the page. Nothing is classified. A demo photo stays pending for two seconds and
takes the selected result when the page refreshes. A live demo listing offers **Simulate a
reviewer rejecting photo 1**, which runs a synthetic `asset.rejected` event through the same
events-feed code as live mode. Withdrawing a demo listing removes the bytes the app kept, so
its previews stop.

## Use live moderation

```sh
export CALMLENS_API_KEY='your-project-api-key'
export CALMLENS_PROJECT_ID='your-project-id'
mvn -q compile exec:java
```

The banner changes to **Live** and the demo selectors disappear. Each listing makes two
synchronous text calls and one queued upload per photo, all with an `externalId` of
`<listing-id>:<field>` (`title`, `description`, `photo-1` ...) and
`keepContentAfterProcessing: true`, so a reviewer can see flagged content in the CalmLens
portal. The same value is the call's `Idempotency-Key`, so a retried upload never creates a second
asset. Whenever the app retrieves an asset (polling, previews, events and webhooks), it checks
that the asset's `externalId` points back to the listing that holds it; an asset that does not is
never used as that listing's decision. OCR is metered separately from image moderation, and text found in a photo uses
normal text moderation. Restarting the app clears only local state; it does **not** delete
live assets.

The first approved photo preview calls `ensureLens` for the `calmmarket-card` lens (a 640×480
WebP crop). Each preview retrieves the photo's current decision again before calling
`assets.createSignedUrl` and redirecting to it. If the refresh fails, the photo is hidden.

Configure the moderation policy in the CalmLens portal. `CALMLENS_API_URL` and
`CALMLENS_CDN_URL` optionally point to a local CalmLens. Live SDK requests time out after 30
seconds; reads and uploads are retried by the SDK after network failures and throttling. Failures
are logged by error code and request ID, and the page shows only the app's own messages, never
an API error's text. Notices after a form are fixed messages chosen by a key in the URL, so text
placed in a link is never displayed.

## Review decisions

**Events feed (pull).** Click **Check for review decisions**. The first call to
`events.list` without a cursor returns a cursor for "now". Later calls pass it as `after`,
follow `hasMore`, and apply each `asset.*` event about a local listing by retrieving the
current state; the event's snapshot is not trusted. An event about a photo **or its OCR
child** refreshes the photo (which carries the combined decision) and its child. A rejected
title or description takes the listing down. The cursor advances only after a whole page is
applied, so a failed retrieval retries the page. Events already applied are skipped, and
events about a withdrawn listing change nothing.

**Webhooks (push).** Set the same secret on this app and on the
[CalmLens CLI](https://calmlens.com/docs/guides/local-development) listener:

```sh
export CALMLENS_WEBHOOK_SECRET='a-local-development-secret'
mvn -q compile exec:java
```

In another terminal:

```sh
export CALMLENS_API_KEY='your-project-api-key'
export CALMLENS_PROJECT_ID='your-project-id'
export CALMLENS_WEBHOOK_SECRET='a-local-development-secret'
npx calmlens listen --forward-to http://127.0.0.1:6404/webhooks/calmlens
```

The handler passes the **exact raw body bytes** to `CalmLensServerClient.parseWebhookEvent`, which
verifies the signature and timestamp before parsing, then applies the event through the same code
as the events feed. A forged, tampered or stale delivery gets 401. If retrieval
fails, it returns 502 so delivery retries. A repeated event has no further effect. A test send
(fact `{ key: "test", value: true }`) is logged and changes nothing. The activity panel shows
registered facts such as **Reviewer** and **Note**; the hidden reviewer ID and unknown keys
are not shown, and only absolute HTTP(S) fact URLs become links.

## Read the code

- [Calmmarket.java](src/main/java/calmmarket/Calmmarket.java): `submit` (text first, then
  photos with `photoProcessing()`, cleanup with `assets.delete`), `lookUp` and `textChild`
  (decision, externalId check and OCR child through `assets.iterateChildren`), `driver` and
  `explain` (which modality caused a rejection, category by category), `withdraw`
  (`assets.deleteContent`), `photo` (lens and signed URL), `sync`, `apply` and `webhook`.
- [Demo.java](src/main/java/calmmarket/Demo.java): the synthetic demo answers, used only in demo
  mode.
- [Page.java](src/main/java/calmmarket/Page.java): server-rendered HTML with no JavaScript or
  external assets. Every dynamic value is escaped.
- [Main.java](src/main/java/calmmarket/Main.java): the JDK HTTP server, its concurrent executor,
  the bind address, and request bodies read only after their declared size is checked.
- [Multipart.java](src/main/java/calmmarket/Multipart.java): a small, bounded form parser.
- [CalmmarketTest.java](src/test/java/calmmarket/CalmmarketTest.java): OCR on every upload,
  modality attribution, missing and failed OCR children, not-evaluated categories, held
  listings, withdrawal and retries, events feed, webhooks, failures, form tokens and the
  server.

```sh
mvn -q -f java/pom.xml install -DskipTests   # from the repository root
mvn -B verify                                             # in examples/marketplace-listing-java
```

## From this example to production

This is a **local, single-user learning example**. It keeps up to 20 listings and 50
activity entries in memory and polls for photo decisions when the page loads. A production marketplace needs seller accounts and authorization,
persistent storage (including the events cursor and the IDs of OCR children), webhooks
rather than page-load polling, a retention schedule that matches its own policies (for
example removing content after a dispute window rather than only on withdrawal), payments,
and a reviewer workflow. It should also decide how to treat a photo that is still processing
when a seller withdraws it: Calmmarket looks for its OCR child at that moment, but text
extracted later is not removed.
