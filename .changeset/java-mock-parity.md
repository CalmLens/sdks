---
"@calmlens/sdk-java": minor
---

`MockCalmLensServerClient.Options` has a `projectId` option for a mock built without a client builder, which uses `project-1` (`MockCalmLensServerClient.MOCK_PROJECT_ID`) by default. A builder sets its own project ID, so setting the option alongside one throws `sdk/invalid-argument`.
