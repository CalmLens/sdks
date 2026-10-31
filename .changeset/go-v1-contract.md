---
"@calmlens/sdk-go": major
---

Follows the CalmLens API v1 contract:

- `Assets.List` and `Assets.ListAll` request `GET /v1/projects/{projectId}/assets`.
- `OrderAscending` and `OrderDescending` are lowercase: `"asc"` and `"desc"`.
- API errors no longer carry `traceId` in `Details`. `RequestID` comes from the `X-Request-Id` header, or from the error body's `requestId`.
- The generated `Code...` constants include the validation codes and the new route, internal, authentication, search, transform, remote URL, copyright and permission codes.
- Webhook bodies use the same flat shape as `Events.List` items: `ParseWebhookEvent` and `VerifyWebhookRequest` return a `*Event`, and `ToWebhookEventPayload` returns an `Event` whose `Raw` is the body. `WebhookEventPayload` and `WebhookEventData` are removed.
- `Event` no longer has `UserID`, `Notify`, `UpdatedAt` or `ReadAt`.
- `Asset` no longer has `UserID`, and `AssetContent` no longer has `SafetyTest`.
- `ListFoldersOptions` no longer has `SearchAll`, `IDs` or `ResolveOnly`, and `Folders.List` returns 50 folders by default.
- The `calmlenstest` mock follows the same contract: its error bodies carry `requestId` and an object `details`, unknown routes fail with `misc/route-not-found`, invalid filters with `validation/invalid-filter`, and every cursor list defaults to 50 items.
