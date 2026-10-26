# @calmlens/sdk-php

## 0.1.0 (pre-release)

### New

- PHP client for moderation, streaming uploads, asset and folder management, events, CDN delivery, named lenses, signed URLs and browser upload tokens.
- Hash lists (`hashLists`) of PDQ hashes that image uploads are compared with: create, update and delete lists, and add hashes directly or from an image asset. The mock CalmLens keeps hash lists and their entries in memory.
- Moderation statuses (`pending`, `allowed`, `age-restricted`, `blocked`, `purged`), with `waitForDecision` returning once an asset is decided.
- CDN URLs with the `allowAgeRestricted` option for public age-restricted assets, and the `placeholder` resource.
- Webhook verification, offline request testing and an in-memory mock CalmLens with moderation outcomes.
- Laravel comment moderation and webhook example, and the Chirp short-post example.
