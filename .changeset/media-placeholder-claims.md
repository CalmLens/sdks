---
"@calmlens/sdk": patch
"@calmlens/sdk-go": patch
"@calmlens/sdk-rust": patch
"@calmlens/sdk-ruby": patch
"@calmlens/sdk-java": patch
"@calmlens/sdk-php": patch
"@calmlens/sdk-python": patch
---

`CalmLensMedia` shows the CDN placeholder for private assets and signed URLs too, since the CDN serves every asset's placeholder publicly. It sends only viewer claims that differ from the defaults (a `region`, or `ageConfirmed: true`), so `ageConfirmed: false` no longer makes the CDN's responses private and uncacheable, and placeholder URLs carry only the region. The mock clients serve private assets' placeholders without `assets:download`, as the CDN does.
