---
"@calmlens/sdk-go": minor
---

A `calmlenstest` mock built without a `ProjectID` uses `project-1`, available as `calmlenstest.DefaultProjectID`. `CapturedRequest.Status` is now an `*int`, `nil` for a request that failed without a response.
