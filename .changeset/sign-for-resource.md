---
"@calmlens/sdk": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-rust": minor
---

`cdn.signAssetUrl` signs a URL for a `resource` instead of taking `original`: the API returns the URL ending in that resource, and only a URL signed for `original` serves the exact uploaded file; any other, or one without a resource, serves every other resource beneath its grant. Lenses, transforms and viewer claims are still appended by the SDK. The asset component, the viewers and `getAssetInfo` accept a resource URL beneath an asset URL, such as a URL signed for `original`. Go's resource constants are now a `CDNResource` type, and Java's `setResource` takes a `CdnResource` enum.
