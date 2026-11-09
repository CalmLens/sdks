---
"@calmlens/sdk-java": minor
---

`AssetContent.hls()` now has `status()`, `reason()` and `renditions()`: it says whether a requested adaptive stream is `preparing` or `ready`, or `unavailable` with a reason (`allowance-used`, `billing-required`, `spend-limit`, `processing-failed` or `content-not-kept`), and lists its renditions once ready. Check `status()` rather than whether `hls()` is null. The offline mock prepares no stream, so it reports `null`. Adds the `ErrorCodes.MEDIA_DURATION_LIMIT` error code: audio or video whose file states it is over the duration limit is refused at upload, with `details.durationSeconds` and `details.limitSeconds`.
