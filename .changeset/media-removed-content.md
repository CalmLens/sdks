---
"@calmlens/sdk": patch
---

`CalmLensMedia` shows its unavailable notice, without requesting anything from the CDN, for an `asset` whose `content.status` is `removed`. Set `contentRemoved` to do the same without passing an asset.
