---
"@calmlens/sdk-go": minor
---

The `calmlenstest` mock's `CDN.Serve` now answers like the CDN: blocked, purged and failed assets, and assets whose content was removed, return `403` with `asset/not-available` whatever the key, before any permission check. `Decide(assetID, decision)` applies a reviewer's decision and adds the matching `asset.<decision>` event with a `decided-by: reviewer` fact. Waits take no real time: retry backoff and `Assets.WaitForDecision` only advance the mock client's clock, so a pending asset returns `sdk/timeout` straight away.
