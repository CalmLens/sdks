---
"@calmlens/sdk-go": minor
---

Manage a project's configuration as data. `UploadPresets` lists presets (`List`, `ListAll`), creates or replaces them by key (`Ensure`) and deletes them (`Delete`); `ProjectSettings` reads and replaces the project's settings (`Get`, `Update`); and `MetadataFields` lists, creates or replaces and deletes its metadata fields (`List`, `Ensure`, `Delete`). Each change can send the `Revision` you read, so one made since is refused, and unchanged configuration keeps its revision. `UploadPreset` has `Key` and `Revision`, and the `calmlenstest` mock serves all of these.
