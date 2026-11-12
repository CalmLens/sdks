---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": patch
---

Align text classification options across languages: `visibility` is available in every SDK,
and Python declares upload and text `tags`. Python's asset-ID option types now require `assetId`,
matching the existing runtime requirement. Ruby declares the existing `link_checking_enabled`
project setting. Rust's `search_indexing_budget_units` now accepts `f64`, matching the API's
numeric budget; change integer literals assigned to it to floating-point literals.
