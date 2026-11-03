---
"@calmlens/sdk": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

The events list response includes `excludedTypes` in every SDK: the event types the API key lacks the permission to receive (`ExcludedTypes` in Go, `excluded_types` in Rust, `excludedTypes()` in Java). Each SDK's offline mock returns an empty list, because its key holds every permission.

`CalmLensServerClient` and `CalmLensAppClient` in the JavaScript SDK refuse an option a method doesn't take, such as a misspelt `externalId`, with `sdk/invalid-argument` naming the key before sending anything, as the Ruby, PHP and Python SDKs do. The app client also refuses options its upload preset sets, such as `folderId`.
