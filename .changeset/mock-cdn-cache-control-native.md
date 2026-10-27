---
"@calmlens/sdk-php": patch
"@calmlens/sdk-rust": patch
"@calmlens/sdk-java": patch
---

The mock clients' `cdn.serve` now sends `Cache-Control` as the CDN does: `public` only when anyone may see the asset (including a public age-restricted asset requested with `ageConfirmed`), otherwise `private`, with `max-age=31536000, immutable` for images and `max-age=3600` for other content. They previously sent `private, no-store` or `public, max-age=31536000`. PHP's `MockServerClient::decide` now also records the review in the asset's `manualReviews`, as the Rust and Java mocks already did.
