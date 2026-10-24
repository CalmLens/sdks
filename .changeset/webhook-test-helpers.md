---
"@calmlens/sdk-go": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
---

New helpers build signed webhook deliveries for testing a webhook handler, as the JavaScript, Python and PHP SDKs already do. `CreateWebhookHeaders` (Go), `create_webhook_headers` (Rust), `CalmLens.create_webhook_headers` (Ruby) and `CalmLensServerClient.createWebhookHeaders` (Java) return the `content-type`, `x-calmlens-delivery`, `x-calmlens-timestamp` and `x-calmlens-signature` headers for a body. Ruby's `CalmLens.to_webhook_event_payload` and Java's `CalmLensServerClient.toWebhookEventPayload` convert an event from `events.list` to its delivery body.
