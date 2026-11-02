---
"@calmlens/sdk-rust": minor
---

`MockOptions::moderate` replaces the queued and analyzed outcome options of `MockServerClient::in_memory`: your callback receives each stored asset with its uploaded bytes and text, why it is being moderated and whether CalmLens would queue the work, and returns a `MockOutcome` or a `MockDecision` built with `MockDecision::new(status).flag(category, score, qualifiers)?` and `not_evaluated(category)?`, so decided assets carry a complete report. `complete_processing(asset_id, decision)` finishes a pending asset as CalmLens would, uploads add `asset.uploaded`, `asset.classified` and the automated decision (or `asset.failed`) to the events feed, `fail_next_request` takes `MockFailureOptions` with the failure's operation, error details and `Retry-After`, recorded request paths are relative to the base URL (such as `/projects/project-1/assets`), and `clear_requests()` forgets the requests recorded so far.
