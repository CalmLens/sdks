---

"@calmlens/sdk-python": patch
"@calmlens/sdk-ruby": patch
"@calmlens/sdk-php": patch
"@calmlens/sdk-go": patch
"@calmlens/sdk-rust": patch
"@calmlens/sdk-java": patch
---

CDN URLs write viewer claims as `region` then `ageConfirmed`, whatever order you pass them in, so every SDK builds the same URL for the same claims. A placeholder's error message now says only what it rejects: a lens or a transform.
