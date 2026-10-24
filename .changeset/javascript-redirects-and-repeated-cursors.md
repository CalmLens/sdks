---
"@calmlens/sdk": minor
---

A redirect response now fails with `sdk/http-error` and the redirect's HTTP status (and request ID), instead of `sdk/transport-error`. It is not retried, and the redirect is still never followed. `assets.iterate`, `assets.iterateChildren` and `events.pages` now fail with `sdk/invalid-response` (with the cursor in `details.cursor`) when a page that says more pages follow returns a cursor the iteration has already used, instead of repeating pages or stopping without notice.
