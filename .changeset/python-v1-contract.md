---
"@calmlens/sdk-python": major
---

Follows the CalmLens API v1 contract:

- `assets.list` and `assets.iter` request `GET /v1/projects/{projectId}/assets`.
- Sort directions in `ordering` are lowercase: `"asc"` and `"desc"`.
- API errors no longer carry `traceId` in `details`. `request_id` comes from the `X-Request-Id` header, or from the error body's `requestId`. `details` is the body's object as sent.
- `calmlens.error_codes` includes the validation codes and the new route, internal, authentication, search, transform, remote URL, copyright and permission codes.
- Webhook bodies, `parse_webhook_event` and `to_webhook_event_payload` use the same flat shape as `events.list` items: `{id, projectId, type, severity, title, description, assetId, asset, facts, createdAt}`, without a `data` envelope. `is_test_webhook_event` reads that shape. `WebhookEventData` is removed.
- Listed events no longer include `userId`, `notify`, `updatedAt` or `readAt`; `description`, `assetId` and `asset` are `None` when absent.
- `Asset` no longer includes `userId` or `content.safetyTest`.
- `folders.list` no longer takes `search_all`, `ids` or `resolve_only`, and returns 50 folders by default.
- The testing mock follows the same contract: error bodies carry `requestId` and `details`, unknown routes answer `misc/route-not-found`, and every cursor list defaults to 50 items.
