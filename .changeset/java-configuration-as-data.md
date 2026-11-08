---
"@calmlens/sdk-java": minor
---

Keep a project's configuration in code: `client.uploadPresets` lists, iterates, ensures by key and deletes upload presets, which have a `key` and `revision`; `client.projectSettings` reads and replaces the project's settings; and `client.metadataFields` lists, ensures by ID and deletes its metadata fields. Send the `revision` you read to refuse a change made since. `ErrorCodes` adds the codes these calls return, and `MockCalmLensServerClient` serves all of them.
