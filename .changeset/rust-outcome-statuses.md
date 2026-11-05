---
"@calmlens/sdk-rust": minor
---

Moderation outcomes are reported as statuses, reviews no longer carry personal data, and uploads take tags.

- `AssetClassificationStatus::Queued` replaces `Pending`: the asset is waiting for its content, such as a multipart upload still receiving parts, or for its turn. An asset is settled once its `classification.status` is `Completed` or `Failed`.
- `assets().wait_for_decision` and `Asset::is_decided` return once the asset is settled, and keep waiting while it is `Queued` or `Processing`, even when a reviewer has already decided it. A failed asset is returned with its `classification.failure_reason`.
- Each `AssetReview` in `classification.moderation.manual_reviews` has `decided_by` (a `ReviewActor` with `actor_type`, `ReviewActorType::User` or `ApiKey`, and the user's or API key's `id`) and `applied`, which replaces `applied_to_asset`. Reviews no longer include `reviewer_name` or `reviewer_email`.
- `AssetModeration::automated_status` (`Option<AssetModerationDecision>`: `Allowed`, `Limited`, `AgeRestricted`, `Blocked` or `Purged`) replaces `automated_action`, and is `None` before a decision.
- Each `RegionalDecision` in `classification.moderation.regions` has a `status` (`AssetModerationDecision`: `Limited`, `AgeRestricted`, `Blocked` or `Purged`) in place of its `action`.
- `LinkSafetyDecision::links` lists the `CheckedLink`s that take the link-safety action, each with its `url`, `final_url`, `redirects`, `source`, `verdict` and `evidence`, in place of their indexes.
- `CategoryPolicySource::indexes` names the deciding allowance or restriction rules, the decisive rule first; the single `index` is removed.
- Assets no longer include `classification.labels`, `classification.moderation.test_category_actions`, `classification.moderation.test_regional_actions`, `processing_options` or the policy-condition answers in `classification.moderation.raw.categories`, and timeline segments from `assets().list_timeline` no longer include them either. `SubmitAsset::processing_options` remains an upload option; `UpdateAsset::processing_options` is removed, as an asset's processing options can't be changed after upload. `ClassificationLabel`, `PolicyConditionResult`, `CategoryResult::policy_conditions` and `models::TestRegionalAction` are removed.
- `SubmitAsset::tags` and `ClassifyText::tags` (`Option<Vec<String>>`) set the asset's tags on `assets().create`, `assets().classify` and `text().classify`. Uploads through an upload preset can't set tags.
- Event facts: `asset.region-restricted` reports `status` (`limited`, `age-restricted`, `blocked` or `purged`) in place of `action`, `asset.link-flagged` reports `link-status` (`limited`, `age-restricted` or `blocked`) in place of `link-action`, and `asset.review-requested` reports `automated-status` in place of `automated-outcome`. The asset snapshot's `classification.status` is `queued` where it was `pending`.
- `MockServerClient` follows: an open multipart upload is `queued`, reviews record `decided_by` as the mock API key with `applied: true`, decided assets carry `automated_status`, created assets keep their `tags`, and assets no longer include `processing_options`.
