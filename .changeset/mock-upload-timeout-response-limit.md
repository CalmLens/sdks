---
"@calmlens/sdk-python": patch
"@calmlens/sdk-go": patch
"@calmlens/sdk-php": patch
"@calmlens/sdk-rust": patch
---

The mock clients accept the real client's upload timeout and response size limit: `upload_timeout` and `max_response_bytes` on Python's `MockCalmLensServerClient`, `UploadTimeout` and `MaxResponseBytes` on Go's `calmlenstest.Options`, `uploadTimeout` and `maxResponseBytes` on PHP's `MockServerClient`, and `MockOptions::upload_timeout` and `MockOptions::max_response_bytes` in Rust. They are validated like the real client's, and the size limit applies to the mock's answers.
