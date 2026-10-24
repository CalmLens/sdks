---
"@calmlens/sdk-ruby": minor
---

`CalmLens::MockServerClient` takes an `api_key:` from `MockServerClient.create_api_key(grants)`. Its CDN now answers like the real one, with JSON error bodies: blocked, purged and failed assets, and assets whose content was removed, return `403` with `asset/not-available`, and a private asset, or a public age-restricted one requested without `allow_age_restricted: true`, returns `403` with `asset/api-key-missing-permission` unless the key has an `assets:download` grant. The default key has no grants, so pass a key with one to read private content. `decide(asset_id, decision)` applies a reviewer's decision and adds the matching `asset.<decision>` event, and `assets.wait_for_decision` takes no real time.
