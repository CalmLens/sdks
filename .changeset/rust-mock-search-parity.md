---
"@calmlens/sdk-rust": patch
---

The in-memory `MockServerClient` keyword search matches every word of the query in any searchable field (now including type, content format and extension, and moderation status) and returns the API's keyword scores, matched fields and ranking. Mock list filters accept parentheses, with `;` binding tighter than `,`. The default mock clock gives assets created in a row increasing `created_at`, so lists, cursors and search order them predictably.
