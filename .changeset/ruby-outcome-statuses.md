---
"@calmlens/sdk-ruby": minor
---

Moderation outcomes are reported as statuses, reviews no longer carry personal data, and uploads take tags.

- `classification.status` is `queued`, `processing`, `completed` or `failed`. `queued` replaces `pending`: the asset is waiting for its content, such as a multipart upload still receiving parts, or for its turn. An asset is settled once it is `completed` or `failed`.
- `assets.wait_for_decision` returns once the asset is settled, and keeps waiting while it is `queued` or `processing`, even when a reviewer has already decided it. A failed asset is returned with its `classification.failureReason`. `CalmLens::Assets::SETTLED_STATUSES` lists the settled statuses, replacing `PENDING_MODERATION_STATUS` and `FINISHED_PROCESSING_STATUSES`.
- Each review in `classification.moderation.manualReviews` has `decidedBy` (`{ 'type', 'id' }`, with `type` `user` or `api-key` and the user's or API key's ID) and `applied`, which replaces `appliedToAsset`. Reviews no longer include `reviewerName` or `reviewerEmail`.
- `classification.moderation.automatedStatus` (`allowed`, `limited`, `age-restricted`, `blocked` or `purged`) replaces `automatedAction`, and is absent before a decision.
- Each regional decision in `classification.moderation.regions` has a `status` (`limited`, `age-restricted`, `blocked` or `purged`) in place of its `action`.
- `classification.moderation.linkSafety.links` lists the checked links that take the link-safety action, each with its `url`, `finalUrl`, `redirects`, `source`, `verdict` and `evidence`, in place of their indexes.
- A category's `source` names the deciding allowance or restriction rules as `indexes`, the decisive rule first, in place of a single `index`.
- Assets no longer include `classification.labels`, `classification.moderation.testCategoryActions`, `classification.moderation.testRegionalActions`, `processingOptions` or the policy-condition answers in `classification.moderation.raw.categories`. `processing_options:` remains an upload option. The RBS signatures drop the `classification_label`, `processing_options` and `processing_features` types and add `review_actor`.
- `assets.create`, `assets.classify` and `text.classify` take a `tags:` option, an Array of Strings, which the asset keeps in `tags`.
- Event facts: `asset.region-restricted` reports `status` (`limited`, `age-restricted`, `blocked` or `purged`) in place of `action`, `asset.link-flagged` reports `link-status` (`limited`, `age-restricted` or `blocked`) in place of `link-action`, and `asset.review-requested` reports `automated-status` in place of `automated-outcome`. The asset snapshot's `classification.status` is `queued` where it was `pending`.
- `CalmLens::MockServerClient` follows: an open multipart upload is `queued`, reviews (through `assets.decide` or `decide`) record `decidedBy` as the mock API key with `applied: true`, decided assets carry `automatedStatus`, created assets keep their `tags`, and assets no longer include `processingOptions`.
