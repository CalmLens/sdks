---
"@calmlens/sdk-java": minor
---

Adaptive streaming of audio and video, and an embed page for every asset (preview).

- The CDN's new `hls` resource serves an audio or video asset's adaptive stream, its HLS master playlist at `/hls/index.m3u8` (one signature covers every playlist and segment beneath `/hls/`), and the new `embed` resource serves an HTML page at `/embed` that shows any asset in an iframe. `cdn.getAssetUrl`, `cdn.serve` and `assets.createSignedUrl` accept both, and `SIGNED_CDN_RESOURCES` and `CDN_RESOURCES` list them. Neither takes a lens or transform; the SDK refuses one with `sdk/invalid-argument`, as it does for the original.
- `AssetContent.hls()` (`AssetHls`) describes the stream once one is prepared: its `renditions`, each an `AssetHlsRendition` with `kind` (`video` or `audio`), `width`, `height`, `bandwidth` and `codecs`. It is null for other assets and until then. `AssetContent` gains the `hls` component.
- `ProcessingFeatures.streaming(FeatureOptions)` turns streaming on or off for an upload; left null, the project's setting decides. `ProcessingFeatures` gains the `streaming` component.
- The mock client prepares no stream, so `hls()` is null and the `hls` resource answers `asset/no-rendered-version`; it serves an embed page for every asset it may deliver.
