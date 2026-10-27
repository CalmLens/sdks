---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
---

CDN URL builders take a `placeholder` resource: a small blurred PNG of the asset that the CDN serves for public assets whatever their moderation status, for example in place of an age-restricted image. It takes no lens, transform or `ageConfirmed`, and passing one is rejected with `sdk/invalid-argument`, as is an unknown resource.

The JavaScript SDK exports `getAssetUrl` from `@calmlens/sdk/app` and `@calmlens/sdk`. It builds the same CDN URLs as the server client's `cdn.getAssetUrl` from a project ID, with no API key and no request, so it works in browsers.
