---
"@calmlens/sdk-python": minor
---

Keep a project's configuration in code: `client.upload_presets` lists, iterates, ensures by key and deletes upload presets, which now carry a `key` and `revision`; `client.project_settings` reads and replaces the project's settings; and `client.metadata_fields` lists, ensures by ID and deletes its metadata fields. Send the `revision` you read to refuse a change made since. `MockCalmLensServerClient` serves all of them.
