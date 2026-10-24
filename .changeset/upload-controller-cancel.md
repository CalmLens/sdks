---
"@calmlens/sdk": minor
---

The upload controller, `useCalmLensUpload` and the Vue `useCalmLensUpload` have `cancel(key)`: it stops a queued or running file and keeps it in the list as failed with `sdk/cancelled`, so `retry` can upload it again. `remove` still drops the file.
