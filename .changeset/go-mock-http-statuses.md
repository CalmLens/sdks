---
"@calmlens/sdk-go": patch
---

The `calmlenstest` mock answers with the HTTP statuses the API sends: `201 Created` for `Folders.Create` and `202 Accepted` for `Assets.Batch` (it answered `200` for both).
