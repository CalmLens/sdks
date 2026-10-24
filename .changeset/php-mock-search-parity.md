---
"@calmlens/sdk-php": patch
---

`MockServerClient` runs the API's keyword search: `assets->search` matches every word of the query in any searchable field and returns the API's scores, matched fields and ranking. Mock list filters accept parentheses, with `;` binding tighter than `,`, and list cursors resume after the last item returned, so assets created or deleted between pages are neither repeated nor skipped. The default mock clock gives assets created in a row increasing `createdAt`.
