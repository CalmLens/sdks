---
"@calmlens/sdk": patch
"@calmlens/sdk-python": patch
"@calmlens/sdk-go": patch
"@calmlens/sdk-rust": patch
"@calmlens/sdk-ruby": patch
"@calmlens/sdk-java": patch
---

Mock decisions can supply OCR and link findings for an image, as PHP's already could: the mock reports the text regions, QR codes and links when the upload turns those features on, and the OCR text as `content.extractedText` when the upload keeps its content. Ruby responses also support `fetch`, with Hash semantics.
