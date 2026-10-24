---
"@calmlens/sdk-rust": minor
---

Breaking: `SignedUrlOptions.resource` is a `SignedUrlResource` (`Original` or `Rendered`) instead of a `CdnResource`, so a signed URL can no longer be requested for the `placeholder` resource, which the API refuses.
