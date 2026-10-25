---
"@calmlens/sdk-java": minor
---

Add `client.assets.batch(new BatchAssets().assetIds(...).operation(...))`, which deletes up to 500 assets (`AssetBatchOperation.DELETE`) or removes their stored content (`AssetBatchOperation.REMOVE_CONTENT`) in one request and returns a `BatchAssetsResponse` with `queued()`. It sends `POST /projects/:projectId/assets/batch`. Every asset must exist in the project and the API key needs `assets:delete` for its folder, or the request fails (`asset/not-found`, `auth/permission-denied`) and nothing is queued; once queued, the work runs in the background and records `asset.deleted` or `asset.content-removed` for each asset. The method refuses an empty list, more than 500 IDs, an empty ID or a missing operation with `sdk/invalid-argument` before sending, and is not retried. The new `auth/permission-denied` error code is available as a constant. The mock client validates the batch like the API and applies it at once.
