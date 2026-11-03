---
"@calmlens/sdk": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

Breaking: a transform is now one set of image options, applied in one pass. Pass the options themselves, such as `{ width: 1024, format: "png" }`, where you passed `{ type: "imageTransform", options: { ... } }` or a list of steps; lenses take `transform` options in place of a `transforms` list. CDN URLs put a lens and its extra options in one path segment, such as `/rendered/@thumbnail,width=64`, and options in the URL replace the lens's own. Selector strings containing `/` or starting with `@` are refused with `sdk/invalid-argument`.
