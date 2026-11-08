---
"@calmlens/sdk": minor
---

`calmlens listen` retries a failed delivery the way CalmLens retries webhook deliveries: network errors, timeouts, `408`, `425`, `429` and `5xx` responses get up to 7 attempts with the same `x-calmlens-delivery` ID, each signed again, after 1, 2, 4, 8, 15 and 30 seconds, or longer when a `Retry-After` header asks, up to 60 seconds. Later events wait until the delivery succeeds or gives up. The CLI's help lists every key of the forwarded body and the ways to install it without Node.js: the install script at `https://calmlens.com/install.sh` (`install.ps1` on Windows), Homebrew and the release downloads.
