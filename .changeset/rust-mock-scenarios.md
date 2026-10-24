---
"@calmlens/sdk-rust": minor
---

`MockServerClient` waits take no real time: retry backoff and `assets().wait_for_decision` advance a virtual clock, read with `mock.elapsed()`, so a pending asset fails with `sdk/timeout` at once. The in-memory CDN now answers like the real one: blocked, purged and failed assets, and assets whose content was removed or is still uploading, return `403` with `asset/not-available` whatever the key, before any permission check (missing content previously returned `404`). `decide` gives its event the event catalog's severity: `low` for `allowed`, `high` otherwise. `MockOptions::api_base_url` and `MockOptions::cdn_base_url` set the URLs the mock answers.
