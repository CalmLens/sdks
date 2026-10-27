---
"@calmlens/sdk-php": minor
---

`MockServerClient`'s CDN now answers like the real one: blocked, purged and failed assets, and assets whose content was removed or is still uploading, return `403` with `asset/not-available` whatever the key, before any permission check. The default key has no grants, like a real key without `assets:download`, so private assets and public age-restricted ones requested without `ageConfirmed` return `403` with `asset/api-key-missing-permission`; pass `apiKey: MockServerClient::createApiKey($grants)` with an `assets:download` grant to read them. The `downloadPermission` option is removed. `decide` gives its event the event catalog's severity: `low` for `allowed`, `high` otherwise.
