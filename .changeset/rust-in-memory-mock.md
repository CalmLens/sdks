---
"@calmlens/sdk-rust": minor
---

`MockServerClient::in_memory` adds an in-memory API to the Rust mock, matching the other SDKs' testing support. Uploads create stored assets with a chosen `MockOutcome` (`queued_outcome` for `create`, `analyzed_outcome` for `classify`), and assets, folders, search, lenses, the events feed and CDN downloads behave like the API, including its error codes, idempotent replays and download permissions (`create_mock_api_key`). `decide` applies a reviewer decision and adds the matching `asset.<status>` event, and `enqueue_event` adds events to the feed. Queued responses are still used first.
