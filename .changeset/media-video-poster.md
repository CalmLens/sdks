---
"@calmlens/sdk": patch
---

`CalmLensMedia` no longer requests a `rendered` poster or a CDN placeholder for video and audio, which the CDN doesn't render. Videos play their original file without a poster, and the CDN placeholder is used only for images.
