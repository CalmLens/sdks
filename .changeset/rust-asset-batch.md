---
"@calmlens/sdk-rust": minor
---

Add `client.assets().batch(BatchAssets { asset_ids, operation })`, which deletes up to 500 assets (`AssetBatchOperation::Delete`) or removes their stored content (`AssetBatchOperation::RemoveContent`) in one request and returns a `BatchAssetsResponse` with `queued`, in the async and blocking clients. It sends `POST /projects/:projectId/assets/batch`. Every asset must exist in the project and the API key needs `assets:delete` for its folder, or the request fails (`asset/not-found`, `auth/permission-denied`) and nothing is queued; once queued, the work runs in the background and records `asset.deleted` or `asset.content-removed` for each asset. The method refuses an empty list, more than 500 IDs or an empty ID with `sdk/invalid-argument` before sending, and is not retried. The new `auth/permission-denied` error code is available as a constant. The in-memory mock validates the batch like the API and applies it at once.
