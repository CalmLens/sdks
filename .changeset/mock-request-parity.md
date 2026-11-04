---
"@calmlens/sdk": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

Structured transform options are checked against the image transform schema before a CDN or signed URL is built: an unknown option (such as the earlier `{ type: "imageTransform", options: { ... } }` shape) or an invalid value (such as `width: 0` or `format: "bmp"`) fails with `sdk/invalid-argument`, naming each option, instead of building a URL the CDN refuses. Selector strings are passed to the CDN unchanged.

Every SDK refuses an upload whose type CalmLens can't moderate (anything other than an image, audio, video, text, document or web page, such as `application/zip`) with `upload/invalid-mime-type` before sending it, as the API does.

An option given as `null` (`None` in Python, `nil` in Ruby) is left out of the request, as if omitted, unless the API takes `null` for it, such as `description` to clear it or `folderId` for the project root. Passing `viewer_claims=None` to `create_signed_url` now works. In Java and Rust, `UpdateAsset`'s name is a plain optional string, since a name can't be cleared.

The mock clients answer more like the API: they refuse `metadata` that isn't a list of `{ id, value }` items and `null` for fields the API refuses it for with the same `validation/...` error, refuse the same upload types, and their CDN refuses a transform it can't read (`asset/invalid-transform`) or whose options are invalid (`asset/invalid-transform-options`).
