---
"@calmlens/sdk": patch
---

Add the `upload/rate-limit-reached` error code (429): an organisation past its upload rate, 100 uploads every 10 seconds unless raised, is refused with `Retry-After`. Websites count towards that rate like any other upload, so the project setting `websiteSubmissionsPerMinute` and the error code `upload/website-rate-limit-reached` are removed.
