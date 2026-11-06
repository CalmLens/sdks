---
"@calmlens/sdk": minor
---

Long audio and video, rendered media and previews.

- `assets.listTimeline({ assetId, cursor?, pageSize? })` pages through every segment of an audio or video asset's findings timeline in time order, from `GET /v1/projects/:projectId/assets/:assetId/timeline` in the client's project. Pass each page's `nextCursor` back unchanged; cursors are opaque.
- `classification.moderation.timeline` is `{ segmentCount }` for an audio or video asset with a findings timeline, and `null` otherwise. `classification.moderation.raw` no longer includes the timeline.
- `classification.progress` reports `completedSections` and `totalSections` while long media is analysed in sections, and the `asset.processing-progress` event reports the same. The failure reasons include `media-limit` and `spend-limit`.
- `content.rendered` describes the asset's displayable file (`kind` `image`, `pdf`, `video` or `audio`, with its `format`, `width`, `height` and, for audio, waveform `peaks`), and `content.preview` describes its still image (`width`, `height`, `thumbhash` and `averageColor`). They replace `content.image`. The file's own `width`, `height`, `durationSeconds`, `pageCount`, `perceptualHash` and `perceptualHashQuality` are on `content`, and `content.fileMetadata` is now `content.metadata`. New exported types: `AssetRendered`, `AssetRenderedKind` and `AssetPreview`.
- The CDN's new `preview` resource serves the asset's still image: the image itself, a document's first page or slide, a website's first screen, a video's poster frame or an audio waveform. `cdn.getAssetUrl`, `cdn.signAssetUrl` and `cdn.serve` accept it, and it takes lenses and transforms. The `rendered` resource takes them only when it is an image; the CDN answers `asset/invalid-transform` otherwise, and `asset/no-rendered-version` for a resource the asset doesn't have.
- The mock client serves the timeline endpoint (empty, as the mock analyses no media), fills `content.rendered` and `content.preview` for each asset type, serves the `preview` and `rendered` resources as the CDN does, and gives mock assets a `null` progress and timeline.
- Audio and video can be up to 2 GiB when sent in parts, whether `assets.create` and `assets.classify` split a large file or you use the multipart part API; one request still takes up to 50 MiB. Before billing is set up, the API keeps every audio and video upload to 50 MiB and answers `upload/file-too-large`.
