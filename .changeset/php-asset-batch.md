---
"@calmlens/sdk-php": minor
---

Add `$client->assets->batch(['assetIds' => [...], 'operation' => ...])`, which deletes up to 500 assets (`Assets::BATCH_DELETE`) or removes their stored content (`Assets::BATCH_REMOVE_CONTENT`) in one request and returns `['queued' => true]`. It sends `POST /projects/:projectId/assets/batch`. Every asset must exist in the project and the API key needs `assets:delete` for its folder, or the request fails (`asset/not-found`, `auth/permission-denied`) and nothing is queued; once queued, the work runs in the background and records `asset.deleted` or `asset.content-removed` for each asset. The method refuses an empty list, more than 500 IDs, an empty ID or an unknown operation with `sdk/invalid-argument` before sending, and is not retried. The new `auth/permission-denied` error code is available as a constant. `MockServerClient` validates the batch like the API and applies it at once.
