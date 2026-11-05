---
"@calmlens/sdk-go": minor
---

Moderation outcomes are reported as statuses, reviews no longer carry personal data, and uploads take tags.

- `Classification.Status` is `queued`, `processing`, `completed` or `failed`. `ClassificationStatusQueued` (`queued`) replaces `ClassificationStatusPending`: the asset is waiting for its content, such as a multipart upload still receiving parts, or for its turn. An asset is settled once it is `completed` or `failed`.
- `Assets.WaitForDecision` returns once the asset is settled, and keeps waiting while it is `queued` or `processing`, even when a reviewer has already decided it. A failed asset is returned with its `Classification.FailureReason`.
- Each `AssetReview` in `Classification.Moderation.ManualReviews` has `DecidedBy` (a `ReviewActor` with `Type` `ReviewActorUser` or `ReviewActorAPIKey`, and the user's or API key's `ID`) and `Applied`, which replaces `AppliedToAsset`. Reviews no longer include `ReviewerName` or `ReviewerEmail`.
- `Classification.Moderation.AutomatedStatus` (`allowed`, `limited`, `age-restricted`, `blocked` or `purged`) replaces `AutomatedAction`, and is nil before a decision.
- Each `RegionalDecision` in `Classification.Moderation.Regions` has a `Status` (`limited`, `age-restricted`, `blocked` or `purged`) in place of its `Action`.
- `Classification.Moderation.LinkSafety.Links` lists the checked links (`CheckedLink`) that take the link-safety action, each with its `URL`, `FinalURL`, `Redirects`, `Source`, `Verdict` and `Evidence`, in place of their indexes.
- A category's `Source` (`CategoryPolicySource`) names the deciding allowance or restriction rules in `Indexes`, the decisive rule first; its `Index` field is removed.
- Assets no longer include `Classification.Labels`, `Classification.Moderation.TestCategoryActions`, `Classification.Moderation.TestRegionalActions`, `ProcessingOptions` or the policy-condition answers in `Classification.Moderation.Raw.Categories`, and findings timeline segments no longer include them either. The `PolicyConditionResult` type and `CategoryResult.PolicyConditions` are removed. `ProcessingOptions` remains an upload option. The `ClassificationLabel` and `TestRegionalAction` types are removed from the `calmlens` package.
- `SubmitAssetOptions` (for `Assets.Create` and `Assets.Classify`) and `ClassifyTextOptions` (for `Text.Classify`) take `Tags`, a list of strings, which the asset keeps in `Tags`.
- The mock client follows: an open multipart upload is `queued`, reviews record `DecidedBy` as the mock API key with `Applied` true, decided assets carry `AutomatedStatus`, created assets keep their tags, and assets no longer include `ProcessingOptions`, while the upload's processing options still apply.
