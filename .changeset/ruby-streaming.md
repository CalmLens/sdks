---
"@calmlens/sdk-ruby": minor
---

Adaptive streaming of audio and video (preview), and an embed page for every asset.

- The CDN's new `hls` resource serves an audio or video asset's adaptive stream, its HLS master playlist at `/hls/index.m3u8` (a signed asset URL covers every playlist and segment beneath `/hls/`), and the new `embed` resource serves an HTML page at `/embed` that shows any asset, as a viewer for its type, for an iframe. `cdn.get_asset_url`, `cdn.serve` and `cdn.sign_asset_url` accept both, and `CalmLens::CDN::RESOURCES` lists every resource. Neither takes a lens or transform; the SDK refuses one with `sdk/invalid-argument`, as it does for the original.
- `content.hls` describes the stream once one is prepared (its `renditions`, each with `kind`, `width`, `height`, `bandwidth` and `codecs`), and is `nil` for other assets, until then, once the content is removed and while the asset is held. The RBS signatures add `asset_hls` and `asset_hls_rendition`.
- `processing_options: { features: { streaming: { enabled: } } }` turns streaming on or off for an upload; left out, the project's setting decides.
- `MockServerClient` prepares no stream, so `content.hls` is `nil` and it answers `asset/no-rendered-version` for the `hls` resource; it serves an embed page for every asset it may deliver.
