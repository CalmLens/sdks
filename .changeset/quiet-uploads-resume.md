---
"@calmlens/sdk-go": patch
---

Resume split uploads with an explicit IdempotencyKey by checking their recorded progress before sending file bytes. Already stored parts, including the first part, are no longer retransmitted. A fresh explicit key adds one small lookup request before the upload.
