---
"@calmlens/sdk-php": minor
---

Manage a project's configuration from code: `uploadPresets` (`list`, `each`, `ensure` and `delete`) creates or replaces upload presets by key, `projectSettings` (`get` and `update`) reads and replaces the project's settings, and `metadataFields` (`list`, `ensure` and `delete`) manages its metadata field definitions, each guarded by a `revision` that refuses a change made since you read it. `ErrorCodes` adds the codes these calls return, and `MockServerClient` serves all of them.
