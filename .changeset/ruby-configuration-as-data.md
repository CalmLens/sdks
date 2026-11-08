---
"@calmlens/sdk-ruby": minor
---

Manage a project's configuration as data: `upload_presets` lists and iterates upload presets, creates or replaces them by key with `ensure` and removes them with `delete`; `project_settings` reads and replaces the project's settings with `get` and `update`; and `metadata_fields` lists, creates or replaces by ID, and deletes metadata fields. Send the `revision` you read to refuse a change made since. `MockServerClient` serves all of them.
