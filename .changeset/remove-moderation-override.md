---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

Uploads no longer take `processingOptions.flaggedContentPolicy`: the project's moderation policy decides every asset, with its allowances and restrictions. The typed processing options drop it (Go, Java, Python, Ruby and Rust remove the `FlaggedContentPolicy` type), and `classification.moderation.source` no longer reports `asset-override` (Go drops `DecisionSourceAssetOverride`). JavaScript exports the policy action type as `PolicyAction` instead of `FlaggedContentAction`.
