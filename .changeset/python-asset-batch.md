---
"@calmlens/sdk-python": minor
---

Add `client.assets.batch(asset_ids=..., operation=...)`, which deletes up to 500 assets (`"delete"`) or removes their stored content (`"remove-content"`) in one request and returns `{"queued": True}`. It sends `POST /projects/:projectId/assets/batch`. Every asset must exist in the project and the API key needs `assets:delete` for its folder, or the request fails (`asset/not-found`, `auth/permission-denied`) and nothing is queued; once queued, the work runs in the background and records `asset.deleted` or `asset.content-removed` for each asset. The method refuses an empty list, more than 500 IDs, an empty ID or an unknown operation with `sdk/invalid-argument` before sending, and is not retried. The new `auth/permission-denied` error code is available as a constant. The `AssetBatchOperation`, `BatchAssetsOptions` and `BatchAssetsResponse` types are exported. The mock client validates the batch like the API and applies it at once.
