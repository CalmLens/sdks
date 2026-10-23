# @calmlens/sdk-php

## 0.1.0 (pre-release)

### New

- PHP client for moderation, streaming uploads, asset and folder management, events, CDN delivery, named lenses, signed URLs and browser upload tokens.
- Moderation statuses (`pending`, `allowed`, `age-restricted`, `blocked`, `purged`), with `waitForDecision` returning once an asset is decided.
- CDN URLs with the `ageRestricted` option for public age-restricted assets.
- Webhook verification, offline request testing and an in-memory mock CalmLens with moderation outcomes.
- Laravel comment moderation and webhook example, and the Chirp short-post example.
