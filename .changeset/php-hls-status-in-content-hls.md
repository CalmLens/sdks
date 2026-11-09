---
"@calmlens/sdk-php": minor
---

`content['hls']` now has `status`, `reason` and `renditions`: it says whether a requested adaptive stream is `preparing` or `ready`, or `unavailable` with a reason (`allowance-used`, `billing-required`, `spend-limit`, `processing-failed` or `content-not-kept`), and lists its renditions once ready. Check `status` rather than whether `hls` is `null`. The offline mock prepares no stream, so it reports `null`. This replaces the separate HLS status field added in 0.22.0.
