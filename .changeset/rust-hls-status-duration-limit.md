---
"@calmlens/sdk-rust": minor
---

`AssetContent::hls_status` says whether a requested adaptive stream is `preparing` or `ready`, or `unavailable` with a reason (`allowance-used`, `billing-required`, `spend-limit`, `processing-failed` or `content-not-kept`). The offline mock prepares no stream, so it reports `null`. Adds the `media/duration-limit` error code: audio or video whose file states it is over the duration limit is refused at upload, with `details.durationSeconds` and `details.limitSeconds`.
