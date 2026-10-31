---
"@calmlens/sdk-rust": major
---

Follows the CalmLens API v1 contract:

- `assets().list` and `assets().iterate` request `GET /v1/projects/{projectId}/assets`.
- `SortDirection::Asc` and `SortDirection::Desc` are sent and read as `asc` and `desc`.
- API errors no longer copy `traceId` into `details()`. `request_id()` is the `X-Request-Id` header, or the error body's `requestId` when the header is missing.
- `ErrorCode` includes the validation codes and the new route, internal, authentication, search, transform, remote URL, copyright and permission codes.
- `WebhookEventPayload` has the same flat shape as an `Event` from `events().list`: `severity`, `title`, `description`, `asset_id`, `asset` and `facts` are top-level fields, and `WebhookEventData` is removed. `parse_webhook_event`, `construct_webhook_event` and `WebhookEventPayload::from_event` read and write that shape.
- `Event` no longer has `user_id`, `notify`, `updated_at` or `read_at`.
- `Asset` no longer has `user_id`, and `AssetContent` no longer has `safety_test`.
- `ListFolders` no longer has `search_all`, `ids` or `resolve_only`, and folders list 50 to a page by default.
- The testing mocks follow the same contract: error bodies carry `requestId`, and every cursor list defaults to 50 items.
