---
"@calmlens/sdk-java": patch
---

The `MockCalmLensServerClient` in-memory API answers with the HTTP statuses the API sends: `201 Created` for `folders.create`, `202 Accepted` for `assets.batch`, and `200` with an empty JSON object for asset and folder deletes (it answered `200` for creates and the batch, and `204 No Content` for deletes).
