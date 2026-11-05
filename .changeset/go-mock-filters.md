---
"@calmlens/sdk-go": minor
---

The `calmlenstest` mock filters assets like the API: only the documented asset fields and the `==`, `!=`, `>`, `>=`, `<`, `<=`, `=in=` and `=out=` operators, with any other field or operator, such as `=like=` or `=gt=`, refused with `validation/invalid-filter` (HTTP 400). `*` wildcards ignore case, a number field needs a number, and a comparison never matches a missing value. Ordering by a field other than `createdAt` or `id` is refused with `validation/invalid-value`.
