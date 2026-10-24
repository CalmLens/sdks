---
"@calmlens/sdk-java": minor
---

`MockCalmLensServerClient`'s CDN now answers like the real one: blocked, purged and failed assets, and assets whose content was removed or is still uploading, return `403` with `asset/not-available` whatever the key, before any permission check. Missing or removed content previously returned `404` with `asset/content-unavailable`. `decide` gives its event the event catalog's severity: `low` for `allowed`, `high` otherwise.
