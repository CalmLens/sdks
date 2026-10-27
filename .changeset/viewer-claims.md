---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

CDN methods, signed URL creation and media widgets accept optional `viewerClaims` containing `region` and `ageConfirmed`. These replace the separate region and age options. The CDN defaults to the connecting country and no age confirmation, including authenticated requests. Customers determine the assertions; CalmLens applies content restrictions without independently verifying them.

Asset retrieval returns stored moderation results without a request-specific `delivery` object or region parameter. Pass viewer context on the CDN request instead. Raw HTTP supports a JSON query parameter or `X-CalmLens-Viewer-Claims` header. Age-restricted delivery without confirmation returns `viewer/age-confirmation-required`; private access remains a separate requirement.
