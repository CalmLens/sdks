---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

CalmLens IDs now name the kind of object they identify: a prefix, an underscore and 20 letters and digits, such as `proj_8fK2mQx7Lp4NvB3tRz9Y` for a project, `asset_5Gm2Rk8XqT3wLp9VbN4c` for an asset and `fldr_7Nc4Wq2Lm8Xt5Rk9Bv3P` for a folder. The in-memory mocks mint IDs the same way, and their ID option (`createId`, `create_id` or `CreateID`) now receives the prefix of the object it names (`asset`, `fldr`, `hl`, `hle`, `lens`, `evt` or `rev`). The mocks' `assets.batch` refuses an ID that is not an asset ID with `validation/invalid-format`, as the API does.
