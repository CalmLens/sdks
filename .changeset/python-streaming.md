---
"@calmlens/sdk-python": minor
---

Adaptive streaming of audio and video (preview), and an embed page for every asset.

- The CDN's new `hls` resource serves an audio or video asset's adaptive stream, its HLS master playlist at `/hls/index.m3u8` (one signature covers every playlist and segment beneath `/hls/`), and the new `embed` resource serves an HTML page at `/embed` that shows any asset, as a viewer for its type, for an iframe. `cdn.get_asset_url`, `cdn.serve` and `assets.create_signed_url` accept both, and `SIGNED_CDN_RESOURCES` lists them. Neither takes a lens or transform; the SDK refuses one with `sdk/invalid-argument`, as it does for the original.
- `content["hls"]` describes the stream once one is prepared (its `renditions`, each with `kind`, `width`, `height`, `bandwidth` and `codecs`), and is `None` for other assets, until then, once the content is removed and while the asset is held. New types: `AssetHls`, `AssetHlsRendition` and `StreamingFeatureOptions`.
- `processing_options={"features": {"streaming": {"enabled": ...}}}` turns streaming on or off for an upload; left out, the project's setting decides.
- The mock client prepares no stream, so `content["hls"]` is `None` and it answers `asset/no-rendered-version` for the `hls` resource; it serves an embed page for every asset it may deliver.
