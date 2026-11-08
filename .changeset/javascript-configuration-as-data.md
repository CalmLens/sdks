---
"@calmlens/sdk": minor
---

Manage a project's configuration in code. `uploadPresets.list`, `iterate`, `ensure` and `delete` read upload presets and create or replace them by key; `projectSettings.get` and `update` read and replace the project's settings; `metadataFields.list`, `ensure` and `delete` manage its metadata fields. Each change can send the `revision` you read, so a change made since is refused instead of overwritten, and the mock client serves all of them. The `calmlens` CLI adds `calmlens plan` and `calmlens apply`, which compare a `calmlens.config.json` file listing the project's policies, upload presets, lenses, metadata fields and settings with the project and make the differences; `--prune` also deletes presets, lenses and metadata fields the file doesn't list.
