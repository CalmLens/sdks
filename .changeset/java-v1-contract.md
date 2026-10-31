---
"@calmlens/sdk-java": major
---

Follows the CalmLens API v1 contract:

- `assets.list` and `assets.iterate` request `GET /v1/projects/{projectId}/assets`.
- Sort directions in `Order` are lowercase: `"asc"` and `"desc"`.
- `ApiException.getTraceId()` is removed and `getDetails()` no longer carries `traceId`. `getRequestId()` is the `X-Request-Id` header, or the error body's `requestId`.
- `ErrorCodes` includes the validation codes (`INVALID_TYPE`, `TOO_SMALL`, `TOO_BIG`, `INVALID_FORMAT`, `INVALID_VALUE`, `UNKNOWN_FIELD`, `UNSUPPORTED_CONTENT_TYPE`, `INVALID_FILTER`, `INVALID_ORDERING_FIELD`) and `ROUTE_NOT_FOUND`, `INTERNAL_ERROR`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_TOKEN`, `SEARCH_UNAVAILABLE`, `INVALID_TRANSFORM`, `INVALID_TRANSFORM_OPTIONS`, `REMOTE_URL_REDIRECT_LIMIT`, `COPYRIGHT_CONTENT_HELD` and `DOWNLOAD_PERMISSION_REQUIRED`.
- Webhook bodies use the same flat shape as `events.list` items. `WebhookEventPayload` has `id`, `projectId`, `type`, `severity`, `title`, `description`, `assetId`, `asset`, `facts` and `createdAt`; `data()` and `WebhookEventData` are removed. `parseWebhookEvent`, `isTestWebhookEvent` and `toWebhookEventPayload` read and write that shape.
- `Event` no longer has `userId`, `notifies`, `updatedAt` or `readAt`, and its components follow the API's field order.
- `Asset` no longer has `userId`, and `AssetContent` no longer has `safetyTest`.
- `ListFolders` no longer takes `searchAll`, `ids` or `resolveOnly`; `folders.list` returns 50 folders by default.
- `MockCalmLensServerClient` follows the same contract: error bodies are `{ code, message, requestId, details }`, and every cursor list defaults to 50 items.
