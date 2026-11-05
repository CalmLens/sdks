---
"@calmlens/sdk-java": minor
---

Moderation outcomes are reported as statuses, reviews no longer carry personal data, and uploads take tags.

- `AssetClassificationStatus.QUEUED` replaces `PENDING`: the asset is waiting for its content, such as a multipart upload still receiving parts, or for its turn. An asset is settled once its `classification().status()` is `COMPLETED` or `FAILED`.
- `assets.waitForDecision` returns once the asset is settled, and keeps waiting while it is queued or processing, even when a reviewer has already decided it. A failed asset is returned with its `classification().failureReason()`.
- Each `AssetReview` has `decidedBy()`, a `ReviewDecider` with a `type` (`user` or `api-key`) and the user's or API key's `id`, and `applied()`, which replaces `appliedToAsset()`. Reviews no longer include `reviewerName` or `reviewerEmail`.
- `AssetModeration.automatedStatus()` (`ALLOWED`, `LIMITED`, `AGE_RESTRICTED`, `BLOCKED` or `PURGED`) replaces `automatedAction()`, and is null before a decision.
- Each `RegionalDecision` has a `status()` (`LIMITED`, `AGE_RESTRICTED`, `BLOCKED` or `PURGED`) in place of its `action()`.
- `LinkSafetyDecision.links()` lists the `CheckedLink`s that take the link-safety action, each with its URL, final URL, redirects, source, verdict and evidence, in place of their indexes.
- `CategoryPolicySource.indexes()` names the deciding allowance or restriction rules, the decisive rule first; `index()` is removed.
- Assets no longer include `classification().labels()`, `classification().moderation().testCategoryActions()`, `testRegionalActions()`, `processingOptions()` or the policy-condition answers in `classification().moderation().raw().categories()`. `processingOptions` remains an upload option, and `UpdateAsset` no longer takes it. The `ClassificationLabel` and `TestRegionalAction` types are removed.
- `SubmitAsset.tags` and `ClassifyText.tags` set the asset's tags, which it keeps in `tags()`.
- Event facts: `asset.region-restricted` reports `status` in place of `action`, `asset.link-flagged` reports `link-status` in place of `link-action`, and `asset.review-requested` reports `automated-status` in place of `automated-outcome`. The asset snapshot's `classification.status` is `queued` where it was `pending`.
- `MockCalmLensServerClient` follows: an open multipart upload is queued, reviews record `decidedBy` as the mock API key (with no ID) and `applied`, decided assets carry `automatedStatus`, created assets keep their tags, and assets no longer include `processingOptions`.
