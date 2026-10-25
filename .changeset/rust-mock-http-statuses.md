---
"@calmlens/sdk-rust": minor
---

The in-memory `MockServerClient` answers with the HTTP statuses the API sends: `201 Created` for `folders().create` and `202 Accepted` for `assets().batch` (it answered `200` for both). Captured requests now carry `response_status`, the status the mock answered with (`None` when the request failed without a response).
