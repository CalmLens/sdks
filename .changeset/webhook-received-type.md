---
"@calmlens/sdk": patch
---

`parseWebhookEvent` returns a typed event: `data.asset` is the asset snapshot CalmLens sends, so `externalId` and `classification` no longer need casting, and `createdAt` is always a number. A signed body without a numeric `createdAt` is refused with `sdk/invalid-webhook-payload`, like any other body that isn't a CalmLens event.
