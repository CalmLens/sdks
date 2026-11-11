---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-php": minor
---

Enable optional paid link checks with `linkCheckingEnabled` in project settings (`link_checking_enabled` in Rust, `LinkCheckingEnabled` in Go). The setting defaults to false. Each distinct URL is billed once per asset content revision, including redirects and browser fallback; internal retries do not add charges.
