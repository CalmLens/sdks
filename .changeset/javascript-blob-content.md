---
"@calmlens/sdk": minor
---

Pass a `Blob` or `File` as `content` to `assets.create` and `assets.classify`, on the server client and the upload preset client: its own type is the content type. Through an upload preset, a `File`'s name is the asset's name unless you pass `name`. A `Blob` without a type is rejected with `upload-payload/invalid` before anything is sent. `{ data, type }` and the other content forms work as before.
