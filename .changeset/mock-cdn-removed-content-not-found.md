---
"@calmlens/sdk": patch
"@calmlens/sdk-python": patch
"@calmlens/sdk-ruby": patch
"@calmlens/sdk-rust": patch
"@calmlens/sdk-java": patch
"@calmlens/sdk-go": patch
"@calmlens/sdk-php": patch
---

The mock CDN answers every resource of an asset whose content was removed, its placeholder
included, with `404` `asset/not-found`, as it answers an unknown asset, as the CDN now does. Its
display info still reports the asset as unavailable.
