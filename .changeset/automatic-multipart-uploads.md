---
"@calmlens/sdk": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

Images can be uploaded in parts at any size up to 20 MiB, down to one final part: `upload/multipart-image-too-small` is gone. In JavaScript and Python, `assets.create` and `assets.classify` upload content larger than `partSizeBytes` (`part_size_bytes`, 8 MiB by default, from 5 MiB to 64 MiB) in parts when its size is known and it can be read again: each part has its own idempotency key (`<key>:part-<n>`) and is retried on its own, and calling again with the same `idempotencyKey` resumes the upload. Content in parts can be up to each type's limit, so images up to 20 MiB no longer need manual parts.
