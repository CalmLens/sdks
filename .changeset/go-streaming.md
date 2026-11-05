---
"@calmlens/sdk-go": minor
---

Adaptive streaming of audio and video, and an embed page for every asset (preview).

- The CDN's new `hls` resource (`ResourceHLS`) serves an audio or video asset's adaptive stream, its HLS master playlist at `/hls/index.m3u8` (one signature covers every playlist and segment beneath `/hls/`), and the new `embed` resource (`ResourceEmbed`) serves an HTML page at `/embed` that shows any asset in an iframe. `CDN.GetAssetURL`, `CDN.Serve` and `Assets.CreateSignedURL` accept both, and `SignedCDNResources` lists them. Neither takes a lens or transform; the SDK refuses one with `sdk/invalid-argument`, as it does for the original.
- `Content.HLS` (`*AssetHls`) describes the stream once one is prepared: its `Renditions`, each an `AssetHlsRendition` with `Kind` (`AssetHlsRenditionKindVideo` or `AssetHlsRenditionKindAudio`), `Width`, `Height`, `Bandwidth` and `Codecs`. It is nil for other assets and until then.
- `ProcessingFeatures.Streaming` (`*StreamingFeatureOptions` with `Enabled`) turns streaming on or off for an upload; left nil, the project's setting decides.
- The mock client prepares no stream, so `Content.HLS` is nil and the `hls` resource answers `asset/no-rendered-version`; it serves an embed page for every asset it may deliver.
