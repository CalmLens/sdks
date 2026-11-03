---
"@calmlens/sdk": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

Generate signed test inputs in every SDK: text codes for a scenario, preset or category, and audio and video test phrases, from a project's test input key. Python `calmlens.testing.generate_test_text_code` and `generate_media_test_code`; Go `calmlenstest.GenerateTestTextCode` and `GenerateMediaTestCode`; Rust `calmlens::testing::generate_test_text_code` and `generate_media_test_code`; Ruby `CalmLens::TestInputs.generate_text_code` and `generate_media_code`; Java `TestInputs.generateTestTextCode` and `generateMediaTestCode`; PHP `CalmLens\Testing\TestInputs::generateTestTextCode` and `generateMediaTestCode`. Each SDK produces the same codes as the JavaScript SDK's `calmlens/test-inputs` and rejects invalid scenarios with `sdk/invalid-argument`.
