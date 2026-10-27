---
"@calmlens/sdk": patch
"@calmlens/sdk-python": patch
"@calmlens/sdk-go": patch
"@calmlens/sdk-rust": patch
"@calmlens/sdk-ruby": patch
"@calmlens/sdk-java": patch
"@calmlens/sdk-php": patch
---

Event facts' `url` is now a stable link that opens the item in the CalmLens portal, such as `https://calmlens.com/go/asset/<asset-id>`, in webhook payloads and the events feed. The in-memory mocks give asset facts the same links.
