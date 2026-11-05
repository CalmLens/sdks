---
"@calmlens/sdk": minor
---

Long audio and video: `assets.listTimeline({ assetId, cursor?, pageSize? })` pages through every segment of an audio or video asset's findings timeline in time order (a long asset's report keeps a shortened timeline, with `segmentCount` giving the full length). `classification.progress` reports `completedSections` and `totalSections` while long media is analysed in sections, the `asset.processing-progress` event reports the same, and the failure reasons include `media-limit` and `spend-limit`. The mock client serves the timeline endpoint and gives mock assets a `null` progress.
