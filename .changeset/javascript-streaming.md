---
"@calmlens/sdk": minor
---

Adaptive streaming of audio and video, and the embed page (preview).

- The CDN's new `hls` resource serves an audio or video asset's adaptive stream, its HLS master playlist at `/hls/index.m3u8` (one signature covers every playlist and segment beneath `/hls/`), and the new `embed` resource serves an HTML page at `/embed` that shows the asset in an iframe. `getAssetUrl`, `cdn.getAssetUrl`, `cdn.serve` and `assets.createSignedUrl` accept both, and `SIGNED_CDN_RESOURCES` lists them. Neither takes a lens or transform; the SDK refuses one with `sdk/invalid-argument`, as it does for the original.
- `content.hls` describes the stream once one is prepared (its `renditions`, each with `kind`, `width`, `height`, `bandwidth` and `codecs`), and is `null` for other assets and until then. New exported types: `AssetHls` and `AssetHlsRendition`.
- `processingOptions.features.streaming: { enabled }` (the `StreamingFeatureOptions` type) turns streaming on or off for an upload; left out, the project's setting decides.
- `CalmLensMedia` plays the stream of video and audio that has one, in React, Vue, Svelte and the custom elements: natively where the browser plays HLS (Safari and iOS), through hls.js where it has Media Source Extensions, and otherwise, or once the stream fails, from the rendered file. hls.js is loaded only when a stream plays that way. With `getSignedUrl`, the stream is signed too (as `hls`), and signed again when its signature expires mid-playback, which then resumes where it stopped. `stream={false}` (`no-stream` on the custom element) plays the rendered file; `hasStream` (`has-stream`) is set from `asset`.
- In React Native, `renderPlayer` receives the stream as `src` when there is one, with `streaming: true`, and is rendered again with the rendered file if the stream fails.
- The mock client prepares no stream, so `content.hls` is `null`; it answers `asset/no-rendered-version` for `hls`, and serves an embed page for every asset it may deliver.
