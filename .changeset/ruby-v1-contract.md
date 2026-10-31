---
"@calmlens/sdk-ruby": major
---

Follows the CalmLens API v1 contract:

- `assets.list` and `assets.each` request `GET /v1/projects/{project_id}/assets`.
- Sort directions in `ordering` are lowercase: `'asc'` and `'desc'`.
- API errors no longer carry `traceId` in `details`. `request_id` comes from the `X-Request-Id` header, or from the error body's `requestId`. `details` is the body's object as sent.
- `CalmLens::ErrorCodes` includes the validation codes and the new route, internal, authentication, search, transform, remote URL, copyright and permission codes.
- Webhook bodies and `CalmLens.to_webhook_event_payload` use the same flat shape as `events.list` items: `{ id, projectId, type, severity, title, description, assetId, asset, facts, createdAt }`, without a `data` envelope.
- `CalmLens::WebhookEvent` has the members `id`, `project_id`, `type`, `severity`, `title`, `description`, `asset_id`, `asset`, `facts`, `created_at` and `payload` (the body as received). `data` and `fields` are removed.
- Listed events no longer include `userId`, `notify`, `updatedAt` or `readAt`; `description`, `assetId` and `asset` are nil when absent.
- Assets no longer include `userId` or `content.safetyTest`.
- `folders.list` no longer takes `search_all`, `ids` or `resolve_only`, and returns 50 folders by default.
- `MockServerClient` follows the same contract: error bodies carry `requestId` and a `details` object, unknown routes answer `misc/route-not-found`, invalid `ordering` entries answer `validation/invalid-value`, and every cursor list defaults to 50 items.
