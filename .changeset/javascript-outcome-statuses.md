---
"@calmlens/sdk": minor
---

Moderation outcomes are reported as statuses, reviews no longer carry personal data, and uploads take tags.

- `classification.status` is `queued`, `processing`, `completed` or `failed`. `queued` replaces `pending`: the asset is waiting for its content, such as a multipart upload still receiving parts, or for its turn. An asset is settled once it is `completed` or `failed`.
- `assets.waitForDecision` and `isAssetDecided` return once the asset is settled, and keep waiting while it is `queued` or `processing`, even when a reviewer has already decided it. A failed asset is returned with its `classification.failureReason`.
- Each review in `classification.moderation.manualReviews` has `decidedBy` (`{ type, id }`, with `type` `user` or `api-key` and the user's or API key's ID) and `applied`, which replaces `appliedToAsset`. Reviews no longer include `reviewerName` or `reviewerEmail`.
- `classification.moderation.automatedStatus` (`allowed`, `limited`, `age-restricted`, `blocked` or `purged`) replaces `automatedAction`, and is absent before a decision.
- Each regional decision in `classification.moderation.regions` has a `status` (`limited`, `age-restricted`, `blocked` or `purged`) in place of its `action`. `CalmLensMedia` reads it to show an asset as unavailable to viewers in that region.
- `classification.moderation.linkSafety.links` lists the checked links that take the link-safety action, each with its `url`, `finalUrl`, `redirects`, `source`, `verdict` and `evidence`, in place of their indexes.
- A category's `source` names the deciding allowance or restriction rules as `indexes`, the decisive rule first, in place of a single `index`.
- Assets no longer include `classification.labels`, `classification.moderation.testCategoryActions`, `classification.moderation.testRegionalActions`, `processingOptions` or the policy-condition answers in `classification.moderation.raw.categories`. `processingOptions` remains an upload option. The `ClassificationLabel` type is removed.
- `assets.create`, `assets.classify` and `text.classify` take a `tags` option, an array of strings, which the asset keeps in `tags`. Uploads through an upload preset can't set tags.
- An upload through an upload preset (`UploadedAsset`) now has `upload` (`status` and `partsReceived`) and `classification` (`status`, `failureReason` and, when the preset shows decisions, `moderation.status`), in place of its top-level `status`. The uploader keeps checking an upload until it is settled, and shows one whose processing failed as failed, uploading it again on retry.
- Event facts: `asset.region-restricted` reports `status` (`limited`, `age-restricted`, `blocked` or `purged`) in place of `action`, `asset.link-flagged` reports `link-status` (`limited`, `age-restricted` or `blocked`) in place of `link-action`, and `asset.review-requested` reports `automated-status` in place of `automated-outcome`. The asset snapshot's `classification.status` is `queued` where it was `pending`.
- The mock clients follow: an open multipart upload is `queued`, reviews record `decidedBy` as the mock API key with `applied: true`, decided assets carry `automatedStatus`, created assets keep their `tags`, browser uploads return the new `UploadedAsset` shape and refuse `metadata`, `tags`, `authorId`, `context` and `processingOptions` with `upload-preset/field-not-allowed`, and assets no longer include `processingOptions`.
