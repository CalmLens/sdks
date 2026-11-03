---
"@calmlens/sdk": minor
"@calmlens/sdk-go": minor
"@calmlens/sdk-python": minor
"@calmlens/sdk-rust": minor
"@calmlens/sdk-ruby": minor
"@calmlens/sdk-java": minor
"@calmlens/sdk-php": minor
---

The PHP SDK works with Guzzle 7 and Guzzle 8 (with Guzzle PSR-7 2 or 3 and Guzzle Promises 2 or 3), so it installs in Laravel 13 applications.

The Ruby, PHP and Python SDKs refuse an option a method doesn't take, such as a misspelt `externalId`, with `sdk/invalid-argument` before sending anything; Python checks an options dict against the method's keyword arguments. `text.classify` without text fails with `sdk/invalid-argument` in every SDK, where it gave `upload/invalid-payload`.

Every SDK refuses one-request content whose size it knows and that is over the upload limit with `upload/file-too-large` before sending it: images over 10 MiB, audio and video over 50 MiB and other files over 5,000 MiB. Every SDK's error codes include `image/invalid-input`, `image/unsupported-format` and `image/input-limit`.

The JavaScript SDK's main, `/server` and `/app` entry points load no other package at runtime, so `calmlens/app` works from an import map without a bundler.
