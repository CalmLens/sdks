---
"@calmlens/sdk-rust": minor
---

Adaptive streaming of audio and video, and an embed page for every asset (preview).

- The CDN's new `hls` resource (`CdnResource::Hls`, `SignedUrlResource::Hls`) serves an audio or video asset's adaptive stream, its HLS master playlist at `/hls/index.m3u8` (one signature covers every playlist and segment beneath `/hls/`), and the new `embed` resource (`CdnResource::Embed`, `SignedUrlResource::Embed`) serves an HTML page at `/embed` that shows any asset in an iframe. `cdn().get_asset_url`, `cdn().serve` and `assets().create_signed_url` accept both, and `SIGNED_CDN_RESOURCES` lists them. Neither takes a lens or transform; the SDK refuses one with `sdk/invalid-argument`, as it does for the original.
- `AssetContent::hls` (`Option<AssetHls>`) describes the stream once one is prepared: its `renditions`, each an `AssetHlsRendition` with `kind` (`AssetHlsRenditionKind::Video` or `Audio`), `width`, `height`, `bandwidth` and `codecs`. It is `None` for other assets and until then.
- `ProcessingFeatures::streaming` (`Option<FeatureOptions>`) turns streaming on or off for an upload; left `None`, the project's setting decides.
- The in-memory mock prepares no stream, so `hls` is `None` and the `hls` resource answers `asset/no-rendered-version`; it serves an embed page for every asset it may deliver.
