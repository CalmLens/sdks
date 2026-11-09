---
"@calmlens/sdk-go": minor
---

`Content.HLS` now has `Status`, `Reason` and `Renditions`: it says whether a requested adaptive stream is `preparing` or `ready`, or `unavailable` with a reason (`allowance-used`, `billing-required`, `spend-limit`, `processing-failed` or `content-not-kept`), and lists its renditions once ready. Check `Status` rather than whether `HLS` is nil. The offline mock prepares no stream, so it reports `null`. This replaces the separate HLS status field added in 0.22.0.
