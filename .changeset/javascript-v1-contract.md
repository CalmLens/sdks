---
"@calmlens/sdk": major
---

Follows the CalmLens API v1 contract:

- `assets.list` and `assets.iterate` request `GET /v1/projects/{projectId}/assets`.
- `ensureLens` sends its definition through `PUT /v1/projects/{projectId}/lenses`, the request `ensureLenses` uses.
- Sort directions in `ordering` are lowercase: `"asc"` and `"desc"`.
- API errors no longer carry `traceId` in `details`. `requestId` comes from the `X-Request-Id` header, or from the error body's `requestId`. `details` is the body's object as sent.
- `API_ERROR_CODES` includes the validation codes and the new route, internal, authentication, search, transform, remote URL, copyright and permission codes.
- Webhook bodies and `toWebhookEventPayload` use the same flat shape as `events.list` items: `{ id, projectId, type, severity, title, description, assetId, asset, facts, createdAt }`, without a `data` envelope. `parseWebhookEvent` and `isTestWebhookEvent` read that shape.
- Listed events no longer include `userId`, `notify`, `updatedAt` or `readAt`; `description`, `assetId` and `asset` are `null` when absent.
- `Asset` no longer includes `userId` or `content.safetyTest`. The person, face and AI-generated detection results are not part of the asset while those features are off.
- `folders.list` no longer takes `searchAll`, `ids` or `resolveOnly`, and returns 50 folders by default.
- The testing mocks follow the same contract, and every cursor list in them defaults to 50 items.
