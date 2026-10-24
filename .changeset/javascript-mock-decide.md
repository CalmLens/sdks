---
"@calmlens/sdk": minor
---

`MockCalmLensServerClient` now answers CDN requests like the CDN: blocked, purged and failed assets, and assets whose content was removed, return `403` with `asset/not-available` whatever the key, before any permission check. `decide(assetId, decision)` applies a reviewer's decision (`allowed`, `age-restricted`, `blocked` or `purged`) and adds the matching `asset.<decision>` event with a `decided-by: reviewer` fact. `assets.waitForDecision` takes no real time: an asset that stays pending fails with `sdk/timeout` straight away.
