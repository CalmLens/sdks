---
"@calmlens/sdk-php": major
---

Follows the CalmLens API v1 contract:

- `assets->list` and `assets->each` request `GET /v1/projects/{projectId}/assets`.
- Sort directions in `ordering` are lowercase: `asc` and `desc`.
- API errors no longer carry `traceId` in `details`. `requestId` comes from the `X-Request-Id` header, or from the error body's `requestId`. `details` is the body's object as sent.
- `ErrorCodes` includes the validation codes and the new route, internal, authentication, search, transform, remote URL, copyright and permission codes.
- Webhook bodies and `Webhooks::toPayload` use the same flat shape as `events->list` items: `id`, `projectId`, `type`, `severity`, `title`, `description`, `assetId`, `asset`, `facts` and `createdAt`, without a `data` envelope. `Webhooks::parseEvent` and `Webhooks::isTest` read that shape.
- Listed events no longer include `userId`, `notify`, `updatedAt` or `readAt`; `description`, `assetId` and `asset` are `null` when absent.
- Assets no longer include `userId` or `content.safetyTest`. The person, face and AI-generated detection results are not part of the asset while those features are off.
- `folders->list` no longer takes `searchAll`, `ids` or `resolveOnly`, and returns 50 folders by default.
- `MockServerClient` follows the same contract: error bodies carry `requestId` and a `details` object, and every cursor list defaults to 50 items.
