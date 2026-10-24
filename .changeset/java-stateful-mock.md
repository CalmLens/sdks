---
"@calmlens/sdk-java": minor
---

`MockCalmLensServerClient` now answers from an in-memory API, like the other SDKs' mock clients. Uploads create assets you can retrieve, list, search, update, move and delete, and the CDN serves their stored bytes. `Options` sets the outcome of queued and analyzed uploads (`pending`, `allowed`, `age-restricted`, `blocked`, `purged` or `failed`) and makes IDs and timestamps deterministic. `decide(assetId, outcome)` applies a reviewer decision and adds the matching event, `enqueueEvent` adds events to the feed, and `createMockApiKey` creates keys with the download grant for private and age-restricted CDN reads. Queued responses still take precedence.
