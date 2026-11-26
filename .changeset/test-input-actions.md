---
"@calmlens/sdk": patch
"@calmlens/sdk-go": patch
"@calmlens/sdk-java": patch
"@calmlens/sdk-php": patch
"@calmlens/sdk-python": patch
"@calmlens/sdk-ruby": patch
"@calmlens/sdk-rust": patch
---

Test input instances no longer take an `allow` action: an explicit action is `limit`, `age-restrict` or `block`, so a test input can set a stricter outcome but never mark content as allowed. Leave `action` off every instance to have your policy decide.
