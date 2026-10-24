---
"@calmlens/sdk-python": minor
---

`MockCalmLensServerClient.cdn.serve` now answers like the CDN: blocked, purged and failed assets, and assets whose content was removed, return `403` with `asset/not-available` whatever the key, before any permission check. `decide(asset_id, decision)` applies a reviewer's decision (`allowed`, `age-restricted`, `blocked` or `purged`) and adds the matching `asset.<decision>` event with a `decided-by: reviewer` fact.
