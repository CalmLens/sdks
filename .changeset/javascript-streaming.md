---
"@calmlens/sdk": minor
---

Adaptive streaming of audio and video, and the embed page (preview).

- The CDN's new `hls` resource serves an audio or video asset's adaptive stream, its HLS master playlist at `/hls/index.m3u8` (its playlists and segments are beneath `/hls/`), and the new `embed` resource serves an HTML page at `/embed` that shows the asset in an iframe. `cdn.getAssetUrl`, `cdn.signAssetUrl` and `cdn.serve` accept both. Neither takes a lens or transform; the SDK refuses one with `sdk/invalid-argument`, as it does for the original.
- `content.hls` describes the stream once one is prepared (its `renditions`, each with `kind`, `width`, `height`, `bandwidth` and `codecs`), and is `null` for other assets and until then. New exported types: `AssetHls` and `AssetHlsRendition`.
- `processingOptions.features.streaming: { enabled }` (the `StreamingFeatureOptions` type) turns streaming on or off for an upload; left out, the project's setting decides.
- `CalmLensAsset` plays the stream of video and audio that has one, in React, Vue, Svelte and the custom elements: natively where the browser plays HLS (Safari and iOS), through hls.js where it has Media Source Extensions, and otherwise, or once the stream fails, from the rendered file. hls.js is loaded only when a stream plays that way. When a signed asset URL expires mid-playback, `onExpired` supplies a fresh one and playback resumes where it stopped. `video={{ stream: false }}` (`no-stream` on the custom element) plays the rendered file.
- In React Native, `renderPlayer` receives the stream as `src` when there is one, with `streaming: true`, and is rendered again with the rendered file if the stream fails.
- The mock client prepares no stream, so `content.hls` is `null`; it answers `asset/no-rendered-version` for `hls`, and serves an embed page for every asset it may deliver.
