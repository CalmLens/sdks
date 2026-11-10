---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-php": minor
---

Configure retainContent through project settings. Offline mocks retain new uploads by default and resolve upload retention from an explicit upload value, then its preset, then project settings. Existing uploads retain their original choice.

The processing option is now named `retainContent` in JSON and JavaScript, `retain_content` in Python and Ruby, and `RetainContent` in Go. Use the new name in upload options and configuration.
