---
"@calmlens/sdk-rust": minor
---

Declare a project's configuration in code. `upload_presets()` lists, iterates and deletes upload presets, and `ensure` creates or replaces them by key; `project_settings()` gets and replaces the project's settings; `metadata_fields()` lists its metadata fields, `ensure` creates or replaces them by ID, and `delete` removes one. Send the `revision` you read to refuse a change made since. The blocking client offers the same methods, and `MockServerClient::in_memory` serves them.
