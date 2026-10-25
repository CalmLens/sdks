---
"@calmlens/sdk-php": patch
---

The `MockServerClient` in-memory API answers with the HTTP statuses the API sends: `201 Created` for `folders->create`, and `200` with an empty JSON object for asset and folder deletes (it answered `200` for creates and `204 No Content` for deletes).
