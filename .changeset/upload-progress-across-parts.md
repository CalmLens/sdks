---
"@calmlens/sdk": patch
---

The upload widget's progress bar counts a file uploaded in parts as one upload instead of restarting with each part. `createProgressFetch` counts the bytes of every request sent through it and takes an optional `totalBytes`, such as the file's size, to report against.
