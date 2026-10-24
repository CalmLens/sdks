---
"@calmlens/sdk": minor
---

`isTestWebhookEvent(event)` from `@calmlens/sdk/server` tells a test send from the portal or the CLI apart from a real event. `parseWebhookEvent` now also refuses a body whose known `data` fields have the wrong types, such as `facts` that is not a list of `{ key, value }` facts, with `sdk/invalid-webhook-payload`. `@calmlens/sdk/testing` exports `signUploadToken(apiKey, options, { now, nonce })`, which signs an upload token with a fixed clock and nonce for comparing with known tokens in tests.
