---
"@calmlens/sdk": patch
"@calmlens/sdk-python": patch
"@calmlens/sdk-go": patch
"@calmlens/sdk-ruby": patch
---

The mock clients' `cdn.serve` now sends `Cache-Control` as the CDN does: `public` only when anyone may see the asset (including a public age-restricted asset requested with `ageConfirmed`), otherwise `private`, with `max-age=31536000, immutable` for images and `max-age=3600` for other content. JavaScript and Python previously sent `private, no-store` or `public, max-age=31536000`; Go and Ruby sent no `Cache-Control`.
