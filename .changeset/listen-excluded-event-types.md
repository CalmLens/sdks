---
"@calmlens/sdk": minor
---

`events.list` returns `excludedTypes`, the event types the API key lacks the permission to receive. `calmlens listen` warns about them when it starts, instead of printing "Event types: all" and leaving them out silently.
