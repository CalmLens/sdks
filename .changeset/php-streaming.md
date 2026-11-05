---
"@calmlens/sdk-php": minor
---

Adaptive streaming of audio and video (preview), and an embed page for every asset. The CDN's new `hls` resource serves an audio or video asset's adaptive stream, its HLS master playlist at `/hls/index.m3u8` (one signature covers every playlist and segment beneath `/hls/`), and the new `embed` resource serves an HTML page at `/embed` that shows any asset, as a viewer for its type, for an iframe. `$client->cdn->getAssetUrl`, `$client->cdn->serve` and `$client->assets->createSignedUrl` accept both, and `Cdn::SIGNED_RESOURCES` and `Cdn::RESOURCES` list them. Neither takes a lens or transform; the client refuses one with `sdk/invalid-argument`, as it does for the original.

`content.hls` describes the stream once one is prepared (its `renditions`, each with `kind`, `width`, `height`, `bandwidth` and `codecs`), and is `null` for other assets, until then, once the content is removed and while the asset is held. `processingOptions.features.streaming` (`['enabled' => bool]`) turns streaming on or off for an upload; left out, the project's setting decides.

`MockServerClient` prepares no stream, so `content.hls` is `null` and it answers 404 `asset/no-rendered-version` for the `hls` resource; it serves an embed page (`text/html`) for every asset it may deliver.
