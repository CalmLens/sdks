---
"@calmlens/sdk": patch
"@calmlens/sdk-go": patch
"@calmlens/sdk-python": patch
"@calmlens/sdk-rust": patch
"@calmlens/sdk-ruby": patch
"@calmlens/sdk-java": patch
"@calmlens/sdk-php": patch
---

`waitForDecision` waits at most 2 seconds between checks, down from 5, so it returns sooner after a decision is made. It still checks again after 0.5 seconds, waits 1.5 times longer each time and stops at the same timeout.
