---
"@calmlens/sdk-java": minor
---

`MockCalmLensServerClient` filters `tags` like the API: only `=in=`, an asset with any of the tags, and `=out=`, an asset with none of them, including one without tags. Any other operator on `tags`, such as `tags==homepage`, is refused with `validation/invalid-filter` (HTTP 400).
