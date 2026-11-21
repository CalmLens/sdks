---
"@calmlens/sdk": patch
"@calmlens/sdk-go": patch
"@calmlens/sdk-python": patch
"@calmlens/sdk-ruby": patch
"@calmlens/sdk-java": patch
"@calmlens/sdk-php": patch
"@calmlens/sdk-rust": patch
---

Add the `website-unavailable` failure reason: a website that refuses its page with an HTTP error, or shows a bot check instead of its content, fails with it rather than `processing-error`. Retry it once the page is reachable.
