---
"@calmlens/sdk-go": patch
---

The `calmlenstest` mock's `Assets.Search` now works like the API's keyword search: every query word (case-insensitive, up to 8) must appear in the name, ID, external ID, description, tags, type, content format or extension, or moderation status, and results are ranked by the API's score, then newest first. List cursors resume after the last returned asset, so assets created or deleted between pages don't shift later pages. The default mock clock advances at least 1 ms per reading, so assets created in a row have increasing `createdAt` values; a `Now` you supply is used as is.
