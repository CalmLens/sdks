---
"@calmlens/sdk": patch
"@calmlens/sdk-python": patch
"@calmlens/sdk-go": patch
"@calmlens/sdk-rust": patch
"@calmlens/sdk-ruby": patch
"@calmlens/sdk-java": patch
"@calmlens/sdk-php": patch
---

Creating a signed URL now fails with `sdk/invalid-argument` before sending anything when the API would reject it: a resource other than `original` or `rendered` (a placeholder needs no signed URL), a lens or transform on the `original` resource, or a lifetime that is not a whole number of seconds from 1 to 86400 (24 hours). The longest lifetime is available as `MAX_SIGNED_URL_SECONDS` in Rust and Java, `MaxSignedURLSeconds` in Go, `CalmLens::Assets::MAX_SIGNED_URL_SECONDS` in Ruby and `CalmLens\Assets::MAX_SIGNED_URL_SECONDS` in PHP.
