---
"@calmlens/sdk-go": patch
"@calmlens/sdk-java": patch
"@calmlens/sdk-php": patch
"@calmlens/sdk-python": patch
"@calmlens/sdk-ruby": patch
"@calmlens/sdk-rust": patch
---

Apply the decision timeout to in-flight asset lookups and their retries. A zero timeout still checks once.

Python also reports truncated CDN downloads during streaming reads. PHP returns the original upload error when a stream of unknown size cannot be rewound for a retry.
