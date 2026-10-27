# Calmclips — Go voice notes and video clips

A browser app using the [CalmLens Go SDK](../../go/README.md) to classify
**voice notes and short video clips** before anyone can play them. Clips of up to 50 MiB
go **straight from the browser to CalmLens** through an
[upload preset](https://calmlens.com/docs/guides/upload-presets), so large media
never passes through your server: the Go server only signs a single-use upload token per
clip, without calling CalmLens. It also shows
[audio and video moderation](https://calmlens.com/docs/guides/audio-and-video)
(beta), [multipart uploads](https://calmlens.com/docs/guides/multipart-uploads)
for larger clips, the report's `media` timeline, private playback through short-lived
signed CDN URLs, retrying failed processing, deleting an asset, and verified webhooks.

## Run locally

Go 1.22+; no external modules. `go.mod` uses the sibling SDK through a local `replace`.

```sh
cd examples/voice-clips-go
CALMLENS_DEMO=1 go run .   # simulated demo, no project needed
```

Open **http://127.0.0.1:6402**. Without credentials and without `CALMLENS_DEMO=1` the app
refuses to start, so a missing secret never silently runs the demo instead of live mode. Choose an audio or video clip of up to 50 MiB and
120 seconds. The server checks the size and accepts only the documented, tested formats
by MIME type (the type the browser reports in live mode): WAV, MP3, FLAC, AAC, M4A,
Ogg/Vorbis, Opus, AIFF and WMA audio, and MP4, MOV, WebM, Matroska, AVI, MPEG, MPEG-TS and
WMV video. It does not decode media, so the 120-second limit is enforced by CalmLens: a
longer, corrupt or unsupported clip ends with classification status `failed`.

## Demo mode

`CALMLENS_DEMO=1` runs the app on the SDK's in-memory client (`calmlenstest`), so the
real client's validation, multipart splitting and request encoding still run. The demo has
no upload preset, so it uses a **simulated server path**: the browser posts the clip to
this server, which uploads it with the Go SDK (one `Assets.Create` up to 8 MiB, otherwise
`Assets.Create` with `Part` and then `Assets.UploadPart` in 5 MiB parts, each streamed
from the uploaded file with `io.NewSectionReader`). [demo.js](demo.js) adds drag and drop
and an upload progress row; without JavaScript the form posts normally and the page refreshes
itself while a clip is checked. Setting `CALMLENS_UPLOAD_PRESET_ID` together with
`CALMLENS_DEMO=1` stops startup. All demo code
lives in the separate [`demo`](demo/demo.go) package; live mode never calls it. The demo
selector lets you choose the outcome explicitly: allow, limit, age-restrict, block, purge, or a
processing error. The clip stays pending for five seconds, then the selected outcome is
written with a **simulated** report: a fixed duration per outcome (41 seconds when allowed, up to
1:36 when blocked) split into overlapping 30-second `clip` segments, with synthetic category
scores in some of them (`Scenarios` in [demo/demo.go](demo/demo.go)). Nothing is decoded and no moderation
model runs. Allowed and limited demo clips play through the mock CDN, and a purged demo clip loses its
stored content.

## Live mode

### 1. Create the upload preset

In the portal, open **Developer → Upload presets** and create a preset:

| Setting | Value |
| --- | --- |
| Who can upload? | **Users your server approves**, so every upload needs a token this app signed |
| File types | `audio/*, video/*` (or the exact types listed above) |
| Maximum file size (MB) | `50` |
| Visibility | **Private** |
| Keep content after moderation | **On**: allowed clips are played from CalmLens, and without it the content is deleted after moderation |
| Show the decision to the uploader | Off is fine: the page never reads the browser's view of the upload |
| Allowed sites | `http://127.0.0.1:6402` (the origin you open the app on) |

Copy the preset ID. The API key below must be able to create assets in the preset's
folder, because upload tokens act for the key that signed them.

### 2. JavaScript SDK

The page uploads with the JavaScript SDK's `CalmLensAppClient`. No published
`@calmlens/sdk` release includes it yet, so the server serves the workspace build from
`javascript/esm` at `/sdk/`. From the repository root:

The JavaScript SDK is already built in this checkout.

Set `CALMLENS_JS_SDK_DIR` to serve the build from another folder. Once a published release
includes `CalmLensAppClient`, import `@calmlens/sdk/app` from your bundler or CDN instead of
`/sdk/app.js` in [upload.js](upload.js) and drop the `/sdk/` route.

### 3. Run

```sh
export CALMLENS_API_KEY='your-project-api-key'
export CALMLENS_PROJECT_ID='proj_8fK2mQx7Lp4NvB3tRz9Y'
export CALMLENS_UPLOAD_PRESET_ID='preset_4Lk8Qw2Xm9Rt5Vb3Nc7P'
go run .
```

All three values are required; a missing one, or a missing SDK build, stops startup, as
does combining them with `CALMLENS_DEMO=1`. Optionally set `CALMLENS_API_URL` for a local
backend (the page uploads to the same API), and `CALMLENS_CDN_URL` for its CDN.
Local playback accepts HTTP URLs on loopback; deployed playback uses HTTPS.

- **Upload.** Choosing a clip calls `POST /uploads/start` with its name, type and size. The
  server checks the format and size, reserves a slot, and returns a token from
  `client.UploadTokens.Sign` for the preset, with the clip's ID as `ExternalID` and a
  10-minute expiry. The page then creates
  `new CalmLensAppClient({ uploadPresetId, token })` and uploads the file straight to
  CalmLens. Clips up to 8 MiB go in one `assets.create` request. Larger clips are a
  multipart upload: `assets.create` with `part` (part 1) and `totalSizeInBytes`, then
  `assets.uploadPart` for each further part, marking the last with `isFinal`. Every
  non-final part is exactly 5 MiB, the minimum the API accepts, and is a `Blob` slice of
  the file, so the clip is never copied into memory. While it uploads, the clip list shows
  it with a progress bar and the part being sent; the widget's own queue only shows failed
  uploads, with its retry. The preset makes the asset private and keeps its content; the browser can only
  name it.
- **Records.** Each clip gets its own ID (`clip_…`). The upload token sets it as the asset's
  `externalId`, and the browser can't change it. When the upload ends, the page sends the
  asset ID to `POST /uploads/finish`. The server treats it as a hint: it calls
  `Assets.Retrieve` and links the asset only if its `externalId` is this clip's ID, so a
  browser can't claim another clip's asset. Every later refresh checks the `externalId`
  again before applying a decision. The browser's view of the upload is never used.
- **Decisions.** Audio and video always return with moderation status `pending` and are
  processed in the background. A clip is decided once `Classification.Moderation.Status` is
  no longer `pending` (`allowed`, `limited`, `age-restricted`, `blocked` or `purged`), or
  `Classification.Status` is `failed`. While a clip is pending, the page reloads every three seconds (never during
  an upload) and the server calls `Assets.Retrieve`; verified webhooks update a clip
  sooner. The **Activity** panel lists each decision the app picked up and whether it came
  from a status check or a webhook.
- **Timeline.** `classification.moderation.timeline` provides `durationSeconds` and `segments`. Native analysis
  uses overlapping 30-second chunks (`source: "clip"`). Each segment lists the categories
  that were evaluated (or partially evaluated) with a score of at least 0.4 ("possible").
  A `not-evaluated` category is never shown as a zero score. Ranges are approximate. Segments
  come from different sources (sampled frames, speech, on-screen text or whole clip chunks), so
  each clip shows one bar per source, coloured by the strongest finding's likelihood, and lists
  the time ranges with findings, merging touching flagged segments of the same source. The
  decision line names each category found, strongest first.
- **Playback.** Only an explicit `allowed` or `limited` status plays. CalmLens delivers a
  `limited` asset exactly like an allowed one and only marks it so your app can reduce its
  reach; this app collapses a limited clip behind a "Show limited clip" control. CalmLens delivers an
  `age-restricted` asset only through signed URLs or API keys so your backend can put it
  behind an age check; this app has no age check, so it doesn't play those either. `blocked`
  and `purged` clips are never shown (a purged clip's content is deleted). The `/media` route retrieves
  the asset again, then calls `Assets.CreateSignedURL` with a **300-second expiry**
  (long enough to play and seek a two-minute clip) and redirects the `<audio>` or
  `<video>` element to it. A failed retrieve, a clip that is pending, failed or not allowed, or a
  non-HTTPS URL never gets one. The signed URL is reused while at least 150 seconds of it
  remain, so seeking and replays don't call CalmLens again; a refresh or webhook that
  reports a different decision drops it. In the demo, `/media` streams the mock CDN response and passes `Range` through.
- **Retry.** A clip whose processing `failed` offers **Retry processing**, which calls
  `Assets.Retry` and returns it to processing.
- **Delete.** **Delete clip** calls `Assets.Delete`, which removes the asset record and
  its stored content in CalmLens, and then removes the clip from the page. If the call
  fails, the clip stays listed. A clip whose browser upload never finished has no linked
  asset, so deleting it only frees its slot.

Live uploads consume project quota (audio and video use the token meter) and retain
content in your project until you delete the clip. Restarting the app clears only
local state; manage earlier assets in the portal.

## Webhooks

Polling works without webhooks. To try signed delivery, set the **same secret** on this
app and on the [CalmLens CLI](https://calmlens.com/docs/guides/local-development) listener:

```sh
export CALMLENS_WEBHOOK_SECRET='a-local-development-secret'
# Start or restart the app in this terminal after setting the secret.
go run .
```

In another terminal:

```sh
export CALMLENS_API_KEY='your-project-api-key'
export CALMLENS_PROJECT_ID='proj_8fK2mQx7Lp4NvB3tRz9Y'
export CALMLENS_WEBHOOK_SECRET='a-local-development-secret'
calmlens listen --forward-to http://127.0.0.1:6402/webhooks/calmlens
```

The handler verifies the **exact raw body** before parsing JSON. For `asset.allowed`,
`asset.limited`, `asset.age-restricted`, `asset.blocked` and `asset.purged` (sent for automated moderation
outcomes and reviewer decisions alike) and `asset.failed`, it retrieves the clip's current state instead of trusting the event snapshot. If that
retrieval fails it returns 502, so delivery is retried. A delivery that was already
applied has no further effect, and a test send (fact `{ key: "test", value: true }`) is
listed in the Activity panel and changes nothing.

## Read the code

- [main.go](main.go), `startUpload`: the MIME allow-list, the size limit and
  `UploadTokens.Sign`; `finishUpload`: linking the browser's asset only after a retrieve
  confirms its `externalId`; `sdk`: serving the SDK build.
- [upload.js](upload.js): the browser upload through the preset, single-request or
  multipart, with per-part progress.
- `upload` and `send`: the demo's simulated server upload.
- `refresh` and `timeline`: SDK retrieval and turning `classification.moderation.timeline` into segment rows;
  `Flagged` and `Reasons` summarise them.
- `media`: fresh status check, the signed URL cache, live short-lived signed playback
  and streamed demo playback.
- `retry`, `remove`: `Assets.Retry` and `Assets.Delete`.
- `webhook`: `VerifyWebhookRequest`, test sends, replays and state refresh.
- [demo/demo.go](demo/demo.go): the explicitly selected, simulated demo outcomes.
- [index.html](index.html): server-rendered UI with no external assets; live mode adds
  `upload.js` as a module script, the demo `demo.js`.
- [main_test.go](main_test.go): format and size limits, upload tokens bound to their clip,
  linking only the clip's own asset, multipart part counts, playback gating, signed URLs,
  timelines, retry, delete, form tokens and webhooks.

```sh
go test -race ./...
go vet ./...
```

## Local example versus production

This is a **local, single-user learning example**. It keeps up to 12 clips in memory. Its
lock only guards that local state: CalmLens calls run outside it, so one slow request
never blocks the others.
It has no accounts, so "owner" means whoever uses this browser session, and it has no
persistent records, background worker or upload resumption: an interrupted multipart
upload is abandoned, and an upload whose asset was created but never confirmed stays in
your project without a clip. Anyone who can reach the page can request upload tokens. A production service would authenticate users before signing upload tokens, check
ownership before playback, retry and deletion, store asset IDs in a database, process
webhooks from a durable queue, and deduplicate
deliveries across restarts.
