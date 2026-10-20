# Calmclips — Go voice notes and video clips

A browser app using the [CalmLens Go SDK](../../go/README.md) to moderate
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
longer, corrupt or unsupported clip ends with processing status `failed`.

## Demo mode

`CALMLENS_DEMO=1` runs the app on the SDK's in-memory client (`calmlenstest`), so the
real client's validation, multipart splitting and request encoding still run. The demo has
no upload preset, so it uses a **simulated server path**: the browser posts the clip to
this server, which uploads it with the Go SDK (one `Assets.Create` up to 8 MiB, otherwise
`Assets.Create` with `Part` and then `Assets.UploadPart` in 5 MiB parts, each streamed
from the uploaded file with `io.NewSectionReader`). The page needs no JavaScript in the
demo, and setting `CALMLENS_UPLOAD_PRESET_ID` together with `CALMLENS_DEMO=1` stops
startup. All demo code
lives in the separate [`demo`](demo/demo.go) package; live mode never calls it. The demo
selector lets you choose the outcome explicitly: approve, approve and flag, reject, or a
processing error. The clip stays pending for two seconds, then the selected outcome is
written with a **simulated** report: a fixed 48-second duration and two overlapping
`clip` segments with synthetic category scores. Nothing is decoded and no moderation
model runs. Approved demo clips play through the mock CDN.

## Live mode

### 1. Create the upload preset

In the portal, open **Developer → Upload presets** and create a preset:

| Setting | Value |
| --- | --- |
| Who can upload? | **Users your server approves**, so every upload needs a token this app signed |
| File types | `audio/*, video/*` (or the exact types listed above) |
| Maximum file size (MB) | `50` |
| Visibility | **Private** |
| Keep content after moderation | **On**: approved clips are played from CalmLens, and without it the content is deleted after moderation |
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
export CALMLENS_PROJECT_ID='your-project-id'
export CALMLENS_UPLOAD_PRESET_ID='your-upload-preset-id'
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
  the file, so the clip is never copied into memory. A progress bar advances after each
  part. The preset makes the asset private and keeps its content; the browser can only
  name it.
- **Records.** Each clip gets its own ID (`clip_…`). The upload token sets it as the asset's
  `externalId`, and the browser can't change it. When the upload ends, the page sends the
  asset ID to `POST /uploads/finish`. The server treats it as a hint: it calls
  `Assets.Retrieve` and links the asset only if its `externalId` is this clip's ID, so a
  browser can't claim another clip's asset. Every later refresh checks the `externalId`
  again before applying a decision. The browser's view of the upload is never used.
- **Decisions.** Audio and video always return with moderation status `pending` and are
  processed in the background. A clip is decided once `Moderation.Status` is `approved` or
  `rejected`, or `Processing.Status` is `failed`; it is flagged for review when
  `Moderation.Action` is set (the policy chose `alert`). While a clip is pending, the page reloads every three seconds (never during
  an upload) and the server calls `Assets.Retrieve`; verified webhooks update a clip
  sooner.
- **Timeline.** `moderation.report.media` provides `durationSeconds` and `segments`. Native analysis
  uses overlapping 30-second chunks (`source: "clip"`). Each segment lists the categories
  that were evaluated (or partially evaluated) with a score of at least 0.4 ("possible").
  A `not-evaluated` category is never shown as a zero score. Ranges are approximate.
- **Playback.** Only an explicit `approved` decision plays. The `/media` route retrieves
  the asset again, then calls `Assets.CreateSignedURL` with a **300-second expiry**
  (long enough to play and seek a two-minute clip) and redirects the `<audio>` or
  `<video>` element to it. A failed retrieve, a pending, rejected or failed clip, or a
  non-HTTPS URL never gets one. The signed URL is reused while at least 150 seconds of it
  remain, so seeking and replays don't call CalmLens again; a refresh or webhook that
  reports a different decision drops it. An approved, flagged clip plays with a review
  badge. In the demo, `/media` streams the mock CDN response and passes `Range` through.
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
export CALMLENS_PROJECT_ID='your-project-id'
export CALMLENS_WEBHOOK_SECRET='a-local-development-secret'
calmlens listen --forward-to http://127.0.0.1:6402/webhooks/calmlens
```

The handler verifies the **exact raw body** before parsing JSON. For `asset.approved` and
`asset.rejected` (sent for automated moderation outcomes and reviewer decisions alike) and
`asset.failed`, it retrieves the clip's current state instead of trusting the event snapshot. If that
retrieval fails it returns 502, so delivery is retried. A delivery that was already
applied has no further effect, and a test send (fact `{ key: "test", value: true }`) is
logged in the activity panel and changes nothing.

## Read the code

- [main.go](main.go), `startUpload`: the MIME allow-list, the size limit and
  `UploadTokens.Sign`; `finishUpload`: linking the browser's asset only after a retrieve
  confirms its `externalId`; `sdk`: serving the SDK build.
- [upload.js](upload.js): the browser upload through the preset, single-request or
  multipart, with per-part progress.
- `upload` and `send`: the demo's simulated server upload.
- `refresh` and `timeline`: SDK retrieval and turning `moderation.report.media` into segment rows.
- `media`: fresh approval check, the signed URL cache, live short-lived signed playback
  and streamed demo playback.
- `retry`, `remove`: `Assets.Retry` and `Assets.Delete`.
- `webhook`: `VerifyWebhookRequest`, test sends, replays and state refresh.
- [demo/demo.go](demo/demo.go): the explicitly selected, simulated demo outcomes.
- [index.html](index.html): server-rendered UI with no external assets; live mode adds
  `upload.js` as a module script.
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
